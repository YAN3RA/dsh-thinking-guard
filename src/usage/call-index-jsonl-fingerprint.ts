/**
 * Read-only content fingerprints for persisted Session artifacts.
 *
 * Why this exists: the call index wants a warm start that does NOT decode a log
 * body. Public `list`/`stat` already give us a backend-resolved
 * `location.path` plus an OPAQUE `revision`; the revision is only comparable
 * inside one service instance, so it can never authorize a cross-instance cache
 * hit. The only durable, portable evidence that an artifact is the same one the
 * cache was built from is a CONTENT digest, computed here without decoding.
 *
 * Boundaries that make the digest trustworthy:
 * - the path must resolve (realpath, so junctions/symlinks anywhere in the chain
 *   are resolved) inside an explicitly configured `sourceRoot`;
 * - the target itself must be a regular file, not a link, and inside size limits;
 * - bytes are streamed through SHA-256 from ONE open handle, and the file
 *   identity observed by `fstat` before the read must still hold after it;
 * - the path is stat'ed again after the handle closes, so a replacement between
 *   "we hashed it" and "the cache would trust it" is refused.
 *
 * Decode accounting is deliberately separate from I/O accounting: this module
 * never decompresses anything, so it reports `headerFrameDecodes: 0` and
 * `fullLogDecodes: 0` while still counting every byte and every open/stat. A
 * caller that also ran the backend's `list` adds its header-frame decodes to the
 * same counters, which is what keeps "0 full-log decodes" from being confused
 * with "0 bytes read".
 */
import { createHash } from 'node:crypto'
import { open, lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Backend-resolved artifact location, as exposed by the public snapshot. */
export interface ArtifactLocation {
  readonly kind: string
  readonly path: string
}

/**
 * Observable work counters.
 *
 * Decode counters are never incremented here; they exist so the caller can keep
 * header-frame and full-log decodes in separate columns next to real I/O.
 */
export interface ArtifactIoCounters {
  openCalls: number
  statCalls: number
  bytesRead: number
  /**
   * Zstandard frames this FINGERPRINT path decoded.
   *
   * Structurally 0: hashing reads bytes and never decompresses. The backend's own
   * header-frame work during `list`/`stat` is separate and is NOT counted here.
   */
  fingerprintHeaderFrameDecodes: number
  /**
   * Whole-log decodes performed by this fingerprint path.
   *
   * Always 0 by construction. This is deliberately named after the path it
   * measures: it is NOT a measurement of the Host, and must never be reported as
   * "the warm start decoded nothing".
   */
  fingerprintFullLogDecodes: number
}

export function createArtifactIoCounters(): ArtifactIoCounters {
  return { openCalls: 0, statCalls: 0, bytesRead: 0, fingerprintHeaderFrameDecodes: 0, fingerprintFullLogDecodes: 0 }
}

/** Digest binding one artifact revision; never carries the path itself. */
export interface ArtifactDigest {
  readonly size: number
  readonly sha256: string
}

export interface FingerprintOptions {
  /** Explicitly authorized read root; a path outside it is refused, not clamped. */
  readonly sourceRoot: string
  /** Refuse larger artifacts instead of hashing an unbounded file. */
  readonly maxBytes?: number
  readonly signal?: AbortSignal
  readonly counters?: ArtifactIoCounters
  readonly chunkBytes?: number
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_CHUNK_BYTES = 64 * 1024
const MAX_PATH_LENGTH = 4096
const HEX64 = /^[0-9a-f]{64}$/

/** Whether a value is a well-formed lowercase SHA-256 hex digest. */
export function isDigest(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value)
}

/** Case-fold Windows paths so a drive-letter or case difference cannot slip past. */
function fold(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/**
 * Strict containment test: the target must be strictly BELOW the root.
 *
 * `relative` is computed on case-folded values and any '..' segment refuses, so
 * neither a sibling sharing a name prefix (`C:\\root2` vs `C:\\root`) nor a
 * trailing-separator trick can pass.
 */
function strictlyInside(root: string, target: string): boolean {
  const foldedRoot = fold(root)
  const foldedTarget = fold(target)
  if (foldedTarget === foldedRoot) return false
  const rel = relative(foldedRoot, foldedTarget)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return false
  return !rel.split(sep).includes('..')
}

/**
 * Hash one artifact under `sourceRoot`, or return `undefined` when the artifact
 * cannot be bound with certainty.
 *
 * Absence, an out-of-root path, a non-regular file, an oversized file, and any
 * identity change during the read all return `undefined` — the caller then
 * falls back to a normal scan. Cancellation propagates instead, because a
 * cancelled pass must not look like "unverifiable".
 */
export async function fingerprintArtifact(
  location: unknown,
  options: FingerprintOptions,
): Promise<ArtifactDigest | undefined> {
  const { sourceRoot, signal, counters } = options
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  if (typeof sourceRoot !== 'string' || sourceRoot.trim().length === 0) return undefined
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) return undefined
  if (typeof chunkBytes !== 'number' || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1) return undefined
  if (typeof location !== 'object' || location === null) return undefined
  const raw = location as { kind?: unknown; path?: unknown }
  // Only the JSONL backend exposes a per-Session artifact; every other kind has
  // no path contract to bind against, so it stays uncacheable rather than guessed.
  if (raw.kind !== 'jsonl') return undefined
  if (typeof raw.path !== 'string') return undefined
  if (raw.path.length === 0 || raw.path.length > MAX_PATH_LENGTH || raw.path.includes('\u0000')) return undefined

  const rootLexical = resolve(sourceRoot)
  const targetLexical = resolve(raw.path)
  // Lexical containment first: a sibling sharing a name prefix never reaches disk.
  if (!strictlyInside(rootLexical, targetLexical)) return undefined

  signal?.throwIfAborted()
  let rootReal: string
  let targetReal: string
  try {
    counters && (counters.statCalls += 1)
    rootReal = await realpath(rootLexical)
    signal?.throwIfAborted()
    counters && (counters.statCalls += 1)
    targetReal = await realpath(targetLexical)
    signal?.throwIfAborted()
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
  /**
   * No redirection ANYWHERE in the chain.
   *
   * `realpath` resolves symlinks and Windows junctions in every component, so
   * requiring the canonical path to equal the lexical path is what refuses a
   * reparse point that stays inside the root (still an aliasing hazard: the file
   * we hash could be swapped later through the link) as well as one that escapes
   * it. The authorized root itself must be canonical too, otherwise containment
   * would be measured against a path the OS does not actually use.
   */
  if (fold(rootReal) !== fold(rootLexical) || fold(targetReal) !== fold(targetLexical)) return undefined
  if (!strictlyInside(rootReal, targetReal)) return undefined

  let link: Awaited<ReturnType<typeof lstat>>
  try {
    counters && (counters.statCalls += 1)
    link = await lstat(targetReal)
    signal?.throwIfAborted()
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
  // The final component must be the file itself, never a link to something else.
  if (link.isSymbolicLink() || !link.isFile()) return undefined
  if (link.size <= 0 || link.size > maxBytes) return undefined

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    counters && (counters.openCalls += 1)
    handle = await open(targetReal, 'r')
    signal?.throwIfAborted()
    counters && (counters.statCalls += 1)
    const before = await handle.stat({ bigint: true })
    signal?.throwIfAborted()
    if (!before.isFile() || before.size !== BigInt(link.size)) return undefined
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(chunkBytes)
    let total = 0
    for (;;) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      total += bytesRead
      if (counters) counters.bytesRead += bytesRead
      if (total > link.size) return undefined
    }
    signal?.throwIfAborted()
    if (total !== link.size) return undefined
    counters && (counters.statCalls += 1)
    const after = await handle.stat({ bigint: true })
    signal?.throwIfAborted()
    // Identity drift during the read means the bytes hashed are not the bytes the
    // caller will read next; refuse rather than publish a digest for a moving file.
    if (after.size !== before.size || after.ino !== before.ino || after.mtimeNs !== before.mtimeNs) return undefined
    const sha256 = hash.digest('hex')
    // Path reuse check: the digest is only usable if the path still names the
    // same inode/size/mtime after the handle closed.
    counters && (counters.statCalls += 1)
    const afterClose = await stat(targetReal, { bigint: true })
    signal?.throwIfAborted()
    if (afterClose.ino !== before.ino || afterClose.size !== before.size || afterClose.mtimeNs !== before.mtimeNs) return undefined
    return { size: Number(before.size), sha256 }
  } catch {
    signal?.throwIfAborted()
    return undefined
  } finally {
    if (handle) try { await handle.close() } catch { /* A failed close cannot change the verdict. */ }
  }
}
