/**
 * Metadata-only call index core: projector + bounded single-session partition.
 *
 * This module is the pure, dependency-light half of the new call index (D-026).
 * It never reads tool arguments, tool result content, model streams, reasoning,
 * `error.reason`/`error.name`, or raw `source` text; it only extracts the stable
 * lifecycle coordinates a call index needs. All sequence numbers are
 * non-negative safe integers and all timestamps are finite valid epoch values.
 *
 * The partition is a bounded, per-session accumulation:
 * - events dedupe by `seq`; a conflicting payload for an already seen `seq` is a
 *   coverage gap and never overwrites the first value;
 * - results may arrive before their call (same batch or a later batch) and are
 *   paired by `callId` plus turn/step, never by tool name alone;
 * - multiple calls sharing one `callId` stay as separate rows and are not
 *   guessed onto one another;
 * - a result must follow its call (`resultSeq > callSeq`) and a turn/step
 *   mismatch is not paired;
 * - the first real result (lowest `seq`) wins; surface replacements and
 *   synthetic crash-recovery results never override a real result;
 * - every observed `seq` (tool and non-tool control alike) participates in the
 *   continuity check, so a snapshot is `complete` only for a contiguous,
 *   gap-free `[0, cut)` range;
 * - capacity (events / calls / bytes / external reserve) and orphan bounds make
 *   the index degrade to `partial` instead of pretending to be complete.
 *
 * Raw events are never retained: a compact per-seq signature is kept only to
 * detect seq conflicts, and only bounded metadata rows survive.
 */
import { Buffer } from 'node:buffer'
import {
  KNOWN_SESSION_EVENT_TYPES,
  TOOL_NOT_STARTED,
  TOOL_OUTCOME_UNKNOWN,
} from '@deepseek-ai/dsh-session'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import type { CallIndexSourceKind } from './call-index-wire.ts'

/** One bounded, fixed reason code; never free-form error text. */
export type CallIndexReason =
  | 'malformed-event'
  | 'invalid-seq'
  | 'invalid-time'
  | 'unreadable-field'
  | 'unknown-required-event'
  | 'malformed-tool-call'
  | 'malformed-tool-result'
  | 'field-too-long'
  | 'seq-conflict'
  | 'duplicate-call-id'
  | 'result-before-call'
  | 'turn-step-mismatch'
  | 'clock-anomaly'
  | 'orphan-capacity'
  | 'orphan-result'
  | 'index-capacity'
  | 'reserve-denied'
  | 'projection-gap'
  /**
   * The backend declared fewer events than the log actually holds.
   *
   * The jsonl backend counts only the header record of a multi-frame zstd
   * artifact, so a long log can declare `eventCount: 1`. The scan must read past
   * that declaration (D-030); this code records that it happened, because a
   * silently-truncated scan and a genuinely short log look identical otherwise.
   */
  | 'event-count-underreported'

const CALL_INDEX_REASONS: ReadonlySet<string> = new Set<CallIndexReason>([
  'malformed-event',
  'invalid-seq',
  'invalid-time',
  'unreadable-field',
  'unknown-required-event',
  'malformed-tool-call',
  'malformed-tool-result',
  'field-too-long',
  'seq-conflict',
  'duplicate-call-id',
  'result-before-call',
  'turn-step-mismatch',
  'clock-anomaly',
  'orphan-capacity',
  'orphan-result',
  'index-capacity',
  'reserve-denied',
  'projection-gap',
  'event-count-underreported',
])

const MAX_ID_LENGTH = 512
const MAX_TOOL_NAME_LENGTH = 512
const MAX_ERROR_CODE_LENGTH = 80
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]+$/

/** A projected, metadata-only call-index event. */
export interface CallIndexEvent {
  readonly seq: number
  readonly time: number
  readonly kind: 'call' | 'result' | 'other'
  readonly turn?: number
  readonly step?: number
  readonly callId?: string
  readonly toolName?: string
  readonly outcome?: 'success' | 'error' | 'cancelled' | 'unresolved'
  readonly errorCode?: string
  readonly replacement?: boolean
  readonly turnClosed?: boolean
}

/** One call row as exposed to a snapshot. */
export interface CallIndexRow {
  sessionId: string
  callSeq: number
  callId: string
  toolName: string
  turn?: number
  step?: number
  startedAt: number
  endedAt?: number
  resultSeq?: number
  durationMs?: number
  outcome: 'success' | 'error' | 'cancelled' | 'unresolved' | 'unknown' | 'running'
  inherited: boolean
  sourceKind: CallIndexSourceKind
  /**
   * PTC nesting depth. Always `'unknown'`: the PTC parent/child contract is not
   * verified (plan §13.3), and a guessed layer would double-count nested calls.
   */
  layer: 'unknown'
}

/**
 * Provenance of one call, decided by the caller from trusted catalog evidence.
 *
 * The partition never inspects a tool name itself: `mcp__` prefixes are a
 * naming convention, not proof, so an unattributed call stays `unknown` (plan
 * §3.5). The resolver is optional so a Host without the capability service
 * still indexes calls — with honest `unknown` provenance.
 */
export type CallIndexSourceResolver = (toolName: string) => CallIndexSourceKind

export interface CallIndexPartitionOptions {
  sessionId: string
  revision: string
  inheritedEventCount: number
  maxEvents?: number
  maxCalls?: number
  maxBytes?: number
  maxOrphans?: number
  reserve?: (bytes: number) => boolean
  /**
   * Provenance resolver built from trusted catalog evidence.
   *
   * Omitted means "no trusted evidence available", which yields `unknown` for
   * every row — not a guess. A resolver that throws is treated the same way for
   * that call only, so one bad catalog read cannot blank a whole partition.
   */
  resolveSource?: CallIndexSourceResolver
}

export interface CallIndexPartitionSnapshot {
  sessionId: string
  revision: string
  cut: number
  rows: readonly CallIndexRow[]
  coverage: 'complete' | 'partial'
  reasons: readonly string[]
  estimatedBytes: number
}

const UNREADABLE = Symbol('unreadable')
type UnknownRecord = { readonly [key: string]: unknown }

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

/** Read exactly one whitelisted property; a throwing getter becomes {@link UNREADABLE}. */
function readField(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return UNREADABLE
  }
}

function readOptionalField(value: unknown, key: string): unknown {
  const field = readField(value, key)
  return field === UNREADABLE ? undefined : field
}

function safeSeq(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

const safeCount = safeSeq

function safeTime(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isFinite(new Date(value).getTime())
    ? value
    : undefined
}

interface BoundedId {
  readonly value?: string
  readonly tooLong: boolean
}

function boundedId(value: unknown, max: number): BoundedId {
  if (typeof value !== 'string') return { tooLong: false }
  if (value.trim().length === 0) return { tooLong: false }
  if (value.length > max) return { tooLong: true }
  return { value, tooLong: false }
}

function isReplaceSurfaceOp(value: unknown): boolean {
  if (value === UNREADABLE || !isRecord(value)) return false
  return readOptionalField(value, 'op') === 'replace'
}

function projectToolCall(
  raw: unknown,
  seq: number,
  time: number,
  reasons: CallIndexReason[],
): { event?: CallIndexEvent; reasons: CallIndexReason[] } {
  const data = readField(raw, 'data')
  if (data === UNREADABLE) {
    reasons.push('unreadable-field')
    return { reasons }
  }
  if (!isRecord(data)) {
    reasons.push('malformed-tool-call')
    return { reasons }
  }
  const callIdRaw = readField(data, 'callId')
  const nameRaw = readField(data, 'name')
  if (callIdRaw === UNREADABLE || nameRaw === UNREADABLE) {
    reasons.push('unreadable-field')
    return { reasons }
  }
  const callId = boundedId(callIdRaw, MAX_ID_LENGTH)
  const name = boundedId(nameRaw, MAX_TOOL_NAME_LENGTH)
  if (callId.tooLong || name.tooLong) {
    reasons.push('field-too-long')
    return { reasons }
  }
  if (callId.value === undefined || name.value === undefined) {
    reasons.push('malformed-tool-call')
    return { reasons }
  }
  const turn = safeCount(readOptionalField(data, 'turn'))
  const step = safeCount(readOptionalField(data, 'step'))
  const event: CallIndexEvent = {
    seq,
    time,
    kind: 'call',
    callId: callId.value,
    toolName: name.value,
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
  }
  return { event, reasons }
}

function projectToolResult(
  raw: unknown,
  seq: number,
  time: number,
  reasons: CallIndexReason[],
): { event?: CallIndexEvent; reasons: CallIndexReason[] } {
  const data = readField(raw, 'data')
  if (data === UNREADABLE) {
    reasons.push('unreadable-field')
    return { reasons }
  }
  if (!isRecord(data)) {
    reasons.push('malformed-tool-result')
    return { reasons }
  }
  const message = readField(data, 'message')
  if (message === UNREADABLE) {
    reasons.push('unreadable-field')
    return { reasons }
  }
  if (!isRecord(message)) {
    reasons.push('malformed-tool-result')
    return { reasons }
  }
  const callIdRaw = readField(message, 'toolCallId')
  const isErrorRaw = readField(message, 'isError')
  if (callIdRaw === UNREADABLE || isErrorRaw === UNREADABLE) {
    reasons.push('unreadable-field')
    return { reasons }
  }
  const callId = boundedId(callIdRaw, MAX_ID_LENGTH)
  if (callId.tooLong) {
    reasons.push('field-too-long')
    return { reasons }
  }
  if (callId.value === undefined) {
    reasons.push('malformed-tool-result')
    return { reasons }
  }
  if (isErrorRaw !== undefined && typeof isErrorRaw !== 'boolean') {
    reasons.push('malformed-tool-result')
    return { reasons }
  }
  const replacement = isReplaceSurfaceOp(readField(raw, 'surfaceOp'))
  const turn = safeCount(readOptionalField(data, 'turn'))
  const step = safeCount(readOptionalField(data, 'step'))
  const coords = {
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
  }
  if (isErrorRaw !== true) {
    return {
      event: {
        seq,
        time,
        kind: 'result',
        callId: callId.value,
        outcome: 'success',
        ...coords,
        ...(replacement ? { replacement: true } : {}),
      },
      reasons,
    }
  }
  const errorRaw = readField(data, 'error')
  if (errorRaw === UNREADABLE) {
    reasons.push('unreadable-field')
    return { reasons }
  }
  let code: string | undefined
  if (isRecord(errorRaw)) {
    const codeRaw = readField(errorRaw, 'code')
    if (codeRaw === UNREADABLE) {
      reasons.push('unreadable-field')
      return { reasons }
    }
    // `error.name` and `error.reason` are deliberately never read.
    if (typeof codeRaw === 'string' && codeRaw.length <= MAX_ERROR_CODE_LENGTH && ERROR_CODE_PATTERN.test(codeRaw)) {
      code = codeRaw
    }
  }
  const recovery = code === TOOL_NOT_STARTED || code === TOOL_OUTCOME_UNKNOWN
  if (recovery) {
    // Synthetic crash-recovery results are not failures; keep the call unresolved.
    return {
      event: {
        seq,
        time,
        kind: 'result',
        callId: callId.value,
        outcome: 'unresolved',
        replacement: true,
        ...(code === undefined ? {} : { errorCode: code }),
        ...coords,
      },
      reasons,
    }
  }
  const cancelled = code === TOOL_ABORTED || code === TOOL_ABORTED_BEFORE_DISPATCH
  const outcome: 'cancelled' | 'error' = cancelled ? 'cancelled' : 'error'
  return {
    event: {
      seq,
      time,
      kind: 'result',
      callId: callId.value,
      outcome,
      ...(code === undefined ? {} : { errorCode: code }),
      ...coords,
      ...(replacement ? { replacement: true } : {}),
    },
    reasons,
  }
}

/**
 * Project one raw session event to a metadata-only {@link CallIndexEvent}.
 *
 * Unknown *required* event types are a coverage gap; unknown *ignorable* types
 * project as `other`. Control events expose only `seq`/`time`/`type` plus the
 * closing `turn` of `turn/end`. A throwing getter on any read field is reported
 * as `unreadable-field` and never propagated.
 */
export function projectCallIndexEvent(raw: unknown): { event?: CallIndexEvent; reasons: readonly string[] } {
  const reasons: CallIndexReason[] = []
  const push = (reason: CallIndexReason): void => {
    if (!reasons.includes(reason)) reasons.push(reason)
  }
  if (!isRecord(raw)) return { reasons: ['malformed-event'] }

  const typeRaw = readField(raw, 'type')
  if (typeRaw === UNREADABLE) return { reasons: ['unreadable-field'] }
  if (typeof typeRaw !== 'string' || typeRaw.length === 0) return { reasons: ['malformed-event'] }
  const type = typeRaw

  const seqRaw = readField(raw, 'seq')
  const timeRaw = readField(raw, 'time')
  if (seqRaw === UNREADABLE || timeRaw === UNREADABLE) return { reasons: ['unreadable-field'] }
  const seq = safeSeq(seqRaw)
  const time = safeTime(timeRaw)
  if (seq === undefined) push('invalid-seq')
  if (time === undefined) push('invalid-time')
  if (seq === undefined || time === undefined) return { reasons }

  if (!KNOWN_SESSION_EVENT_TYPES.has(type) && readOptionalField(raw, 'ignorable') !== true) {
    push('unknown-required-event')
    return { reasons }
  }

  if (type === 'tool/call') return projectToolCall(raw, seq, time, reasons)
  if (type === 'tool/result') return projectToolResult(raw, seq, time, reasons)

  if (type === 'turn/end') {
    const data = readField(raw, 'data')
    if (data === UNREADABLE) {
      push('unreadable-field')
      return { event: { seq, time, kind: 'other', turnClosed: true }, reasons }
    }
    const turnRaw = readField(data, 'turn')
    if (turnRaw === UNREADABLE) {
      push('unreadable-field')
      return { event: { seq, time, kind: 'other', turnClosed: true }, reasons }
    }
    const turn = safeCount(turnRaw)
    return {
      event: { seq, time, kind: 'other', turnClosed: true, ...(turn === undefined ? {} : { turn }) },
      reasons,
    }
  }

  return { event: { seq, time, kind: 'other' }, reasons }
}

interface ResultRecord {
  readonly seq: number
  readonly time: number
  readonly callId: string
  readonly outcome: 'success' | 'error' | 'cancelled' | 'unresolved'
  readonly errorCode?: string
  readonly replacement: boolean
  readonly turn?: number
  readonly step?: number
}

interface CallRecord {
  readonly seq: number
  readonly callId: string
  readonly toolName: string
  readonly turn?: number
  readonly step?: number
  readonly startedAt: number
  readonly inherited: boolean
  readonly results: ResultRecord[]
  ambiguous: boolean
}

const DEFAULT_MAX_EVENTS = 250_000
const DEFAULT_MAX_CALLS = 100_000
const DEFAULT_MAX_BYTES = 8_000_000
const DEFAULT_MAX_ORPHANS = 2_000
const MAX_REASONS = 32

function resolveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Conservative per-entry byte estimate: payload copy plus projection/row overhead. */
function estimateBytes(value: unknown): number {
  let json = ''
  try {
    json = JSON.stringify(value) ?? ''
  } catch {
    json = ''
  }
  return 2 * utf8Length(json) + 1024
}

function signatureOf(event: CallIndexEvent): string {
  return JSON.stringify([
    event.kind,
    event.seq,
    event.time,
    event.turn ?? null,
    event.step ?? null,
    event.callId ?? null,
    event.toolName ?? null,
    event.outcome ?? null,
    event.errorCode ?? null,
    event.replacement === true,
    event.turnClosed === true,
  ])
}

function pickLowestSeq(results: readonly ResultRecord[]): ResultRecord | undefined {
  let best: ResultRecord | undefined
  for (const result of results) {
    if (best === undefined || result.seq < best.seq) best = result
  }
  return best
}

/** Bounded, single-session call index partition. */
export class CallIndexPartition {
  private readonly sessionId: string
  private readonly revision: string
  private readonly inheritedEventCount: number
  private readonly maxEvents: number
  private readonly maxCalls: number
  private readonly maxBytes: number
  private readonly maxOrphans: number
  private readonly reserveCallback?: (bytes: number) => boolean
  private readonly resolveSource?: CallIndexSourceResolver
  /** Resolved provenance per tool name; a catalog read must happen once per name. */
  private readonly sourceByTool = new Map<string, CallIndexSourceKind>()

  /** seq -> compact signature, used only for dedupe/conflict detection. */
  private readonly seqMeta = new Map<number, string>()
  private readonly calls: CallRecord[] = []
  private readonly callsByCallId = new Map<string, CallRecord[]>()
  private readonly orphans = new Map<string, ResultRecord[]>()
  private readonly reasonCodes = new Set<string>()
  private readonly turnClosedSeq = new Map<number, number>()

  private stopped = false
  private bytes = 0
  private orphanCount = 0

  constructor(options: CallIndexPartitionOptions) {
    if (typeof options !== 'object' || options === null) throw new TypeError('options are required')
    if (typeof options.sessionId !== 'string' || options.sessionId.trim().length === 0) {
      throw new TypeError('sessionId must be a non-empty string')
    }
    if (typeof options.revision !== 'string') throw new TypeError('revision must be a string')
    if (!Number.isSafeInteger(options.inheritedEventCount) || options.inheritedEventCount < 0) {
      throw new RangeError('inheritedEventCount must be a non-negative safe integer')
    }
    this.sessionId = options.sessionId
    this.revision = options.revision
    this.inheritedEventCount = options.inheritedEventCount
    this.maxEvents = resolveLimit(options.maxEvents, DEFAULT_MAX_EVENTS, 'maxEvents')
    this.maxCalls = resolveLimit(options.maxCalls, DEFAULT_MAX_CALLS, 'maxCalls')
    this.maxBytes = resolveLimit(options.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes')
    this.maxOrphans = resolveLimit(options.maxOrphans, DEFAULT_MAX_ORPHANS, 'maxOrphans')
    this.reserveCallback = options.reserve
    this.resolveSource = options.resolveSource
  }

  /** Ingest a batch of already-projected events. Ingestion stops at the first capacity breach. */
  ingest(events: readonly CallIndexEvent[]): void {
    for (const event of events) {
      if (this.stopped) break
      this.ingestOne(event)
    }
  }

  /** Record a coverage gap identified outside the projector (fixed code or generic fallback). */
  addGap(reason: string): void {
    this.addReason(reason)
  }

  usage(): { events: number; calls: number; bytes: number } {
    return { events: this.seqMeta.size, calls: this.calls.length, bytes: this.bytes }
  }

  snapshot(cut: number): CallIndexPartitionSnapshot {
    const limit = Number.isSafeInteger(cut) && cut >= 0 ? cut : 0
    const reasons = new Set<string>(this.reasonCodes)
    const rows: CallIndexRow[] = []
    for (const record of this.calls) {
      if (record.seq >= limit) continue
      rows.push(this.buildRow(record, limit, reasons))
    }
    rows.sort((a, b) => a.callSeq - b.callSeq)
    const orphanWithinCut = [...this.orphans.values()].some(results => results.some(result => result.seq < limit))
    if (orphanWithinCut) reasons.add('orphan-result')
    return {
      sessionId: this.sessionId,
      revision: this.revision,
      cut: limit,
      rows,
      coverage: this.isComplete(limit) && reasons.size === 0 ? 'complete' : 'partial',
      reasons: [...reasons],
      estimatedBytes: this.bytes,
    }
  }

  private addReason(reason: string): void {
    if (this.reasonCodes.size >= MAX_REASONS) return
    this.reasonCodes.add(CALL_INDEX_REASONS.has(reason) ? reason : 'projection-gap')
  }

  private reachCapacity(reason: CallIndexReason): void {
    this.stopped = true
    this.addReason(reason)
  }

  private tryReserve(bytes: number, denial: CallIndexReason): boolean {
    if (this.stopped) return false
    if (this.bytes + bytes > this.maxBytes) {
      this.reachCapacity('index-capacity')
      return false
    }
    if (this.reserveCallback !== undefined) {
      let accepted = false
      try {
        accepted = this.reserveCallback(bytes) === true
      } catch {
        accepted = false
      }
      if (!accepted) {
        this.reachCapacity(denial)
        return false
      }
    }
    this.bytes += bytes
    return true
  }

  private ingestOne(event: CallIndexEvent): void {
    if (safeSeq(event.seq) === undefined || safeTime(event.time) === undefined) {
      this.addReason('malformed-event')
      return
    }
    const signature = signatureOf(event)
    const existing = this.seqMeta.get(event.seq)
    if (existing !== undefined) {
      if (existing !== signature) this.addReason('seq-conflict')
      return
    }
    if (this.seqMeta.size >= this.maxEvents) {
      this.reachCapacity('index-capacity')
      return
    }
    const seqBytes = estimateBytes({
      kind: event.kind,
      seq: event.seq,
      time: event.time,
      callId: event.callId ?? null,
      toolName: event.toolName ?? null,
      outcome: event.outcome ?? null,
    })
    if (!this.tryReserve(seqBytes, 'reserve-denied')) return
    this.seqMeta.set(event.seq, signature)

    if (event.kind === 'other') {
      if (event.turnClosed === true && event.turn !== undefined && safeCount(event.turn) !== undefined) {
        const previous = this.turnClosedSeq.get(event.turn)
        if (previous === undefined || event.seq < previous) this.turnClosedSeq.set(event.turn, event.seq)
      }
      return
    }
    if (event.kind === 'call') {
      this.ingestCall(event)
      return
    }
    if (event.kind === 'result') {
      this.ingestResult(event)
    }
  }

  private ingestCall(event: CallIndexEvent): void {
    const callId = event.callId
    const toolName = event.toolName
    if (typeof callId !== 'string' || callId.trim().length === 0
      || typeof toolName !== 'string' || toolName.trim().length === 0) {
      this.addReason('malformed-tool-call')
      return
    }
    if (this.calls.length >= this.maxCalls) {
      this.reachCapacity('index-capacity')
      return
    }
    const record: CallRecord = {
      seq: event.seq,
      callId,
      toolName,
      ...(event.turn === undefined ? {} : { turn: event.turn }),
      ...(event.step === undefined ? {} : { step: event.step }),
      startedAt: event.time,
      inherited: event.seq < this.inheritedEventCount,
      results: [],
      ambiguous: false,
    }
    const bytes = estimateBytes({
      kind: 'call',
      seq: event.seq,
      callId,
      toolName,
      turn: event.turn ?? null,
      step: event.step ?? null,
      time: event.time,
    })
    if (!this.tryReserve(bytes, 'reserve-denied')) return
    this.calls.push(record)
    const bucket = this.callsByCallId.get(callId)
    if (bucket === undefined) this.callsByCallId.set(callId, [record])
    else {
      bucket.push(record)
      for (const call of bucket) call.ambiguous = true
      this.addReason('duplicate-call-id')
    }
    this.retryOrphans(callId)
  }

  private ingestResult(event: CallIndexEvent): void {
    const callId = event.callId
    const outcome = event.outcome
    if (typeof callId !== 'string' || callId.trim().length === 0) {
      this.addReason('malformed-tool-result')
      return
    }
    if (outcome !== 'success' && outcome !== 'error' && outcome !== 'cancelled' && outcome !== 'unresolved') {
      this.addReason('malformed-tool-result')
      return
    }
    const replacement = event.replacement === true || outcome === 'unresolved'
    // A surface replacement that is not a recovery marker is a replay, not a fresh result.
    if (replacement && outcome !== 'unresolved') return
    const result: ResultRecord = {
      seq: event.seq,
      time: event.time,
      callId,
      outcome,
      replacement,
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
      ...(event.turn === undefined ? {} : { turn: event.turn }),
      ...(event.step === undefined ? {} : { step: event.step }),
    }
    const status = this.tryAttachResult(result)
    if (status === 'orphan') this.bufferOrphan(result)
  }

  private isCompatible(record: CallRecord, result: ResultRecord): boolean {
    if (result.seq <= record.seq) return false
    if (result.turn !== undefined && record.turn !== undefined && result.turn !== record.turn) return false
    if (result.step !== undefined && record.step !== undefined && result.step !== record.step) return false
    return true
  }

  private tryAttachResult(result: ResultRecord): 'attached' | 'orphan' | 'skipped' {
    const bucket = this.callsByCallId.get(result.callId)
    if (bucket === undefined || bucket.length === 0) return 'orphan'
    if (bucket.length > 1) { this.addReason('duplicate-call-id'); return 'skipped' }
    const candidates = bucket.filter(record => this.isCompatible(record, result))
    if (candidates.length === 0) {
      if (bucket.every(record => result.seq <= record.seq)) {
        this.addReason('result-before-call')
        return 'skipped'
      }
      const mismatch = bucket.some(record => (
        (result.turn !== undefined && record.turn !== undefined && result.turn !== record.turn)
        || (result.step !== undefined && record.step !== undefined && result.step !== record.step)
      ))
      if (mismatch) this.addReason('turn-step-mismatch')
      return 'orphan'
    }
    if (candidates.length > 1) {
      for (const record of candidates) record.ambiguous = true
      this.addReason('duplicate-call-id')
      return 'skipped'
    }
    const record = candidates[0]
    const bytes = estimateBytes({
      kind: 'result',
      seq: result.seq,
      callId: result.callId,
      outcome: result.outcome,
      errorCode: result.errorCode ?? null,
      replacement: result.replacement,
      time: result.time,
    })
    if (!this.tryReserve(bytes, 'reserve-denied')) return 'skipped'
    record.results.push(result)
    if (result.time < record.startedAt) this.addReason('clock-anomaly')
    return 'attached'
  }

  private bufferOrphan(result: ResultRecord): void {
    if (this.orphanCount >= this.maxOrphans) {
      this.reachCapacity('orphan-capacity')
      return
    }
    const bytes = estimateBytes({ kind: 'result-orphan', seq: result.seq, callId: result.callId })
    if (!this.tryReserve(bytes, 'reserve-denied')) return
    const list = this.orphans.get(result.callId)
    if (list === undefined) this.orphans.set(result.callId, [result])
    else list.push(result)
    this.orphanCount += 1
  }

  private retryOrphans(callId: string): void {
    const list = this.orphans.get(callId)
    if (list === undefined) return
    this.orphans.delete(callId)
    this.orphanCount -= list.length
    const remaining: ResultRecord[] = []
    const ordered = [...list].sort((a, b) => a.seq - b.seq)
    for (const result of ordered) {
      if (this.stopped) {
        remaining.push(result)
        continue
      }
      if (this.tryAttachResult(result) === 'orphan') remaining.push(result)
    }
    if (remaining.length > 0) {
      this.orphans.set(callId, remaining)
      this.orphanCount += remaining.length
    }
  }

  /**
   * Resolve one call's provenance from the caller's trusted evidence.
   *
   * Cached per tool name because a Session can make thousands of calls to the
   * same tool and the catalog lookup is a synchronous map read. A throwing
   * resolver degrades that call to `unknown`; it never propagates and never
   * guesses a kind from the name.
   */
  private sourceKindFor(toolName: string): CallIndexSourceKind {
    const cached = this.sourceByTool.get(toolName)
    if (cached !== undefined) return cached
    let resolved: CallIndexSourceKind = 'unknown'
    if (this.resolveSource !== undefined) {
      try {
        const value = this.resolveSource(toolName)
        if (value === 'mcp' || value === 'plugin-tool' || value === 'native' || value === 'skill' || value === 'unknown') {
          resolved = value
        }
      } catch {
        resolved = 'unknown'
      }
    }
    this.sourceByTool.set(toolName, resolved)
    return resolved
  }

  private buildRow(record: CallRecord, limit: number, reasons: Set<string>): CallIndexRow {
    const results = record.results.filter(result => result.seq < limit)
    const real = results.filter(result => result.replacement !== true)
    const recovered = results.filter(result => result.replacement === true && result.outcome === 'unresolved')
    const chosen = pickLowestSeq(real) ?? pickLowestSeq(recovered)
    const base = {
      sessionId: this.sessionId,
      callSeq: record.seq,
      callId: record.callId,
      toolName: record.toolName,
      ...(record.turn === undefined ? {} : { turn: record.turn }),
      ...(record.step === undefined ? {} : { step: record.step }),
      startedAt: record.startedAt,
      inherited: record.inherited,
      sourceKind: this.sourceKindFor(record.toolName),
      layer: 'unknown' as const,
    }
    if (record.ambiguous) return { ...base, outcome: 'unknown' }
    if (chosen !== undefined) {
      const duration = chosen.time - record.startedAt
      if (duration < 0) reasons.add('clock-anomaly')
      return {
        ...base,
        endedAt: chosen.time,
        resultSeq: chosen.seq,
        ...(duration >= 0 ? { durationMs: duration } : {}),
        outcome: chosen.outcome,
      }
    }
    if (record.ambiguous) return { ...base, outcome: 'unknown' }
    if (record.turn !== undefined) {
      const closed = this.turnClosedSeq.get(record.turn)
      if (closed !== undefined && closed < limit) return { ...base, outcome: 'unresolved' }
    }
    // An unclosed historic log is not evidence that an operation is running now.
    return { ...base, outcome: 'unresolved' }
  }

  private isComplete(limit: number): boolean {
    if (this.stopped) return false
    if (this.reasonCodes.size > 0) return false
    for (let seq = 0; seq < limit; seq += 1) {
      if (!this.seqMeta.has(seq)) return false
    }
    return true
  }
}
