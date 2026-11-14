/** Formal Host owner of the call index. Scope is explicit; storage remains read-only. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionCallIndex } from './session-index.ts'
import { CallIndexQueries } from './call-index-query.ts'
import { callIndexError, callIndexReply, type CallIndexReply } from './call-index-wire.ts'
import type { CallIndexSourceResolver } from './call-index-core.ts'
import type { CallIndexSourceKind } from './call-index-wire.ts'
import { BUILT_IN_SERVER } from '../constants.ts'

export interface CallIndexRuntimeConfig {
  scope?: 'disabled' | 'host-visible'
  liveDebounceMs?: number
  maxEventsPerRun?: number
  queryTtlMs?: number
  queryMaxViews?: number
  queryMaxBytes?: number
  pageSize?: number
  maxBytes?: number
  maxCalls?: number
  maxSessions?: number
  maxLiveQueue?: number
  /** Run one history scan automatically when the plugin mounts (D-031). */
  autoIndex?: boolean
  /** Which pass the automatic scan requests. Incremental by default. */
  autoIndexMode?: 'full' | 'incremental'
  /** Delay before the automatic scan, so the mount and scope resolve first. */
  autoIndexDelayMs?: number
}
export const CallIndexConfig: z<CallIndexRuntimeConfig> = z.object({
  /**
   * Corpus scope. DEFAULT CHANGED to `host-visible` on 2026-11-11 at the
   * operator's explicit request (see D-029), reversing D-026's
   * default-`disabled` gate.
   *
   * What that means operationally: the index reads whatever the Host's official
   * session services expose, which MAY INCLUDE OTHER PROFILES' history. It never
   * enumerates the home directory itself and never opens a path of its own, but
   * "current-process visible" is not "this profile only".
   *
   * Set `scope: disabled` to restore the previous behaviour; the UI then reports
   * 索引范围未启用 and every scan trigger stays inert. Live observation still
   * requires a ready scope, so `disabled` really means "no indexing at all".
   */
  scope: z.union(['disabled', 'host-visible']).default('host-visible'),
  liveDebounceMs: z.number().min(0).max(60_000).default(200),
  maxEventsPerRun: z.number().min(1).max(1_000_000).default(400_000),
  queryTtlMs: z.number().min(1).max(300_000).default(60_000),
  queryMaxViews: z.number().min(1).max(16).default(4),
  queryMaxBytes: z.number().min(1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024),
  pageSize: z.number().min(1).max(250).default(128),
  maxBytes: z.number().min(1024).max(256 * 1024 * 1024).default(64 * 1024 * 1024),
  maxCalls: z.number().min(1).max(100_000).default(100_000),
  maxSessions: z.number().min(1).max(10_000).default(5_000),
  maxLiveQueue: z.number().min(1).max(10_000).default(1_024),
  /**
   * Index history automatically on mount (D-031). Default ON: the manual
   * 全量索引 / 增量更新 buttons were removed at the operator's request, so
   * without this the index would never fill.
   */
  autoIndex: z.boolean().default(true),
  autoIndexMode: z.union(['full', 'incremental']).default('incremental'),
  autoIndexDelayMs: z.number().min(0).max(600_000).default(1_500),
})
interface RuntimeTask {
  taskId: string
  mode: 'full' | 'incremental'
  phase: 'running' | 'complete' | 'partial' | 'cancelled' | 'failed'
  startedAt: number
  finishedAt?: number
  cancelRequested: boolean
}
export interface CallIndexRuntime {
  getIndexStatus(): CallIndexReply
  startIndex(request?: unknown): CallIndexReply
  cancelIndex(request: unknown): CallIndexReply
  getSummary(request?: unknown): CallIndexReply
  listSessions(request?: unknown): CallIndexReply
  listCalls(request?: unknown): CallIndexReply
  getCallDetail(request: unknown): Promise<CallIndexReply>
  whenIdle(): Promise<void>
  dispose(): Promise<void>
}
export interface CallIndexRuntimeOptions {
  now?: () => number
  schedule?: (callback: () => void, delay: number) => () => void
}
declare module '@deepseek-ai/cordis' { interface Context { callIndexRuntime: CallIndexRuntime } }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function scheduleDefault(callback: () => void, delay: number): () => void {
  const handle = setTimeout(callback, delay)
  handle.unref?.()
  return () => clearTimeout(handle)
}

/**
 * Build the provenance resolver from the capability catalog.
 *
 * The ONLY accepted evidence is `capability.get(id, 'tool').origin.serverName`,
 * the same audited chain `usage-runtime.ts` already uses:
 *
 * - a resolved server that equals the reserved {@link BUILT_IN_SERVER} means the
 *   call is a harness-native tool;
 * - any other non-empty server name means MCP;
 * - no record, no server name, or a throwing lookup stays `unknown`.
 *
 * `plugin-tool` and `skill` are never emitted here. The DSH `ToolDefinition`
 * surface carries no owner field (R-009), so a plugin owner cannot be proven
 * from this evidence, and a skill *load* is not a tool call. Both remain
 * `unknown` rather than being guessed from a name.
 *
 * Returns `undefined` when the Host has no capability service, which keeps the
 * whole index at `unknown` provenance and `semanticCoverage.source: 'unknown'`.
 */
function createSourceResolver(ctx: Context): CallIndexSourceResolver | undefined {
  let service: unknown
  try {
    service = (ctx.get as (key: string) => unknown)('capability')
  } catch {
    return undefined
  }
  if (!record(service) || typeof service.get !== 'function') return undefined
  const lookup = service.get as (id: string, kind?: string) => unknown
  return (toolName: string): CallIndexSourceKind => {
    let entry: unknown
    try {
      entry = lookup.call(service, toolName, 'tool')
    } catch {
      return 'unknown'
    }
    if (!record(entry)) return 'unknown'
    const origin = entry.origin
    if (!record(origin)) return 'unknown'
    const serverName = origin.serverName
    if (typeof serverName !== 'string') return 'unknown'
    const trimmed = serverName.trim()
    if (trimmed.length === 0) return 'unknown'
    return trimmed === BUILT_IN_SERVER ? 'native' : 'mcp'
  }
}

export function installCallIndexRuntime(ctx: Context, config: CallIndexRuntimeConfig = {}, options: CallIndexRuntimeOptions = {}): CallIndexRuntime {
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? scheduleDefault
  const instance = randomUUID()
  let disposed = false
  let queryVersion = 0
  let cancelTimer: (() => void) | undefined
  let listenerDispose: (() => void) | undefined
  let needsFlush = false
  let active: Promise<unknown> | undefined
  let task: RuntimeTask | undefined
  const backend = () => ctx.get('sessionPersistence')
  const resolveSource = createSourceResolver(ctx)
  /**
   * The effective scope mode.
   *
   * Since D-029 the default is `host-visible`, and `config.scope` may be absent
   * (a Host that calls `installCallIndexRuntime` with `{}`, or a config document
   * written before the default flipped). Reading `config.scope` raw would then
   * compare `undefined !== 'host-visible'` and silently keep live flushing and
   * subscription off while the scope controller reported `ready` — a split brain.
   * Every check below goes through this one function.
   */
  const scopeMode = (): 'disabled' | 'host-visible' => config.scope ?? 'host-visible'
  const index = new SessionCallIndex({
    getMode: () => disposed ? 'disabled' : scopeMode(),
    getBackend: backend, now,
    isLiveSession: id => ctx.get('sessions')?.get(SessionId(id))?.id === id,
    pageSize: config.pageSize, maxBytes: config.maxBytes, maxCalls: config.maxCalls,
    maxSessions: config.maxSessions, maxLiveQueue: config.maxLiveQueue,
    ...(resolveSource === undefined ? {} : { resolveSource }),
  })
  const stamp = () => {
    const current = index.stamp()
    return `${instance}:${disposed ? 'disposed' : current.epoch ?? 'off'}:${queryVersion}`
  }
  const queries = new CallIndexQueries({
    snapshot: () => index.snapshot(), stamp, generation: () => index.stamp().generation,
    async isSessionVisible(id) {
      if (disposed || id.length > 512) return false
      const before = stamp()
      if (index.snapshot(false).scope.status !== 'ready') return false
      try {
        const stored = await backend()?.stat(SessionId(id))
        if (stamp() !== before || disposed) return false
        if (stored?.header.id === id) return true
        // Live-only membership is checked against the public SessionStore, not a guessed path.
        return ctx.get('sessions')?.get(SessionId(id))?.id === id
      } catch { return false }
    },
  }, { now, ttlMs: config.queryTtlMs, maxViews: config.queryMaxViews, maxBytes: config.queryMaxBytes, maxReplyBytes: 240 * 1024 })

  const safeReply = (kind: 'status' | 'task', data: unknown): CallIndexReply => {
    try { return callIndexReply({ schemaVersion: 1, ok: true, kind, data }) }
    catch (error) {
      // Losing the whole status surface to one malformed number is exactly the
      // failure mode that made this page unreadable for several rounds. Keep the
      // reply well-formed and leave a code an operator can act on.
      console.error('[capability-menu] callIndex reply rejected:', error instanceof Error ? error.name : 'unknown')
      return callIndexError('internal-error')
    }
  }
  const scheduleFlush = () => {
    if (disposed || scopeMode() !== 'host-visible' || cancelTimer) return
    try { cancelTimer = schedule(() => {
      cancelTimer = undefined
      if (disposed) return
      if (active) { needsFlush = true; return }
      try { index.flushLive() } catch { index.markGap('live-projection-failed') }
    }, config.liveDebounceMs ?? 200) } catch { index.markGap('live-timer-failed') }
  }
  const syncListener = () => {
    if (!disposed && scopeMode() === 'host-visible') {
      if (!listenerDispose) listenerDispose = ctx.on('session/event', (session, event) => {
        if (disposed || scopeMode() !== 'host-visible') return
        try {
          if (index.observeLive(session.id, event, session.inheritedEventCount)) scheduleFlush()
        } catch { index.markGap('live-projection-failed') }
      })
    } else {
      try { listenerDispose?.() } catch { index.markGap('live-projection-failed') }
      listenerDispose = undefined
      try { cancelTimer?.() } catch { index.markGap('live-timer-failed') }
      cancelTimer = undefined
      index.cancel()
    }
  }
  const statusSnapshot = () => { syncListener(); return index.snapshot(false) }
  const ready = (): CallIndexReply | undefined => {
    if (disposed) return callIndexError('runtime-unavailable')
    const snapshot = statusSnapshot()
    if (snapshot.scope.status !== 'ready') return callIndexError(snapshot.scope.status === 'disabled' ? 'scope-disabled' : 'persistence-unavailable')
    return undefined
  }
  const taskReply = () => safeReply('task', task ? {
    taskId: task.taskId, mode: task.mode, phase: task.phase, startedAt: task.startedAt,
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }), cancelRequested: task.cancelRequested,
  } : {})
  const runtime: CallIndexRuntime = {
    getIndexStatus() {
      if (disposed) return callIndexError('runtime-unavailable')
      const value = statusSnapshot()
      return safeReply('status', {
        scope: value.scope, corpus: value.corpus, generation: value.generation, censusGeneration: value.censusGeneration,
        ...(value.asOf === undefined ? {} : { asOf: value.asOf }), phase: value.phase,
        coverage: value.coverage, eventCoverage: value.eventCoverage,
        enumerationCoverage: value.enumerationCoverage, semanticCoverage: value.semanticCoverage,
        listedSessions: value.listedSessions, visibleSessions: value.visibleSessions, completedSessions: value.completedSessions,
        declaredEvents: value.declaredEvents, readEvents: value.readEvents,
        pendingSessions: value.pendingSessions, failedSessions: value.failedSessions, pendingLive: value.pendingLive,
        estimatedBytes: value.estimatedBytes, reasons: value.reasons,
        totals: value.totals,
        ...(task ? { task: { ...task } } : {}),
      })
    },
    startIndex(request) {
      const unavailable = ready()
      if (unavailable) return unavailable
      if (request !== undefined && (!record(request) || Object.keys(request).some(key => key !== 'mode')
        || (request.mode !== undefined && request.mode !== 'full' && request.mode !== 'incremental'))) return callIndexError('invalid-request')
      if (active) return taskReply()
      if (config.maxEventsPerRun !== undefined && (!Number.isSafeInteger(config.maxEventsPerRun) || config.maxEventsPerRun < 1)) return callIndexError('invalid-request')
      const mode = record(request) && request.mode === 'full' ? 'full' : 'incremental'
      queryVersion++; queries.invalidate()
      task = { taskId: randomUUID(), mode, phase: 'running', startedAt: now(), cancelRequested: false }
      const owner = task
      active = index.start({ full: mode === 'full', maxEvents: config.maxEventsPerRun }).then(result => {
        if (disposed || task !== owner) return
        owner.phase = result.phase === 'cancelled' ? 'cancelled' : result.phase === 'failed' ? 'failed' : result.coverage === 'complete' ? 'complete' : 'partial'
        owner.finishedAt = now()
      }).catch(() => { if (!disposed && task === owner) { owner.phase = 'failed'; owner.finishedAt = now() } }).finally(() => {
        active = undefined
        if (needsFlush && !disposed) { needsFlush = false; scheduleFlush() }
      })
      return taskReply()
    },
    cancelIndex(request) {
      if (disposed) return callIndexError('runtime-unavailable')
      if (!record(request) || Object.keys(request).some(key => key !== 'taskId') || typeof request.taskId !== 'string' || request.taskId.length > 80) return callIndexError('invalid-request')
      if (!task || task.taskId !== request.taskId) return callIndexError('task-not-found')
      if (active) { task.cancelRequested = true; index.cancel() }
      return taskReply()
    },
    getSummary(request) { const error = ready(); return error ?? queries.getSummary(request) },
    listSessions(request) { const error = ready(); return error ?? queries.listSessions(request) },
    listCalls(request) { const error = ready(); return error ?? queries.listCalls(request) },
    async getCallDetail(request) { const error = ready(); return error ?? queries.getCallDetail(request) },
    async whenIdle() { await active },
    async dispose() {
      if (disposed) return
      disposed = true; queryVersion++; queries.invalidate()
      try { cancelTimer?.() } catch { /* Continue teardown even if a scheduler fails. */ }
      cancelTimer = undefined
      try { listenerDispose?.() } catch { /* The owning fiber also releases its subscription. */ }
      listenerDispose = undefined
      index.dispose()
      await active
    },
  }
  syncListener()

  /**
   * Auto-index on mount (D-031).
   *
   * History scanning used to be strictly manual: the UI exposed 全量索引 /
   * 增量更新 and the contract required an explicit trigger. In practice that
   * meant the index stayed empty until the operator found and pressed a button,
   * and a failed press was indistinguishable from an empty corpus. The plugin
   * now indexes as soon as the Host is up: one incremental pass immediately, so
   * a restart picks up new Sessions without any interaction.
   *
   * Deliberately NOT a polling loop: one pass per mount. Live traffic is still
   * observed through the session/event subscription, and a scan is idempotent
   * on the Host, so a restart is the only thing that re-triggers it.
   */
  const autoIndex = (): void => {
    if (disposed || config.autoIndex === false) return
    if (scopeMode() !== 'host-visible') return
    try {
      const started = runtime.startIndex(config.autoIndexMode === 'full' ? { mode: 'full' } : undefined)
      if (started.ok === false) {
        // Never silent: a refused automatic scan is the exact failure that made
        // the page show a permanent zero with no explanation.
        console.error('[capability-menu] callIndex auto-index refused:', started.reason)
      }
    } catch (error) {
      console.error('[capability-menu] callIndex auto-index failed:', error instanceof Error ? error.name : 'unknown')
    }
  }

  ctx.effect(() => {
    // Defer so the mount finishes and the scope controller has resolved; running
    // inside the effect body would race the first syncScope().
    const timer = setTimeout(autoIndex, Math.max(0, config.autoIndexDelayMs ?? 1500))
    return () => {
      try { clearTimeout(timer) } catch { /* Teardown continues regardless. */ }
      void runtime.dispose()
    }
  })
  return Object.freeze(runtime)
}
