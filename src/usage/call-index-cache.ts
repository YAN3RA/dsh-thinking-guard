/**
 * Opt-in, on-disk warm cache for the call index.
 *
 * The cache exists for ONE purpose: after a Host restart, a Session whose
 * artifact is byte-for-byte the one the index already read does not have to be
 * read again. It is deliberately narrow:
 *
 * - only Sessions whose log reached EOF are written (`exhausted`); a partial
 *   coverage caused by a backend under-report is still cacheable, because the
 *   log really was read to its end;
 * - the entry stores a fixed METADATA allowlist — rows, cut, coverage, reasons,
 *   header allowlist and artifact digests. Never call arguments, results, message
 *   bodies, raw error text, backend identity or auth tokens;
 * - restoring never fabricates raw events or feeds a partition: a restored entry
 *   is a read-only row set, and any live change to that Session drops it and
 *   rebuilds from zero on disk;
 * - a digest is only trusted after re-verifying the artifact (and every ancestor
 *   artifact of a fork chain) at restore time;
 * - a corrupt manifest or shard is left on disk untouched and simply ignored.
 *
 * Files are addressed by a hash of the Session id, never by a stored path, so the
 * cache directory cannot leak the original corpus layout.
 */
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallIndexRow } from './call-index-core.ts'
import { CALL_INDEX_OUTCOMES, CALL_INDEX_SOURCE_KINDS, type CallIndexOutcome, type CallIndexSourceKind } from './call-index-wire.ts'
import { isDigest, type ArtifactDigest, type ArtifactLocation } from './call-index-jsonl-fingerprint.ts'

/** Bumped when the stored shape changes; an old schema is ignored, never migrated. */
export const CALL_INDEX_CACHE_SCHEMA = 1
/** Bumped when the row projection changes meaning, so old rows cannot be replayed. */
export const CALL_INDEX_CACHE_PROJECTION = 1

const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_SHARD_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 5000
const MAX_ROWS = 100_000
const MAX_REASONS = 32
const MAX_ID_LENGTH = 512
const MAX_CWD_LENGTH = 4096
const MAX_LINEAGE = 32
const MAX_ARTIFACTS = 4
const HEX64 = /^[0-9a-f]{64}$/

/** Header fields allowed to leave the Host; nothing else from the header is stored. */
export interface CachedHeader {
  readonly cwd?: string
  readonly isSeeded: boolean
  readonly parentSession?: string
  readonly inheritedEventCount: number
}

/** One ancestor of a fork chain, bound by its artifact digest. */
export interface CachedLineageLink {
  readonly sessionId: string
  readonly sha256: string
}

/** A fully validated, restorable Session entry. Immutable by construction. */
export interface CachedEntry {
  readonly schemaVersion: number
  readonly projectionVersion: number
  readonly sessionId: string
  readonly coverage: 'complete' | 'partial'
  /**
   * EOF evidence: the log really was read to its end.
   *
   * Required, not implied by a non-empty row set. A Session with zero business
   * calls (header-only, or events that project to no row) is perfectly legal and
   * still reaches EOF; without this marker the only way to express it would be an
   * empty row list, which is indistinguishable from "nothing was read".
   */
  readonly exhausted: true
  readonly cut: number
  readonly header: CachedHeader
  readonly artifacts: readonly ArtifactDigest[]
  readonly lineage: readonly CachedLineageLink[]
  readonly rows: readonly CallIndexRow[]
  readonly reasons: readonly string[]
}

/** Manifest entry: just enough to find and pre-filter a shard. */
interface ManifestEntry {
  readonly sessionId: string
  readonly shard: string
  readonly size: number
  readonly sha256: string
}

interface Manifest {
  readonly schemaVersion: number
  readonly projectionVersion: number
  readonly entries: readonly ManifestEntry[]
}

export interface CallIndexCacheOptions {
  /** Explicit cache directory; the cache is inactive when absent. */
  readonly dir: string
  readonly onWriteError?: (reason: string) => void
}

/** Stable shard file name; a hash, so no corpus path or session id becomes a path. */
export function shardName(sessionId: string): string {
  return createHash('sha256').update('call-index-cache:' + sessionId).digest('hex') + '.json'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const boundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

function isOutcome(value: unknown): value is CallIndexOutcome {
  return typeof value === 'string' && (CALL_INDEX_OUTCOMES as readonly string[]).includes(value)
}

function isSourceKind(value: unknown): value is CallIndexSourceKind {
  return typeof value === 'string' && (CALL_INDEX_SOURCE_KINDS as readonly string[]).includes(value)
}

/** Validate one row against the closed metadata allowlist; anything extra refuses the shard. */
function parseRow(value: unknown): CallIndexRow | undefined {
  if (!isRecord(value)) return undefined
  const allowed = new Set([
    'sessionId', 'callSeq', 'callId', 'toolName', 'turn', 'step', 'startedAt',
    'endedAt', 'resultSeq', 'durationMs', 'outcome', 'inherited', 'sourceKind', 'layer',
  ])
  for (const key of Object.keys(value)) if (!allowed.has(key)) return undefined
  if (!boundedString(value.sessionId, MAX_ID_LENGTH)) return undefined
  if (!isCount(value.callSeq)) return undefined
  if (!boundedString(value.callId, MAX_ID_LENGTH)) return undefined
  if (!boundedString(value.toolName, MAX_ID_LENGTH)) return undefined
  if (!isCount(value.startedAt)) return undefined
  if (!isOutcome(value.outcome)) return undefined
  if (typeof value.inherited !== 'boolean') return undefined
  if (!isSourceKind(value.sourceKind)) return undefined
  if (value.layer !== 'unknown') return undefined
  const optionalCount = (field: unknown): boolean => field === undefined || isCount(field)
  if (!optionalCount(value.turn) || !optionalCount(value.step) || !optionalCount(value.endedAt)
    || !optionalCount(value.resultSeq) || !optionalCount(value.durationMs)) return undefined
  return {
    sessionId: value.sessionId,
    callSeq: value.callSeq,
    callId: value.callId,
    toolName: value.toolName,
    ...(value.turn === undefined ? {} : { turn: value.turn as number }),
    ...(value.step === undefined ? {} : { step: value.step as number }),
    startedAt: value.startedAt,
    ...(value.endedAt === undefined ? {} : { endedAt: value.endedAt as number }),
    ...(value.resultSeq === undefined ? {} : { resultSeq: value.resultSeq as number }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs as number }),
    outcome: value.outcome,
    inherited: value.inherited,
    sourceKind: value.sourceKind,
    layer: 'unknown',
  }
}

function parseDigest(value: unknown): ArtifactDigest | undefined {
  if (!isRecord(value)) return undefined
  if (Object.keys(value).some(key => key !== 'size' && key !== 'sha256')) return undefined
  if (!isCount(value.size) || value.size < 1) return undefined
  if (!isDigest(value.sha256)) return undefined
  return { size: value.size, sha256: value.sha256 }
}

function parseHeader(value: unknown): CachedHeader | undefined {
  if (!isRecord(value)) return undefined
  if (Object.keys(value).some(key => !['cwd', 'isSeeded', 'parentSession', 'inheritedEventCount'].includes(key))) return undefined
  if (typeof value.isSeeded !== 'boolean') return undefined
  if (!isCount(value.inheritedEventCount)) return undefined
  if (value.cwd !== undefined && (typeof value.cwd !== 'string' || value.cwd.length > MAX_CWD_LENGTH)) return undefined
  if (value.parentSession !== undefined && !boundedString(value.parentSession, MAX_ID_LENGTH)) return undefined
  return {
    ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    isSeeded: value.isSeeded,
    ...(value.parentSession === undefined ? {} : { parentSession: value.parentSession }),
    inheritedEventCount: value.inheritedEventCount,
  }
}

/**
 * Validate one shard document.
 *
 * Every failure returns `undefined`; nothing is repaired and the file is not
 * touched, so a bad shard costs one re-read of that Session, not the corpus.
 */
export function parseCachedEntry(value: unknown, sessionId: string): CachedEntry | undefined {
  if (!isRecord(value)) return undefined
  const allowed = new Set(['schemaVersion', 'projectionVersion', 'sessionId', 'coverage', 'exhausted', 'cut', 'header', 'artifacts', 'lineage', 'rows', 'reasons'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) return undefined
  if (value.schemaVersion !== CALL_INDEX_CACHE_SCHEMA) return undefined
  if (value.projectionVersion !== CALL_INDEX_CACHE_PROJECTION) return undefined
  if (value.sessionId !== sessionId) return undefined
  if (value.coverage !== 'complete' && value.coverage !== 'partial') return undefined
  // Missing EOF evidence is refused: a shard that cannot prove the log was read
  // to its end must not authorize a warm hit.
  if (value.exhausted !== true) return undefined
  if (!isCount(value.cut)) return undefined
  const header = parseHeader(value.header)
  if (header === undefined) return undefined
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0 || value.artifacts.length > MAX_ARTIFACTS) return undefined
  const artifacts: ArtifactDigest[] = []
  for (const item of value.artifacts) {
    const digest = parseDigest(item)
    if (digest === undefined) return undefined
    artifacts.push(digest)
  }
  if (!Array.isArray(value.lineage) || value.lineage.length > MAX_LINEAGE) return undefined
  const lineage: CachedLineageLink[] = []
  for (const item of value.lineage) {
    if (!isRecord(item) || Object.keys(item).some(key => key !== 'sessionId' && key !== 'sha256')) return undefined
    if (!boundedString(item.sessionId, MAX_ID_LENGTH) || !isDigest(item.sha256)) return undefined
    lineage.push({ sessionId: item.sessionId, sha256: item.sha256 })
  }
  if (!Array.isArray(value.rows) || value.rows.length > MAX_ROWS) return undefined
  const rows: CallIndexRow[] = []
  for (const item of value.rows) {
    const row = parseRow(item)
    if (row === undefined) return undefined
    if (row.sessionId !== sessionId) return undefined
    rows.push(row)
  }
  if (!Array.isArray(value.reasons) || value.reasons.length > MAX_REASONS) return undefined
  const reasons: string[] = []
  for (const item of value.reasons) {
    if (typeof item !== 'string' || item.length > 64 || !/^[a-z][a-z0-9-]*$/.test(item)) return undefined
    if (!reasons.includes(item)) reasons.push(item)
  }
  return Object.freeze({
    schemaVersion: CALL_INDEX_CACHE_SCHEMA,
    projectionVersion: CALL_INDEX_CACHE_PROJECTION,
    sessionId,
    coverage: value.coverage,
    exhausted: true,
    cut: value.cut,
    header: Object.freeze(header),
    artifacts: Object.freeze(artifacts),
    lineage: Object.freeze(lineage),
    rows: Object.freeze(rows),
    reasons: Object.freeze(reasons),
  })
}

/** What a successful scan hands to {@link CallIndexCache.save}. */
export interface CacheWriteRequest {
  readonly sessionId: string
  readonly coverage: 'complete' | 'partial'
  /** Only an EOF (exhausted) read may be cached; the writer states it explicitly. */
  readonly exhausted: true
  readonly cut: number
  readonly header: CachedHeader
  readonly artifacts: readonly ArtifactDigest[]
  readonly lineage: readonly CachedLineageLink[]
  readonly rows: readonly CallIndexRow[]
  readonly reasons: readonly string[]
  /** Session/scope epoch captured when the scan began; a stale write is dropped. */
  readonly epoch: number
  readonly isCurrent: () => boolean
}

/**
 * Serialized, best-effort cache writer.
 *
 * One write queue: shards are written and renamed one at a time so a crash can
 * never leave a manifest naming a half-written shard. A write failure only marks
 * the cache degraded — it never reaches the tool surface, and nothing on disk is
 * deleted.
 */
export class CallIndexCache {
  private readonly dir: string
  private readonly shardsDir: string
  private readonly onWriteError?: (reason: string) => void
  private manifest: Manifest | undefined
  private loaded = false
  private disposed = false
  private queue: Promise<void> = Promise.resolve()
  private readonly known = new Map<string, ManifestEntry>()
  private writes = 0
  private rejects = 0
  /**
   * Set when the on-disk manifest could not be read or validated.
   *
   * A degraded cache still answers reads (a valid shard may exist) but refuses to
   * write, so the damaged document is preserved for inspection instead of being
   * overwritten by the next scan.
   */
  private degraded = false

  constructor(options: CallIndexCacheOptions) {
    this.dir = options.dir
    this.shardsDir = join(options.dir, 'shards')
    this.onWriteError = options.onWriteError
  }

  /** Counters for tests and diagnostics; never sent to the browser. */
  counters(): { writes: number; rejects: number; known: number } {
    return { writes: this.writes, rejects: this.rejects, known: this.known.size }
  }

  /**
   * Read one cache file with a REAL size limit.
   *
   * The limit has to be enforced BEFORE allocation: `readFile` would happily
   * buffer an arbitrarily large document and only then let a caller notice. This
   * opens the file, stats it, refuses anything that is not a regular file of an
   * acceptable size (so a symlink or a directory can never be followed into the
   * process), and only then allocates exactly that many bytes.
   */
  private async readBounded(path: string, maxBytes: number): Promise<string | undefined> {
    let link
    try {
      link = await lstat(path)
    } catch {
      return undefined
    }
    // No symlink/junction anywhere at the leaf: the cache writes regular files.
    if (link.isSymbolicLink() || !link.isFile()) return undefined
    if (link.size <= 0 || link.size > maxBytes) return undefined
    let handle
    try {
      handle = await open(path, 'r')
      const info = await handle.stat()
      if (!info.isFile() || info.size <= 0 || info.size > maxBytes) return undefined
      // The stat that decided the allocation and the bytes actually read must
      // describe the same size, or a growing file could overrun the buffer.
      if (info.size !== link.size) return undefined
      const buffer = Buffer.alloc(info.size)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead !== buffer.length) return undefined
      return buffer.toString('utf8')
    } catch {
      return undefined
    } finally {
      if (handle) try { await handle.close() } catch { /* Read verdict already decided. */ }
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const text = await this.readBounded(join(this.dir, 'manifest.json'), MAX_MANIFEST_BYTES)
      if (text === undefined) {
        // Distinguish "first run, no manifest" (normal) from "a manifest exists
        // but could not be used" (degraded: never overwrite it).
        this.degraded = await this.manifestExists()
        return
      }
      // A manifest that exists but does not validate in ANY way — including
      // well-formed JSON of the wrong shape — degrades the cache. Returning
      // quietly would let the next scan overwrite a document an operator may
      // still need to inspect.
      const entries = parseManifest(text)
      if (entries === undefined) { this.degraded = true; return }
      this.manifest = { schemaVersion: CALL_INDEX_CACHE_SCHEMA, projectionVersion: CALL_INDEX_CACHE_PROJECTION, entries }
      for (const entry of entries) this.known.set(entry.sessionId, entry)
    } catch (error) {
      // An ABSENT manifest is the normal first run. A manifest that exists but
      // cannot be validated degrades the cache: it stays on disk untouched and
      // this instance stops writing, so damage is never silently overwritten.
      this.manifest = undefined
      if (!isNotFound(error)) this.degraded = true
    }
  }

  /** Whether a manifest file is present at all; only distinguishes absent vs damaged. */
  private async manifestExists(): Promise<boolean> {
    try {
      const link = await lstat(join(this.dir, 'manifest.json'))
      return link.isFile() || link.isSymbolicLink()
    } catch {
      return false
    }
  }

  /** Whether a manifest entry exists for this Session (cheap pre-filter). */
  async has(sessionId: string): Promise<boolean> {
    await this.ensureLoaded()
    return this.known.has(sessionId)
  }

  /** Read and validate one shard, or `undefined` when it is absent or unusable. */
  async load(sessionId: string): Promise<CachedEntry | undefined> {
    if (this.disposed) return undefined
    await this.ensureLoaded()
    const entry = this.known.get(sessionId)
    if (entry === undefined) return undefined
    try {
      // Bounded read: the declared shard size is a LIMIT checked before the
      // allocation, not a number verified after the whole file was buffered.
      const text = await this.readBounded(join(this.shardsDir, entry.shard), Math.min(entry.size, MAX_SHARD_BYTES))
      if (text === undefined || Buffer.byteLength(text, 'utf8') !== entry.size) { this.rejects += 1; return undefined }
      if (createHash('sha256').update(text).digest('hex') !== entry.sha256) { this.rejects += 1; return undefined }
      const parsed = parseCachedEntry(JSON.parse(text), sessionId)
      if (parsed === undefined) { this.rejects += 1; return undefined }
      return parsed
    } catch {
      this.rejects += 1
      return undefined
    }
  }

  /** Queue one durable write. Returns a promise that settles when the queue reaches it. */
  save(request: CacheWriteRequest): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.degraded) { this.rejects += 1; return Promise.resolve() }
    const run = this.queue.then(async () => {
      // Re-check the epoch INSIDE the queued task: a write queued before a scope
      // change must never be committed after it.
      if (this.disposed || !request.isCurrent()) return
      try {
        await this.commit(request)
        this.writes += 1
      } catch {
        this.rejects += 1
        this.onWriteError?.('cache-write-failed')
      }
    })
    this.queue = run.catch(() => {})
    return run
  }

  private async commit(request: CacheWriteRequest): Promise<void> {
    const entry: CachedEntry = Object.freeze({
      schemaVersion: CALL_INDEX_CACHE_SCHEMA,
      projectionVersion: CALL_INDEX_CACHE_PROJECTION,
      sessionId: request.sessionId,
      coverage: request.coverage,
      exhausted: true,
      cut: request.cut,
      header: request.header,
      artifacts: request.artifacts,
      lineage: request.lineage,
      rows: request.rows,
      reasons: request.reasons,
    })
    // Round-trip through the validator before writing: a shard that would be
    // refused on read is never written in the first place.
    const text = JSON.stringify(entry)
    if (Buffer.byteLength(text, 'utf8') > MAX_SHARD_BYTES) return
    if (parseCachedEntry(JSON.parse(text), request.sessionId) === undefined) return
    await mkdir(this.shardsDir, { recursive: true })
    const shard = shardName(request.sessionId)
    const shardPath = join(this.shardsDir, shard)
    // Unique per write: a pid alone would collide between two instances in the
    // same process (and two hosts can share a pid across containers).
    const tmpShard = shardPath + '.' + randomBytes(8).toString('hex') + '.tmp'
    await writeFileDurable(tmpShard, text)
    if (this.disposed || !request.isCurrent()) { await rm(tmpShard, { force: true }); return }
    await rename(tmpShard, shardPath)
    const entryMeta: ManifestEntry = {
      sessionId: request.sessionId,
      shard,
      size: Buffer.byteLength(text, 'utf8'),
      sha256: createHash('sha256').update(text).digest('hex'),
    }
    this.known.set(request.sessionId, entryMeta)
    const entries = [...this.known.values()]
    if (entries.length > MAX_ENTRIES) { this.known.delete(request.sessionId); return }
    const manifest: Manifest = { schemaVersion: CALL_INDEX_CACHE_SCHEMA, projectionVersion: CALL_INDEX_CACHE_PROJECTION, entries }
    const manifestText = JSON.stringify(manifest)
    if (Buffer.byteLength(manifestText, 'utf8') > MAX_MANIFEST_BYTES) { this.known.delete(request.sessionId); return }
    const manifestPath = join(this.dir, 'manifest.json')
    const tmpManifest = manifestPath + '.' + randomBytes(8).toString('hex') + '.tmp'
    await mkdir(this.dir, { recursive: true })
    await writeFileDurable(tmpManifest, manifestText)
    if (this.disposed || !request.isCurrent()) { await rm(tmpManifest, { force: true }); return }
    await rename(tmpManifest, manifestPath)
    this.manifest = manifest
  }

  /** Resolve once every write queued so far has settled; never rejects. */
  async settled(): Promise<void> {
    await this.queue.catch(() => {})
  }

  /** Stop accepting writes and wait for the queue; pending files stay as they are. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.queue.catch(() => {})
  }

  /** True when a manifest was loaded; used only for diagnostics/tests. */
  hasManifest(): boolean {
    return this.manifest !== undefined
  }
}

/**
 * Validate a manifest document.
 *
 * Every failure — malformed JSON, wrong shape, wrong versions, an entry with an
 * unexpected key — returns `undefined`; nothing is repaired.
 */
function parseManifest(text: string): ManifestEntry[] | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return undefined }
  if (!isRecord(parsed)) return undefined
  if (Object.keys(parsed).some(key => key !== 'schemaVersion' && key !== 'projectionVersion' && key !== 'entries')) return undefined
  if (parsed.schemaVersion !== CALL_INDEX_CACHE_SCHEMA) return undefined
  if (parsed.projectionVersion !== CALL_INDEX_CACHE_PROJECTION) return undefined
  if (!Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES) return undefined
  const entries: ManifestEntry[] = []
  for (const item of parsed.entries) {
    if (!isRecord(item)) return undefined
    if (Object.keys(item).some(key => !['sessionId', 'shard', 'size', 'sha256'].includes(key))) return undefined
    if (!boundedString(item.sessionId, MAX_ID_LENGTH)) return undefined
    if (!boundedString(item.shard, 80) || !HEX64.test(item.shard.replace(/\.json$/, ''))) return undefined
    if (!isCount(item.size) || item.size <= 0 || item.size > MAX_SHARD_BYTES) return undefined
    if (!isDigest(item.sha256)) return undefined
    entries.push({ sessionId: item.sessionId, shard: item.shard, size: item.size, sha256: item.sha256 })
  }
  return entries
}

/** Whether a filesystem error means "this path does not exist". */
function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT'
}

/** Write a small text file through a handle so the rename publishes complete bytes. */
async function writeFileDurable(path: string, text: string): Promise<void> {
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Digest of one artifact under the authorized root, or `undefined`.
 *
 * Re-exported so callers do not have to import two modules for one concept.
 */
export type { ArtifactDigest, ArtifactLocation }
