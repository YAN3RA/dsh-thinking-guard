/**
 * New, unmounted call-index scanner. Public read handles only; no disk state
 * except the OPT-IN warm cache, which stores metadata only and is off by default.
 */
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallIndexPartition, projectCallIndexEvent, type CallIndexEvent, type CallIndexPartitionSnapshot, type CallIndexRow, type CallIndexSourceResolver } from './call-index-core.ts'
import { CallIndexScopeController, describeCallIndexScope, type CallIndexScope } from './call-index-scope.ts'
import { CallIndexCache, type CachedEntry } from './call-index-cache.ts'
import { createArtifactIoCounters, fingerprintArtifact, type ArtifactIoCounters } from './call-index-jsonl-fingerprint.ts'

type ReadyScope = Extract<CallIndexScope, { status: 'ready' }>
interface Ledger { used: number }
interface Target { id: string; revision: string; eventCount?: number; seeded: boolean; cwd?: string; parentSession?: string; location?: unknown }
/** `resumable` marks a stage stopped mid-log: its partition and cut survive so the next pass continues from there. */
interface Stage {
  target: Target
  part: CallIndexPartition
  next: number
  ledger: Ledger
  inherited: number
  resumable: boolean
  /**
   * Artifact digest the partition was BOUND to when it started.
   *
   * A stage can outlive a pass, so its rows were read from bytes that may since
   * have changed in place under the same opaque revision. Reusing it without
   * re-proving that digest would mix an old prefix with a fresh tail and then
   * cache the mixture, so the run discards such a stage and re-reads from zero.
   */
  digest?: { size: number; sha256: string }
}
/**
 * What a published entry can do: report usage and project a snapshot.
 *
 * A live stage needs a real {@link CallIndexPartition} (it ingests events); a
 * warm-cache entry is a READ-ONLY row view and must never be hydrated from
 * fabricated events, so it only satisfies this narrower shape.
 */
interface PartitionLike {
  ingest(events: readonly CallIndexEvent[]): void
  addGap(reason: string): void
  usage(): { events: number; calls: number; bytes: number }
  snapshot(cut: number): CallIndexPartitionSnapshot
}
/** `exhausted` is false while the Session's log has not been read to EOF; its coverage is then honestly `partial`. */
interface Published { value: CallIndexPartitionSnapshot; part: PartitionLike; target: Target; inherited: number; ledger: Ledger; bytes: number; exhausted: boolean; cwd?: string; restored?: CachedEntry }
/**
 * Read-only projection of one verified cache entry.
 *
 * `ingest`/`addGap` are deliberate no-ops: restoring must never pretend raw
 * events were replayed. Any live change drops the entry instead, and the Session
 * is rebuilt from zero on disk.
 */
class CachedPartition implements PartitionLike {
  /**
   * @param entry - verified cache entry (rows are already final metadata)
   * @param revision - the CURRENT list revision of this instance
   *
   * The revision comes from this process's own `list`, never from the shard: an
   * opaque backend token is not portable across instances, and it must not be
   * what authorizes a hit (the digest does). Using the live value only keeps the
   * published row consistent with the rest of this pass.
   */
  constructor(
    private readonly entry: CachedEntry,
    private readonly revision: string,
    /** Rows re-projected against THIS process's provenance evidence. */
    private readonly rows: readonly CallIndexRow[],
  ) {}
  ingest(_events: readonly CallIndexEvent[]): void { /* read-only cache view */ }
  addGap(_reason: string): void { /* read-only cache view */ }
  usage(): { events: number; calls: number; bytes: number } {
    // `events` reports what the index RETAINS from the verified cache, not what
    // this process decoded (that is always 0 for a warm hit).
    return { events: this.entry.cut, calls: this.rows.length, bytes: 0 }
  }
  snapshot(cut: number): CallIndexPartitionSnapshot {
    const limit = Number.isSafeInteger(cut) && cut >= 0 ? cut : 0
    return {
      sessionId: this.entry.sessionId,
      revision: this.revision,
      cut: Math.min(limit, this.entry.cut),
      rows: this.rows.filter(row => row.callSeq < limit),
      coverage: this.entry.coverage,
      reasons: [...this.entry.reasons],
      estimatedBytes: 0,
    }
  }
}
/** Opt-in warm cache: both the cache directory and the authorized read root are required. */
export interface WarmCacheOptions {
  /** Where manifests/shards may be written. Never a corpus path. */
  readonly dir: string
  /** Explicitly authorized artifact root; fingerprints outside it are refused. */
  readonly sourceRoot: string
  /** Refuse to hash artifacts larger than this. */
  readonly maxBytes?: number
}
/**
 * Verifications between voluntary scheduling points during warm restore.
 *
 * This is a YIELD interval, not a cap: every listed candidate within the pass's
 * own `maxSessions` is attempted, so a corpus of 70 or 165 Sessions is restored
 * completely instead of silently cold-reading whatever fell past a fixed 64.
 */
const WARM_YIELD_EVERY = 16

/** One EOF entry waiting for its ancestor digests to become available. */
interface DeferredWarm {
  readonly target: Target
  readonly inherited: number
  readonly coverage: 'complete' | 'partial'
  readonly cut: number
  readonly rows: readonly CallIndexRow[]
  readonly reasons: readonly string[]
  readonly digest: { size: number; sha256: string }
  readonly epoch: number
}

/**
 * Conservative retained-byte estimate for one restored entry.
 *
 * Deliberately pessimistic (a per-row constant well above the real object size,
 * plus the stored reasons): the point is to CHARGE the budget honestly, so a
 * restored view can never look free. It is an estimate of retained metadata, not
 * a measurement of RSS.
 */
function estimateCachedBytes(entry: CachedEntry): number {
  const perRow = 2 * (JSON.stringify({
    sessionId: entry.sessionId, callId: '', toolName: '', outcome: 'unresolved',
    sourceKind: 'unknown', layer: 'unknown',
  }).length + 512) + 256
  return 1024 + entry.rows.length * perRow + entry.reasons.length * 64
}
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
  /**
   * OPT-IN warm cache. Absent means the feature is off and nothing is written:
   * the default stays "no disk state".
   */
  warmCache?: WarmCacheOptions
  /** Upper bound on pages read through ONE open handle before it is released (TG-07 micro-batch). */
  pagesPerHandle?: number
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

/** Pages read on one handle between voluntary scheduling points. */
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
  /** `partial` = terminal but unfinished (budget or capacity), and resumable. */
  private phase: 'idle' | 'running' | 'complete' | 'partial' | 'cancelled' | 'failed' = 'idle'
  /** True while the last finished pass stopped on a capacity reservation. */
  private paused = false
  /** Live counters of the current/last pass (never cumulative). */
  private passReadEvents = 0
  private passPages = 0
  private passSessions = 0
  /**
   * Highest verified cut this pass advanced to, in events.
   *
   * TG-09's progress guard: rows published and pages read can both stay flat
   * while a pass genuinely advances (a log of ignorable events has no rows, and
   * a resumed stage reads a page it already accounted for). The cut moving is the
   * one signal that cannot be produced without really reading forward.
   */
  private passCut = 0
  /**
   * Scheduler progress bookkeeping, keyed by Session and bound to its revision.
   *
   * The scheduler must NOT use "sum of cuts" as progress. A re-listed Session
   * under a NEW revision starts its own cut at 0, so `sum max(oldCut, newNext)`
   * hides the new revision's real advance; and a revision that keeps churning
   * would look like endless progress. Progress is therefore per (session,
   * revision): the first sighting only establishes a baseline, and only a cut
   * that advances within the SAME revision counts. This map stays Host-internal —
   * no revision, scope or backend identity is ever put on the wire.
   */
  private readonly progressBase = new Map<string, { revision: string; cut: number }>()
  /** Verified forward progress of the last finished pass, in events. */
  private progressEvents = 0
  /**
   * Sessions whose log was read through EOF.
   *
   * Deliberately INDEPENDENT of `coverage`: a backend that under-reports its
   * event count yields a legitimate `partial` coverage (that gap is real), yet
   * the log really was read to its end. Conflating the two made such a Session
   * count as never-complete forever, which is how a fully read corpus ended up
   * rendering as 「没有可索引的会话」 with pending 0.
   */
  private exhaustedCount = 0
  private liveCount = 0
  private disposed = false
  /** Opt-in cache owner; `undefined` when the feature is not configured. */
  private cache: CallIndexCache | undefined
  /**
   * Digest of each artifact the last pass verified, keyed by Session.
   *
   * Populated only on a full EOF read of that Session (or by a cache hit), and
   * used to decide whether a warm entry may be restored at all.
   */
  private readonly digests = new Map<string, { size: number; sha256: string }>()
  /** Artifact I/O accounting for the current process, never sent to the browser. */
  private readonly io: ArtifactIoCounters = createArtifactIoCounters()
  /**
   * Cache diagnostics, kept OUT of `reasons`.
   *
   * A cache miss, a disabled/unavailable cache, or an unverifiable artifact says
   * nothing about whether the SOURCE was read: folding those codes into the
   * coverage-gap list made a perfectly complete cold scan render as permanently
   * `partial`. Only real read/projection gaps affect coverage.
   */
  private readonly cacheNotes = new Map<string, number>()
  /**
   * Assertions for entries whose ancestors were not yet read in this pass.
   *
   * Holds only metadata already verified for THIS instance/scope; retried at pass
   * end and across passes. Cleared on scope change/dispose.
   */
  private deferredWarm: DeferredWarm[] = []
  /** Sessions whose cache entry this instance has already committed. */
  private readonly warmSaved = new Set<string>()
  /** Targets of the CURRENT pass, so fork lineage can be walked by id. */
  private readonly targetsById = new Map<string, Target>()
  private readonly limits: { pageSize: number; maxBytes: number; maxCalls: number; maxSessions: number; maxEvents: number; maxOrphans: number; maxLive: number; pagesPerHandle: number }

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
      // A bounded slice through one handle. Large enough that ordinary logs are
      // read in a single slice (a 4009-event log at page 2048 needs 3 pages), small
      // enough that one pathological log cannot starve the rest of the corpus or
      // delay cancellation for long.
      pagesPerHandle: positive(options.pagesPerHandle, 16),
    }
    // Both halves are required. A cache directory without an authorized source
    // root would let a stale manifest speak for artifacts this process cannot
    // verify, so the feature simply stays off instead.
    const warm = options.warmCache
    if (warm !== undefined && typeof warm.dir === 'string' && warm.dir.length > 0
      && typeof warm.sourceRoot === 'string' && warm.sourceRoot.length > 0) {
      this.cache = new CallIndexCache({ dir: warm.dir })
    }
  }

  /**
   * Observable accounting for the FINGERPRINT path only.
   *
   * `fullLogDecodes` here means "whole-log decodes performed by this scanner's
   * artifact verification", which is always 0 by construction — it is NOT a
   * measurement of the Host's own `list`/`stat`/`open` decode work, and must
   * never be reported as such. `headerFrameDecodes` is likewise 0 for this
   * module; the backend's header-frame work is counted by the caller.
   */
  ioCounters(): ArtifactIoCounters { return { ...this.io } }

  /** Wait until every queued cache write has settled; a barrier for a real shutdown. */
  async flushCache(): Promise<void> {
    const cache = this.cache
    if (cache !== undefined) await cache.settled()
  }

  /** Drop a warm-restored entry; the Session then rebuilds from zero on disk. */
  private invalidateRestored(id: string): boolean {
    const entry = this.published.get(id)
    if (entry === undefined || entry.restored === undefined) return false
    // Release exactly what publishRestored reserved, so the ledger cannot drift
    // upward each time a restored Session is dropped and rebuilt.
    entry.ledger.used = Math.max(0, entry.ledger.used - entry.bytes)
    this.published.delete(id)
    this.digests.delete(id)
    this.generation += 1
    return true
  }

  /**
   * Verify one Session's artifact against its cached digest.
   *
   * A hit is returned only when EVERY condition holds: the artifact path comes
   * from the public snapshot, the file is inside the authorized root, the digest
   * matches, the entry is a full-EOF entry, and the row set still fits the
   * CURRENT pass limits. Anything else returns `undefined` and the caller does a
   * normal scan — never a partial restore dressed up as complete.
   */
  private async verifyCache(id: string, target: Target, epoch: number, signal?: AbortSignal): Promise<CachedEntry | undefined> {
    const cache = this.cache
    if (cache === undefined || target.location === undefined) return undefined
    const loaded = await cache.load(id)
    if (loaded === undefined || this.disposed) return undefined
    const options = this.options.warmCache
    if (options === undefined) return undefined
    const digest = await fingerprintArtifact(target.location, {
      sourceRoot: options.sourceRoot, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(signal === undefined ? {} : { signal }), counters: this.io,
    })
    if (digest === undefined || this.disposed) return undefined
    // The entry must describe exactly this artifact, at this size.
    const artifact = loaded.artifacts[0]
    if (artifact === undefined || artifact.sha256 !== digest.sha256 || artifact.size !== digest.size) return undefined
    // Re-check authorization/epoch AFTER the asynchronous verification.
    const current = this.syncScope()
    if (!current || current.epoch !== epoch || !this.scopes.isCurrent(current)) return undefined
    // Current-pass budgets still apply: a larger old manifest cannot bypass them.
    if (loaded.rows.length > this.limits.maxCalls) return undefined
    if (loaded.rows.length > this.limits.maxCalls - this.publishedRowCount()) return undefined
    if (loaded.cut > this.limits.maxEvents) return undefined
    // An EMPTY row set is not a reason to refuse: a header-only Session (cut 0)
    // and an other-only log (rows 0, cut > 0) are both legal EOF states. What
    // authorizes the hit is the entry's own EOF marker, checked in the parser.
    // Byte budget is charged BEFORE the entry becomes visible. Restored rows are
    // real retained metadata, so pretending they cost 0 bytes would let an old
    // large manifest overrun this pass's maxBytes — and hide the real memory.
    const bytes = estimateCachedBytes(loaded)
    if (bytes > this.limits.maxBytes) return undefined
    if (this.ledger.used + bytes > this.limits.maxBytes) { this.gap('index-capacity'); return undefined }
    /**
     * Identity must match THIS listing, not just the stored copy.
     *
     * A shard is untrusted input: without this check a fork whose parent moved,
     * or a seeded Session whose inherited cut changed, could be restored on the
     * strength of its own bytes alone.
     */
    if (loaded.header.isSeeded !== target.seeded) return undefined
    if (loaded.header.parentSession !== target.parentSession) return undefined
    // Inherited cut: a non-seeded Session must have none, and a seeded one must
    // carry a cut that its CURRENT parent can actually account for. The public
    // snapshot exposes no exact inherited count, so the parent's declared event
    // count is the strongest available evidence; without it we fail closed
    // rather than trusting the shard's own number.
    const inherited = loaded.header.inheritedEventCount
    if (!target.seeded) {
      if (inherited !== 0) return undefined
    } else {
      const parent = target.parentSession === undefined ? undefined : this.targetsById.get(target.parentSession)
      if (parent === undefined || inherited < 1) return undefined
      /**
       * Bound the inherited cut by CONTENT, not by the backend's hint.
       *
       * A multi-frame JSONL parent routinely declares a small `eventCount` (the
       * header record alone), so treating that number as an upper bound would
       * refuse every legitimate fork. The authoritative bound is the parent's own
       * VERIFIED EOF cut — the count this process actually read through EOF and
       * bound to the parent's artifact digest — used only when that parent entry
       * exists and its digest still matches this pass. With no verified parent
       * entry the child fails closed (cold rebuild) instead of guessing.
       */
      const verifiedParent = this.published.get(parent.id)?.restored ?? undefined
      if (verifiedParent === undefined) return undefined
      if (inherited > verifiedParent.cut) return undefined
      if (this.digests.get(parent.id)?.sha256 !== loaded.lineage[0]?.sha256) return undefined
    }
    /**
     * The WHOLE ancestor chain must be re-proven, not just the first link.
     *
     * An empty or truncated lineage can never be accepted: a fork inherits a
     * prefix from its parent, so "no recorded ancestors" is only legitimate for
     * a Session that has no parent at all. Every hop must name the immediate
     * parent of the previous hop, end at a root, and still carry a digest this
     * pass verified.
     */
    const chain = this.lineageChain(id, target.parentSession)
    if (chain === undefined) return undefined
    if (chain.length !== loaded.lineage.length) return undefined
    for (const [index, sessionId] of chain.entries()) {
      const link = loaded.lineage[index]!
      if (link.sessionId !== sessionId) return undefined
      const known = this.digests.get(sessionId)
      if (known === undefined || known.sha256 !== link.sha256) return undefined
    }
    return loaded
  }

  /**
   * Walk the CURRENT parent chain of a Session, root last.
   *
   * Returns `undefined` when the chain is broken (a parent that is not listed),
   * cyclic, or longer than the supported depth — all of which make a cached
   * inherited view unverifiable rather than "probably fine".
   */
  private lineageChain(id: string, parent: string | undefined): string[] | undefined {
    const chain: string[] = []
    const seen = new Set<string>([id])
    let current = parent
    for (let depth = 0; current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return undefined
      const next = this.targetsById.get(current)
      if (next === undefined) return undefined
      seen.add(current)
      chain.push(current)
      current = next.parentSession
    }
    return chain
  }

  /**
   * Try to restore every listed Session from the warm cache.
   *
   * Ordering matters: ancestors are verified before descendants, so a fork whose
   * parent changed can never be restored on a prefix that no longer exists. A
   * Session that fails verification is simply left pending — it is NOT marked
   * stale-and-shown, because a view built on an unverified artifact must never be
   * visible at all.
   */
  private async restoreWarm(scope: ReadyScope, targets: readonly Target[], signal?: AbortSignal): Promise<void> {
    const cache = this.cache
    if (cache === undefined) return
    let attempts = 0
    const byId = new Map(targets.map(target => [target.id, target]))
    // Deterministic order: a parent listed after its child must still verify first.
    const ordered: Target[] = []
    const placed = new Set<string>()
    const place = (target: Target, depth: number): void => {
      if (placed.has(target.id) || depth > 32) return
      const parent = target.parentSession === undefined ? undefined : byId.get(target.parentSession)
      if (parent !== undefined) place(parent, depth + 1)
      placed.add(target.id)
      ordered.push(target)
    }
    for (const target of targets) place(target, 0)
    for (const target of ordered) {
      if (this.published.has(target.id) || !this.pending.has(target.id)) continue
      // Voluntary yield, not a cap: every listed candidate is attempted, so a
      // large corpus is restored in full rather than partly cold-read.
      if (attempts > 0 && attempts % WARM_YIELD_EVERY === 0) await (this.options.yield ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0))))()
      this.guard(scope, signal)
      attempts += 1
      const loaded = await this.verifyCache(target.id, target, scope.epoch, signal)
      this.guard(scope, signal)
      if (loaded === undefined) { this.cacheNote('warm-cache-miss'); continue }
      this.publishRestored(target, loaded)
    }
  }

  /**
   * Install a verified cache entry as a read-only published view.
   *
   * The byte charge is conservative and OWNED by the entry, so
   * {@link invalidateRestored} can release exactly what was reserved.
   */
  private publishRestored(target: Target, entry: CachedEntry): void {
    const rows = this.reprojectRows(entry.rows)
    const part = new CachedPartition(entry, target.revision, rows)
    const snapshot = part.snapshot(entry.cut)
    const bytes = estimateCachedBytes(entry)
    this.ledger.used += bytes
    this.published.set(target.id, {
      value: snapshot, part, target, inherited: entry.header.inheritedEventCount,
      ledger: this.ledger, bytes, exhausted: true,
      ...(target.cwd === undefined ? {} : { cwd: target.cwd }), restored: entry,
    })
    this.digests.set(target.id, entry.artifacts[0]!)
    this.pending.delete(target.id)
    this.failures.delete(target.id)
    this.generation += 1
  }

  /**
   * Re-apply provenance to cached rows.
   *
   * `sourceKind` is NOT a property of the artifact bytes: it is evidence from
   * THIS process's capability catalog. Reusing the value stored by an older
   * instance would attribute a call using a catalog that may no longer exist, so
   * every row is re-resolved now, and a missing/throwing resolver yields
   * `unknown` instead of stale evidence. No raw event text is involved.
   */
  private reprojectRows(rows: readonly CallIndexRow[]): CallIndexRow[] {
    const resolve = this.options.resolveSource
    return rows.map(row => {
      let sourceKind: CallIndexRow['sourceKind'] = 'unknown'
      if (resolve !== undefined) {
        try {
          const value = resolve(row.toolName)
          if (value === 'mcp' || value === 'plugin-tool' || value === 'native' || value === 'skill') sourceKind = value
        } catch { sourceKind = 'unknown' }
      }
      return { ...row, sourceKind }
    })
  }

  /**
   * Persist a cache entry for one Session that was read through EOF.
   *
   * Deliberately narrow: the artifact is fingerprinted with the same read-only
   * hasher used for verification, and the entry carries only the fixed metadata
   * allowlist. A missing location, a hash failure, or a scope change while the
   * digest is being computed all mean "do not cache", never "cache unverified".
   */
  private async saveWarm(
    scope: ReadyScope,
    target: Target,
    stage: Stage,
    location: unknown,
    signal?: AbortSignal,
    beforeDigest?: { size: number; sha256: string },
    revisionStable = false,
  ): Promise<void> {
    const cache = this.cache
    const options = this.options.warmCache
    if (cache === undefined || options === undefined) return
    if (location === undefined) { this.cacheNote('warm-cache-unavailable'); return }
    // No pre-read digest means the artifact could not be bound to this read, so
    // the safe answer is "do not cache" (the next pass re-reads it).
    if (beforeDigest === undefined) { this.cacheNote('warm-cache-unstable'); return }
    // The backend's own revision token moved while we read: the EOF cut no longer
    // describes the artifact's current state.
    if (!revisionStable) { this.cacheNote('warm-cache-unstable'); return }
    //
    // NO `usage().events === 0` bail-out.
    //
    // A Session that reached EOF with zero retained events is perfectly legal: a
    // header-only log (cut 0) and a log whose events project to no call row both
    // end here. Skipping them meant such a Session was re-read on every warm
    // start, so "restart restores the full index with no whole-log decode" could
    // not hold for the whole corpus. The EOF evidence is the explicit
    // `exhausted: true` marker written below, never a non-empty row list.
    const digest = await fingerprintArtifact(location, {
      sourceRoot: options.sourceRoot, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(signal === undefined ? {} : { signal }), counters: this.io,
    })
    if (digest === undefined) { this.cacheNote('warm-cache-unavailable'); return }
    // Same artifact revision as the one this read reached EOF on: the bytes that
    // produced this cut are exactly the bytes being bound to it.
    if (digest.sha256 !== beforeDigest.sha256 || digest.size !== beforeDigest.size) {
      this.cacheNote('warm-cache-unstable')
      return
    }
    // Record the verified digest of this EOF read even if the entry is deferred:
    // later passes reuse it as the "same generation" proof for descendants.
    this.digests.set(target.id, digest)
    const current = this.syncScope()
    if (!current || current.epoch !== scope.epoch || this.disposed) return
    const snapshot = stage.part.snapshot(stage.next)
    const record: DeferredWarm = {
      target, inherited: stage.inherited, coverage: snapshot.coverage, cut: snapshot.cut,
      rows: snapshot.rows.map(row => ({ ...row })), reasons: [...snapshot.reasons],
      digest, epoch: scope.epoch,
    }
    // Lineage needs EVERY ancestor digest, and a newest-first corpus reads the
    // child BEFORE its parent. Give the pass a chance to finish: an unresolved
    // child is deferred and retried after the scan loop, when its ancestors have
    // been read. It is never guessed and never written unverified.
    if (!await this.commitWarm(record, signal)) this.deferredWarm.push(record)
  }

  /**
   * Write one warmed entry when its WHOLE lineage is already verified.
   *
   * @returns `true` when the entry was saved, `false` when an ancestor digest is
   *   still unknown (the caller may retry later in the same pass). A broken chain
   *   (missing ancestor, cycle, too deep) is a hard refusal, never deferred.
   */
  private async commitWarm(record: DeferredWarm, signal?: AbortSignal): Promise<boolean> {
    const cache = this.cache
    const options = this.options.warmCache
    if (cache === undefined || options === undefined || this.disposed) return true
    const { target } = record
    const lineage: Array<{ sessionId: string; sha256: string }> = []
    let parent = target.parentSession
    for (let depth = 0; parent !== undefined; depth++) {
      if (depth >= 32) { this.cacheNote('warm-cache-lineage-unverified'); return true }
      const parentTarget = this.targetsById.get(parent)
      if (parentTarget === undefined) { this.cacheNote('warm-cache-lineage-unverified'); return true }
      const parentDigest = this.digests.get(parent)
      if (parentDigest === undefined) return false
      if (parentTarget.location === undefined) { this.cacheNote('warm-cache-lineage-unverified'); return true }
      // Re-verify the ANCESTOR now: its digest was recorded earlier in this pass,
      // and the inherited prefix this child's view was built on must still be the
      // same artifact. A parent appended in between must not be bound to an older
      // inherited view.
      const recheck = await fingerprintArtifact(parentTarget.location, {
        sourceRoot: options.sourceRoot, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
        ...(signal === undefined ? {} : { signal }), counters: this.io,
      })
      if (recheck === undefined || recheck.sha256 !== parentDigest.sha256) {
        this.cacheNote('warm-cache-lineage-unstable')
        return true
      }
      lineage.push({ sessionId: parent, sha256: parentDigest.sha256 })
      parent = parentTarget.parentSession
    }
    const scope = this.syncScope()
    if (!scope || scope.epoch !== record.epoch || this.disposed) return true
    this.digests.set(target.id, record.digest)
    await cache.save({
      sessionId: target.id,
      coverage: record.coverage,
      // Reaching this path already means EOF; stating it explicitly is what lets
      // an empty row set be cached honestly.
      exhausted: true,
      cut: record.cut,
      header: {
        ...(target.cwd === undefined ? {} : { cwd: target.cwd }),
        isSeeded: target.seeded,
        ...(target.parentSession === undefined ? {} : { parentSession: target.parentSession }),
        inheritedEventCount: record.inherited,
      },
      artifacts: [record.digest],
      lineage,
      rows: record.rows,
      reasons: record.reasons,
      epoch: record.epoch,
      isCurrent: () => !this.disposed && this.syncScope()?.epoch === record.epoch,
    })
    this.warmSaved.add(target.id)
    return true
  }

  /**
   * Flush every cacheable EOF entry this pass published, then drain deferred ones.
   *
   * Re-deriving from `published` (not from stages) is what makes a superseded
   * stage un-writable: its partition is no longer the published value. Only EOF
   * entries are considered, only when this instance holds a verified digest for
   * the same artifact generation.
   */
  private async flushWarmEntries(scope: ReadyScope, signal?: AbortSignal): Promise<void> {
    if (this.cache === undefined) return
    for (const [id, entry] of this.published) {
      if (entry.restored !== undefined) continue
      if (!entry.exhausted) continue
      if (this.warmSaved.has(id)) continue
      const target = this.targetsById.get(id)
      if (target === undefined || target.location === undefined) continue
      const digest = this.digests.get(id)
      if (digest === undefined) continue
      // A live stage still owns a NEWER partition for this Session, so the
      // published value may be a superseded prefix: never write it.
      if (this.stages.has(id)) continue
      const record: DeferredWarm = {
        target, inherited: entry.inherited, coverage: entry.value.coverage, cut: entry.value.cut,
        rows: entry.value.rows.map(row => ({ ...row })), reasons: [...entry.value.reasons],
        digest, epoch: scope.epoch,
      }
      this.guard(scope, signal)
      const saved = await this.commitWarm(record, signal)
      this.guard(scope, signal)
      if (saved) this.warmSaved.add(id)
      else this.deferredWarm.push(record)
    }
    await this.drainDeferredWarm(signal)
  }

  /** Retry deferred entries until no further ancestor became verifiable. */
  private async drainDeferredWarm(signal?: AbortSignal): Promise<void> {
    for (let round = 0; round < 32 && this.deferredWarm.length > 0; round++) {
      const queue = this.deferredWarm.splice(0)
      const retry: DeferredWarm[] = []
      const before = this.digests.size
      for (const record of queue) {
        if (this.disposed) return
        if (!await this.commitWarm(record, signal)) retry.push(record)
      }
      this.deferredWarm.push(...retry)
      // No new ancestor digest means no later round can make progress.
      if (this.digests.size === before) break
    }
    if (this.deferredWarm.length > 0) this.cacheNote('warm-cache-lineage-unverified')
    this.deferredWarm.length = 0
  }

  private publishedRowCount(): number {
    let total = 0
    for (const entry of this.published.values()) total += entry.value.rows.length
    return total
  }

  private gap(reason: string): void { if (this.reasons.size < 32) this.reasons.add(reason) }
  /** Record a cache diagnostic; never contributes to coverage or `reasons`. */
  private cacheNote(reason: string): void { this.cacheNotes.set(reason, (this.cacheNotes.get(reason) ?? 0) + 1) }
  /** Cache diagnostics for tests/diagnostics; bounded and never on the wire. */
  cacheDiagnostics(): Readonly<Record<string, number>> { return Object.freeze(Object.fromEntries(this.cacheNotes)) }
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
      this.deferredWarm.length = 0; this.warmSaved.clear(); this.cacheNotes.clear()
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
    // Ownership transfer. A checkpoint publishes a stage that legitimately keeps
    // running, so `published` and `stages` can hold the SAME partition. The
    // ledger charges those bytes exactly once; whoever holds the part must carry
    // them. Dropping the stage without moving the charge would let a later
    // eviction subtract the same bytes a second time.
    const entry = this.published.get(stage.target.id)
    if (entry !== undefined && entry.part === stage.part) entry.bytes = stage.part.usage().bytes
  }

  /** Immediate projection keeps raw events out of the bounded live queue. */
  observeLive(sessionId: string, raw: unknown, inheritedEventCount: number): boolean {
    if (!this.syncScope()) return false
    // A live event proves the artifact moved past what the cache verified: drop
    // the restored view FIRST so nothing downstream can keep serving it. The
    // Session then rebuilds from zero on disk; no event is fabricated to patch it.
    this.invalidateRestored(sessionId)
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
      // A warm-restored view can never absorb live events: it is dropped first and
      // the Session restarts as a fresh observed-live stage.
      this.invalidateRestored(id)
      const old = this.published.get(id)
      const stage: Stage = old
        ? { target: old.target, part: old.part as CallIndexPartition, next: old.value.cut, ledger: old.ledger, inherited: old.inherited, resumable: false }
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
  dispose(): void {
    this.disposed = true
    this.cancel()
    this.scopes.invalidate()
    this.token = undefined
    this.published.clear(); this.stages.clear(); this.live.clear(); this.observedThrough.clear(); this.visible.clear()
    this.pending.clear(); this.failures.clear(); this.reasons.clear(); this.targetsById.clear(); this.digests.clear()
    this.deferredWarm.length = 0; this.warmSaved.clear()
    this.ledger = { used: 0 }; this.liveCount = 0; this.enumerated = false; this.enumerationCurrent = false
    this.listedCount = 0; this.asOf = undefined; this.phase = 'idle'
    // Pending writes observe `disposed` inside the queue and drop themselves.
    const cache = this.cache
    this.cache = undefined
    if (cache !== undefined) void cache.dispose()
  }

  private stage(target: Target, inherited: number): Stage {
    // A restored read-only view must be replaced by a real partition before any
    // event is ingested; silently reusing it would fabricate history.
    const restored = this.published.get(target.id)
    if (restored?.restored !== undefined) this.invalidateRestored(target.id)
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
    const stage = { target, part, next: 0, ledger, inherited, resumable: false }
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
    /**
     * Preserve a readable COMPLETE partition until the new read really earn its
     * replacement.
     *
     * The check must be exhaustion/revision based, NOT `snapshot.coverage ===
     * 'partial'`: a mid-run checkpoint's cut is internally contiguous, so the
     * partition calls its own prefix "complete" even at event 5 of 101. Gating on
     * coverage therefore let a 5-event prefix overwrite 100 complete calls.
     */
    if (old !== undefined && old.exhausted && old.value.coverage === 'complete' && old.part !== stage.part) {
      // Only a read of a DIFFERENT revision can be superseded by replacement. The
      // guard is exhaustion + revision based on purpose: a mid-run checkpoint's cut
      // is internally contiguous, so `snapshot.coverage` alone would call a
      // 5-event prefix "complete" and let it overwrite 100 complete calls.
      if (old.value.revision !== stage.target.revision) {
        const replaces = !stage.resumable && snapshot.coverage === 'complete'
        if (!replaces) {
          this.gap('session-partial')
          // Keep the new stage alive so the new revision resumes at its cut
          // instead of being discarded and re-read from 0 every pass.
          if (stage.resumable) this.pending.add(stage.target.id)
          else this.discard(stage)
          return
        }
      } else if (stage.resumable) {
        // SAME revision, still mid-read: retain the readable complete value and
        // keep the stage so the read resumes instead of restarting.
        this.gap('session-partial')
        this.pending.add(stage.target.id)
        return
      }
      // SAME revision, read finished, but its result is worse than the retained
      // value: keep what the operator can read and settle the Session (D-039)
      // rather than leaving it queued forever. An explicit full rebuild that
      // reaches a complete result falls through and replaces the value below.
    }
    if (snapshot.coverage === 'partial' && old) {
      this.gap('session-partial')
      // (a) SAME partition: this is a legal checkpoint of a resumed read, so the
      // readable value MUST advance with it. The old code only refreshed `bytes`
      // and returned, which froze the published cut and row set at the first
      // checkpoint forever: a 30-event log served as 5 calls / cut 5 while the
      // reads really walked to 30. A gap reason (under-report, partial coverage)
      // describes the DATA, and must never lock the snapshot in place.
      if (old.part === stage.part) {
        if (snapshot.cut >= old.value.cut) {
          old.value = snapshot
          old.exhausted = !stage.resumable
          this.generation += 1
        }
        // Ownership: the live stage charges the ledger, so the entry owns 0 until
        // the stage is gone.
        old.bytes = stage.resumable ? 0 : stage.part.usage().bytes
        // EOF on the same partition: the stage is finished and must be cleared,
        // or the next pass would resume a log that was already fully read.
        if (!stage.resumable) this.stages.delete(stage.target.id)
        this.pending.delete(stage.target.id)
        return
      }
      // (b) Different partition (rebuild, or a partial-aware revision change that
      // the guard above did not already settle): retain the last readable
      // partition instead of mixing versions.
      this.discard(stage)
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
    // TG-08: a checkpoint mid-run publishes what was already read under a new
    // generation WITHOUT ending the stage, so the next pass resumes at `cut`
    // instead of re-reading from 0. Only a finished stage is deleted.
    //
    // The published entry's `bytes` is what it still OWNS in the shared ledger,
    // so it is 0 exactly while a live stage holds the same partition. Charging
    // both produced a double release and eventually a negative (clamped, hence
    // silently under-counted) ledger that let the scan over-retain.
    if (!stage.resumable) this.stages.delete(stage.target.id)
    /**
     * A checkpoint is never `complete`.
     *
     * Completeness is judged over `[0, cut)`, and a checkpoint's cut is exactly
     * where the slice stopped — so the partition's own verdict is "complete" even
     * though the log continues. Publishing that as complete is the false-complete
     * TG-08/TG-09 warns about, so the index records exhaustion separately and
     * reports such a Session as `partial` with its real cut.
     */
    this.published.set(stage.target.id, { value: snapshot, part: stage.part, target: stage.target, inherited: stage.inherited, ledger: stage.ledger, bytes: stage.resumable ? 0 : stage.part.usage().bytes, exhausted: !stage.resumable, ...(stage.target.cwd === undefined ? {} : { cwd: stage.target.cwd }) })
    if (snapshot.coverage === 'complete' && snapshot.cut >= (this.observedThrough.get(stage.target.id) ?? 0)) this.observedThrough.delete(stage.target.id)
    if (this.observedThrough.has(stage.target.id)) this.pending.add(stage.target.id)
    else this.pending.delete(stage.target.id)
    this.generation += 1
  }

  /**
   * Publish a checkpoint for a stage that was read but not exhausted.
   *
   * TG-08's failure mode was "32 Sessions read 57344 events, published 0 rows":
   * a run that hits its budget before any Session reaches EOF left every stage
   * unpublished, and the status page showed `readEvents: 0 / calls: 0` while the
   * disk had actually been read. A checkpoint publishes the verified prefix that
   * was successfully indexed (with an explicit `partial` coverage and cut), so
   * "we read something" is never invisible, and the next pass resumes from the
   * same cut rather than restarting the Session.
   *
   * It never overwrites a complete partition: the partial branch of {@link publish}
   * retains the previous readable value.
   */
  private checkpoint(stage: Stage): void {
    if (stage.part.usage().events === 0) return
    // A resumed stage keeps its existing partition, so publishing again is how a
    // mid-run cut becomes visible. The watermark still says "live events past
    // this cut", which is exactly why the Session stays pending.
    if (this.observedThrough.has(stage.target.id)) this.pending.add(stage.target.id)
    this.publish(stage)
  }

  private async run(maxEvents: number, signal: AbortSignal, full: boolean): Promise<ReturnType<SessionCallIndex['snapshot']>> {
    const scope = this.syncScope()
    if (!scope) return this.snapshot()
    this.phase = 'running'
    this.paused = false
    let readCount = 0
    try {
      this.guard(scope, signal)
      this.enumerationCurrent = false
      const listed = await scope.backend.list({ signal })
      this.guard(scope, signal)
      for (const reason of ['scan-pending', 'scan-cancelled', 'scan-budget', 'scan-paused-capacity', 'session-list-or-stat-failed', 'session-read-failed', 'handle-close-failed', 'revision-changed', 'session-disappeared', 'session-partial', 'observed-live-only', 'live-membership-unverified']) this.reasons.delete(reason)
      this.failures.clear(); this.visible.clear(); this.pending.clear()
      this.enumerated = true; this.enumerationCurrent = true; this.censusGeneration += 1; this.asOf = (this.options.now ?? Date.now)()
      this.targetsById.clear()
      // Per-pass progress. These describe THIS pass only; the cumulative
      // `readEvents` below still describes what the index retains. Keeping them
      // apart is what makes "read 57344 events, published 0" readable.
      this.passReadEvents = 0; this.passPages = 0; this.passSessions = 0; this.passCut = 0

      const targets: Target[] = []
      const ids = new Set<string>()
      for (const row of listed) {
        const id = row.header.id
        if (!text(id) || !text(row.revision) || typeof row.header.isSeeded !== 'boolean'
          || (row.eventCount !== undefined && !integer(row.eventCount)) || ids.has(id)) { this.gap('invalid-session-metadata'); continue }
        ids.add(id)
        if (targets.length >= this.limits.maxSessions) { this.gap('session-capacity'); continue }
        // The public snapshot is the ONLY source of lineage and artifact location.
        // No private backend field is read, and an absent location simply means
        // "this Session cannot be warm-restored" rather than a guess.
        const parent = row.header.parentSession
        const target: Target = {
          id, revision: row.revision, seeded: row.header.isSeeded,
          ...(typeof row.header.cwd === 'string' && row.header.cwd.length <= 4096 ? { cwd: row.header.cwd } : {}),
          ...(row.eventCount === undefined ? {} : { eventCount: row.eventCount }),
          ...(typeof parent === 'string' && text(parent) ? { parentSession: parent } : {}),
          ...(row.location === undefined ? {} : { location: row.location }),
        }
        targets.push(target); this.visible.add(id); this.targetsById.set(id, target)
        const old = this.published.get(id)
        // A warm-restored view is only valid for the exact revision it was
        // verified against; anything else drops it and rebuilds from zero.
        if (old?.restored !== undefined && (full || old.value.revision !== target.revision || this.live.has(id) || this.observedThrough.has(id))) {
          this.invalidateRestored(id)
        }
        const retained = this.published.get(id)
        if (full || !retained || retained.value.revision !== target.revision || retained.value.coverage !== 'complete' || this.live.has(id) || this.observedThrough.has(id) || this.stages.has(id)) this.pending.add(id)
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
      // Warm cache: verify each listed Session's artifact against its cached
      // digest BEFORE any handle is opened. A hit becomes a read-only published
      // entry; a miss, or any doubt at all, leaves the Session pending so it is
      // scanned from zero exactly as before.
      if (this.cache !== undefined && !full) await this.restoreWarm(scope, targets, signal)
      this.listedCount = targets.length
      const rotated = targets.length ? [...targets.slice(this.fairCursor % targets.length), ...targets.slice(0, this.fairCursor % targets.length)] : []
      const queue = rotated.filter(target => this.pending.has(target.id))
      /**
       * CONTINUOUS micro-batch scheduling (TG-07).
       *
       * The previous loop opened a handle, read ONE page, closed it, and moved to
       * the next Session. Public `read` costs a full read+decode of the artifact
       * whenever the Host's two-entry log cache misses, and rotating between more
       * than two multi-page logs evicts exactly the entry the next round needs:
       * three Sessions x nine events at page 4 produced 12 opens and 12 simulated
       * full decodes instead of 3 (V-P). Keeping one handle and consuming its
       * pages in a bounded slice is what turns "decodes ~ page count" into
       * "decodes ~ Session count".
       *
       * Bounds, all deliberate:
       * - `pagesPerHandle` pages per handle, then a voluntary yield, so one huge
       *   log cannot starve the corpus or delay cancellation. The option is wired
       *   straight into the loop: a knob that only validated its value would look
       *   like a bound without being one;
       * - `maxEvents` still caps the whole pass;
       * - EOF is still ONLY an empty page — never `eventCount`, and never one
       *   `Number.MAX_SAFE_INTEGER` read that would hold the whole log in memory.
       *
       * A Session that is not exhausted when the slice/budget/capacity stops keeps
       * its partition (`resumable`) and publishes a checkpoint, so the next pass
       * resumes at the same cut instead of re-reading from 0 and so "read a lot,
       * published 0" can no longer happen.
       */
      /** Set when a Session's partition stopped reserving: the pass pauses instead of spinning. */
      let capacityPaused = false
      /** Set when the per-pass event budget, not EOF, ended the walk. */
      let budgetStopped = false
      while (queue.length && readCount < maxEvents) {
        this.guard(scope, signal)
        const target = queue.shift()!
        let stage = this.stages.get(target.id)
        if (stage?.target.revision !== target.revision) stage = undefined
        let handle: Awaited<ReturnType<typeof scope.backend.open>> | undefined
        let done = false
        let failed = false
        let capacity = false
        /**
         * Digest taken BEFORE the read starts, used to prove the EOF snapshot and
         * the cached digest describe the SAME artifact revision.
         *
         * Without this the cache would bind a cut/row set read at time T to bytes
         * hashed at time T+n: an append landing in that window produces a
         * "complete" entry that silently omits the new tail, and a later warm hit
         * would trust it. Both digests must agree or the entry is not cached.
         */
        let beforeDigest: { size: number; sha256: string } | undefined
        try {
          if (this.cache !== undefined && target.location !== undefined) {
            const options = this.options.warmCache
            if (options !== undefined) {
              beforeDigest = await fingerprintArtifact(target.location, {
                sourceRoot: options.sourceRoot,
                ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
                ...(signal === undefined ? {} : { signal }), counters: this.io,
              })
              this.guard(scope, signal)
            }
          }
          /**
           * A resumed stage belongs to an OLDER set of bytes.
           *
           * The stage survives across passes, but its partition was filled from
           * the artifact as it looked then. If the digest now differs — including
           * a content change in place under the same opaque revision — reusing it
           * would publish old prefix rows next to fresh tail rows and then cache
           * that mixture. Discard it and re-read this Session from zero.
           */
          if (stage !== undefined && beforeDigest !== undefined
            && (stage.digest === undefined || stage.digest.sha256 !== beforeDigest.sha256 || stage.digest.size !== beforeDigest.size)) {
            this.discard(stage)
            stage = undefined
            this.cacheNote('warm-cache-stage-reset')
          }
          handle = await scope.backend.open(SessionId(target.id), 'read', { signal })
          this.guard(scope, signal)
          const inherited = handle.inheritedEventCount
          if (handle.id !== target.id || handle.access !== 'read' || !integer(inherited)
            || (!target.seeded && inherited !== 0) || (target.eventCount !== undefined && inherited > target.eventCount)) throw Error('invalid handle metadata')
          stage = this.stage(target, inherited)
          // Bind the partition to the bytes it is about to be read from.
          if (beforeDigest !== undefined) stage.digest = beforeDigest
          this.passSessions += 1
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
          for (let pageIndex = 0; pageIndex < this.limits.pagesPerHandle && !done && readCount < maxEvents; pageIndex++) {
            // Recomputed per page, NOT once per handle: a backend that declares
            // one event for a long log would otherwise cap every page in the
            // slice at one event and make a full corpus look starved (D-030).
            const declaredRemaining = target.eventCount === undefined ? undefined : target.eventCount - stage.next
            // We have already read MORE than the backend claims exists. Record it
            // once (this is the multi-frame under-report) and keep reading: the
            // declared count must never truncate the scan or stall the loop.
            if (declaredRemaining !== undefined && declaredRemaining < 0) {
              stage.part.addGap('event-count-underreported')
            }
            // A declared count only ever CAPS a page; it never caps the scan.
            // A non-positive declaration (the multi-frame case reports 1, and a
            // broken backend may report 0) carries no information, so it falls
            // back to the normal page size instead of throttling the read to one
            // event per round trip.
            const cap = declaredRemaining !== undefined && declaredRemaining > 0
              ? declaredRemaining
              : this.limits.pageSize
            const remainingInPass = maxEvents - readCount
            const length = Math.min(this.limits.pageSize, remainingInPass, cap)
            // A zero-length read would be a no-op page that some backends could
            // report as EOF; stop the slice instead and let the pass end normally.
            if (length < 1) break
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
            this.passReadEvents += page.events.length
            this.passPages += 1
            if (stage.next > this.passCut) this.passCut = stage.next
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
            // TG-08: the partition itself may have stopped reserving (its own
            // capacity, or the shared ledger). Continuing to read pages for it
            // would burn decode work on events that can never be retained, so the
            // slice ends with an explicit, recoverable reason instead.
            if (stage.part.snapshot(stage.next).reasons.includes('index-capacity')) { capacity = true; break }
          }
          // Reaching the slice limit or the pass budget with events still on the
          // log is NOT an error and NOT EOF: the stage stays resumable.
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
            stage.resumable = false
            this.publish(stage)
            // Only a full EOF read of this Session may write a cache entry, and
            // only when the artifact really has a public location to bind AND it
            // is provably the same revision this read observed. The post-read
            // stat is this instance's own evidence that nothing moved under the
            // read; a changed revision means the cut describes an older log.
            await this.saveWarm(scope, target, stage, after?.location, signal, beforeDigest,
              after.revision === target.revision)
          }
        } else if (!failed && stage) {
          // Read a bounded slice, log not exhausted. Keep the partition so the
          // next pass continues at `next` (no re-read of the retained prefix) and
          // publish the verified prefix NOW, so a long scan is never invisible.
          stage.resumable = true
          this.checkpoint(stage)
          // Not exhausted means still owed work: the Session stays pending so the
          // follow-up pass resumes it and the UI can count the real backlog.
          this.pending.add(target.id)
          if (capacity) {
            capacityPaused = true
            this.gap('index-capacity')
            this.gap('scan-paused-capacity')
            break
          }
          if (readCount >= maxEvents) budgetStopped = true
          // The deferred target goes to the END of the queue: a Session whose
          // slice just ran must not immediately take the next slice, or one huge
          // log would alternate only with itself.
          queue.push(target)
        } else if (!failed) {
          queue.push(target)
        }
        this.fairCursor = targets.length ? (targets.findIndex(item => item.id === target.id) + 1) % targets.length : 0
        // Yield between slices, not between every page: `setTimeout(0)` has a
        // ~15ms floor on Windows, so yielding per page turned a fast local read
        // into a visibly slow scan.
        await (this.options.yield ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0))))()
      }
      // Warm-cache flush at pass end.
      //
      // Derived from what this pass actually PUBLISHED (never from a superseded
      // stage), so a child read before its parent still gets an entry once the
      // parent's digest exists, and an entry that was deferred in an earlier pass
      // gets retried here instead of being lost forever.
      await this.flushWarmEntries(scope, signal)
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
      //
      // TG-09: the phase must describe what REALLY happened. A pass that stopped
      // on the event budget or on a capacity reservation still has work left, so
      // it ends `partial` with a fixed reason — never `complete` with a
      // "still pending" note, which is what let the UI claim completion while
      // Sessions were unread, and never a silent stop.
      this.phase = capacityPaused || budgetStopped ? 'partial' : 'complete'
      if (capacityPaused) { this.paused = true; this.gap('scan-paused-capacity') }
      if (this.pending.size) this.gap('scan-pending')
      if (this.phase === 'partial' && !capacityPaused) this.gap('scan-budget')
      // Progress is only what advanced WITHIN an unchanged revision.
      //
      // The live STAGE is authoritative when one exists: while an old complete
      // partition is preserved, the published entry still says revision r1 cut 100,
      // so reading the publish side would hide r2's real advance entirely (and,
      // conversely, folding max(oldCut, newNext) into a sum would MASK it). A new
      // revision or a first sighting only sets the baseline and contributes 0, so
      // a re-listed Session cannot mask its own work and churn cannot fake it.
      let progress = 0
      const progressIds = new Set([...this.published.keys(), ...this.stages.keys()])
      for (const id of progressIds) {
        const stage = this.stages.get(id)
        const revision = stage?.target.revision ?? this.published.get(id)?.value.revision ?? ''
        const cut = stage !== undefined ? stage.next : (this.published.get(id)?.value.cut ?? 0)
        const prior = this.progressBase.get(id)
        if (prior !== undefined && prior.revision === revision && cut > prior.cut) progress += cut - prior.cut
        this.progressBase.set(id, { revision, cut })
      }
      // Evict bookkeeping for Sessions that left the visible corpus.
      for (const id of [...this.progressBase.keys()]) if (!this.visible.has(id)) this.progressBase.delete(id)
      this.progressEvents = Number.isFinite(progress) ? progress : 0
      // Exhaustion is a property of the DATA, counted independently of coverage.
      this.exhaustedCount = [...this.published.values()].filter(entry => entry.exhausted).length
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
    const sessions = entries.map(([id, entry]) => ({
      sessionId: id,
      ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
      revision: entry.value.revision,
      cut: entry.value.cut,
      // A Session still being read forward cannot claim complete coverage even
      // when everything up to its checkpoint cut is intact.
      coverage: entry.exhausted ? entry.value.coverage : 'partial' as const,
      stale: this.pending.has(id) || this.failures.has(id),
      reasons: [...entry.value.reasons],
    }))
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
      // Per-pass progress, kept separate from the cumulative counters above so
      // "this pass read 57344 events and published nothing yet" is readable.
      passReadEvents: finite(this.passReadEvents),
      passReadSessions: finite(this.passSessions),
      passPages: finite(this.passPages),
      passCut: finite(this.passCut),
      /**
       * Total verified forward-scanned events: published cuts plus the cursor of
       * every stage still in flight, taking the further of the two per Session so
       * one partition is never counted twice.
       *
       * This is a CUMULATIVE index figure, not a progress measure — see
       * `progressEvents` for what the scheduler uses.
       */
      scannedEvents: finite([...new Set([...entries.map(([id]) => id), ...this.stages.keys()])]
        .reduce((sum, id) => {
          const cut = this.published.get(id)?.value.cut ?? 0
          const next = this.stages.get(id)?.next ?? 0
          return sum + Math.max(finite(cut), finite(next))
        }, 0)),
      /** Sessions read through EOF, regardless of coverage gaps. */
      exhaustedSessions: finite(this.exhaustedCount),
      /**
       * Verified forward progress of the last finished pass, in events, within a
       * stable revision. A revision change re-baselines and contributes 0, which
       * is what keeps a churning revision from looking like infinite progress and
       * a new revision's baseline from masking its own later advance.
       */
      progressEvents: finite(this.progressEvents),
      // A pass that stopped on capacity is RESUMABLE, not failed, and says so.
      paused: this.paused === true,
      estimatedBytes: finite(this.ledger.used), reasons: [...this.reasons], sessions, rows,
      totals: { calls: counted.length, succeeded: counted.filter(row => row.outcome === 'success').length, failed: counted.filter(row => row.outcome === 'error').length, unresolved: counted.filter(row => row.outcome === 'unresolved').length, unknown: counted.filter(row => row.outcome === 'unknown').length, cancelled: counted.filter(row => row.outcome === 'cancelled').length, running: counted.filter(row => row.outcome === 'running').length, inherited: retained.length - counted.length },
    }
  }
}
