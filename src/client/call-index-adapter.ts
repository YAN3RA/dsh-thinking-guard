/**
 * Pure adapter from the `callIndex` wire replies (`src/usage/call-index-wire.ts`,
 * mounted by `src/client/call-index-remote.ts`) to the view models the call
 * statistics UI consumes.
 *
 * WHY THIS FILE EXISTS — the Host answers seven reply kinds (`status`, `task`,
 * `summary`, `sessions`, `calls`, `detail`, `error`) whose payloads are typed as
 * `Record<string, unknown>` after the wire's zod projector. A panel cannot render
 * that: it needs closed, named shapes (a status view, an overview with `bySource`
 * / `byDay`, a page of rows, one row's detail) plus a single error envelope with
 * a locale key. That translation is all this module does.
 *
 * WHAT IT NEVER DOES:
 * - Never spreads a raw wire object into a view. Every view is built field by
 *   field from validated reads (`readString`, `readCount`, …), so an unexpected
 *   extra key on the wire can never leak into a React prop tree.
 * - Never invents a fact. A field the wire marks required and syntax-validates
 *   is required here too: when it is missing or malformed the whole reply
 *   degrades to `internal-error` instead of a fabricated `0`/`''`. Fields the
 *   wire marks optional (`asOf`, `hasUpdates`, `totalExact`, `semanticCoverage`,
 *   `aggregates`, `task`, `features`) stay optional here and are omitted — an
 *   older Host that does not send `aggregates` yields `aggregates: undefined`,
 *   never a throw and never a zero-filled trend line.
 * - Never imports a Host module, a React module, the Remote contribution or a
 *   Session object: it depends only on the browser-safe wire constants. That
 *   keeps it directly testable and safe to bundle in the web client.
 * - Never writes user-facing copy. Error codes map to *locale keys* only, so
 *   the zh/en dictionaries stay the single place text is written.
 *
 * CONTRACT NOTES (deliberate, see the task report):
 * - The view `kind` of `summary` stays `summary` (the interface is named
 *   {@link CallIndexOverviewView}) so a caller can dispatch on the wire kind
 *   without a rename table.
 * - Every mapper accepts `unknown`, not `CallIndexReply`: the reply type's
 *   `data` is an open record, and letting an untyped `result.value` in makes
 *   the adapter total instead of forcing casts at every call site.
 * - Request building (query filters, `dayOffsetMinutes`, cursors) is *not* here:
 *   it belongs to the request schemas in `call-index-wire.ts`.
 *
 * @module dsh-thinking-guard/client/call-index-adapter
 */
import {
  CALL_INDEX_ERROR_REASONS,
  CALL_INDEX_MAX_DAY_BUCKETS,
  CALL_INDEX_MAX_DAY_OFFSET_MINUTES,
  CALL_INDEX_MIN_DAY_OFFSET_MINUTES,
  CALL_INDEX_OUTCOMES,
  CALL_INDEX_REPLY_KINDS,
  CALL_INDEX_SOURCE_KINDS,
  type CallIndexErrorReason,
  type CallIndexOutcome,
  type CallIndexReplyKind,
  type CallIndexSourceKind,
} from '../usage/call-index-wire.ts'

/** Reply kinds that carry a payload; `error` does not. */
type PayloadReplyKind = Exclude<CallIndexReplyKind, 'error'>

/** Coverage of the frozen snapshot a page was cut from. */
export type CallIndexCoverage = 'complete' | 'partial' | 'unknown'

/**
 * Scan phase as reported by `getIndexStatus`.
 *
 * MUST stay identical to the wire's `statusDataSchema.phase` enum. It used to
 * list only `idle / running / cancelled / failed` — missing `complete` AND
 * `partial`, the two values a finished scan actually reports. `projectStatus`
 * therefore rejected every real status reply and the page showed
 * 「读取失败：Host 返回了无效的响应结构」 while the Host was answering correctly.
 *
 * This is the client half of D-033: fixing the wire allowlist was not enough,
 * because the adapter keeps its own copy of the enum.
 */
export const CALL_INDEX_STATUS_PHASES = ['idle', 'running', 'complete', 'partial', 'cancelled', 'failed'] as const
export type CallIndexStatusPhase = (typeof CALL_INDEX_STATUS_PHASES)[number]

/** Lifecycle phase of one explicit index run. */
export const CALL_INDEX_TASK_PHASES = ['running', 'complete', 'partial', 'cancelled', 'failed'] as const
export type CallIndexTaskPhase = (typeof CALL_INDEX_TASK_PHASES)[number]

/** Why the scope is not usable, as reported by the Host. */
export type CallIndexScopeReason = 'not-enabled' | 'unsupported-scope' | 'persistence-unavailable'

/** The only value the wire ever puts in `data.corpus`. */
export type CallIndexCorpus = 'persisted-plus-observed-live'

/** Per-Session scan state; the Host never claims `unknown` here. */
export type CallIndexSessionCoverage = 'complete' | 'partial'

/** Bounded reason list length (mirrors the wire's `.max(32)`). */
const MAX_REASONS = 32

/** Stable dictionary keys for the ten failure codes. */
export type CallIndexMessageKey =
  | 'callIndex.error.invalidRequest'
  | 'callIndex.error.scopeDisabled'
  | 'callIndex.error.persistenceUnavailable'
  | 'callIndex.error.cursorStale'
  | 'callIndex.error.queryCapacity'
  | 'callIndex.error.replyTooLarge'
  | 'callIndex.error.notVisible'
  | 'callIndex.error.runtimeUnavailable'
  | 'callIndex.error.taskNotFound'
  | 'callIndex.error.internal'

/**
 * Failure code → locale key. Exhaustive over {@link CallIndexErrorReason}, so a
 * new code cannot be added without a key.
 */
export const CALL_INDEX_ERROR_MESSAGE_KEYS: Readonly<Record<CallIndexErrorReason, CallIndexMessageKey>> =
  Object.freeze({
    'invalid-request': 'callIndex.error.invalidRequest',
    'scope-disabled': 'callIndex.error.scopeDisabled',
    'persistence-unavailable': 'callIndex.error.persistenceUnavailable',
    'cursor-stale': 'callIndex.error.cursorStale',
    'query-capacity': 'callIndex.error.queryCapacity',
    'reply-too-large': 'callIndex.error.replyTooLarge',
    'not-visible': 'callIndex.error.notVisible',
    'runtime-unavailable': 'callIndex.error.runtimeUnavailable',
    'task-not-found': 'callIndex.error.taskNotFound',
    'internal-error': 'callIndex.error.internal',
  })

/**
 * Advisory retry hint per code.
 *
 * `true` means "issuing the request again — with any cached cursor/snapshot id
 * discarded and, where relevant, a narrower filter — can plausibly succeed".
 * It is a hint for a retry button, not a promise: `cursor-stale` and
 * `query-capacity` in particular need a *fresh* request, never a replay.
 */
export const CALL_INDEX_ERROR_RETRYABLE: Readonly<Record<CallIndexErrorReason, boolean>> = Object.freeze({
  'invalid-request': false,
  'scope-disabled': false,
  'persistence-unavailable': false,
  'cursor-stale': true,
  'query-capacity': true,
  'reply-too-large': true,
  'not-visible': false,
  'runtime-unavailable': true,
  'task-not-found': false,
  'internal-error': true,
})

/** One mapped failure: the stable code plus how to render/retry it. */
export interface CallIndexViewError {
  /** Always one of the ten wire reasons; anything unrecognized normalizes to `internal-error`. */
  readonly code: CallIndexErrorReason
  /** Locale dictionary key — resolve with the shell's `t()`. */
  readonly messageKey: CallIndexMessageKey
  /** Advisory: a fresh (not replayed) request may succeed. */
  readonly retryable: boolean
}

/** Result envelope for one mapped reply; mirrors the Remote's `ok`/`error` shape. */
export type CallIndexResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CallIndexViewError }

/** Scope of the host-visible index, as the status page needs it. */
export interface CallIndexScopeView {
  readonly status: 'disabled' | 'unavailable' | 'ready'
  readonly mode: 'disabled' | 'host-visible'
  /**
   * Only meaningful — and only ever present — when `status` is `ready`; the
   * wire projector strips it otherwise. `true` means the index may include
   * Sessions that are not in the current Profile.
   */
  readonly includesOtherProfiles?: true
  /** Monotonic scope generation; a change invalidates cached cursors. */
  readonly epoch?: number
  /** Present when `status` is not `ready`. */
  readonly reason?: CallIndexScopeReason
}

/** Which semantic dimensions the Host could actually verify. */
export interface CallIndexSemanticCoverage {
  readonly source: 'verified' | 'unknown'
  readonly ptc: 'verified' | 'unknown'
  readonly skillExecution: 'verified' | 'unavailable'
  readonly denied: 'verified' | 'unavailable'
}

/** Optional feature switches the Host advertises on the status reply. */
export interface CallIndexFeatures {
  readonly history?: boolean
  readonly ptc?: boolean
  readonly skillExecution?: boolean
  readonly denied?: boolean
}

/**
 * Where the automatic scheduler is, independent of the scan phase.
 *
 * `scheduled` is the value that matters: it means "another pass is queued but
 * has not started". Without it a poll taken between passes looks terminal and
 * the client stops polling, missing the next round entirely.
 */
export const CALL_INDEX_AUTO_STATES = ['idle', 'scheduled', 'running', 'stopped'] as const
export type CallIndexAutoStateName = (typeof CALL_INDEX_AUTO_STATES)[number]
export interface CallIndexAutoState {
  readonly state: CallIndexAutoStateName
  readonly round: number
}

/** One explicit index run. */
export interface CallIndexTaskView {
  readonly taskId: string
  readonly mode: 'full' | 'incremental'
  readonly phase: CallIndexTaskPhase
  readonly startedAt: number
  readonly finishedAt?: number
  readonly cancelRequested: boolean
}

/** Outcome counters shared by the status totals and every page summary. */
export interface CallIndexTotals {
  readonly calls: number
  readonly succeeded: number
  readonly failed: number
  readonly unresolved: number
  readonly unknown: number
  readonly cancelled: number
  readonly running: number
  readonly inherited: number
}

/** Counters of one `summary`/`sessions`/`calls` page. */
export interface CallIndexSummaryCounts {
  readonly total: number
  readonly success: number
  readonly error: number
  readonly cancelled: number
  readonly unresolved: number
  readonly unknown: number
  readonly running: number
  readonly inherited: number
}

/** Discovery counters; the four "shape" numbers the status page headline uses. */
export interface CallIndexSessionCensus {
  readonly listed: number
  readonly visible: number
  readonly completed: number
  readonly pending: number
  readonly failed: number
  readonly pendingLive: number
  /**
   * De-duplicated Sessions in this generation's progress denominator:
   * |visible ∪ failures|. Optional: an older Host omits it and the progress bar
   * falls back to `visible`.
   */
  readonly scopeSessions?: number
  /**
   * Sessions read through EOF, independent of coverage.
   *
   * Optional: an older Host does not send it, and the page must then fall back to
   * the coverage-based counters rather than inventing a read-complete claim.
   */
  readonly exhausted?: number
}

/** Status of the index itself (`getIndexStatus`). */
export interface CallIndexStatusView {
  readonly scope: CallIndexScopeView
  readonly generation: number
  readonly censusGeneration: number
  readonly phase: CallIndexStatusPhase
  readonly coverage: CallIndexCoverage
  readonly eventCoverage: CallIndexCoverage
  readonly enumerationCoverage: CallIndexCoverage
  readonly semanticCoverage: CallIndexSemanticCoverage
  readonly sessions: CallIndexSessionCensus
  readonly estimatedBytes: number
  readonly reasons: readonly string[]
  /** Aggregate scan diagnostic: events the backend declared (absent on old Hosts). */
  readonly declaredEvents?: number
  /** Aggregate scan diagnostic: events actually read (absent on old Hosts). */
  readonly readEvents?: number
  /** Events read by the CURRENT/last pass (absent on old Hosts). */
  readonly passReadEvents?: number
  /** Sessions touched by the CURRENT/last pass. */
  readonly passReadSessions?: number
  /** Pages read by the CURRENT/last pass. */
  readonly passPages?: number
  /** Highest verified cut the CURRENT/last pass reached, in events. */
  readonly passCut?: number
  /** Monotone forward-scanned events; the scheduler's real progress signal. */
  readonly scannedEvents?: number
  /** The last pass stopped on a capacity reservation and can resume. */
  readonly paused?: boolean
  /**
   * Sessions read through EOF, independent of coverage gaps.
   *
   * Distinct from `sessions.completed`: a log can be fully read AND still
   * `partial` because the backend under-reported its event count. The page must
   * be able to say "read complete, coverage partial (diagnosis)" instead of
   * "not finished".
   */
  readonly exhaustedSessions?: number
  /** Verified forward progress of the last pass, within a stable revision. */
  readonly progressEvents?: number
  /** Real automatic-scheduler state (whether another pass is queued). */
  readonly auto?: CallIndexAutoState
  readonly totals: CallIndexTotals
  readonly corpus?: CallIndexCorpus
  readonly asOf?: number
  /** Present while a run is in flight (or its final state, until the next run). */
  readonly task?: CallIndexTaskView
  readonly features?: CallIndexFeatures
}

/** One `YYYY-MM-DD` bucket in the caller's local day boundary. */
export interface CallIndexDayBucket {
  readonly day: string
  readonly calls: number
  readonly success: number
  readonly error: number
  readonly cancelled: number
  readonly unresolved: number
  readonly unknown: number
  readonly running: number
}

/** Always carries all five source kinds, zeros included. */
export type CallIndexSourceCounts = Readonly<Record<CallIndexSourceKind, number>>

/**
 * Overview aggregates over the whole filtered set (never the current page).
 *
 * Absent entirely when the answer did not carry them or they were unusable —
 * `undefined` means "this Host cannot give me a trend", which the UI must show
 * as a missing block, not as zeros.
 */
export interface CallIndexAggregates {
  /** Distinct `toolName` values; a non-negative integer. */
  readonly distinctTools: number
  readonly bySource: CallIndexSourceCounts
  /** Oldest-first local-day buckets; omitted when the filtered set is empty. */
  readonly byDay?: readonly CallIndexDayBucket[]
  /** The day boundary actually used, echoed so a day label cannot be misread. */
  readonly dayOffsetMinutes: number
}

/** Envelope shared by `summary`, `sessions`, `calls` and `detail` replies. */
export interface CallIndexPageMeta {
  /** Frozen snapshot this page was cut from; pass it back for a follow-up read. */
  readonly snapshotId: string
  readonly generation: number
  readonly coverage: CallIndexCoverage
  readonly corpus?: CallIndexCorpus
  readonly asOf?: number
  /**
   * `true` means "`total` is the whole truth for this filter". `false`/absent
   * means the count is a lower bound — say so instead of presenting it as exact.
   */
  readonly totalExact?: boolean
  readonly semanticCoverage?: CallIndexSemanticCoverage
  /** The Host observed new calls since this view was captured. */
  readonly hasUpdates?: boolean
}

/** Overview page (`getSummary`). */
export interface CallIndexOverviewView extends CallIndexPageMeta {
  readonly summary: CallIndexSummaryCounts
  /** Size of the filtered set; equals `summary.total` when present. */
  readonly total?: number
  readonly aggregates?: CallIndexAggregates
}

/** One call row; metadata only, never arguments or results. */
export interface CallIndexCallRow {
  readonly sessionId: string
  readonly callSeq: number
  readonly callId: string
  readonly toolName: string
  readonly startedAt: number
  readonly outcome: CallIndexOutcome
  readonly inherited: boolean
  readonly sourceKind: CallIndexSourceKind
  readonly layer: string
  readonly turn?: number
  readonly step?: number
  readonly endedAt?: number
  readonly resultSeq?: number
  readonly durationMs?: number
}

/** One Session row. */
export interface CallIndexSessionRow {
  readonly sessionId: string
  readonly revision: string
  readonly cut: number
  readonly coverage: CallIndexSessionCoverage
  readonly stale: boolean
  /** Fixed codes (`max-reads`, `live-projection-failed`, …), never messages. */
  readonly reasons: readonly string[]
  readonly cwd?: string
}

/** One page of call rows (`listCalls`). */
export interface CallIndexCallPageView extends CallIndexPageMeta {
  readonly summary: CallIndexSummaryCounts
  readonly total?: number
  readonly items: readonly CallIndexCallRow[]
  /** Rows dropped because they failed the allowlist projection; 0 when clean. */
  readonly droppedItems: number
  /** Opaque continuation token; pass it back with the same `snapshotId`. */
  readonly nextCursor?: string
}

/** One page of Session rows (`listSessions`). */
export interface CallIndexSessionPageView extends CallIndexPageMeta {
  readonly summary: CallIndexSummaryCounts
  readonly total?: number
  readonly items: readonly CallIndexSessionRow[]
  /** Rows dropped because they failed the allowlist projection; 0 when clean. */
  readonly droppedItems: number
  readonly nextCursor?: string
}

/** One call's detail (`getCallDetail`). */
export interface CallIndexDetailView extends CallIndexPageMeta {
  readonly detail: CallIndexCallRow
}

/**
 * Every mapped reply, discriminated by the wire kind (with `error` for failures).
 * A caller that does not know which method produced a reply can switch on this.
 */
export type CallIndexView =
  | { readonly ok: true; readonly kind: 'status'; readonly value: CallIndexStatusView }
  | { readonly ok: true; readonly kind: 'task'; readonly value: CallIndexTaskView }
  | { readonly ok: true; readonly kind: 'summary'; readonly value: CallIndexOverviewView }
  | { readonly ok: true; readonly kind: 'sessions'; readonly value: CallIndexSessionPageView }
  | { readonly ok: true; readonly kind: 'calls'; readonly value: CallIndexCallPageView }
  | { readonly ok: true; readonly kind: 'detail'; readonly value: CallIndexDetailView }
  | { readonly ok: false; readonly kind: 'error'; readonly error: CallIndexViewError }

const REPLY_KIND_SET: ReadonlySet<string> = new Set<string>(CALL_INDEX_REPLY_KINDS)
const REASON_SET: ReadonlySet<string> = new Set<string>(CALL_INDEX_ERROR_REASONS)
const OUTCOME_SET: ReadonlySet<string> = new Set<string>(CALL_INDEX_OUTCOMES)
const SOURCE_KIND_SET: ReadonlySet<string> = new Set<string>(CALL_INDEX_SOURCE_KINDS)
const STATUS_PHASE_SET: ReadonlySet<string> = new Set<string>(CALL_INDEX_STATUS_PHASES)
const AUTO_STATE_SET: ReadonlySet<string> = new Set<string>(CALL_INDEX_AUTO_STATES)
const TASK_PHASE_SET: ReadonlySet<string> = new Set<string>(CALL_INDEX_TASK_PHASES)

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const REASON_CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/** A safe non-negative integer, i.e. a counter. */
function readCount(value: unknown): number | undefined {
  const int = readInt(value)
  return int !== undefined && int >= 0 ? int : undefined
}

function readBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readEnum<T extends string>(value: unknown, set: ReadonlySet<string>): T | undefined {
  return typeof value === 'string' && set.has(value) ? (value as T) : undefined
}

function readCoverage(value: unknown): CallIndexCoverage | undefined {
  return value === 'complete' || value === 'partial' || value === 'unknown' ? value : undefined
}

/** Fixed reason codes, bounded and de-duplicated; over-cap tails are dropped. */
function readReasons(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (out.length >= MAX_REASONS) break
    if (typeof entry !== 'string' || !REASON_CODE_PATTERN.test(entry) || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
  }
  return out
}

/** Normalize any wire reason (or junk) to one of the ten stable codes. */
export function normalizeCallIndexReason(value: unknown): CallIndexErrorReason {
  return typeof value === 'string' && REASON_SET.has(value) ? (value as CallIndexErrorReason) : 'internal-error'
}

/** Build the error view for a stable code. */
export function callIndexErrorView(code: CallIndexErrorReason): CallIndexViewError {
  return {
    code,
    messageKey: CALL_INDEX_ERROR_MESSAGE_KEYS[code],
    retryable: CALL_INDEX_ERROR_RETRYABLE[code],
  }
}

function failure<T>(code: CallIndexErrorReason): CallIndexResult<T> {
  return { ok: false, error: callIndexErrorView(code) }
}

function success<T>(value: T): CallIndexResult<T> {
  return { ok: true, value }
}

/**
 * Minutes east of UTC for the caller's local day boundary, clamped to the wire
 * range. This is what the overview request's `dayOffsetMinutes` should carry:
 * the Host never guesses a timezone, so the browser supplies one.
 *
 * Not a pure function of its argument in the mathematical sense — it reads the
 * host zone — but it is deterministic within one zone and has no other input.
 */
export function localDayOffsetMinutes(instant: number = Date.now()): number {
  const at = Number.isFinite(instant) ? instant : Date.now()
  const offset = -new Date(at).getTimezoneOffset()
  if (!Number.isFinite(offset)) return 0
  return Math.min(
    CALL_INDEX_MAX_DAY_OFFSET_MINUTES,
    Math.max(CALL_INDEX_MIN_DAY_OFFSET_MINUTES, Math.trunc(offset)),
  )
}

type ReplyRead =
  | { readonly ok: true; readonly kind: PayloadReplyKind; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly error: CallIndexViewError }

/**
 * Validate the envelope only; the payload is validated field by field by the
 * per-kind projectors. Never throws.
 */
function readReply(value: unknown): ReplyRead {
  if (!isRecord(value)) return { ok: false, error: callIndexErrorView('internal-error') }
  if (value.schemaVersion !== 1) return { ok: false, error: callIndexErrorView('internal-error') }
  const kind = value.kind
  if (typeof kind !== 'string' || !REPLY_KIND_SET.has(kind)) {
    return { ok: false, error: callIndexErrorView('internal-error') }
  }
  if (value.ok !== true) {
    if (value.ok === false) {
      // The wire's own failure channel. A non-error reply marked `ok: false`
      // still normalizes to the same envelope, so the UI has one error path.
      return { ok: false, error: callIndexErrorView(normalizeCallIndexReason(value.reason)) }
    }
    return { ok: false, error: callIndexErrorView('internal-error') }
  }
  if (kind === 'error') {
    return { ok: false, error: callIndexErrorView(normalizeCallIndexReason(value.reason)) }
  }
  if (!isRecord(value.data)) return { ok: false, error: callIndexErrorView('internal-error') }
  return { ok: true, kind: kind as PayloadReplyKind, data: value.data }
}

function projectSummaryCounts(value: unknown): CallIndexSummaryCounts | undefined {
  if (!isRecord(value)) return undefined
  const total = readCount(value.total)
  const successCount = readCount(value.success)
  const errorCount = readCount(value.error)
  const cancelled = readCount(value.cancelled)
  const unresolved = readCount(value.unresolved)
  const unknown = readCount(value.unknown)
  const running = readCount(value.running)
  const inherited = readCount(value.inherited)
  if (total === undefined || successCount === undefined || errorCount === undefined
    || cancelled === undefined || unresolved === undefined || unknown === undefined
    || running === undefined || inherited === undefined) return undefined
  return { total, success: successCount, error: errorCount, cancelled, unresolved, unknown, running, inherited }
}

function projectTotals(value: unknown): CallIndexTotals | undefined {
  if (!isRecord(value)) return undefined
  const calls = readCount(value.calls)
  const succeeded = readCount(value.succeeded)
  const failed = readCount(value.failed)
  const unresolved = readCount(value.unresolved)
  const unknown = readCount(value.unknown)
  const cancelled = readCount(value.cancelled)
  const running = readCount(value.running)
  const inherited = readCount(value.inherited)
  if (calls === undefined || succeeded === undefined || failed === undefined
    || unresolved === undefined || unknown === undefined || cancelled === undefined
    || running === undefined || inherited === undefined) return undefined
  return { calls, succeeded, failed, unresolved, unknown, cancelled, running, inherited }
}

function projectSemanticCoverage(value: unknown): CallIndexSemanticCoverage | undefined {
  if (!isRecord(value)) return undefined
  // Only `verified` is ever reported as verified; every other string (the status
  // reply types these as open strings) degrades to the conservative answer.
  return {
    source: value.source === 'verified' ? 'verified' : 'unknown',
    ptc: value.ptc === 'verified' ? 'verified' : 'unknown',
    skillExecution: value.skillExecution === 'verified' ? 'verified' : 'unavailable',
    denied: value.denied === 'verified' ? 'verified' : 'unavailable',
  }
}

function projectTask(value: unknown): CallIndexTaskView | undefined {
  if (!isRecord(value)) return undefined
  const taskId = readString(value.taskId)
  const mode = value.mode === 'full' || value.mode === 'incremental' ? value.mode : undefined
  const phase = readEnum<CallIndexTaskPhase>(value.phase, TASK_PHASE_SET)
  const startedAt = readFinite(value.startedAt)
  const cancelRequested = readBool(value.cancelRequested)
  if (taskId === undefined || taskId === '' || mode === undefined || phase === undefined
    || startedAt === undefined || cancelRequested === undefined) return undefined
  const finishedAt = readFinite(value.finishedAt)
  return { taskId, mode, phase, startedAt, cancelRequested, ...(finishedAt === undefined ? {} : { finishedAt }) }
}

function projectAuto(value: unknown): CallIndexAutoState | undefined {
  if (!isRecord(value)) return undefined
  const state = readEnum<CallIndexAutoStateName>(value.state, AUTO_STATE_SET)
  const round = readCount(value.round)
  if (state === undefined || round === undefined) return undefined
  return { state, round }
}

function projectFeatures(value: unknown): CallIndexFeatures | undefined {
  if (!isRecord(value)) return undefined
  const history = readBool(value.history)
  const ptc = readBool(value.ptc)
  const skillExecution = readBool(value.skillExecution)
  const denied = readBool(value.denied)
  // `rawPayloads` is pinned to `false` by the wire and is never exposed: the
  // adapter must not create a prop that suggests raw payloads are available.
  const features: CallIndexFeatures = {
    ...(history === undefined ? {} : { history }),
    ...(ptc === undefined ? {} : { ptc }),
    ...(skillExecution === undefined ? {} : { skillExecution }),
    ...(denied === undefined ? {} : { denied }),
  }
  return Object.keys(features).length === 0 ? undefined : features
}

function projectScope(value: unknown): CallIndexScopeView | undefined {
  if (!isRecord(value)) return undefined
  const status = value.status
  const mode = value.mode
  if (status !== 'disabled' && status !== 'unavailable' && status !== 'ready') return undefined
  if (mode !== 'disabled' && mode !== 'host-visible') return undefined
  if (status === 'ready') {
    const epoch = readInt(value.epoch)
    return {
      status,
      mode,
      ...(value.includesOtherProfiles === true ? { includesOtherProfiles: true as const } : {}),
      ...(epoch === undefined ? {} : { epoch }),
    }
  }
  const reason = value.reason === 'not-enabled' || value.reason === 'unsupported-scope'
    || value.reason === 'persistence-unavailable' ? value.reason : undefined
  // The wire strips `epoch` and `includesOtherProfiles` for a non-ready scope,
  // so they are never surfaced here even if a stale Host echoes them.
  return { status, mode, ...(reason === undefined ? {} : { reason }) }
}

function projectCorpus(value: unknown): CallIndexCorpus | undefined {
  return value === 'persisted-plus-observed-live' ? value : undefined
}

function projectStatus(data: Record<string, unknown>): CallIndexResult<CallIndexStatusView> {
  const scope = projectScope(data.scope)
  const generation = readInt(data.generation)
  const censusGeneration = readInt(data.censusGeneration)
  const phase = readEnum<CallIndexStatusPhase>(data.phase, STATUS_PHASE_SET)
  const coverage = readCoverage(data.coverage)
  const eventCoverage = readCoverage(data.eventCoverage)
  const enumerationCoverage = readCoverage(data.enumerationCoverage)
  const semanticCoverage = projectSemanticCoverage(data.semanticCoverage)
  const listed = readCount(data.listedSessions)
  const visible = readCount(data.visibleSessions)
  const completed = readCount(data.completedSessions)
  const pending = readCount(data.pendingSessions)
  const failed = readCount(data.failedSessions)
  const pendingLive = readCount(data.pendingLive)
  const estimatedBytes = readCount(data.estimatedBytes)
  const totals = projectTotals(data.totals)
  if (scope === undefined || generation === undefined || censusGeneration === undefined
    || phase === undefined || coverage === undefined || eventCoverage === undefined
    || enumerationCoverage === undefined || semanticCoverage === undefined
    || listed === undefined || visible === undefined || completed === undefined
    || pending === undefined || failed === undefined || pendingLive === undefined
    || estimatedBytes === undefined || totals === undefined) {
    return failure('internal-error')
  }
  const asOf = readFinite(data.asOf)
  const corpus = projectCorpus(data.corpus)
  const task = projectTask(data.task)
  const auto = projectAuto(data.auto)
  const features = projectFeatures(data.features)
  return success({
    scope,
    generation,
    censusGeneration,
    phase,
    coverage,
    eventCoverage,
    enumerationCoverage,
    semanticCoverage,
    sessions: {
      listed, visible, completed, pending, failed, pendingLive,
      ...(readCount(data.scopeSessions) === undefined ? {} : { scopeSessions: readCount(data.scopeSessions)! }),
      ...(readCount(data.exhaustedSessions) === undefined ? {} : { exhausted: readCount(data.exhaustedSessions)! }),
    },
    estimatedBytes,
    reasons: readReasons(data.reasons),
    ...(typeof data.declaredEvents === 'number' ? { declaredEvents: data.declaredEvents } : {}),
    ...(typeof data.readEvents === 'number' ? { readEvents: data.readEvents } : {}),
    // Per-pass progress is optional on purpose: an older Host omits it and the
    // page falls back to the cumulative counters instead of inventing zeros.
    ...(readCount(data.passReadEvents) === undefined ? {} : { passReadEvents: readCount(data.passReadEvents)! }),
    ...(readCount(data.passReadSessions) === undefined ? {} : { passReadSessions: readCount(data.passReadSessions)! }),
    ...(readCount(data.passPages) === undefined ? {} : { passPages: readCount(data.passPages)! }),
    ...(readCount(data.passCut) === undefined ? {} : { passCut: readCount(data.passCut)! }),
    ...(readCount(data.scannedEvents) === undefined ? {} : { scannedEvents: readCount(data.scannedEvents)! }),
    ...(readBool(data.paused) === undefined ? {} : { paused: readBool(data.paused)! }),
    ...(readCount(data.exhaustedSessions) === undefined ? {} : { exhaustedSessions: readCount(data.exhaustedSessions)! }),
    ...(readCount(data.progressEvents) === undefined ? {} : { progressEvents: readCount(data.progressEvents)! }),
    ...(auto === undefined ? {} : { auto }),
    totals,
    ...(corpus === undefined ? {} : { corpus }),
    ...(asOf === undefined ? {} : { asOf }),
    ...(task === undefined ? {} : { task }),
    ...(features === undefined ? {} : { features }),
  })
}

function projectPageMeta(data: Record<string, unknown>): CallIndexPageMeta | undefined {
  const snapshotId = readString(data.snapshotId)
  const generation = readInt(data.generation)
  const coverage = readCoverage(data.coverage)
  if (snapshotId === undefined || snapshotId === '' || generation === undefined || coverage === undefined) {
    return undefined
  }
  const corpus = projectCorpus(data.corpus)
  const asOf = readFinite(data.asOf)
  const totalExact = readBool(data.totalExact)
  const semanticCoverage = projectSemanticCoverage(data.semanticCoverage)
  const hasUpdates = readBool(data.hasUpdates)
  return {
    snapshotId,
    generation,
    coverage,
    ...(corpus === undefined ? {} : { corpus }),
    ...(asOf === undefined ? {} : { asOf }),
    ...(totalExact === undefined ? {} : { totalExact }),
    ...(semanticCoverage === undefined ? {} : { semanticCoverage }),
    ...(hasUpdates === undefined ? {} : { hasUpdates }),
  }
}

function projectSourceCounts(value: unknown): CallIndexSourceCounts | undefined {
  if (!isRecord(value)) return undefined
  const mcp = readCount(value.mcp)
  const pluginTool = readCount(value['plugin-tool'])
  const native = readCount(value.native)
  const skill = readCount(value.skill)
  const unknown = readCount(value.unknown)
  if (mcp === undefined || pluginTool === undefined || native === undefined
    || skill === undefined || unknown === undefined) return undefined
  return { mcp, 'plugin-tool': pluginTool, native, skill, unknown }
}

function projectDayBucket(value: unknown): CallIndexDayBucket | undefined {
  if (!isRecord(value)) return undefined
  const day = readString(value.day)
  const calls = readCount(value.calls)
  const successCount = readCount(value.success)
  const errorCount = readCount(value.error)
  const cancelled = readCount(value.cancelled)
  const unresolved = readCount(value.unresolved)
  const unknown = readCount(value.unknown)
  const running = readCount(value.running)
  if (day === undefined || !DAY_PATTERN.test(day) || calls === undefined || successCount === undefined
    || errorCount === undefined || cancelled === undefined || unresolved === undefined
    || unknown === undefined || running === undefined) return undefined
  return { day, calls, success: successCount, error: errorCount, cancelled, unresolved, unknown, running }
}

/**
 * Day buckets must be whole: one malformed bucket, an over-cap span or a
 * non-array makes the trend unusable. Truncating would draw a line that lies
 * about the shape, so the caller is told the trend is not there.
 */
function projectDayBuckets(value: unknown): readonly CallIndexDayBucket[] | undefined {
  if (!Array.isArray(value) || value.length > CALL_INDEX_MAX_DAY_BUCKETS) return undefined
  const buckets: CallIndexDayBucket[] = []
  for (const entry of value) {
    const bucket = projectDayBucket(entry)
    if (bucket === undefined) return undefined
    buckets.push(bucket)
  }
  return buckets
}

function projectAggregates(value: unknown): CallIndexAggregates | undefined {
  if (!isRecord(value)) return undefined
  const distinctTools = readCount(value.distinctTools)
  const dayOffsetMinutes = readInt(value.dayOffsetMinutes)
  if (distinctTools === undefined || dayOffsetMinutes === undefined) return undefined
  // Without a trustworthy day boundary every `byDay` label would be mislabelled,
  // so the whole block degrades rather than a half-correct trend.
  if (dayOffsetMinutes < CALL_INDEX_MIN_DAY_OFFSET_MINUTES
    || dayOffsetMinutes > CALL_INDEX_MAX_DAY_OFFSET_MINUTES) return undefined
  const bySource = projectSourceCounts(value.bySource)
  if (bySource === undefined) return undefined
  // `byDay` present but unusable makes the WHOLE block unavailable: a trend that
  // silently lost a day is worse than no trend, and the other fields ship from
  // the same read so they cannot be trusted to be independently complete.
  const byDay = value.byDay === undefined ? undefined : projectDayBuckets(value.byDay)
  if (value.byDay !== undefined && byDay === undefined) return undefined
  return { distinctTools, bySource, dayOffsetMinutes, ...(byDay === undefined ? {} : { byDay }) }
}

function projectCallRow(value: unknown): CallIndexCallRow | undefined {
  if (!isRecord(value)) return undefined
  const sessionId = readString(value.sessionId)
  const callSeq = readCount(value.callSeq)
  const callId = readString(value.callId)
  const toolName = readString(value.toolName)
  const startedAt = readFinite(value.startedAt)
  const outcome = readEnum<CallIndexOutcome>(value.outcome, OUTCOME_SET)
  const sourceKind = readEnum<CallIndexSourceKind>(value.sourceKind, SOURCE_KIND_SET)
  const layer = readString(value.layer)
  const inherited = readBool(value.inherited)
  if (sessionId === undefined || sessionId === '' || callSeq === undefined || callId === undefined
    || toolName === undefined || startedAt === undefined || outcome === undefined
    || sourceKind === undefined || layer === undefined || inherited === undefined) return undefined
  const turn = readInt(value.turn)
  const step = readInt(value.step)
  const endedAt = readFinite(value.endedAt)
  const resultSeq = readInt(value.resultSeq)
  const durationMs = readCount(value.durationMs)
  return {
    sessionId,
    callSeq,
    callId,
    toolName,
    startedAt,
    outcome,
    inherited,
    sourceKind,
    layer,
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(resultSeq === undefined ? {} : { resultSeq }),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

function projectSessionRow(value: unknown): CallIndexSessionRow | undefined {
  if (!isRecord(value)) return undefined
  const sessionId = readString(value.sessionId)
  const revision = readString(value.revision)
  const cut = readCount(value.cut)
  const coverage = value.coverage === 'complete' || value.coverage === 'partial' ? value.coverage : undefined
  const stale = readBool(value.stale)
  if (sessionId === undefined || sessionId === '' || revision === undefined || cut === undefined
    || coverage === undefined || stale === undefined) return undefined
  const cwd = readString(value.cwd)
  return {
    sessionId,
    revision,
    cut,
    coverage,
    stale,
    reasons: readReasons(value.reasons),
    ...(cwd === undefined ? {} : { cwd }),
  }
}

/** Project a list of rows, counting the ones the allowlist rejected. */
function projectRows<T>(
  value: unknown,
  project: (row: unknown) => T | undefined,
): { items: T[]; dropped: number } {
  if (value === undefined) return { items: [], dropped: 0 }
  if (!Array.isArray(value)) return { items: [], dropped: 1 }
  const items: T[] = []
  let dropped = 0
  for (const entry of value) {
    const row = project(entry)
    if (row === undefined) dropped += 1
    else items.push(row)
  }
  return { items, dropped }
}

function projectOverview(data: Record<string, unknown>): CallIndexResult<CallIndexOverviewView> {
  const meta = projectPageMeta(data)
  const summary = projectSummaryCounts(data.summary)
  if (meta === undefined || summary === undefined) return failure('internal-error')
  const total = readCount(data.total)
  // Optional on the wire: an older Host simply does not send it, and the panel
  // then hides the trend block instead of drawing zeros.
  const aggregates = projectAggregates(data.aggregates)
  return success({
    ...meta,
    summary,
    ...(total === undefined ? {} : { total }),
    ...(aggregates === undefined ? {} : { aggregates }),
  })
}

function projectCallPage(data: Record<string, unknown>): CallIndexResult<CallIndexCallPageView> {
  const meta = projectPageMeta(data)
  const summary = projectSummaryCounts(data.summary)
  if (meta === undefined || summary === undefined) return failure('internal-error')
  const total = readCount(data.total)
  const rows = projectRows(data.items, projectCallRow)
  const nextCursor = readString(data.nextCursor)
  return success({
    ...meta,
    summary,
    items: rows.items,
    droppedItems: rows.dropped,
    ...(total === undefined ? {} : { total }),
    ...(nextCursor === undefined || nextCursor === '' ? {} : { nextCursor }),
  })
}

function projectSessionPage(data: Record<string, unknown>): CallIndexResult<CallIndexSessionPageView> {
  const meta = projectPageMeta(data)
  const summary = projectSummaryCounts(data.summary)
  if (meta === undefined || summary === undefined) return failure('internal-error')
  const total = readCount(data.total)
  const rows = projectRows(data.items, projectSessionRow)
  const nextCursor = readString(data.nextCursor)
  return success({
    ...meta,
    summary,
    items: rows.items,
    droppedItems: rows.dropped,
    ...(total === undefined ? {} : { total }),
    ...(nextCursor === undefined || nextCursor === '' ? {} : { nextCursor }),
  })
}

function projectDetail(data: Record<string, unknown>): CallIndexResult<CallIndexDetailView> {
  const meta = projectPageMeta(data)
  const detail = projectCallRow(data.detail)
  if (meta === undefined || detail === undefined) return failure('internal-error')
  return success({ ...meta, detail })
}

function projectTaskReply(data: Record<string, unknown>): CallIndexResult<CallIndexTaskView> {
  const task = projectTask(data)
  // `startIndex`/`cancelIndex` answer with the whole task record; a record that
  // fails the allowlist is a Host defect, not an empty task.
  return task === undefined ? failure('internal-error') : success(task)
}

/** Shared mapper: validate the envelope, require the expected kind, project it. */
function mapKind<T>(
  reply: unknown,
  kind: PayloadReplyKind,
  project: (data: Record<string, unknown>) => CallIndexResult<T>,
): CallIndexResult<T> {
  const read = readReply(reply)
  if (!read.ok) return { ok: false, error: read.error }
  if (read.kind !== kind) return failure('internal-error')
  return project(read.data)
}

/** `getIndexStatus` → index status view. */
export function mapIndexStatus(reply: unknown): CallIndexResult<CallIndexStatusView> {
  return mapKind(reply, 'status', projectStatus)
}

/** `startIndex` / `cancelIndex` → task view. */
export function mapIndexTask(reply: unknown): CallIndexResult<CallIndexTaskView> {
  return mapKind(reply, 'task', projectTaskReply)
}

/** `getSummary` → overview view (aggregates absent when the Host does not send them). */
export function mapOverview(reply: unknown): CallIndexResult<CallIndexOverviewView> {
  return mapKind(reply, 'summary', projectOverview)
}

/** `listCalls` → one page of call rows. */
export function mapCallPage(reply: unknown): CallIndexResult<CallIndexCallPageView> {
  return mapKind(reply, 'calls', projectCallPage)
}

/** `listSessions` → one page of Session rows. */
export function mapSessionPage(reply: unknown): CallIndexResult<CallIndexSessionPageView> {
  return mapKind(reply, 'sessions', projectSessionPage)
}

/** `getCallDetail` → one call's detail. */
export function mapCallDetail(reply: unknown): CallIndexResult<CallIndexDetailView> {
  return mapKind(reply, 'detail', projectDetail)
}

/**
 * Any reply → the failure view. A *successful* reply has no failure to map, so
 * it yields `internal-error`; this exists so an error path never needs an
 * `undefined` branch when it already knows it is looking at a failure.
 */
export function mapErrorReply(reply: unknown): CallIndexViewError {
  const read = readReply(reply)
  return read.ok ? callIndexErrorView('internal-error') : read.error
}

/** Dispatch any reply onto the tagged view union, without knowing the method. */
export function toCallIndexView(reply: unknown): CallIndexView {
  const read = readReply(reply)
  if (!read.ok) return { ok: false, kind: 'error', error: read.error }
  switch (read.kind) {
    case 'status': {
      const mapped = projectStatus(read.data)
      return mapped.ok ? { ok: true, kind: 'status', value: mapped.value } : { ok: false, kind: 'error', error: mapped.error }
    }
    case 'task': {
      const mapped = projectTaskReply(read.data)
      return mapped.ok ? { ok: true, kind: 'task', value: mapped.value } : { ok: false, kind: 'error', error: mapped.error }
    }
    case 'summary': {
      const mapped = projectOverview(read.data)
      return mapped.ok ? { ok: true, kind: 'summary', value: mapped.value } : { ok: false, kind: 'error', error: mapped.error }
    }
    case 'sessions': {
      const mapped = projectSessionPage(read.data)
      return mapped.ok ? { ok: true, kind: 'sessions', value: mapped.value } : { ok: false, kind: 'error', error: mapped.error }
    }
    case 'calls': {
      const mapped = projectCallPage(read.data)
      return mapped.ok ? { ok: true, kind: 'calls', value: mapped.value } : { ok: false, kind: 'error', error: mapped.error }
    }
    case 'detail': {
      const mapped = projectDetail(read.data)
      return mapped.ok ? { ok: true, kind: 'detail', value: mapped.value } : { ok: false, kind: 'error', error: mapped.error }
    }
    default:
      // Unreachable while `PayloadReplyKind` and the switch agree; kept total so
      // a future wire kind cannot silently become `undefined`.
      return { ok: false, kind: 'error', error: callIndexErrorView('internal-error') }
  }
}
