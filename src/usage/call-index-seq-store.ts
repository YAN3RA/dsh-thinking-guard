/**
 * Compact sequence-evidence storage for CallIndexPartition.
 *
 * A partition must remember every observed `seq` long enough to reject a
 * duplicate (same metadata) or record a conflict (different metadata), and it
 * must know whether `[0, cut)` is contiguous without walking a potentially
 * huge numeric range. Keeping one JSON signature string per event under the old
 * `2 * JSON + 1024` accounting made an other-heavy log exhaust the default
 * budget before a single call could be published.
 *
 * This store retains the same information losslessly:
 * - one presence bit per sequence in chunks that stay sparse until a chunk
 *   becomes dense;
 * - the exact event time as a Float64 (finite fractional times are preserved,
 *   and -0 is normalized to +0 so it compares exactly like the old JSON form);
 * - interned canonical payload strings: one copy per distinct projected
 *   payload, referenced by a small integer id.
 *
 * Dedupe/conflict is exact, never a hash: two events with the same `seq`
 * conflict unless their normalized time and canonical payload are identical.
 * Fields outside the projected event were already ignored by the old
 * signature and stay ignored here. Unknown properties on the projected object
 * are likewise not part of the payload.
 *
 * The byte counter is a conservative model of the retained structure, not a
 * disguised constant: sparse chunks charge per real sparse entry, dense chunks
 * charge their typed-array footprint, and each distinct interned payload is
 * charged once. `estimate` therefore stays additive and bounded.
 */
import { Buffer } from 'node:buffer'

/** Projected event fields that participate in seq dedupe/conflict detection. */
export interface SeqStoreEvent {
  readonly seq: number
  readonly time: number
  readonly kind: string
  readonly turn?: number
  readonly step?: number
  readonly callId?: string
  readonly toolName?: string
  readonly outcome?: string
  readonly errorCode?: string
  readonly replacement?: boolean
  readonly turnClosed?: boolean
}

/** Result of asking the store how a new event relates to an existing seq. */
export type SeqStoreProbe =
  | { readonly status: 'same'; readonly bytes: 0 }
  | { readonly status: 'conflict'; readonly bytes: 0 }
  | { readonly status: 'new'; readonly bytes: number }

/**
 * Canonical projection payload for one event.
 *
 * The old partition hashed/compared `JSON.stringify([kind, seq, time, ...])`.
 * The seq is the store key, and time is stored separately as a Float64, so the
 * remaining fields are canonicalized here with exactly the old normalizations:
 * `undefined` and `null` collapse to `null`, false/undefined flags collapse
 * to `false`, and -0 becomes 0 through JSON number serialization.
 */
export function canonicalSeqPayload(event: SeqStoreEvent): string {
  return JSON.stringify([
    event.kind,
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

const CHUNK_BITS = 13
const CHUNK_SIZE = 1 << CHUNK_BITS
const PRESENT_BYTES = CHUNK_SIZE >>> 3
/** Presence bits + Float64 times + Int32 payload ids for a full chunk. */
const DENSE_BYTES = PRESENT_BYTES + CHUNK_SIZE * 12
/**
 * Keep a chunk sparse until this many entries. A 256-entry threshold promoted
 * far too early: a single promotion charge could deny a small remaining budget
 * even though the sparse form held hundreds of events cheaply. 1024 keeps the
 * promotion charge modest while still bounding per-chunk overhead.
 */
const SPARSE_LIMIT = 1_024
/** Conservative sparse entry: array slot + record + boxed numbers. */
const SPARSE_ENTRY_BYTES = 80
/** Conservative dense entry charge on top of the chunk's typed arrays. */
const DENSE_ENTRY_BYTES = 16
/** Map entry + chunk record overhead charged once per used chunk. */
const CHUNK_BASE_BYTES = 64
/** Interned-string map entry and string-object overhead. */
const PAYLOAD_OVERHEAD_BYTES = 32

function normalizeSeq(seq: number): number {
  return seq === 0 ? 0 : seq
}

function normalizeTime(time: number): number {
  return time === 0 ? 0 : time
}

function payloadBytes(payload: string): number {
  return 2 * Buffer.byteLength(payload, 'utf8') + PAYLOAD_OVERHEAD_BYTES
}

interface SparseEntry {
  offset: number
  time: number
  payloadId: number
}

interface SeqChunk {
  dense: boolean
  count: number
  sparse?: SparseEntry[]
  present?: Uint8Array
  times?: Float64Array
  payloadIds?: Int32Array
}

function newChunk(): SeqChunk {
  return { dense: false, count: 0, sparse: [] }
}

function findSparse(entries: readonly SparseEntry[], offset: number): SparseEntry | undefined {
  for (const entry of entries) if (entry.offset === offset) return entry
  return undefined
}

function denseEntry(chunk: SeqChunk, offset: number): SparseEntry | undefined {
  const present = chunk.present
  const times = chunk.times
  const ids = chunk.payloadIds
  if (present === undefined || times === undefined || ids === undefined) return undefined
  if ((present[offset >>> 3]! & (1 << (offset & 7))) === 0) return undefined
  return { offset, time: times[offset]!, payloadId: ids[offset]! }
}

function promoteChunk(chunk: SeqChunk): void {
  const entries = chunk.sparse ?? []
  const present = new Uint8Array(PRESENT_BYTES)
  const times = new Float64Array(CHUNK_SIZE)
  const payloadIds = new Int32Array(CHUNK_SIZE)
  for (const entry of entries) {
    present[entry.offset >>> 3]! |= 1 << (entry.offset & 7)
    times[entry.offset] = entry.time
    payloadIds[entry.offset] = entry.payloadId
  }
  chunk.dense = true
  chunk.sparse = undefined
  chunk.present = present
  chunk.times = times
  chunk.payloadIds = payloadIds
}

function chunkSlot(seq: number): { index: number; offset: number } {
  const index = Math.floor(seq / CHUNK_SIZE)
  return { index, offset: seq - index * CHUNK_SIZE }
}

/** Compact, exact seq-evidence store used by one CallIndexPartition. */
export class CallIndexSeqStore {
  private readonly chunks = new Map<number, SeqChunk>()
  private readonly payloadIdByKey = new Map<string, number>()
  private readonly payloadKeys: string[] = []
  private eventCount = 0
  private retainedBytes = 0
  /** Smallest seq not yet known present; capped at MAX_SAFE_INTEGER. */
  private contiguousThrough = 0

  get count(): number {
    return this.eventCount
  }

  get bytes(): number {
    return this.retainedBytes
  }

  /** Exact membership check for one safe non-negative seq. */
  has(seq: number): boolean {
    if (!Number.isSafeInteger(seq) || seq < 0) return false
    const normalized = normalizeSeq(seq)
    const { index, offset } = chunkSlot(normalized)
    const chunk = this.chunks.get(index)
    if (chunk === undefined) return false
    if (chunk.dense) return denseEntry(chunk, offset) !== undefined
    return findSparse(chunk.sparse ?? [], offset) !== undefined
  }

  /**
   * True only when every seq in [0, limit) is present. The maintained prefix
   * makes this O(1), so a sparse seq at 2^50 never creates a 2^50-iteration
   * loop.
   */
  isContiguous(limit: number): boolean {
    return Number.isSafeInteger(limit) && limit >= 0 && limit <= this.contiguousThrough
  }

  /**
   * Classify one event and report the exact byte charge a commit would add.
   * This does not mutate the store; callers reserve the bytes first.
   */
  plan(event: SeqStoreEvent): SeqStoreProbe {
    const seq = normalizeSeq(event.seq)
    if (!Number.isSafeInteger(seq) || seq < 0) return { status: 'conflict', bytes: 0 }
    const { index, offset } = chunkSlot(seq)
    const payload = canonicalSeqPayload(event)
    const time = normalizeTime(event.time)
    const chunk = this.chunks.get(index)
    if (chunk !== undefined) {
      const existing = chunk.dense ? denseEntry(chunk, offset) : findSparse(chunk.sparse ?? [], offset)
      if (existing !== undefined) {
        const same = existing.time === time && this.payloadKeys[existing.payloadId] === payload
        return same ? { status: 'same', bytes: 0 } : { status: 'conflict', bytes: 0 }
      }
    }
    let bytes: number
    if (chunk === undefined) bytes = CHUNK_BASE_BYTES + SPARSE_ENTRY_BYTES
    else if (chunk.dense) bytes = DENSE_ENTRY_BYTES
    else if (chunk.count >= SPARSE_LIMIT) bytes = DENSE_BYTES - chunk.count * SPARSE_ENTRY_BYTES
    else bytes = SPARSE_ENTRY_BYTES
    if (!this.payloadIdByKey.has(payload)) bytes += payloadBytes(payload)
    return { status: 'new', bytes }
  }

  /** Commit a plan() result that returned `new`; bytes must equal its charge. */
  commit(event: SeqStoreEvent): void {
    const seq = normalizeSeq(event.seq)
    const time = normalizeTime(event.time)
    const payload = canonicalSeqPayload(event)
    const { index, offset } = chunkSlot(seq)
    let chunk = this.chunks.get(index)
    let charge = 0
    if (chunk === undefined) {
      chunk = newChunk()
      this.chunks.set(index, chunk)
      charge += CHUNK_BASE_BYTES
    }
    let payloadId = this.payloadIdByKey.get(payload)
    if (payloadId === undefined) {
      payloadId = this.payloadKeys.length
      this.payloadKeys.push(payload)
      this.payloadIdByKey.set(payload, payloadId)
      charge += payloadBytes(payload)
    }
    if (chunk.dense) {
      charge += DENSE_ENTRY_BYTES
      chunk.present![offset >>> 3]! |= 1 << (offset & 7)
      chunk.times![offset] = time
      chunk.payloadIds![offset] = payloadId
    } else {
      if (chunk.count >= SPARSE_LIMIT) {
        promoteChunk(chunk)
        charge += DENSE_BYTES - chunk.count * SPARSE_ENTRY_BYTES
        chunk.present![offset >>> 3]! |= 1 << (offset & 7)
        chunk.times![offset] = time
        chunk.payloadIds![offset] = payloadId
      } else {
        charge += SPARSE_ENTRY_BYTES
        chunk.sparse!.push({ offset, time, payloadId })
      }
    }
    chunk.count += 1
    this.eventCount += 1
    this.retainedBytes += charge
    this.advanceContiguous(seq)
  }

  private advanceContiguous(seq: number): void {
    if (seq !== this.contiguousThrough) return
    let next = seq + 1
    while (Number.isSafeInteger(next) && this.has(next)) next += 1
    this.contiguousThrough = Number.isSafeInteger(next) ? next : Number.MAX_SAFE_INTEGER
  }
}
