/**
 * Browser-safe wire contract for the `callIndex` Remote namespace (D-026).
 *
 * This module is the single place both faces agree on. It is imported at
 * RUNTIME by the browser contribution (`src/client/call-index-remote.ts`) and by
 * the Host face (`src/usage/call-index-host-face.ts`), so it may only depend on
 * `zod`; it must never runtime-import a Node module or `session-index.ts` (a
 * type-only import is fine because it is erased before the browser bundle).
 *
 * @module dsh-thinking-guard/usage/call-index-wire
 */
import { z } from 'zod'

/** Every reply kind on the `callIndex` wire. */
export const CALL_INDEX_REPLY_KINDS = [
  'status',
  'task',
  'summary',
  'sessions',
  'calls',
  'detail',
  'error',
] as const
export type CallIndexReplyKind = (typeof CALL_INDEX_REPLY_KINDS)[number]

/** Stable failure codes; anything else normalizes to `internal-error`. */
export const CALL_INDEX_ERROR_REASONS = [
  'invalid-request',
  'scope-disabled',
  'persistence-unavailable',
  'cursor-stale',
  'query-capacity',
  'reply-too-large',
  'not-visible',
  'runtime-unavailable',
  'task-not-found',
  'internal-error',
] as const
export type CallIndexErrorReason = (typeof CALL_INDEX_ERROR_REASONS)[number]

/** Call statuses mirrored from `CallIndexRow.outcome`. */
export const CALL_INDEX_OUTCOMES = [
  'success',
  'error',
  'cancelled',
  'unresolved',
  'unknown',
  'running',
] as const
export type CallIndexOutcome = (typeof CALL_INDEX_OUTCOMES)[number]

/** Known call source categories (the core currently emits only `unknown`). */
export const CALL_INDEX_SOURCE_KINDS = ['mcp', 'plugin-tool', 'native', 'skill', 'unknown'] as const
export type CallIndexSourceKind = (typeof CALL_INDEX_SOURCE_KINDS)[number]

/** Shared literal bounds; Host and browser must agree. */
export const CALL_INDEX_MAX_ID_LENGTH = 512
export const CALL_INDEX_MAX_CWD_LENGTH = 4096
export const CALL_INDEX_MAX_CURSOR_LENGTH = 256
export const CALL_INDEX_DEFAULT_LIMIT = 50
export const CALL_INDEX_MAX_LIMIT = 200
export const CALL_INDEX_DEFAULT_TTL_MS = 60_000
export const CALL_INDEX_DEFAULT_MAX_VIEWS = 4
export const CALL_INDEX_DEFAULT_MAX_BYTES = 8 * 1024 * 1024
export const CALL_INDEX_MAX_REPLY_BYTES = 256 * 1024

/**
 * Reply envelope. Intentionally loose at the type level (`kind` + `data`) so
 * the runtime owner can build `{ schemaVersion, ok, kind, data }` without
 * importing every inner interface; the runtime guarantee comes from
 * {@link callIndexReply}, which re-projects the value through closed schemas.
 */
export interface CallIndexReply {
  readonly schemaVersion: 1
  readonly ok: boolean
  readonly kind: CallIndexReplyKind
  readonly data?: Record<string, unknown>
  readonly reason?: string
  readonly [key: string]: unknown
}

/** Build a stable error reply; an unknown reason becomes `internal-error`. */
export function callIndexError(reason: string): CallIndexReply {
  const normalized = (CALL_INDEX_ERROR_REASONS as readonly string[]).includes(reason)
    ? (reason as CallIndexErrorReason)
    : 'internal-error'
  return { schemaVersion: 1, ok: false, kind: 'error', reason: normalized }
}

const outcomeEnum = z.enum([...CALL_INDEX_OUTCOMES] as [CallIndexOutcome, ...CallIndexOutcome[]])
const sourceKindEnum = z.enum([...CALL_INDEX_SOURCE_KINDS] as [CallIndexSourceKind, ...CallIndexSourceKind[]])

/** A finite number that is also a valid `Date` instant. */
const epochMs = z.number().refine(
  (value) => Number.isFinite(value) && Number.isFinite(new Date(value).getTime()),
  { message: 'invalid-date' },
)

/** One filter shared by summary / list requests. Half-open `[fromMs, toMs)`. */
export const callIndexQuerySchema = z
  .object({
    sessionId: z.string().max(CALL_INDEX_MAX_ID_LENGTH).optional(),
    toolName: z.string().max(CALL_INDEX_MAX_ID_LENGTH).optional(),
    cwd: z.string().max(CALL_INDEX_MAX_CWD_LENGTH).optional(),
    outcome: outcomeEnum.optional(),
    sourceKind: sourceKindEnum.optional(),
    fromMs: epochMs.optional(),
    toMs: epochMs.optional(),
    includeInherited: z.boolean().optional(),
  })
  .strict()
  .refine(value => value.fromMs === undefined || value.toMs === undefined || value.fromMs <= value.toMs, { message: 'invalid-date-interval' })

/** Bounds for the client-supplied local-day offset (UTC-12:00 … UTC+14:00). */
export const CALL_INDEX_MIN_DAY_OFFSET_MINUTES = -720
export const CALL_INDEX_MAX_DAY_OFFSET_MINUTES = 840
/** Hard cap on returned day buckets: one calendar year of daily rows. */
export const CALL_INDEX_MAX_DAY_BUCKETS = 366

/**
 * How many per-tool rows an aggregates reply may carry.
 *
 * The per-tool table needs the whole filtered set, not the rows one page holds:
 * a busy corpus put one tool in the newest 1,050 calls and the table looked like
 * it only had that tool. Bounding the list keeps the reply small; `toolsTruncated`
 * tells the UI to say so instead of implying completeness.
 */
export const CALL_INDEX_MAX_TOOL_ROWS = 60

export const callIndexSummaryRequestSchema = z
  .object({
    query: callIndexQuerySchema.optional(),
    snapshotId: z.string().min(1).max(CALL_INDEX_MAX_ID_LENGTH).optional(),
    /**
     * Minutes east of UTC for the caller's local day boundary.
     *
     * The Host never guesses a timezone: a natural-day bucket is only meaningful
     * relative to a zone, and the browser is the only party that knows the user's
     * preference. Absent means the buckets are UTC days.
     */
    dayOffsetMinutes: z
      .number()
      .int()
      .min(CALL_INDEX_MIN_DAY_OFFSET_MINUTES)
      .max(CALL_INDEX_MAX_DAY_OFFSET_MINUTES)
      .optional(),
  })
  .strict()

export const callIndexListRequestSchema = z
  .object({
    query: callIndexQuerySchema.optional(),
    snapshotId: z.string().min(1).max(CALL_INDEX_MAX_ID_LENGTH).optional(),
    cursor: z.string().min(1).max(CALL_INDEX_MAX_CURSOR_LENGTH).optional(),
    limit: z.number().int().min(1).max(CALL_INDEX_MAX_LIMIT).optional(),
  })
  .strict()

export const callIndexDetailRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(CALL_INDEX_MAX_ID_LENGTH),
    callSeq: z.number().int().min(0),
    snapshotId: z.string().min(1).max(CALL_INDEX_MAX_ID_LENGTH).optional(),
  })
  .strict()

/** `startIndex(request?)`; the runtime owns the actual scan mode. */
export const callIndexStartRequestSchema = z
  .object({ mode: z.enum(['full', 'incremental']).optional() })
  .strict()

/** `cancelIndex(request)`; `request` is required even when it carries nothing. */
export const callIndexCancelRequestSchema = z
  .object({ taskId: z.string().min(1).max(CALL_INDEX_MAX_ID_LENGTH).optional() })
  .strict()

/**
 * Reason codes, sanitized instead of rejected.
 *
 * A strict `.max(32)` list here was a whole-reply failure mode: the scan legitimately
 * accumulates reasons per Session, so once a large corpus produced more than 32
 * distinct codes the ENTIRE status reply was rejected as internal-error and the
 * page reported 「尚未收到索引状态」 — losing the numbers and the diagnostics at
 * the same time. A diagnostic field must never be able to break the read it is
 * supposed to explain.
 *
 * Now each entry is clamped to the wire's 64-char alphabet and the list is
 * truncated to the first 32 (the UI shows them as text, so the first ones are
 * also the most relevant). Malformed entries are dropped rather than failing the
 * parse: the payload keeps answering, just with fewer codes.
 */
const callIndexReasonListSchema = z.array(z.string()).transform(list => {
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const code = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64)
    if (!/^[a-z]/.test(code) || out.includes(code)) continue
    out.push(code)
    if (out.length >= 32) break
  }
  return out
})

const coverageEnum = z.enum(['complete', 'partial', 'unknown'])

/** Fixed metadata fields of one call row (mirrors `CallIndexRow`, never args). */
export const callIndexWireRowSchema = z.object({
  sessionId: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  callSeq: z.number().int().min(0),
  callId: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  toolName: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  turn: z.number().int().optional(),
  step: z.number().int().optional(),
  startedAt: epochMs,
  endedAt: epochMs.optional(),
  resultSeq: z.number().int().optional(),
  durationMs: z.number().min(0).optional(),
  outcome: outcomeEnum,
  inherited: z.boolean(),
  sourceKind: sourceKindEnum,
  layer: z.string().max(64),
})

const sessionRowSchema = z.object({
  sessionId: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  cwd: z.string().max(CALL_INDEX_MAX_CWD_LENGTH).optional(),
  revision: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  cut: z.number().int().min(0),
  coverage: z.enum(['complete', 'partial']),
  stale: z.boolean(),
  reasons: callIndexReasonListSchema,
})
export const callIndexWireSessionSchema = sessionRowSchema

/**
 * Outcome counts. Every counter is optional and defaults to 0.
 *
 * This is the THIRD place the same failure mode appeared: a strict object here
 * meant a reply missing one counter (an older Host, a partially built summary)
 * was rejected as internal-error, so 调用明细 printed 「Host 返回了无效的响应
 * 结构」 and lost all 710 rows that were perfectly valid.
 *
 * A count that was not sent is 0. Losing an entire page over one absent integer
 * is never the right trade: the page shows far more than this breakdown.
 */
const summarySchema = z.object({
  total: z.number().int().min(0).optional(),
  success: z.number().int().min(0).optional(),
  error: z.number().int().min(0).optional(),
  cancelled: z.number().int().min(0).optional(),
  unresolved: z.number().int().min(0).optional(),
  unknown: z.number().int().min(0).optional(),
  running: z.number().int().min(0).optional(),
  inherited: z.number().int().min(0).optional(),
}).transform(counts => ({
  total: counts.total ?? 0,
  success: counts.success ?? 0,
  error: counts.error ?? 0,
  cancelled: counts.cancelled ?? 0,
  unresolved: counts.unresolved ?? 0,
  unknown: counts.unknown ?? 0,
  running: counts.running ?? 0,
  inherited: counts.inherited ?? 0,
}))

const pageBase = {
  corpus: z.literal('persisted-plus-observed-live').optional(),
  snapshotId: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  generation: z.number().int(),
  asOf: z.number().optional(),
  coverage: coverageEnum,
  totalExact: z.boolean().optional(),
  semanticCoverage: z.object({ source: z.enum(['unknown', 'verified']), ptc: z.enum(['unknown', 'verified']), skillExecution: z.enum(['unavailable', 'verified']), denied: z.enum(['unavailable', 'verified']) }).optional(),
}

/**
 * Overview aggregates over the whole filtered set (never the current page).
 *
 * `bySource` always carries every source kind, including zeros, so a caller can
 * distinguish "known to be zero" from "not reported". `byDay` is bounded and
 * ordered oldest-first; a request whose span exceeds
 * {@link CALL_INDEX_MAX_DAY_BUCKETS} fails with `reply-too-large` instead of
 * silently truncating a trend line.
 */
/**
 * Per-source counts. All five keys are always emitted by this Host, but a reply
 * that omits one is still readable: the missing kind is 0 and the caller renders
 * it as "not resolved" anyway (R-009 forbids reading 0 as "unused"). Rejecting
 * the whole overview over one absent key was never worth it.
 */
export const callIndexSourceCountsSchema = z.object({
  mcp: z.number().int().min(0).optional(),
  'plugin-tool': z.number().int().min(0).optional(),
  native: z.number().int().min(0).optional(),
  skill: z.number().int().min(0).optional(),
  unknown: z.number().int().min(0).optional(),
}).transform(counts => ({
  mcp: counts.mcp ?? 0,
  'plugin-tool': counts['plugin-tool'] ?? 0,
  native: counts.native ?? 0,
  skill: counts.skill ?? 0,
  unknown: counts.unknown ?? 0,
}))

/**
 * One day of the trend, salvaged rather than rejected.
 *
 * A strict object here had the same failure mode the status reply had: a bucket
 * missing ONE counter (an older Host, a partially built aggregate) made the whole
 * getSummary answer fail, so 总览 printed 「Host 返回了无效的响应结构」 and lost
 * every number — including the ones that were perfectly valid.
 *
 * A day bucket is a display row. A missing counter is a 0, not a reason to throw
 * away the entire overview. Only the day label stays mandatory, because a bucket
 * without a usable date cannot be placed on the axis at all.
 */
const dayBucketSchema = z.object({
  /** `YYYY-MM-DD` in the caller's local day boundary. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  calls: z.number().int().min(0).optional(),
  success: z.number().int().min(0).optional(),
  error: z.number().int().min(0).optional(),
  cancelled: z.number().int().min(0).optional(),
  unresolved: z.number().int().min(0).optional(),
  unknown: z.number().int().min(0).optional(),
  running: z.number().int().min(0).optional(),
}).transform(bucket => ({
  day: bucket.day,
  calls: bucket.calls ?? 0,
  success: bucket.success ?? 0,
  error: bucket.error ?? 0,
  cancelled: bucket.cancelled ?? 0,
  unresolved: bucket.unresolved ?? 0,
  unknown: bucket.unknown ?? 0,
  running: bucket.running ?? 0,
}))

/** One tool's totals over the whole filtered set (see {@link CALL_INDEX_MAX_TOOL_ROWS}). */
const toolAggregateSchema = z.object({
  // Same bound as the row schema: a tool name the rows may carry must not be
  // rejected here, or one long identifier turns the whole reply into an error.
  toolName: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  calls: z.number().int().min(0),
  success: z.number().int().min(0).optional(),
  failed: z.number().int().min(0).optional(),
  cancelled: z.number().int().min(0).optional(),
  unresolved: z.number().int().min(0).optional(),
  unknown: z.number().int().min(0).optional(),
  running: z.number().int().min(0).optional(),
  durationSumMs: z.number().min(0).optional(),
  durationCount: z.number().int().min(0).optional(),
  lastStartedAt: z.number().optional(),
  sourceKind: z.enum(CALL_INDEX_SOURCE_KINDS).optional(),
}).transform(tool => ({
  toolName: tool.toolName,
  calls: tool.calls,
  success: tool.success ?? 0,
  failed: tool.failed ?? 0,
  cancelled: tool.cancelled ?? 0,
  unresolved: tool.unresolved ?? 0,
  unknown: tool.unknown ?? 0,
  running: tool.running ?? 0,
  durationSumMs: tool.durationSumMs ?? 0,
  durationCount: tool.durationCount ?? 0,
  lastStartedAt: tool.lastStartedAt ?? 0,
  sourceKind: tool.sourceKind ?? 'unknown',
}))

export const callIndexAggregatesSchema = z.object({
  /** Distinct `toolName` values in the filtered set (rows, not calls). */
  distinctTools: z.number().int().min(0),
  bySource: callIndexSourceCountsSchema,
  /** Oldest-first local-day buckets; omitted when the filtered set is empty. */
  byDay: z.array(dayBucketSchema).max(CALL_INDEX_MAX_DAY_BUCKETS).optional(),
  /** Day boundary actually used, echoed so the UI cannot mislabel a UTC day. */
  dayOffsetMinutes: z.number().int().min(CALL_INDEX_MIN_DAY_OFFSET_MINUTES).max(CALL_INDEX_MAX_DAY_OFFSET_MINUTES),
  /** Per-tool totals over the whole filtered set, highest calls first. */
  tools: z.array(toolAggregateSchema).max(CALL_INDEX_MAX_TOOL_ROWS).optional(),
  /** True when more tools exist than the cap allowed to be sent. */
  toolsTruncated: z.boolean().optional(),
})

const summaryDataSchema = z.object({
  ...pageBase,
  hasUpdates: z.boolean().optional(),
  summary: summarySchema,
  total: z.number().int().min(0).optional(),
  aggregates: callIndexAggregatesSchema.optional(),
})

const sessionsDataSchema = z.object({
  ...pageBase,
  summary: summarySchema,
  total: z.number().int().min(0).optional(),
  items: z.array(sessionRowSchema).optional(),
  nextCursor: z.string().optional(),
  hasUpdates: z.boolean().optional(),
})

const callsDataSchema = z.object({
  ...pageBase,
  summary: summarySchema,
  total: z.number().int().min(0).optional(),
  items: z.array(callIndexWireRowSchema).optional(),
  nextCursor: z.string().optional(),
  hasUpdates: z.boolean().optional(),
})

const detailDataSchema = z.object({
  ...pageBase,
  detail: callIndexWireRowSchema,
})

const scopeSchema = z.object({
  status: z.enum(['disabled', 'unavailable', 'ready']),
  mode: z.enum(['disabled', 'host-visible']),
  scope: z.literal('host-visible').optional(),
  includesOtherProfiles: z.literal(true).optional(),
  epoch: z.number().int().optional(),
  reason: z.enum(['not-enabled', 'unsupported-scope', 'persistence-unavailable']).optional(),
})

const semanticCoverageSchema = z.object({
  source: z.string(),
  ptc: z.string(),
  skillExecution: z.string(),
  denied: z.string(),
})

/** Same tolerance as `summarySchema`: an absent counter is 0, not a fatal error. */
const totalsSchema = z.object({
  calls: z.number().int().min(0).optional(),
  succeeded: z.number().int().min(0).optional(),
  failed: z.number().int().min(0).optional(),
  unresolved: z.number().int().min(0).optional(),
  unknown: z.number().int().min(0).optional(),
  cancelled: z.number().int().min(0).optional(),
  running: z.number().int().min(0).optional(),
  inherited: z.number().int().min(0).optional(),
}).transform(counts => ({
  calls: counts.calls ?? 0,
  succeeded: counts.succeeded ?? 0,
  failed: counts.failed ?? 0,
  unresolved: counts.unresolved ?? 0,
  unknown: counts.unknown ?? 0,
  cancelled: counts.cancelled ?? 0,
  running: counts.running ?? 0,
  inherited: counts.inherited ?? 0,
}))

const taskDataSchema = z.object({
  taskId: z.string().max(CALL_INDEX_MAX_ID_LENGTH),
  mode: z.enum(['full', 'incremental']),
  phase: z.enum(['running', 'complete', 'partial', 'cancelled', 'failed']),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  cancelRequested: z.boolean(),
})

const statusDataSchema = z.object({
  corpus: z.literal('persisted-plus-observed-live').optional(),
  scope: scopeSchema,
  generation: z.number().int(),
  censusGeneration: z.number().int(),
  asOf: z.number().optional(),
  /**
   * Scan lifecycle. `idle` means "no scan has ever run in this generation";
   * `complete` means "a scan finished and the index is current".
   *
   * They used to be one value, which made "never scanned" and "scan finished
   * with nothing to show" indistinguishable — the page reported "已列出 0 个
   * Session" in both cases and read as "your corpus is empty".
   */
  // `partial` is a REAL terminal state of a scan (some Sessions read, some
  // skipped). It was missing from this allowlist while session-index.ts emitted
  // it, so every partially-complete scan rejected the entire status reply and
  // the page fell back to 「尚未收到索引状态」 — the whole panel went dead
  // because one enum value was not listed.
  phase: z.enum(['idle', 'running', 'complete', 'partial', 'cancelled', 'failed']),
  coverage: coverageEnum,
  eventCoverage: coverageEnum,
  enumerationCoverage: coverageEnum,
  semanticCoverage: semanticCoverageSchema,
  listedSessions: z.number().int().min(0),
  /**
   * Scan diagnostic: events the backend DECLARED vs events actually read.
   *
   * Both are aggregate integers — no ids, no content. They exist so an operator
   * can tell "the corpus is empty" from "the backend under-reports its event
   * count and the scan is starving" without reading Host logs.
   */
  declaredEvents: z.number().int().min(0).optional(),
  readEvents: z.number().int().min(0).optional(),
  /**
   * Per-pass progress, kept apart from the cumulative pair above.
   *
   * TG-08's report was "read 57344 events / published 0 / readEvents: 0": the
   * cumulative counters cannot describe a pass, so "we are working" and "we have
   * retained nothing yet" were indistinguishable. These are plain counters — no
   * ids, no content, no scope/backend identity — and every one is optional so an
   * older Host still answers.
   */
  passReadEvents: z.number().int().min(0).optional(),
  passReadSessions: z.number().int().min(0).optional(),
  passPages: z.number().int().min(0).optional(),
  /** Highest verified cut this pass reached, in events. */
  passCut: z.number().int().min(0).optional(),
  /**
   * Monotone forward-scanned events across the whole index (published cuts +
   * in-flight stage cursors). The scheduler's progress signal.
   */
  scannedEvents: z.number().int().min(0).optional(),
  /** True when the last pass stopped on a capacity reservation (resumable). */
  paused: z.boolean().optional(),
  /**
   * Sessions read through EOF, INDEPENDENT of coverage.
   *
   * A backend that under-reports its event count produces a legitimate partial
   * coverage while the log really was read to its end. Without this field that
   * Session counts as never-complete, and a fully read corpus reports
   * no-indexable-session with pending 0.
   */
  exhaustedSessions: z.number().int().min(0).optional(),
  /**
   * Verified forward progress of the last pass, in events, within a stable
   * revision. A Host-internal comparison result: no revision, scope or backend
   * identity is exposed.
   */
  progressEvents: z.number().int().min(0).optional(),
  /**
   * Automatic scheduler state: whether a follow-up pass is queued right now.
   * Distinct from `phase` (the scan) and `coverage` (the data).
   */
  auto: z.object({
    state: z.enum(['idle', 'scheduled', 'running', 'stopped']),
    round: z.number().int().min(0),
  }).optional(),
  visibleSessions: z.number().int().min(0),
  /**
   * De-duplicated Sessions in this generation's progress denominator:
   * |visible ∪ failures|. Optional so an older Host omits it; the client then
   * falls back to `visible` (and to the old approximation only if that is 0).
   */
  scopeSessions: z.number().int().min(0).optional(),
  completedSessions: z.number().int().min(0),
  pendingSessions: z.number().int().min(0),
  failedSessions: z.number().int().min(0),
  pendingLive: z.number().int().min(0),
  estimatedBytes: z.number().int().min(0),
  reasons: callIndexReasonListSchema,
  totals: totalsSchema,
  task: taskDataSchema.optional(),
  features: z.object({ history: z.boolean().optional(), rawPayloads: z.literal(false).optional(), ptc: z.boolean().optional(), skillExecution: z.boolean().optional(), denied: z.boolean().optional() }).optional(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const KIND_SET: ReadonlySet<string> = new Set(CALL_INDEX_REPLY_KINDS)

/**
 * Project an arbitrary reply value through the fixed allowlist. Never throws:
 * a structurally invalid payload answers `internal-error`, and extra keys
 * (backend, token, args, content, error.stack) are stripped by the zod schemas.
 */
function projectReply(value: unknown): CallIndexReply {
  if (!isRecord(value)) return callIndexError('internal-error')
  const { schemaVersion, ok, kind } = value
  if (schemaVersion !== 1 || typeof ok !== 'boolean' || typeof kind !== 'string' || !KIND_SET.has(kind)) {
    return callIndexError('internal-error')
  }
  if (!ok) {
    if (kind !== 'error') return callIndexError('internal-error')
    return callIndexError(typeof value.reason === 'string' ? value.reason : 'internal-error')
  }

  const project = (schema: z.ZodType): unknown => {
    const result = schema.safeParse(value.data)
    return result.success ? result.data : undefined
  }

  switch (kind) {
    case 'status': {
      const data = project(statusDataSchema) as Record<string, unknown> | undefined
      if (data === undefined) return callIndexError('internal-error')
      const scope: Record<string, unknown> = { ...(data.scope as Record<string, unknown>) }
      if (scope.status !== 'ready') {
        delete scope.includesOtherProfiles
        delete scope.scope
        delete scope.epoch
      }
      return { schemaVersion: 1, ok: true, kind: 'status', data: { ...data, scope } }
    }
    case 'task': {
      const data = project(taskDataSchema)
      if (data === undefined) return callIndexError('internal-error')
      return { schemaVersion: 1, ok: true, kind: 'task', data: data as Record<string, unknown> }
    }
    case 'summary': {
      const data = project(summaryDataSchema)
      if (data === undefined) return callIndexError('internal-error')
      return { schemaVersion: 1, ok: true, kind: 'summary', data: data as Record<string, unknown> }
    }
    case 'sessions': {
      const data = project(sessionsDataSchema)
      if (data === undefined) return callIndexError('internal-error')
      return { schemaVersion: 1, ok: true, kind: 'sessions', data: data as Record<string, unknown> }
    }
    case 'calls': {
      const data = project(callsDataSchema)
      if (data === undefined) return callIndexError('internal-error')
      return { schemaVersion: 1, ok: true, kind: 'calls', data: data as Record<string, unknown> }
    }
    case 'detail': {
      const data = project(detailDataSchema)
      if (data === undefined) return callIndexError('internal-error')
      return { schemaVersion: 1, ok: true, kind: 'detail', data: data as Record<string, unknown> }
    }
    default:
      return callIndexError('internal-error')
  }
}

/** Public, non-throwing projector used by the Host gateway and the client codec. */
export function callIndexReply(value: unknown): CallIndexReply {
  return projectReply(value)
}

/**
 * Zod codec for replies. `.parse` always succeeds and returns the projected
 * reply, so a malformed Host payload degrades to `internal-error` instead of a
 * transport failure.
 */
export const callIndexReplySchema = z.any().transform((value: unknown) => callIndexReply(value))
