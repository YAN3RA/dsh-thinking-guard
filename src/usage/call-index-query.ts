/**
 * Behavioural query layer for the N22 call index (D-026, N23 host/Remote).
 *
 * `SessionCallIndex` (session-index.ts) is the scanner: it owns enumeration,
 * live observation and freshness. This file is the read-model in front of it:
 * it captures ONE immutable projection per query view, filters it ONCE to the
 * requested query, pre-sorts the call page order and reuses that frozen copy for
 * summary and stable pagination. Later pages only re-read `stamp()` (cheap); the
 * whole filtered set is never re-sorted per page.
 *
 * Cost model (TG-12): a narrow filter (one Session, one tool, `limit: 1`) must
 * not pay the full-corpus byte budget. Raw snapshot rows are tested against the
 * filter before they are projected, so the retained rows and the capacity check
 * are proportional to the MATCHED set, not the whole corpus. An unfiltered read
 * over an oversized corpus still answers `query-capacity` — the budget protects
 * what a view retains, not what it scans.
 *
 * Detail reads (TG-12): omitting `snapshotId` reuses the most recently listed
 * CALLS view instead of capturing a brand-new one. Previously each detail read
 * created a fifth view, evicted the page the user was browsing and turned its
 * cursor stale (the "V5" defect). Passing `snapshotId` remains the precise,
 * filter-bound path and is still enforced.
 *
 * Trust model: a `snapshot()` row is Host data, not a wire object. Every field
 * is copied individually through an allowlist (never spread), so raw tool
 * arguments, result content and error text cannot leak into a reply. `detail`
 * additionally re-checks `isSessionVisible` and the authorization stamp after
 * the async lookups, so a stale or escalated id cannot be read.
 *
 * Pagination uses opaque random UUID cursors bound to (view, kind, filter);
 * there is no client-supplied offset or base64 "signature". Repeating a cursor
 * yields the same page. A cursor for the wrong kind or a filter mismatch is
 * rejected rather than silently jumping.
 *
 * @module dsh-thinking-guard/usage/call-index-query
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { SessionCallIndex } from './session-index.ts'
import {
  CALL_INDEX_DEFAULT_LIMIT,
  CALL_INDEX_DEFAULT_MAX_BYTES,
  CALL_INDEX_DEFAULT_MAX_VIEWS,
  CALL_INDEX_DEFAULT_TTL_MS,
  CALL_INDEX_MAX_DAY_BUCKETS,
  CALL_INDEX_MAX_TOOL_ROWS,
  CALL_INDEX_MAX_REPLY_BYTES,
  CALL_INDEX_OUTCOMES,
  CALL_INDEX_SOURCE_KINDS,
  callIndexDetailRequestSchema,
  callIndexError,
  callIndexListRequestSchema,
  callIndexSummaryRequestSchema,
  callIndexWireRowSchema,
  callIndexWireSessionSchema,
  callIndexReply,
  type CallIndexErrorReason,
  type CallIndexOutcome,
  type CallIndexReply,
  type CallIndexSourceKind,
} from './call-index-wire.ts'

/** Structural type of `SessionCallIndex.snapshot()` — type-only, never bundled. */
export type CallIndexQuerySnapshot = ReturnType<SessionCallIndex['snapshot']>

/** Everything the query layer needs from the Host; the runtime owns it. */
export interface CallIndexQuerySource {
  readonly snapshot: () => CallIndexQuerySnapshot
  /** Cheap authorization/rescan stamp. Changes on scope change or a full rescan. */
  readonly stamp: () => string
  readonly isSessionVisible: (id: string) => Promise<boolean>
  /**
   * Optional cheap freshness probe. When present, pagination can report
   * `hasUpdates` after live additions WITHOUT re-reading `snapshot()`. When
   * absent, frozen views simply report `hasUpdates: false`.
   */
  readonly generation?: () => number
}

export interface CallIndexQueryOptions {
  now?: () => number
  ttlMs?: number
  maxViews?: number
  maxBytes?: number
  maxReplyBytes?: number
}

type Outcome = CallIndexOutcome
type SourceKind = CallIndexSourceKind

interface Row {
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
  outcome: Outcome
  inherited: boolean
  sourceKind: SourceKind
  layer: string
}

interface SessionMeta {
  sessionId: string
  cwd?: string
  revision: string
  cut: number
  coverage: 'complete' | 'partial'
  stale: boolean
  reasons: string[]
}

interface Summary {
  total: number
  success: number
  error: number
  cancelled: number
  unresolved: number
  unknown: number
  running: number
  inherited: number
}

interface SemanticCoverage { source: 'unknown' | 'verified'; ptc: 'unknown' | 'verified'; skillExecution: 'unavailable' | 'verified'; denied: 'unavailable' | 'verified' }
interface ViewData {
  snapshotId: string
  generation: number
  asOf?: number
  coverage: 'complete' | 'partial' | 'unknown'
  sessions: SessionMeta[]
  /** Rows already filtered to the query and pre-sorted desc-by-start. */
  rows: Row[]
  totals: Summary
  semanticCoverage: SemanticCoverage
  cwdBySession: Map<string, string | undefined>
}

interface View extends ViewData {
  stamp: string
  capturedAt: number
  filter: NormalizedQuery
  filterKey: string
  bytes: number
}

interface Cursor {
  viewId: string
  kind: 'sessions' | 'calls'
  filter: NormalizedQuery
  filterKey: string
  offset: number
}

interface NormalizedQuery {
  sessionId?: string
  toolName?: string
  cwd?: string
  outcome?: Outcome
  sourceKind?: SourceKind
  fromMs?: number
  toMs?: number
  includeInherited: boolean
}

type Projection =
  | { kind: 'ok'; data: ViewData }
  | { kind: 'scope-disabled' }
  | { kind: 'persistence-unavailable' }
  | { kind: 'invalid' }

const OUTCOME_SET: ReadonlySet<string> = new Set(CALL_INDEX_OUTCOMES)
const SOURCE_SET: ReadonlySet<string> = new Set(CALL_INDEX_SOURCE_KINDS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one field without letting a hostile getter throw into the query layer. */
function read(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const isNonNegInt = (value: unknown): value is number => isInt(value) && value >= 0
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isStr = (value: unknown): value is string => typeof value === 'string'

function requestObject(value: unknown): unknown {
  return value === undefined ? {} : value
}

function projectRow(raw: unknown): Row | undefined {
  const sessionId = read(raw, 'sessionId')
  const callSeq = read(raw, 'callSeq')
  const callId = read(raw, 'callId')
  const toolName = read(raw, 'toolName')
  const startedAt = read(raw, 'startedAt')
  const outcome = read(raw, 'outcome')
  const inherited = read(raw, 'inherited')
  const sourceKind = read(raw, 'sourceKind')
  const layer = read(raw, 'layer')
  if (
    !isStr(sessionId) || !isNonNegInt(callSeq) || !isStr(callId) || !isStr(toolName)
    || !isNum(startedAt) || !isStr(outcome) || !OUTCOME_SET.has(outcome)
    || typeof inherited !== 'boolean' || !isStr(sourceKind) || !SOURCE_SET.has(sourceKind) || !isStr(layer)
  ) return undefined
  const row: Row = {
    sessionId, callSeq, callId, toolName, startedAt,
    outcome: outcome as Outcome, inherited, sourceKind: sourceKind as SourceKind, layer,
  }
  const turn = read(raw, 'turn')
  if (isInt(turn)) row.turn = turn
  const step = read(raw, 'step')
  if (isInt(step)) row.step = step
  const endedAt = read(raw, 'endedAt')
  if (isNum(endedAt)) row.endedAt = endedAt
  const resultSeq = read(raw, 'resultSeq')
  if (isInt(resultSeq)) row.resultSeq = resultSeq
  const durationMs = read(raw, 'durationMs')
  if (isNum(durationMs)) row.durationMs = durationMs
  const parsed = callIndexWireRowSchema.safeParse(row)
  return parsed.success ? parsed.data : undefined
}

function projectSession(raw: unknown): SessionMeta | undefined {
  const sessionId = read(raw, 'sessionId')
  const revision = read(raw, 'revision')
  const cut = read(raw, 'cut')
  const coverage = read(raw, 'coverage')
  const stale = read(raw, 'stale')
  const reasons = read(raw, 'reasons')
  if (
    !isStr(sessionId) || !isStr(revision) || !isNonNegInt(cut)
    || (coverage !== 'complete' && coverage !== 'partial') || typeof stale !== 'boolean'
    || !Array.isArray(reasons) || !reasons.every(isStr)
  ) return undefined
  const meta: SessionMeta = { sessionId, revision, cut, coverage, stale, reasons: reasons as string[] }
  const cwd = read(raw, 'cwd')
  if (isStr(cwd)) meta.cwd = cwd
  const parsed = callIndexWireSessionSchema.safeParse(meta)
  return parsed.success ? parsed.data : undefined
}

function summarize(rows: readonly Row[]): Summary {
  const summary: Summary = { total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 }
  for (const row of rows) {
    summary.total += 1
    summary[row.outcome] += 1
    if (row.inherited) summary.inherited += 1
  }
  return summary
}

/** One local-day bucket; `day` is the `YYYY-MM-DD` label in the caller's zone. */
interface DayBucket {
  day: string
  calls: number
  success: number
  error: number
  cancelled: number
  unresolved: number
  unknown: number
  running: number
}

/** One tool's totals over the WHOLE filtered set (not just the rows a page holds). */
export interface ToolAggregate {
  readonly toolName: string
  readonly calls: number
  readonly success: number
  readonly failed: number
  readonly cancelled: number
  readonly unresolved: number
  readonly unknown: number
  readonly running: number
  /** Sum and count of calls that reported a duration; the UI divides them. */
  readonly durationSumMs: number
  readonly durationCount: number
  /** Newest call seen for this tool, so "最近调用" is real even off-page. */
  readonly lastStartedAt: number
  /**
   * The source kind that accounts for the most calls of this tool.
   *
   * The Host only ever proves `unknown` (R-009), so this is usually that; when a
   * backend does report a kind the table can show it instead of a blank.
   */
  readonly sourceKind: CallIndexSourceKind
}

interface Aggregates {
  distinctTools: number
  bySource: Record<CallIndexSourceKind, number>
  byDay?: DayBucket[]
  dayOffsetMinutes: number
  /** Per-tool totals over the whole filtered set, capped by {@link CALL_INDEX_MAX_TOOL_ROWS}. */
  tools?: ToolAggregate[]
  /** True when more tools exist than the cap allowed to be sent. */
  toolsTruncated?: boolean
}

/** `YYYY-MM-DD` for an instant, shifted by the caller's local-day offset. */
function localDayLabel(epochMs: number, offsetMinutes: number): string | undefined {
  const shifted = epochMs + offsetMinutes * 60_000
  const date = new Date(shifted)
  const time = date.getTime()
  if (!Number.isFinite(time)) return undefined
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`)
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Overview aggregates over the filtered set, computed from the SAME frozen
 * snapshot and filter as `summary`, so the two can never disagree.
 *
 * `bySource` always emits all five keys. `unknown` is a real answer here — the
 * Host cannot prove a plugin owner (R-009) — so a caller must render "not
 * provable", not "unused". Returns `undefined` when the requested span would
 * exceed {@link CALL_INDEX_MAX_DAY_BUCKETS}, which the caller answers with
 * `reply-too-large` rather than a silently truncated trend.
 */
function aggregateRows(rows: readonly Row[], dayOffsetMinutes: number): Aggregates | undefined {
  const bySource: Record<CallIndexSourceKind, number> = { mcp: 0, 'plugin-tool': 0, native: 0, skill: 0, unknown: 0 }
  const tools = new Set<string>()
  const perTool = new Map<string, { calls: number; success: number; failed: number; cancelled: number; unresolved: number; unknown: number; running: number; durationSumMs: number; durationCount: number; lastStartedAt: number; sources: Map<CallIndexSourceKind, number> }>()
  const days = new Map<string, DayBucket>()
  for (const row of rows) {
    bySource[row.sourceKind] += 1
    tools.add(row.toolName)
    // Per-tool totals over the WHOLE filtered set. The per-tool table used to be
    // built from the rows a page happened to hold, which on a busy corpus showed
    // a single tool (the newest 1,050 calls were all one tool) even though 72
    // different tools existed. Counting here is O(rowed) once per capture.
    let entry = perTool.get(row.toolName)
    if (entry === undefined) {
      entry = { calls: 0, success: 0, failed: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, durationSumMs: 0, durationCount: 0, lastStartedAt: 0, sources: new Map() }
      perTool.set(row.toolName, entry)
    }
    entry.calls += 1
    // Row outcomes use `error`; the tool table reports it as `failed`.
    if (row.outcome === 'error') entry.failed += 1
    else if (row.outcome === 'success') entry.success += 1
    else if (row.outcome === 'cancelled') entry.cancelled += 1
    else if (row.outcome === 'unresolved') entry.unresolved += 1
    else if (row.outcome === 'unknown') entry.unknown += 1
    else entry.running += 1
    if (typeof row.durationMs === 'number' && Number.isFinite(row.durationMs) && row.durationMs >= 0) {
      entry.durationSumMs += row.durationMs
      entry.durationCount += 1
    }
    if (!Number.isFinite(entry.lastStartedAt) || row.startedAt > entry.lastStartedAt) entry.lastStartedAt = row.startedAt
    entry.sources.set(row.sourceKind, (entry.sources.get(row.sourceKind) ?? 0) + 1)
    const day = localDayLabel(row.startedAt, dayOffsetMinutes)
    if (day === undefined) continue
    let bucket = days.get(day)
    if (bucket === undefined) {
      if (days.size >= CALL_INDEX_MAX_DAY_BUCKETS) return undefined
      bucket = { day, calls: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0 }
      days.set(day, bucket)
    }
    bucket.calls += 1
    bucket[row.outcome] += 1
  }
  const aggregates: Aggregates = { distinctTools: tools.size, bySource, dayOffsetMinutes }
  if (perTool.size > 0) {
    const sorted = [...perTool.entries()]
      .map(([toolName, e]) => {
        let dominant: CallIndexSourceKind = 'unknown'
        let best = -1
        // Deterministic tie-break by the fixed source order, so a corpus that
        // reports equal counts does not flip labels between replies.
        for (const kind of CALL_INDEX_SOURCE_KINDS) {
          const count = e.sources.get(kind) ?? 0
          if (count > best) { best = count; dominant = kind }
        }
        const { sources: _sources, ...rest } = e
        return { toolName, ...rest, sourceKind: dominant }
      })
      .sort((a, b) => (b.calls - a.calls) || (a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0))
    aggregates.tools = sorted.slice(0, CALL_INDEX_MAX_TOOL_ROWS)
    if (sorted.length > CALL_INDEX_MAX_TOOL_ROWS) aggregates.toolsTruncated = true
  }
  if (days.size > 0) aggregates.byDay = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return aggregates
}

/**
 * Cheap raw-field prefilter. Runs BEFORE `projectRow` so a narrow query never
 * allocates a projected `Row` for a call it will not return. Every branch reads
 * only the fields the filter cares about; a type that cannot possibly match is
 * treated as "does not match" rather than projected and rejected. A row that
 * DOES match is then fully validated by `projectRow` (invalid metadata on a
 * matching row still fails the whole read, never silently dropped).
 */
function rawMatchesFilter(raw: unknown, filter: NormalizedQuery, cwdBySession: Map<string, string | undefined>): boolean {
  if (!filter.includeInherited && read(raw, 'inherited') === true) return false
  const sessionId = read(raw, 'sessionId')
  if (filter.sessionId !== undefined && sessionId !== filter.sessionId) return false
  if (filter.cwd !== undefined) {
    if (!isStr(sessionId) || cwdBySession.get(sessionId) !== filter.cwd) return false
  }
  if (filter.toolName !== undefined) {
    const toolName = read(raw, 'toolName')
    if (!isStr(toolName) || !toolName.toLowerCase().includes(filter.toolName)) return false
  }
  if (filter.outcome !== undefined && read(raw, 'outcome') !== filter.outcome) return false
  if (filter.sourceKind !== undefined && read(raw, 'sourceKind') !== filter.sourceKind) return false
  if (filter.fromMs !== undefined) {
    const startedAt = read(raw, 'startedAt')
    if (!isNum(startedAt) || startedAt < filter.fromMs) return false
  }
  if (filter.toMs !== undefined) {
    const startedAt = read(raw, 'startedAt')
    if (!isNum(startedAt) || startedAt >= filter.toMs) return false
  }
  return true
}

/**
 * Project ONE query view from a snapshot: validate the scope envelope, read the
 * raw rows that match the filter, project only those, then sort the matched
 * calls once. Sessions are filtered with the same predicate (and, for a
 * call-level filter, restricted to Sessions that actually have a matching call).
 */
function projectSnapshot(raw: unknown, filter: NormalizedQuery): Projection {
  if (!isRecord(raw)) return { kind: 'invalid' }
  const scope = read(raw, 'scope')
  const status = read(scope, 'status')
  if (status === 'disabled') return { kind: 'scope-disabled' }
  if (status === 'unavailable') return { kind: 'persistence-unavailable' }
  if (status !== 'ready') return { kind: 'invalid' }
  const generation = read(raw, 'generation')
  if (!isNonNegInt(generation)) return { kind: 'invalid' }
  const coverageRaw = read(raw, 'coverage')
  const coverage = coverageRaw === 'complete' || coverageRaw === 'partial' || coverageRaw === 'unknown' ? coverageRaw : 'unknown'
  const sessionsRaw = read(raw, 'sessions')
  const rowsRaw = read(raw, 'rows')
  if (!Array.isArray(sessionsRaw) || !Array.isArray(rowsRaw)) return { kind: 'invalid' }

  // Session cwd map first: the `cwd` filter tests a call by its Session's cwd.
  const cwdBySession = new Map<string, string | undefined>()
  for (const entry of sessionsRaw) {
    const sessionId = read(entry, 'sessionId')
    if (!isStr(sessionId)) continue
    const cwd = read(entry, 'cwd')
    cwdBySession.set(sessionId, isStr(cwd) ? cwd : undefined)
  }

  const callLevel = filter.toolName !== undefined || filter.outcome !== undefined
    || filter.sourceKind !== undefined || filter.fromMs !== undefined || filter.toMs !== undefined
  const rows: Row[] = []
  const matchedSessions = new Set<string>()
  for (const entry of rowsRaw) {
    if (!rawMatchesFilter(entry, filter, cwdBySession)) continue
    const row = projectRow(entry)
    if (row === undefined) return { kind: 'invalid' }
    rows.push(row)
    matchedSessions.add(row.sessionId)
  }

  const sessions: SessionMeta[] = []
  for (const entry of sessionsRaw) {
    const sessionId = read(entry, 'sessionId')
    const cwd = read(entry, 'cwd')
    if (filter.sessionId !== undefined && sessionId !== filter.sessionId) continue
    if (filter.cwd !== undefined && cwd !== filter.cwd) continue
    if (callLevel && !(isStr(sessionId) && matchedSessions.has(sessionId))) continue
    const meta = projectSession(entry)
    if (meta === undefined) return { kind: 'invalid' }
    sessions.push(meta)
  }
  sessions.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))

  const ordered = sortRows(rows)
  const semantic = read(raw, 'semanticCoverage')
  const semanticCoverage: SemanticCoverage = { source: read(semantic, 'source') === 'verified' ? 'verified' : 'unknown', ptc: read(semantic, 'ptc') === 'verified' ? 'verified' : 'unknown', skillExecution: read(semantic, 'skillExecution') === 'verified' ? 'verified' : 'unavailable', denied: read(semantic, 'denied') === 'verified' ? 'verified' : 'unavailable' }
  const data: ViewData = { snapshotId: randomUUID(), generation, coverage, sessions, rows: ordered, totals: summarize(ordered), semanticCoverage, cwdBySession }
  const asOf = read(raw, 'asOf')
  if (isNum(asOf)) data.asOf = asOf
  return { kind: 'ok', data }
}

function normalizeQuery(value: unknown): NormalizedQuery {
  const record = isRecord(value) ? value : {}
  const query: NormalizedQuery = { includeInherited: record.includeInherited === true }
  if (isStr(record.sessionId)) query.sessionId = record.sessionId
  if (isStr(record.toolName) && record.toolName.length > 0) query.toolName = record.toolName.toLowerCase()
  if (isStr(record.cwd)) query.cwd = record.cwd
  if (isStr(record.outcome)) query.outcome = record.outcome as Outcome
  if (isStr(record.sourceKind)) query.sourceKind = record.sourceKind as SourceKind
  if (isNum(record.fromMs)) query.fromMs = record.fromMs
  if (isNum(record.toMs)) query.toMs = record.toMs
  return query
}

function filterKey(query: NormalizedQuery): string {
  return JSON.stringify({
    sessionId: query.sessionId ?? null,
    toolName: query.toolName ?? null,
    cwd: query.cwd ?? null,
    outcome: query.outcome ?? null,
    sourceKind: query.sourceKind ?? null,
    fromMs: query.fromMs ?? null,
    toMs: query.toMs ?? null,
    includeInherited: query.includeInherited,
  })
}

function matches(row: Row, query: NormalizedQuery, view: View): boolean {
  if (!query.includeInherited && row.inherited) return false
  if (query.sessionId !== undefined && row.sessionId !== query.sessionId) return false
  if (query.toolName !== undefined && query.toolName.length > 0
    && !row.toolName.toLowerCase().includes(query.toolName.toLowerCase())) return false
  if (query.outcome !== undefined && row.outcome !== query.outcome) return false
  if (query.sourceKind !== undefined && row.sourceKind !== query.sourceKind) return false
  if (query.cwd !== undefined && view.cwdBySession.get(row.sessionId) !== query.cwd) return false
  if (query.fromMs !== undefined && row.startedAt < query.fromMs) return false
  if (query.toMs !== undefined && row.startedAt >= query.toMs) return false
  return true
}

/** Stable desc-by-start sort, then sessionId, then callSeq. */
function sortRows(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) =>
    b.startedAt - a.startedAt
    || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
    || a.callSeq - b.callSeq)
}

/**
 * Immutable, bounded query views behind the `callIndex` namespace.
 *
 * One instance is owned by the Host runtime. Views are frozen captures of a
 * single `snapshot()` filtered to one query; cursors point at offsets inside
 * one view.
 */
export class CallIndexQueries {
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxViews: number
  private readonly maxBytes: number
  private readonly maxReplyBytes: number
  private readonly views = new Map<string, View>()
  private readonly cursors = new Map<string, Cursor>()
  private readonly cursorKeys = new Map<string, string>()
  private totalBytes = 0
  /** Most recently served CALLS view; a detail read reuses it (TG-12 "V5"). */
  private lastCallsViewId: string | undefined

  constructor(private readonly source: CallIndexQuerySource, options: CallIndexQueryOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? CALL_INDEX_DEFAULT_TTL_MS
    this.maxViews = options.maxViews ?? CALL_INDEX_DEFAULT_MAX_VIEWS
    this.maxBytes = options.maxBytes ?? CALL_INDEX_DEFAULT_MAX_BYTES
    this.maxReplyBytes = Math.min(options.maxReplyBytes ?? CALL_INDEX_MAX_REPLY_BYTES, CALL_INDEX_MAX_REPLY_BYTES)
    for (const value of [this.ttlMs, this.maxViews, this.maxBytes, this.maxReplyBytes]) if (!Number.isSafeInteger(value) || value < 1) throw Error('invalid call-index query limit')
  }

  /**
   * Wire envelope shared by every page.
   *
   * `totalExact` means "this number is the whole truth for the filter". The two
   * kinds of provenance filter are NOT symmetric, and the asymmetry decides the
   * flag:
   *
   * - `sourceKind: 'mcp' | 'native' | 'plugin-tool' | 'skill'` — the predicate
   *   means "the real source IS mcp", but the stored label only means "the
   *   catalog resolved it to mcp". A call from a since-removed plugin is
   *   labelled `unknown` although it really was MCP, so this count is a LOWER
   *   BOUND and must not claim exact.
   * - `sourceKind: 'unknown'` — the predicate is the label itself. Every row
   *   carries exactly one label (`buildRow` always writes it, and
   *   `projectRow` drops a row with an invalid one), so "rows matching this
   *   filter" equals "rows labelled unknown" by definition: nothing can be
   *   missed and nothing counted twice. That exactness is definitional, not
   *   evidential, which is why it survives.
   *
   * What `unknown` must NOT be read as is "calls whose real source is unknown":
   * it also holds calls whose source is known but whose tool left the catalog.
   * It is a superset of the truly-unresolved, so the UI has to say
   * "provenance unresolved", never "未知来源的真实总数".
   */
  private meta(view: View, filter: NormalizedQuery): Record<string, unknown> {
    const provenanceFilterExact = filter.sourceKind === undefined || filter.sourceKind === 'unknown'
    return { corpus: 'persisted-plus-observed-live', snapshotId: view.snapshotId, generation: view.generation, coverage: view.coverage,
      totalExact: view.coverage === 'complete' && provenanceFilterExact,
      semanticCoverage: { ...view.semanticCoverage } }
  }
  private bounded(reply: CallIndexReply): CallIndexReply {
    try {
      const projected = callIndexReply(reply)
      return Buffer.byteLength(JSON.stringify(projected), 'utf8') <= this.maxReplyBytes ? projected : callIndexError('reply-too-large')
    } catch { return callIndexError('internal-error') }
  }

  /** Drop every cached view and cursor (explicit rescan / disable / dispose). */
  invalidate(): void {
    this.views.clear()
    this.cursors.clear()
    this.cursorKeys.clear()
    this.totalBytes = 0
    this.lastCallsViewId = undefined
  }

  private estimateBytes(data: ViewData): number {
    return Buffer.byteLength(
      JSON.stringify({ generation: data.generation, coverage: data.coverage, sessions: data.sessions, rows: data.rows }),
      'utf8',
    )
  }

  private dropView(id: string): void {
    const view = this.views.get(id)
    if (view === undefined) return
    this.views.delete(id)
    this.totalBytes = Math.max(0, this.totalBytes - view.bytes)
    if (this.lastCallsViewId === id) this.lastCallsViewId = undefined
    for (const [cursorId, cursor] of this.cursors) {
      if (cursor.viewId !== id) continue
      this.cursors.delete(cursorId)
      this.cursorKeys.delete(this.cursorKey(id, cursor.kind, cursor.filterKey, cursor.offset))
    }
  }

  private evictExpired(): void {
    const now = this.now()
    for (const [id, view] of this.views) if (now - view.capturedAt > this.ttlMs) this.dropView(id)
  }

  private evictOldest(): void {
    let oldest: View | undefined
    for (const view of this.views.values()) if (oldest === undefined || view.capturedAt < oldest.capturedAt) oldest = view
    if (oldest !== undefined) this.dropView(oldest.snapshotId)
  }

  private capture(filter: NormalizedQuery): { kind: 'ok'; view: View } | { kind: 'error'; reason: CallIndexErrorReason } {
    let projection: Projection
    let before: string
    try { before = this.source.stamp(); projection = projectSnapshot(this.source.snapshot(), filter) }
    catch { return { kind: 'error', reason: 'internal-error' } }
    if (projection.kind === 'scope-disabled') return { kind: 'error', reason: 'scope-disabled' }
    if (projection.kind === 'persistence-unavailable') return { kind: 'error', reason: 'persistence-unavailable' }
    if (projection.kind === 'invalid') return { kind: 'error', reason: 'internal-error' }
    const bytes = this.estimateBytes(projection.data) + 2 * Buffer.byteLength(JSON.stringify(filter), 'utf8') + 256
    if (bytes > this.maxBytes) return { kind: 'error', reason: 'query-capacity' }
    let stamp: string
    try {
      stamp = this.source.stamp()
    } catch {
      return { kind: 'error', reason: 'internal-error' }
    }
    if (before !== stamp) return { kind: 'error', reason: 'cursor-stale' }
    // Reuse an identical frozen view instead of capturing a second one.
    //
    // Every first-page read used to create a NEW view even when an equivalent
    // one was alive. Those captures evicted the view a paginating reader was
    // still walking (maxViews is small), so the next cursor page answered
    // `cursor-stale` — observed live: 8 view-creating reads against 9 cursor
    // reads in one session, most cursor pages stale, so the detail table never
    // got past page one and the per-tool panels showed a single tool.
    //
    // A view is identified by its filter AND the corpus generation it froze.
    // Same filter, same generation => byte-identical rows, so returning the
    // live view is exactly what a caller would have got by capturing again.
    const wanted = filterKey(filter)
    const frozen = projection.data.generation
    for (const existing of this.views.values()) {
      if (existing.filterKey === wanted && existing.generation === frozen) {
        // Touch it: a reader that is actively paging must not have its view
        // expire underneath it, or the next cursor page fails the same way.
        existing.capturedAt = this.now()
        return { kind: 'ok', view: existing }
      }
    }
    this.evictExpired()
    while ((this.views.size >= this.maxViews || this.totalBytes + bytes > this.maxBytes) && this.views.size > 0) this.evictOldest()
    const view: View = { ...projection.data, stamp, filter, filterKey: filterKey(filter), capturedAt: this.now(), bytes }
    this.views.set(view.snapshotId, view)
    this.totalBytes += bytes
    return { kind: 'ok', view }
  }

  private resolveView(snapshotId: string | undefined, filter?: NormalizedQuery): { kind: 'ok'; view: View } | { kind: 'error'; reason: CallIndexErrorReason } {
    this.evictExpired()
    if (snapshotId === undefined) return this.capture(filter ?? normalizeQuery(undefined))
    const view = this.views.get(snapshotId)
    if (view === undefined) return { kind: 'error', reason: 'cursor-stale' }
    if (filter !== undefined && filterKey(filter) !== view.filterKey) return { kind: 'error', reason: 'invalid-request' }
    let stamp: string
    try {
      stamp = this.source.stamp()
    } catch {
      return { kind: 'error', reason: 'internal-error' }
    }
    if (stamp !== view.stamp) {
      this.dropView(snapshotId)
      return { kind: 'error', reason: 'cursor-stale' }
    }
    return { kind: 'ok', view }
  }

  private hasUpdates(view: View): boolean {
    if (this.source.generation === undefined) return false
    try {
      const generation = this.source.generation()
      return isInt(generation) && generation !== view.generation
    } catch {
      return false
    }
  }

  private cursorKey(viewId: string, kind: 'sessions' | 'calls', _key: string, offset: number): string {
    // The filter is already bound to the view; avoid copying a long filter per cursor.
    return `${viewId}\u0000${kind}\u0000${offset}`
  }

  /** Reuse the cursor id for an identical (view, kind, filter, offset) position. */
  private newCursor(view: View, kind: 'sessions' | 'calls', filter: NormalizedQuery, offset: number): string {
    const key = this.cursorKey(view.snapshotId, kind, filterKey(filter), offset)
    const existing = this.cursorKeys.get(key)
    if (existing !== undefined && this.cursors.has(existing)) return existing
    while (this.cursors.size >= 256) {
      const oldest = this.cursors.keys().next().value
      if (oldest === undefined) break
      const entry = this.cursors.get(oldest)!
      this.cursors.delete(oldest)
      this.cursorKeys.delete(this.cursorKey(entry.viewId, entry.kind, entry.filterKey, entry.offset))
    }
    const id = randomUUID()
    this.cursors.set(id, { viewId: view.snapshotId, kind, filter, filterKey: view.filterKey, offset })
    this.cursorKeys.set(key, id)
    return id
  }

  private fitCount(count: number, encodeBytes: (count: number) => number): number {
    if (count <= 0) return 0
    if (encodeBytes(count) <= this.maxReplyBytes) return count
    let low = 1
    let high = count
    let best = 0
    while (low <= high) {
      const mid = (low + high) >> 1
      if (encodeBytes(mid) <= this.maxReplyBytes) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return best
  }

  private listContext(
    request: { query?: unknown; snapshotId?: string; cursor?: string },
    kind: 'sessions' | 'calls',
  ): { ok: true; view: View; filter: NormalizedQuery; offset: number } | { ok: false; reply: CallIndexReply } {
    this.evictExpired()
    let cursorEntry: Cursor | undefined
    if (request.cursor !== undefined) {
      cursorEntry = this.cursors.get(request.cursor)
      if (cursorEntry === undefined || cursorEntry.kind !== kind) return { ok: false, reply: callIndexError('cursor-stale') }
      if (request.snapshotId !== undefined && request.snapshotId !== cursorEntry.viewId) {
        return { ok: false, reply: callIndexError('invalid-request') }
      }
    }
    const resolved = this.resolveView(request.snapshotId ?? cursorEntry?.viewId, request.query === undefined ? undefined : normalizeQuery(request.query))
    if (resolved.kind === 'error') return { ok: false, reply: callIndexError(resolved.reason) }
    const view = resolved.view
    if (cursorEntry !== undefined && cursorEntry.viewId !== view.snapshotId) {
      return { ok: false, reply: callIndexError('cursor-stale') }
    }
    if (cursorEntry !== undefined) {
      if (request.query !== undefined && filterKey(normalizeQuery(request.query)) !== cursorEntry.filterKey) {
        return { ok: false, reply: callIndexError('invalid-request') }
      }
      return { ok: true, view, filter: cursorEntry.filter, offset: cursorEntry.offset }
    }
    return { ok: true, view, filter: view.filter, offset: 0 }
  }

  /** Summarise the whole filtered set (not the current page). */
  getSummary(request?: unknown): CallIndexReply {
    const parsed = callIndexSummaryRequestSchema.safeParse(requestObject(request))
    if (!parsed.success) return callIndexError('invalid-request')
    const resolved = this.resolveView(parsed.data.snapshotId, parsed.data.query === undefined ? undefined : normalizeQuery(parsed.data.query))
    if (resolved.kind === 'error') return callIndexError(resolved.reason)
    const view = resolved.view
    const filter = view.filter
    const dayOffsetMinutes = parsed.data.dayOffsetMinutes ?? 0
    const aggregates = aggregateRows(view.rows, dayOffsetMinutes)
    if (aggregates === undefined) return callIndexError('reply-too-large')
    const data: Record<string, unknown> = {
      ...this.meta(view, filter),
      summary: view.totals,
      total: view.rows.length,
      hasUpdates: this.hasUpdates(view),
      aggregates,
    }
    if (view.asOf !== undefined) data.asOf = view.asOf
    return this.bounded({ schemaVersion: 1, ok: true, kind: 'summary', data })
  }

  /** One page of Session metadata; zero-call Sessions are included when unfiltered. */
  listSessions(request?: unknown): CallIndexReply {
    const parsed = callIndexListRequestSchema.safeParse(requestObject(request))
    if (!parsed.success) return callIndexError('invalid-request')
    const context = this.listContext(parsed.data, 'sessions')
    if (!context.ok) return context.reply
    const { view, filter, offset } = context
    const ordered = view.sessions
    if (offset > ordered.length) return callIndexError('cursor-stale')
    const limit = parsed.data.limit ?? CALL_INDEX_DEFAULT_LIMIT
    const summary = view.totals
    const placeholder = 'x'.repeat(36)
    const make = (count: number, nextCursor: string | undefined): CallIndexReply => {
      const data: Record<string, unknown> = {
        ...this.meta(view, filter),
        summary,
        total: ordered.length,
        items: ordered.slice(offset, offset + count),
        hasUpdates: this.hasUpdates(view),
      }
      if (view.asOf !== undefined) data.asOf = view.asOf
      if (nextCursor !== undefined) data.nextCursor = nextCursor
      return { schemaVersion: 1, ok: true, kind: 'sessions', data }
    }
    const room = Math.min(limit, ordered.length - offset)
    const count = this.fitCount(room, (n) => Buffer.byteLength(JSON.stringify(make(n, offset + n < ordered.length ? placeholder : undefined)), 'utf8'))
    if (room > 0 && count === 0) return callIndexError('reply-too-large')
    const nextCursor = offset + count < ordered.length ? this.newCursor(view, 'sessions', filter, offset + count) : undefined
    return this.bounded(make(count, nextCursor))
  }

  /** One page of call rows in stable `(startedAt DESC, sessionId, callSeq)` order. */
  listCalls(request?: unknown): CallIndexReply {
    const parsed = callIndexListRequestSchema.safeParse(requestObject(request))
    if (!parsed.success) return callIndexError('invalid-request')
    const context = this.listContext(parsed.data, 'calls')
    if (!context.ok) return context.reply
    const { view, filter, offset } = context
    this.lastCallsViewId = view.snapshotId
    // `view.rows` is already filtered AND sorted once at capture, so a page is a
    // pure slice; the full filtered set is never re-sorted per page (TG-12).
    const ordered = view.rows
    if (offset > ordered.length) return callIndexError('cursor-stale')
    const limit = parsed.data.limit ?? CALL_INDEX_DEFAULT_LIMIT
    const summary = view.totals
    const placeholder = 'x'.repeat(36)
    const make = (count: number, nextCursor: string | undefined): CallIndexReply => {
      const data: Record<string, unknown> = {
        ...this.meta(view, filter),
        summary,
        total: ordered.length,
        items: ordered.slice(offset, offset + count),
        hasUpdates: this.hasUpdates(view),
      }
      if (view.asOf !== undefined) data.asOf = view.asOf
      if (nextCursor !== undefined) data.nextCursor = nextCursor
      return { schemaVersion: 1, ok: true, kind: 'calls', data }
    }
    const room = Math.min(limit, ordered.length - offset)
    const count = this.fitCount(room, (n) => Buffer.byteLength(JSON.stringify(make(n, offset + n < ordered.length ? placeholder : undefined)), 'utf8'))
    if (room > 0 && count === 0) return callIndexError('reply-too-large')
    const nextCursor = offset + count < ordered.length ? this.newCursor(view, 'calls', filter, offset + count) : undefined
    return this.bounded(make(count, nextCursor))
  }

  /**
   * Find a pooled view (same authorization stamp) containing one call, so a
   * detail read can reuse an existing snapshot instead of capturing a new one.
   * Prefers the most recent CALLS view, then the newest other view.
   */
  private findDetailView(sessionId: string, callSeq: number): { view: View; row: Row } | undefined {
    this.evictExpired()
    let stamp: string
    try {
      stamp = this.source.stamp()
    } catch {
      return undefined
    }
    const ordered: View[] = []
    const last = this.lastCallsViewId === undefined ? undefined : this.views.get(this.lastCallsViewId)
    if (last !== undefined) ordered.push(last)
    for (const view of this.views.values()) if (view !== last) ordered.push(view)
    for (const view of ordered) {
      if (view.stamp !== stamp) continue
      const row = view.rows.find(item => item.sessionId === sessionId && item.callSeq === callSeq && matches(item, view.filter, view))
      if (row !== undefined) return { view, row }
    }
    return undefined
  }

  /**
   * Safely read one call's metadata. The row must be in a frozen view, then the
   * Session must still be visible, then the authorization stamp must still
   * match — a detail read never trusts a browser-supplied id by itself.
   *
   * With `snapshotId` the read is bound to that exact view's filter (the precise
   * path). Without it, the most recent CALLS view is reused so opening a detail
   * does not churn the view pool (TG-12 "V5"); only if no pooled view holds the
   * row is a fresh view captured.
   */
  async getCallDetail(request: unknown): Promise<CallIndexReply> {
    const parsed = callIndexDetailRequestSchema.safeParse(requestObject(request))
    if (!parsed.success) return callIndexError('invalid-request')
    let view: View
    let row: Row | undefined
    if (parsed.data.snapshotId !== undefined) {
      const resolved = this.resolveView(parsed.data.snapshotId)
      if (resolved.kind === 'error') return callIndexError(resolved.reason)
      view = resolved.view
      row = view.rows.find(item => item.sessionId === parsed.data.sessionId && item.callSeq === parsed.data.callSeq && matches(item, view.filter, view))
      if (row === undefined) return callIndexError('not-visible')
    } else {
      const found = this.findDetailView(parsed.data.sessionId, parsed.data.callSeq)
      if (found !== undefined) {
        view = found.view
        row = found.row
      } else {
        // No pooled view holds it: capture a NARROW view for just this Session so
        // a single detail read never pays the whole-corpus byte budget.
        const captured = this.capture({ includeInherited: true, sessionId: parsed.data.sessionId })
        if (captured.kind === 'error') return callIndexError(captured.reason)
        view = captured.view
        row = view.rows.find(item => item.sessionId === parsed.data.sessionId && item.callSeq === parsed.data.callSeq && matches(item, view.filter, view))
        if (row === undefined) return callIndexError('not-visible')
      }
    }
    let visible = false
    try {
      visible = await this.source.isSessionVisible(parsed.data.sessionId)
    } catch {
      visible = false
    }
    if (!visible) return callIndexError('not-visible')
    let stamp: string
    try {
      stamp = this.source.stamp()
    } catch {
      return callIndexError('internal-error')
    }
    if (stamp !== view.stamp || this.views.get(view.snapshotId) !== view) return callIndexError('cursor-stale')
    if (this.now() - view.capturedAt > this.ttlMs) {
      this.dropView(view.snapshotId)
      return callIndexError('cursor-stale')
    }
    const data: Record<string, unknown> = {
      ...this.meta(view, view.filter),
      detail: row,
    }
    if (view.asOf !== undefined) data.asOf = view.asOf
    return this.bounded({ schemaVersion: 1, ok: true, kind: 'detail', data })
  }
}
