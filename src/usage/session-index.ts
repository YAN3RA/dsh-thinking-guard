/** New, unmounted call-index scanner. Public read handles only; no disk state. */
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallIndexPartition, projectCallIndexEvent, type CallIndexEvent, type CallIndexPartitionSnapshot, type CallIndexSourceResolver } from './call-index-core.ts'
import { CallIndexScopeController, describeCallIndexScope, type CallIndexScope } from './call-index-scope.ts'

type ReadyScope = Extract<CallIndexScope, { status: 'ready' }>
interface Ledger { used: number }
interface Target { id: string; revision: string; eventCount?: number; seeded: boolean; cwd?: string }
interface Stage { target: Target; part: CallIndexPartition; next: number; ledger: Ledger; inherited: number }
interface Published { value: CallIndexPartitionSnapshot; part: CallIndexPartition; target: Target; inherited: number; ledger: Ledger; bytes: number; cwd?: string }
interface LiveEntry { event: CallIndexEvent; bytes: number; inherited: number }
export interface SessionCallIndexOptions {
  getMode: () => unknown
  getBackend: () => unknown
  /** Optional public SessionStore membership; it never supplies historical content. */
  isLiveSession?: (id: string) => boolean
  pageSize?: number
  maxBytes?: number
  maxCalls?: number
  maxSessions?: number
  maxEventsPerSession?: number
  maxOrphans?: number
  maxLiveQueue?: number
  now?: () => number
  yield?: () => Promise<void>
  /**
   * Provenance resolver built from trusted catalog evidence by the runtime.
   *
   * Absent means the Host has no capability service, so every row reports
   * `unknown` provenance and `semanticCoverage.source` stays `unknown`.
   */
  resolveSource?: CallIndexSourceResolver
}
export interface IndexScanOptions { signal?: AbortSignal; maxEvents?: number; full?: boolean }

const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512
const positive = (value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback
  if (!integer(value) || value < 1) throw Error('invalid call-index limit')
  return value
}
class ScopeChanged extends Error {}

/**
 * Map a thrown read failure to a bounded reason code.
 *
 * Reads the error's `name`/`code` ONLY. Messages are never inspected: a backend
 * message may quote file content, and this value travels to the browser.
 *
 * Why bother: `session-read-failed` alone made "the corpus is empty" and "every
 * read threw" indistinguishable in the UI, so an operator could not tell a
 * compressed-artifact problem from a permissions problem from a real absence.
 */
function readFailureReason(error: unknown): string {
  const name = typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : ''
  const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : ''
  const tag = `${name} ${code}`.toLowerCase()
  if (tag.includes('notfound') || tag.includes('not_found') || tag.includes('enoent')) return 'session-missing'
  if (tag.includes('zstd') || tag.includes('decompress') || tag.includes('decode')) return 'session-decode-failed'
  if (tag.includes('migration') || tag.includes('version') || tag.includes('format')) return 'session-format-mismatch'
  if (tag.includes('perm') || tag.includes('eacces') || tag.includes('eperm')) return 'session-unreadable'
  return 'session-read-failed'
}

/**
 * In-memory engine for N22. It is deliberately not mounted in the old Usage runtime.
 * Scope is freshly resolved before AND after asynchronous service operations.
 * Memory limits bound estimated retained index metadata, not backend decoding/RSS.
 */
export class SessionCallIndex {
  private readonly scopes = new CallIndexScopeController()
  private lastScope: CallIndexScope = { status: 'disabled', mode: 'disabled', reason: 'not-enabled' }
  private token: symbol | undefined
  private ledger: Ledger = { used: 0 }
  private readonly published = new Map<string, Published>()
  private readonly stages = new Map<string, Stage>()
  private readonly live = new Map<string, LiveEntry[]>()
  private readonly observedThrough = new Map<string, number>()
  private readonly visible = new Set<string>()
  private readonly pending = new Set<string>()
  private readonly failures = new Set<string>()
  private readonly reasons = new Set<string>()
  private task: Promise<ReturnType<SessionCallIndex['snapshot']>> | undefined
  private aborter: AbortController | undefined
  private fairCursor = 0
  private generation = 0
  private censusGeneration = 0
  private asOf: number | undefined
  private enumerated = false
  private enumerationCurrent = false
  private listedCount = 0
  private phase: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed' = 'idle'
  private liveCount = 0
  private disposed = false
  private readonly limits: { pageSize: number; maxBytes: number; maxCalls: number; maxSessions: number; maxEvents: number; maxOrphans: number; maxLive: number }

  constructor(private readonly options: SessionCallIndexOptions) {
    this.limits = {
      // 128 was slow on a real corpus: 9802 events needed ~77 round trips and
      // the index took long enough that the operator called it 「太慢」. Each
      // read is a bounded page from a local file, so a larger page is strictly
      // cheaper per event; 512 keeps one page well inside the byte budget.
      pageSize: positive(options.pageSize, 512), maxBytes: positive(options.maxBytes, 64 * 1024 * 1024),
      maxCalls: positive(options.maxCalls, 100_000), maxSessions: positive(options.maxSessions, 5_000),
      maxEvents: positive(options.maxEventsPerSession, 1_000_000), maxOrphans: positive(options.maxOrphans, 2_048),
      maxLive: positive(options.maxLiveQueue, 1_024),
    }
  }

  private gap(reason: string): void { if (this.reasons.size < 32) this.reasons.add(reason) }
  private syncScope(): ReadyScope | undefined {
    let scope: CallIndexScope
    try {
      const mode = this.disposed ? 'disabled' : this.options.getMode()
      scope = this.scopes.resolve(mode, mode === 'host-visible' ? this.options.getBackend() : undefined)
    } catch { scope = this.scopes.resolve('host-visible') }
    this.lastScope = scope
    const token = scope.status === 'ready' ? scope.token : undefined
    if (this.token !== token) {
      this.token = token
      // Replace the ledger object: old in-flight cleanup cannot subtract new-epoch data.
      this.ledger = { used: 0 }
      this.published.clear(); this.stages.clear(); this.live.clear(); this.observedThrough.clear(); this.visible.clear()
      this.pending.clear(); this.failures.clear(); this.reasons.clear()
      this.liveCount = 0; this.enumerated = false; this.enumerationCurrent = false; this.listedCount = 0; this.asOf = undefined
      this.generation += 1
    }
    return scope.status === 'ready' ? scope : undefined
  }
  private guard(scope: ReadyScope, signal?: AbortSignal): void {
    const current = this.syncScope()
    if (!current || current.token !== scope.token || !this.scopes.isCurrent(scope)) throw new ScopeChanged()
    signal?.throwIfAborted()
  }
  private reserve(ledger: Ledger, bytes: number): boolean {
    if (ledger !== this.ledger || bytes < 0 || ledger.used + bytes > this.limits.maxBytes) { this.gap('index-capacity'); return false }
    ledger.used += bytes
    return true
  }
  private discard(stage: Stage): void {
    stage.ledger.used = Math.max(0, stage.ledger.used - stage.part.usage().bytes)
    if (this.stages.get(stage.target.id) === stage) this.stages.delete(stage.target.id)
  }

  /** Immediate projection keeps raw events out of the bounded live queue. */
  observeLive(sessionId: string, raw: unknown, inheritedEventCount: number): boolean {
    if (!this.syncScope()) return false
    if (!text(sessionId) || !integer(inheritedEventCount)) { this.gap('lineage-unverified'); return false }
    const projection = projectCallIndexEvent(raw)
    for (const reason of projection.reasons) this.gap(reason)
    if (!projection.event) return false
    if (!this.observedThrough.has(sessionId) && this.observedThrough.size >= this.limits.maxSessions) { this.gap('session-capacity'); return false }
    this.observedThrough.set(sessionId, Math.max(this.observedThrough.get(sessionId) ?? 0, projection.event.seq + 1))
    const bytes = 2 * Buffer.byteLength(JSON.stringify(projection.event), 'utf8') + 1024
    if (this.liveCount >= this.limits.maxLive || !this.reserve(this.ledger, bytes)) { this.gap('live-queue-overflow'); return false }
    const queue = this.live.get(sessionId) ?? []
    queue.push({ event: projection.event, bytes, inherited: inheritedEventCount })
    this.live.set(sessionId, queue); this.liveCount += 1
    return true
  }

  /** One active task, including concurrent callers. Cancellation is not a second task. */
  start(options: IndexScanOptions = {}): Promise<ReturnType<SessionCallIndex['snapshot']>> {
    if (this.task) return this.task
    const maxEvents = positive(options.maxEvents, 400_000)
    this.aborter = new AbortController()
    const signal = options.signal ? AbortSignal.any([options.signal, this.aborter.signal]) : this.aborter.signal
    const task = this.run(maxEvents, signal, options.full === true).finally(() => {
      if (this.task === task) { this.task = undefined; this.aborter = undefined }
    })
    this.task = task
    return task
  }
  /** Host observation failures are fixed codes, never exception messages or raw payloads. */
  markGap(reason: 'live-projection-failed' | 'live-timer-failed'): void {
    if (this.syncScope()) { this.gap(reason); this.generation += 1 }
  }

  /** Publish observed metadata only; never enumerate/open historical storage here. */
  flushLive(): ReturnType<SessionCallIndex['snapshot']> {
    const scope = this.syncScope()
    if (!scope || this.task) return this.snapshot(false)
    let changed = false
    for (const [id, queue] of this.live) {
      this.guard(scope)
      const old = this.published.get(id)
      const stage: Stage = old
        ? { target: old.target, part: old.part, next: old.value.cut, ledger: old.ledger, inherited: old.inherited }
        : this.stage({ id, revision: 'observed-live', seeded: queue[0]!.inherited > 0 }, queue[0]!.inherited)
      this.visible.add(id); this.pending.add(id)
      this.mergeLive(stage)
      this.publish(stage)
      // Data is current through an observed cut; corpus enumeration still needs reconciliation.
      this.pending.add(id)
      changed = true
    }
    if (changed) { this.enumerationCurrent = false; this.generation += 1 }
    return this.snapshot(false)
  }

  /** Cheap authorization/data stamp; resolving it also notices live backend replacement. */
  stamp(): { epoch?: number; generation: number } {
    this.syncScope()
    return { ...(this.lastScope.status === 'ready' ? { epoch: this.lastScope.epoch } : {}), generation: this.generation }
  }

  cancel(): void { this.aborter?.abort() }
  dispose(): void { this.disposed = true; this.cancel(); this.scopes.invalidate(); this.token = undefined; this.published.clear(); this.stages.clear(); this.live.clear(); this.observedThrough.clear(); this.visible.clear(); this.pending.clear(); this.failures.clear(); this.reasons.clear(); this.ledger = { used: 0 }; this.liveCount = 0; this.enumerated = false; this.enumerationCurrent = false; this.listedCount = 0; this.asOf = undefined; this.phase = 'idle' }

  private stage(target: Target, inherited: number): Stage {
    const prior = this.stages.get(target.id)
    if (prior && prior.target.revision === target.revision && prior.inherited === inherited) return prior
    if (prior) this.discard(prior)
    const ledger = this.ledger
    const part = new CallIndexPartition({
      sessionId: target.id, revision: target.revision, inheritedEventCount: inherited,
      maxEvents: this.limits.maxEvents, maxCalls: this.limits.maxCalls,
      maxBytes: this.limits.maxBytes, maxOrphans: this.limits.maxOrphans,
      reserve: bytes => this.reserve(ledger, bytes),
      ...(this.options.resolveSource === undefined ? {} : { resolveSource: this.options.resolveSource }),
    })
    const stage = { target, part, next: 0, ledger, inherited }
    this.stages.set(target.id, stage)
    return stage
  }
  private mergeLive(stage: Stage): void {
    const queue = this.live.get(stage.target.id)
    if (!queue) return
    this.live.delete(stage.target.id)
    this.liveCount -= queue.length
    // Math.max(0, NaN) is NaN, not 0 — so a single non-finite operand would
    // silently poison the ledger for the rest of the generation.
    const released = queue.reduce((n, item) => n + (Number.isFinite(item.bytes) ? item.bytes : 0), 0)
    const before = Number.isFinite(stage.ledger.used) ? stage.ledger.used : 0
    stage.ledger.used = Math.max(0, before - released)
    queue.sort((a, b) => a.event.seq - b.event.seq)
    for (const item of queue) {
      stage.part.ingest([item.event])
      stage.next = Math.max(stage.next, item.event.seq + 1)
    }
  }
  private publish(stage: Stage): void {
    if (stage.inherited > stage.next) { stage.part.addGap('lineage-unverified'); this.gap('lineage-unverified') }
    const snapshot = stage.part.snapshot(stage.next)
    if (snapshot.reasons.includes('index-capacity')) this.gap('index-capacity')
    // Surface the backend's under-report at index level too: a per-session gap
    // would otherwise stay buried in that session's row and the page-level
    // "扫描提示" line — the one place an operator actually looks — would omit it.
    if (snapshot.reasons.includes('event-count-underreported')) this.gap('event-count-underreported')
    const old = this.published.get(stage.target.id)
    const totalCalls = [...this.published.values()].reduce((n, entry) => n + entry.value.rows.length, 0)
    if (totalCalls - (old?.value.rows.length ?? 0) + snapshot.rows.length > this.limits.maxCalls) { this.gap('index-capacity'); return }
    // On corrupt/incomplete rebuild retain the last readable partition instead of mixing versions.
    if (snapshot.coverage === 'partial' && old) {
      this.gap('session-partial')
      if (old.part === stage.part) old.bytes = stage.part.usage().bytes
      else this.discard(stage)
      // The watermark must SURVIVE: it records "live events were seen past this
      // cut", and dropping it would claim history had caught up when it had not
      // (see the live-tail test). What must not survive is the PENDING mark —
      // this Session was read in this pass, so leaving it pending made the scan
      // re-queue it forever and report 「待处理 65 个」 permanently. It becomes
      // pending again only when a NEW live event arrives (observeLive).
      this.pending.delete(stage.target.id)
      return
    }
    if (old && old.part !== stage.part) old.ledger.used = Math.max(0, old.ledger.used - old.bytes)
    this.published.set(stage.target.id, { value: snapshot, part: stage.part, target: stage.target, inherited: stage.inherited, ledger: stage.ledger, bytes: stage.part.usage().bytes, ...(stage.target.cwd === undefined ? {} : { cwd: stage.target.cwd }) })
    this.stages.delete(stage.target.id)
    if (snapshot.coverage === 'complete' && snapshot.cut >= (this.observedThrough.get(stage.target.id) ?? 0)) this.observedThrough.delete(stage.target.id)
    if (this.observedThrough.has(stage.target.id)) this.pending.add(stage.target.id)
    else this.pending.delete(stage.target.id)
    this.generation += 1
  }

  private async run(maxEvents: number, signal: AbortSignal, full: boolean): Promise<ReturnType<SessionCallIndex['snapshot']>> {
    const scope = this.syncScope()
    if (!scope) return this.snapshot()
    this.phase = 'running'
    let readCount = 0
    try {
      this.guard(scope, signal)
      this.enumerationCurrent = false
      const listed = await scope.backend.list({ signal })
      this.guard(scope, signal)
      for (const reason of ['scan-pending', 'scan-cancelled', 'session-list-or-stat-failed', 'session-read-failed', 'handle-close-failed', 'revision-changed', 'session-disappeared', 'session-partial', 'observed-live-only', 'live-membership-unverified']) this.reasons.delete(reason)
      this.failures.clear(); this.visible.clear(); this.pending.clear()
      this.enumerated = true; this.enumerationCurrent = true; this.censusGeneration += 1; this.asOf = (this.options.now ?? Date.now)()
      const targets: Target[] = []
      const ids = new Set<string>()
      for (const row of listed) {
        const id = row.header.id
        if (!text(id) || !text(row.revision) || typeof row.header.isSeeded !== 'boolean'
          || (row.eventCount !== undefined && !integer(row.eventCount)) || ids.has(id)) { this.gap('invalid-session-metadata'); continue }
        ids.add(id)
        if (targets.length >= this.limits.maxSessions) { this.gap('session-capacity'); continue }
        const target: Target = { id, revision: row.revision, seeded: row.header.isSeeded, ...(typeof row.header.cwd === 'string' && row.header.cwd.length <= 4096 ? { cwd: row.header.cwd } : {}), ...(row.eventCount === undefined ? {} : { eventCount: row.eventCount }) }
        targets.push(target); this.visible.add(id)
        const old = this.published.get(id)
        if (full || !old || old.value.revision !== target.revision || old.value.coverage !== 'complete' || this.live.has(id) || this.observedThrough.has(id) || this.stages.has(id)) this.pending.add(id)
        if (full) { const stage = this.stages.get(id); if (stage) this.discard(stage) }
      }
      // A verified observed live-only Session must not disappear just because it is not persisted.
      for (const id of this.published.keys()) if (!this.visible.has(id) && this.options.isLiveSession) {
        try {
          if (this.options.isLiveSession(id)) { this.visible.add(id); this.pending.add(id); this.gap('observed-live-only') }
        } catch { this.gap('live-membership-unverified') }
      }
      // Stale cursors are service/Session/revision bound, never reused after a changed log observation.
      for (const stage of this.stages.values()) if (!this.visible.has(stage.target.id)) this.discard(stage)
      for (const [id, entry] of this.published) if (!this.visible.has(id) && !this.live.has(id)) {
        entry.ledger.used = Math.max(0, entry.ledger.used - entry.bytes)
        this.published.delete(id) // Evict a derived cache entry; do not infer that user history was deleted.
      }
      this.listedCount = targets.length
      const rotated = targets.length ? [...targets.slice(this.fairCursor % targets.length), ...targets.slice(0, this.fairCursor % targets.length)] : []
      const queue = rotated.filter(target => this.pending.has(target.id))
      while (queue.length && readCount < maxEvents) {
        this.guard(scope, signal)
        const target = queue.shift()!
        let stage = this.stages.get(target.id)
        if (stage?.target.revision !== target.revision) stage = undefined
        let handle: Awaited<ReturnType<typeof scope.backend.open>> | undefined
        let done = false
        let failed = false
        try {
          handle = await scope.backend.open(SessionId(target.id), 'read', { signal })
          this.guard(scope, signal)
          const inherited = handle.inheritedEventCount
          if (handle.id !== target.id || handle.access !== 'read' || !integer(inherited)
            || (!target.seeded && inherited !== 0) || (target.eventCount !== undefined && inherited > target.eventCount)) throw Error('invalid handle metadata')
          stage = this.stage(target, inherited)
          // `eventCount` is a HINT, never an EOF proof.
          //
          // The jsonl backend counts the header record of a multi-frame zstd
          // artifact and reports `eventCount: 1` for a log holding thousands of
          // events. Treating that as authoritative made the scan stop before the
          // first read, so a full corpus rendered as "0 calls" while reporting a
          // healthy, complete-looking run (D-030).
          //
          // Two consequences, both deliberate:
          // - a declared count of 0 no longer short-circuits the session; we
          //   probe once and let an empty page prove emptiness;
          // - `remaining` only CAPS the page size, it never decides `done`.
          // EOF comes from an empty page (below), which is the backend's own
          // statement that the logical tail was reached.
          const declaredRemaining = target.eventCount === undefined ? undefined : target.eventCount - stage.next
          // We have already read MORE than the backend claims exists. Record it
          // once (this is the multi-frame under-report) and keep reading: the
          // declared count must never truncate the scan or stall the loop.
          if (declaredRemaining !== undefined && declaredRemaining < 0) {
            stage.part.addGap('event-count-underreported')
          }
          {
            // A declared count only ever CAPS a page; it never caps the scan.
            // A non-positive declaration (the multi-frame case reports 1, and a
            // broken backend may report 0) carries no information, so it falls
            // back to the normal page size instead of throttling the read to one
            // event per round trip.
            const cap = declaredRemaining !== undefined && declaredRemaining > 0
              ? declaredRemaining
              : this.limits.pageSize
            const length = Math.min(this.limits.pageSize, maxEvents - readCount, cap)
            const page = await handle.read(stage.next, length, { signal })
            this.guard(scope, signal)
            if (page.events.length > length) throw Error('oversized event page')
            const projected: CallIndexEvent[] = []
            let contiguous = true
            for (const [index, raw] of page.events.entries()) {
              const value = projectCallIndexEvent(raw)
              for (const reason of value.reasons) stage.part.addGap(reason)
              if (!value.event || value.event.seq !== stage.next + index) contiguous = false
              if (value.event) projected.push(value.event)
            }
            if (!contiguous) stage.part.addGap('sequence-gap')
            stage.part.ingest(projected)
            stage.next += page.events.length
            readCount += page.events.length
            // Check the under-report BEFORE the empty-page branch: a backend
            // that declares 1 event for a long log serves the whole log on the
            // first probe and then an empty page, so the "we read past the
            // declaration" fact must be recorded while we still know it.
            if (declaredRemaining !== undefined && target.eventCount !== undefined && stage.next > target.eventCount) {
              stage.part.addGap('event-count-underreported')
            }
            if (page.events.length === 0) {
              // The only trustworthy EOF: the backend returned nothing for this
              // offset. If a declared count said there was more, that count was
              // wrong and the gap must be visible.
              done = true
              if (declaredRemaining !== undefined && declaredRemaining > 0) stage.part.addGap('short-page')
            }
            if (stage.next > this.limits.maxEvents) { stage.part.addGap('index-capacity'); this.gap('index-capacity'); done = true }
          }
        } catch (error) {
          if (error instanceof ScopeChanged || signal.aborted) throw error
          failed = true; this.failures.add(target.id)
          // The reason code used to be a flat `session-read-failed`, which told
          // the operator nothing: a zstd decode failure, a missing artifact and
          // a corrupt tail all looked identical. Classify by the error's own
          // name/code (never its message — that can carry payload text) so the
          // page can say WHICH stage broke. Unknown shapes stay the flat code.
          this.gap(readFailureReason(error))
        } finally {
          if (handle) try { await handle.close() } catch { failed = true; this.failures.add(target.id); this.gap('handle-close-failed') }
        }
        this.guard(scope, signal)
        if (done && !failed && stage) {
          const after = await scope.backend.stat(SessionId(target.id), { signal })
          this.guard(scope, signal)
          if (!after) {
            this.failures.add(target.id); this.gap('session-disappeared'); this.visible.delete(target.id); this.discard(stage)
          } else {
            if (after.revision !== target.revision) { stage.part.addGap('revision-changed'); this.gap('revision-changed') }
            this.mergeLive(stage)
            this.publish(stage)
          }
        } else if (!failed) queue.push(target)
        this.fairCursor = targets.length ? (targets.findIndex(item => item.id === target.id) + 1) % targets.length : 0
        if (this.reasons.has('index-capacity')) break
        // Yield between Sessions, not between every page: `setTimeout(0)` has a
        // ~15ms floor on Windows, so yielding per page turned a fast local read
        // into a visibly slow scan.
        await (this.options.yield ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0))))()
      }
      // Live-only records remain explicitly partial, never a substitute for corpus enumeration.
      for (const [id, queue] of this.live) {
        this.guard(scope, signal)
        if (this.pending.has(id)) continue
        this.visible.add(id)
        const old = this.published.get(id)
        if (old) { this.pending.add(id); continue }
        const stage = this.stage({ id, revision: 'observed-live', seeded: queue[0]!.inherited > 0 }, queue[0]!.inherited)
        // Rebuilds must obtain the history again; a tail-only buffer cannot attest old prefixes.
        stage.part.addGap('observed-live')
        this.mergeLive(stage)
        this.publish(stage)
      }
      // `complete` is a terminal state, not a return to `idle`: the scan really
      // ran and the index is current. Collapsing it into `idle` made a finished
      // scan look identical to one that never started.
      this.phase = 'complete'
      if (this.pending.size) this.gap('scan-pending')
    } catch (error) {
      if (error instanceof ScopeChanged) { this.syncScope(); this.phase = 'idle' }
      else if (signal.aborted) { this.phase = 'cancelled'; this.gap('scan-cancelled') }
      else { this.phase = 'failed'; this.gap('session-list-or-stat-failed') }
    }
    return this.snapshot()
  }

  snapshot(includeRows = true) {
    this.syncScope()
    const entries = [...this.published].filter(([id]) => this.visible.has(id))
    const sessions = entries.map(([id, entry]) => ({ sessionId: id, ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }), revision: entry.value.revision, cut: entry.value.cut, coverage: entry.value.coverage, stale: this.pending.has(id) || this.failures.has(id), reasons: [...entry.value.reasons] }))
    const retained = entries.flatMap(([, entry]) => entry.value.rows)
    const rows = includeRows ? retained.map(row => ({ ...row })) : []
    const counted = retained.filter(row => !row.inherited)
    const complete = this.lastScope.status === 'ready' && this.enumerated && this.enumerationCurrent && this.pending.size === 0 && this.failures.size === 0 && this.reasons.size === 0 && sessions.every(session => session.coverage === 'complete')
    const coverage = complete ? 'complete' as const : this.enumerated || this.visible.size > 0 ? 'partial' as const : 'unknown' as const
    // Every numeric field in this snapshot reaches the wire, where a single
    // non-finite value (NaN / Infinity) makes the zod allowlist reject the WHOLE
    // status reply as internal-error. That is not hypothetical: the ledger and
    // the declared/read event sums are accumulated from per-entry arithmetic, and
    // one missing operand poisons the sum with NaN. The page then shows
    // 「尚未收到索引状态」 and disables the scan trigger — a total, silent loss of
    // the entire status surface caused by one bad number. Coerce at the boundary
    // so a bad counter degrades to 0 instead of erasing the page.
    const finite = (value: number | undefined): number => (
      value !== undefined && Number.isFinite(value) ? value : 0
    )
    return {
      corpus: 'persisted-plus-observed-live' as const,
      scope: describeCallIndexScope(this.lastScope), generation: this.generation, censusGeneration: this.censusGeneration,
      asOf: this.asOf, phase: this.phase, coverage, eventCoverage: coverage,
      enumerationCoverage: !this.enumerationCurrent ? 'unknown' as const : this.reasons.has('session-capacity') || this.reasons.has('invalid-session-metadata') ? 'partial' as const : 'complete' as const,
      semanticCoverage: { source: this.options.resolveSource === undefined ? 'unknown' as const : 'verified' as const, ptc: 'unknown' as const, skillExecution: 'unavailable' as const, denied: 'unavailable' as const },
      listedSessions: finite(this.listedCount), visibleSessions: finite(this.visible.size), completedSessions: sessions.filter(session => session.coverage === 'complete' && !session.stale).length,
      pendingSessions: finite(this.pending.size), failedSessions: finite(this.failures.size), pendingLive: finite(this.liveCount),
      // Diagnostic pair: what the backend CLAIMED per session vs what we actually
      // read. Equal values mean the scan saw the whole log; a large gap means the
      // backend under-reports (multi-frame artifacts) and the index is silently
      // starving. Both are plain integers, no session content.
      declaredEvents: finite(entries.reduce((sum, [, entry]) => sum + finite(entry.value.cut), 0)),
      readEvents: finite(entries.reduce((sum, [, entry]) => sum + finite(entry.part.usage().events), 0)),
      estimatedBytes: finite(this.ledger.used), reasons: [...this.reasons], sessions, rows,
      totals: { calls: counted.length, succeeded: counted.filter(row => row.outcome === 'success').length, failed: counted.filter(row => row.outcome === 'error').length, unresolved: counted.filter(row => row.outcome === 'unresolved').length, unknown: counted.filter(row => row.outcome === 'unknown').length, cancelled: counted.filter(row => row.outcome === 'cancelled').length, running: counted.filter(row => row.outcome === 'running').length, inherited: retained.length - counted.length },
    }
  }
}
