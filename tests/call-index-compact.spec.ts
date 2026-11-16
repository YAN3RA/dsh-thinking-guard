import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CallIndexPartition,
  type CallIndexEvent,
  type CallIndexPartitionOptions,
} from '../src/usage/call-index-core.ts'
import { CallIndexSeqStore } from '../src/usage/call-index-seq-store.ts'

const T0 = Date.UTC(2026, 10, 8, 12, 0, 0)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The commit that introduced the compact seq ledger. The differential baseline
 * must stay pinned to the code *before* that change, so this constant is
 * deliberately a fixed SHA and not `HEAD`: after the change is committed, HEAD
 * already contains the new core and would silently turn the differential into a
 * self-comparison. It is also the last commit that used the old whole-corpus
 * `seqMeta` layout this store is meant to reproduce.
 */
const BASELINE_COMMIT = '0de7610'

function makePartition(overrides: Partial<CallIndexPartitionOptions> = {}): CallIndexPartition {
  return new CallIndexPartition({
    sessionId: overrides.sessionId ?? 'compact-1',
    revision: overrides.revision ?? 'rev-1',
    inheritedEventCount: overrides.inheritedEventCount ?? 0,
    maxEvents: overrides.maxEvents,
    maxCalls: overrides.maxCalls,
    maxBytes: overrides.maxBytes,
    maxOrphans: overrides.maxOrphans,
    reserve: overrides.reserve,
    resolveSource: overrides.resolveSource,
  })
}

function other(seq: number, time = T0 + seq, extra: Partial<CallIndexEvent> = {}): CallIndexEvent {
  return { seq, time, kind: 'other', ...extra }
}

function otherHeavyEvents(session: number, count = 4096): CallIndexEvent[] {
  const events: CallIndexEvent[] = [
    { seq: 0, time: T0, kind: 'call', callId: `call-${session}`, toolName: 'read', turn: 1, step: 1 },
  ]
  for (let seq = 1; seq < count; seq += 1) events.push(other(seq))
  return events
}

interface BaselinePartition {
  ingest(events: readonly unknown[]): void
  snapshot(cut: number): unknown
  usage(): { events: number; calls: number; bytes: number }
}

interface BaselineModule {
  CallIndexPartition: new (options: CallIndexPartitionOptions) => BaselinePartition
}

let baselinePromise: Promise<BaselineModule> | undefined

/**
 * Load the *actual* pre-change CallIndexPartition from the pinned baseline commit.
 *
 * It must be the baseline code, not a hand-written approximation: the whole
 * point of the differential test is that the compact store preserves every
 * row/outcome/gap/count the old implementation produced. The source is copied
 * to a temporary file because the working tree already contains the new core;
 * package imports are rewritten to absolute file URLs so the temp module still
 * resolves the project's existing dependencies without adding any.
 */
/**
 * Read the pre-change core out of git.
 *
 * CI checks out a shallow clone by default, where the pinned commit is simply
 * absent; without the explicit fetch below the differential would fail there for
 * a reason that has nothing to do with the code under test. If the commit still
 * cannot be fetched the error says exactly what to do instead of degrading into
 * a comparison of the new code with itself.
 */
function readBaselineSource(): string {
  const spec = `${BASELINE_COMMIT}:src/usage/call-index-core.ts`
  const show = (): string | undefined => {
    try {
      return execFileSync('git', ['show', spec], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return undefined
    }
  }
  const direct = show()
  if (direct !== undefined) return direct
  // Shallow clone: try to obtain the baseline commit, then retry once. Fetching a
  // bare SHA is not accepted by every transport, so fall back to deepening the
  // history of the current branch.
  for (const args of [
    ['fetch', '--depth=1', '--quiet', 'origin', BASELINE_COMMIT],
    ['fetch', '--unshallow', '--quiet', 'origin'],
  ]) {
    try {
      execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'ignore', 'ignore'] })
      if (show() !== undefined) return show() as string
    } catch {
      // try the next strategy
    }
  }
  const fetched = show()
  if (fetched !== undefined) return fetched
  throw new Error(
    `The pre-change baseline ${BASELINE_COMMIT} is not in this checkout. The differential test needs that commit: ` +
      'run with a full clone (CI uses fetch-depth: 0) or fetch it with ' +
      `\`git fetch --depth=1 origin ${BASELINE_COMMIT}\`.`,
  )
}

function loadBaselineCore(): Promise<BaselineModule> {
  baselinePromise ??= (async () => {
    const source = readBaselineSource()
    const require = createRequire(join(repoRoot, 'package.json'))
    const sessionUrl = pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href
    const toolsUrl = pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href
    const patched = source
      .replace("'@deepseek-ai/dsh-session'", JSON.stringify(sessionUrl))
      .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(toolsUrl))
      // The baseline source imports sibling modules relative to its own directory;
      // the temp copy sits elsewhere, so rewrite every relative specifier to a
      // file URL of the same repo file. Absolute paths keep the temp module
      // resolving the project's real sources, not a stale duplicate.
      .replace(/(['"])(\.\/[A-Za-z0-9._-]+?)(\.ts)?\1/g, (_m, _q, rel: string) =>
        JSON.stringify(pathToFileURL(join(repoRoot, 'src', 'usage', rel.endsWith('.ts') ? rel : `${rel}.ts`)).href),
      )
    const dir = mkdtempSync(join(tmpdir(), 'call-index-baseline-'))
    const file = join(dir, 'call-index-core-baseline.ts')
    writeFileSync(file, patched)
    try {
      return await import(/* @vite-ignore */ pathToFileURL(file).href) as BaselineModule
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows may keep the just-imported file open; the temp directory is
        // still isolated under the OS temp root and does not affect the repo.
      }
    }
  })()
  return baselinePromise
}

function withoutEstimatedBytes(snapshot: unknown): unknown {
  const copy = { ...(snapshot as Record<string, unknown>) }
  delete copy.estimatedBytes
  return copy
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function differentialBatches(): { batches: CallIndexEvent[][]; cuts: number[] } {
  const rng = mulberry32(0x5eedc0de)
  const batches: CallIndexEvent[][] = []
  const cuts: number[] = []
  const callIds: string[] = ['dup', 'early']
  let seq = 0

  const first: CallIndexEvent[] = [
    // A result with no call yet: both implementations must retain it as an orphan gap.
    { seq: 0, time: T0, kind: 'result', callId: 'orphan', outcome: 'success', turn: 1, step: 1 },
    // The same callId twice keeps both rows unknown instead of guessing a pairing.
    { seq: 1, time: T0 + 1, kind: 'call', callId: 'dup', toolName: 'read', turn: 1, step: 1 },
    { seq: 2, time: T0 + 2, kind: 'call', callId: 'dup', toolName: 'write', turn: 1, step: 1 },
    { seq: 3, time: T0 + 3, kind: 'result', callId: 'dup', outcome: 'success', turn: 1, step: 1 },
    // A fractional time and -0 must not change the equality class.
    { seq: 4, time: T0 + 4.5, kind: 'other' },
    { seq: 5, time: -0, kind: 'other' },
    { seq: 6, time: 0, kind: 'other' },
    { seq: 7, time: T0 + 7, kind: 'other', turnClosed: true, turn: 1 },
  ]
  batches.push(first)
  cuts.push(8)
  seq = 8

  for (let batch = 0; batch < 24; batch += 1) {
    const events: CallIndexEvent[] = []
    const length = 18 + (batch % 5) * 6
    for (let index = 0; index < length; index += 1) {
      const roll = rng()
      if (roll < 0.16 || callIds.length === 0) {
        const callId = `call-${Math.floor(rng() * 23)}`
        if (!callIds.includes(callId)) callIds.push(callId)
        events.push({
          seq,
          time: T0 + seq * 1.25 + (rng() < 0.1 ? 0.5 : 0),
          kind: 'call',
          callId,
          toolName: rng() < 0.2 ? 'mcp__demo__tool' : 'read',
          ...(rng() < 0.8 ? { turn: 1 + Math.floor(rng() * 3), step: 1 + Math.floor(rng() * 4) } : {}),
        })
        seq += 1
      } else if (roll < 0.55) {
        const callId = callIds[Math.floor(rng() * callIds.length)]!
        const base: CallIndexEvent = {
          seq,
          time: T0 + seq * 1.25,
          kind: 'result',
          callId,
          ...(rng() < 0.8 ? { turn: 1 + Math.floor(rng() * 3), step: 1 + Math.floor(rng() * 4) } : {}),
        }
        const outcome = rng()
        events.push(outcome < 0.55
          ? { ...base, outcome: 'success' }
          : outcome < 0.75
            ? { ...base, outcome: 'error', errorCode: 'E_FAIL' }
            : outcome < 0.88
              ? { ...base, outcome: 'cancelled' }
              : { ...base, outcome: 'unresolved', replacement: true })
        seq += 1
      } else if (roll < 0.94) {
        events.push(other(seq, T0 + seq * 1.25, rng() < 0.25
          ? { turnClosed: true, turn: 1 + Math.floor(rng() * 3) }
          : {}))
        seq += 1
      } else {
        // Duplicate or conflicting seq against a recent event: the first value
        // must win in both implementations.
        const target = Math.max(0, seq - 1 - Math.floor(rng() * 3))
        events.push(other(target, T0 + target * 1.25, rng() < 0.5
          ? { turnClosed: true, turn: 1 }
          : { turn: 2, step: 2 }))
      }
    }
    batches.push(events)
    cuts.push(seq)
  }
  return { batches, cuts }
}

describe('CallIndexSeqStore primitive contract', () => {
  it('classifies new/same/conflict exactly and does not mutate on plan', () => {
    const store = new CallIndexSeqStore()
    const event = { seq: 3, time: T0 + 0.5, kind: 'other' }
    const plan = store.plan(event)
    expect(plan.status).toBe('new')
    expect(plan.bytes).toBeGreaterThan(0)
    expect(store.count).toBe(0)
    expect(store.has(3)).toBe(false)

    store.commit(event)
    expect(store.count).toBe(1)
    expect(store.has(3)).toBe(true)
    expect(store.plan(event)).toEqual({ status: 'same', bytes: 0 })
    expect(store.plan({ ...event, time: T0 + 0.25 })).toEqual({ status: 'conflict', bytes: 0 })
  })

  it('keeps retainedBytes equal to the sum of committed plan charges', () => {
    const store = new CallIndexSeqStore()
    let planned = 0
    for (let seq = 0; seq < 300; seq += 1) {
      const event = { seq, time: T0 + seq, kind: 'other' }
      const plan = store.plan(event)
      expect(plan.status).toBe('new')
      planned += plan.bytes
      store.commit(event)
    }
    expect(store.count).toBe(300)
    expect(store.bytes).toBe(planned)
  })

  it('keeps sparse chunks bounded and a correct contiguous prefix', () => {
    const store = new CallIndexSeqStore()
    const huge = 2 ** 40
    store.commit({ seq: huge, time: T0, kind: 'other' })
    expect(store.count).toBe(1)
    expect(store.has(huge)).toBe(true)
    expect(store.isContiguous(0)).toBe(true)
    expect(store.isContiguous(1)).toBe(false)
    expect(store.isContiguous(huge + 1)).toBe(false)

    store.commit({ seq: 0, time: T0, kind: 'other' })
    store.commit({ seq: 1, time: T0 + 1, kind: 'other' })
    expect(store.isContiguous(2)).toBe(true)
    expect(store.isContiguous(huge + 1)).toBe(false)
  })
})

describe('CallIndexSeqStore through CallIndexPartition', () => {
  it('treats differing pure-other fields as a seq conflict and partial coverage', () => {
    const part = makePartition()
    part.ingest([other(0)])
    part.ingest([other(0, T0, { turnClosed: true, turn: 1 })])
    const snapshot = part.snapshot(1)
    expect(part.usage().events).toBe(1)
    expect(snapshot.reasons).toContain('seq-conflict')
    expect(snapshot.coverage).toBe('partial')
  })

  it('treats a differing fractional time as a seq conflict but keeps exact equal times identical', () => {
    const same = makePartition()
    same.ingest([other(0, T0 + 0.25)])
    same.ingest([other(0, T0 + 0.25)])
    expect(same.snapshot(1).reasons).toEqual([])
    expect(same.snapshot(1).coverage).toBe('complete')

    const conflict = makePartition()
    conflict.ingest([other(0, T0 + 0.25)])
    conflict.ingest([other(0, T0 + 0.5)])
    expect(conflict.snapshot(1).reasons).toContain('seq-conflict')
    expect(conflict.snapshot(1).coverage).toBe('partial')
  })

  it('normalizes absent/null and false/undefined fields and -0 like the old signature', () => {
    const base: CallIndexEvent = { seq: 0, time: 0, kind: 'call', callId: 'c', toolName: 'read' }
    const part = makePartition()
    part.ingest([base])
    part.ingest([{
      ...base,
      time: -0,
      turn: null as unknown as number,
      step: null as unknown as number,
      replacement: false,
      turnClosed: false,
    }])
    expect(part.usage().events).toBe(1)
    expect(part.snapshot(1).reasons).toEqual([])
    expect(part.snapshot(1).coverage).toBe('complete')
  })

  it('handles unordered seq arrival and an oversized sparse seq without a range walk', () => {
    const part = makePartition()
    part.ingest([other(2), other(0), other(1)])
    expect(part.usage().events).toBe(3)
    expect(part.snapshot(3).coverage).toBe('complete')

    const sparse = makePartition()
    const huge = Number.MAX_SAFE_INTEGER - 1
    sparse.ingest([other(huge, T0)])
    expect(sparse.usage().events).toBe(1)
    const started = performance.now()
    const snapshot = sparse.snapshot(Number.MAX_SAFE_INTEGER)
    expect(performance.now() - started).toBeLessThan(100)
    expect(snapshot.coverage).toBe('partial')
    expect(snapshot.rows).toEqual([])
  })
})

describe('compact capacity accounting', () => {
  it('fits 32 x 4096 other-heavy events inside the default 64 MiB shared ledger', () => {
    const ledgerLimit = 64 * 1024 * 1024
    let used = 0
    const parts: CallIndexPartition[] = []
    for (let session = 0; session < 32; session += 1) {
      const part = new CallIndexPartition({
        sessionId: `other-heavy-${session}`,
        revision: 'rev-1',
        inheritedEventCount: 0,
        maxBytes: 8_000_000,
        reserve: (bytes) => {
          if (!Number.isFinite(bytes) || bytes < 0 || used + bytes > ledgerLimit) return false
          used += bytes
          return true
        },
      })
      part.ingest(otherHeavyEvents(session))
      parts.push(part)
    }
    const snapshots = parts.map(part => part.snapshot(4096))
    expect(snapshots.every(snapshot => snapshot.coverage === 'complete')).toBe(true)
    expect(snapshots.every(snapshot => snapshot.rows.length === 1)).toBe(true)
    expect(used).toBe(parts.reduce((sum, part) => sum + part.usage().bytes, 0))
    expect(used).toBeGreaterThan(0)
    expect(used).toBeLessThan(16 * 1024 * 1024)
  })

  it('fits the default 8 MB partition budget at the 250k maxEvents ceiling', () => {
    const part = makePartition()
    const events: CallIndexEvent[] = [{ seq: 0, time: T0, kind: 'call', callId: 'c', toolName: 'read' }]
    for (let seq = 1; seq < 250_000; seq += 1) events.push(other(seq))
    part.ingest(events)
    expect(part.usage().events).toBe(250_000)
    expect(part.usage().bytes).toBeLessThanOrEqual(8_000_000)
    const snapshot = part.snapshot(250_000)
    expect(snapshot.coverage).toBe('complete')
    expect(snapshot.rows).toHaveLength(1)
  })

  it('honors an exact byte budget and stops before the first non-fitting event', () => {
    const events = Array.from({ length: 300 }, (_, seq) => other(seq))
    const probe = makePartition({ maxBytes: 8_000_000 })
    probe.ingest(events)
    const exact = probe.usage().bytes
    expect(exact).toBeGreaterThan(0)

    const strict = makePartition({ maxBytes: exact })
    strict.ingest(events)
    expect(strict.usage().events).toBe(300)
    expect(strict.usage().bytes).toBe(exact)
    expect(strict.snapshot(300).coverage).toBe('complete')

    strict.ingest([other(300)])
    expect(strict.usage().events).toBe(300)
    expect(strict.usage().bytes).toBeLessThanOrEqual(exact)
    expect(strict.usage().bytes).toBe(exact)
    const stopped = strict.snapshot(301)
    expect(stopped.reasons).toContain('index-capacity')
    expect(stopped.coverage).toBe('partial')
  })

  it('keeps capacity partial honest instead of pretending a complete empty history', () => {
    const part = makePartition({ maxBytes: 1 })
    part.ingest([other(0), other(1)])
    const snapshot = part.snapshot(2)
    expect(part.usage().events).toBe(0)
    expect(snapshot.rows).toEqual([])
    expect(snapshot.coverage).toBe('partial')
    expect(snapshot.reasons).toContain('index-capacity')
  })
})

describe('old/new differential with the pinned pre-change baseline', () => {
  it('matches every projected-field conflict variant against the old signature', async () => {
    const baseline = await loadBaselineCore()
    const base: CallIndexEvent = { seq: 0, time: 0, kind: 'other' }
    const variants: Array<{ label: string; event: CallIndexEvent }> = [
      { label: 'identical', event: { ...base } },
      { label: 'null turn', event: { ...base, turn: null as unknown as number } },
      { label: 'null step', event: { ...base, step: null as unknown as number } },
      { label: 'false replacement', event: { ...base, replacement: false } },
      { label: 'false turnClosed', event: { ...base, turnClosed: false } },
      { label: 'negative zero time', event: { ...base, time: -0 } },
      { label: 'fractional time', event: { ...base, time: 0.5 } },
      { label: 'turn', event: { ...base, turn: 1 } },
      { label: 'step', event: { ...base, step: 1 } },
      { label: 'call id', event: { ...base, callId: 'c' } },
      { label: 'tool name', event: { ...base, toolName: 'read' } },
      { label: 'outcome', event: { ...base, outcome: 'success' } },
      { label: 'error code', event: { ...base, errorCode: 'E_FAIL' } },
      { label: 'replacement', event: { ...base, replacement: true } },
      { label: 'turn closed', event: { ...base, turnClosed: true } },
      { label: 'kind', event: { ...base, kind: 'call', callId: 'c', toolName: 'read' } },
    ]
    const options: CallIndexPartitionOptions = {
      sessionId: 'matrix',
      revision: 'rev-1',
      inheritedEventCount: 0,
      maxBytes: 1_000_000,
    }
    for (const variant of variants) {
      const oldPart = new baseline.CallIndexPartition(options)
      const newPart = makePartition(options)
      oldPart.ingest([base, variant.event])
      newPart.ingest([base, variant.event])
      expect(withoutEstimatedBytes(newPart.snapshot(1))).toEqual(withoutEstimatedBytes(oldPart.snapshot(1)))
      expect(newPart.usage().events).toBe(oldPart.usage().events)
      expect(newPart.usage().calls).toBe(oldPart.usage().calls)
    }
  })

  it('matches every row, outcome, gap, coverage and count under a generous budget', async () => {
    const baseline = await loadBaselineCore()
    const { batches, cuts } = differentialBatches()
    const options: CallIndexPartitionOptions = {
      sessionId: 'differential',
      revision: 'rev-1',
      inheritedEventCount: 0,
      maxEvents: 1_000_000,
      maxCalls: 100_000,
      maxBytes: 1_000_000_000,
      maxOrphans: 10_000,
    }
    const oldPart = new baseline.CallIndexPartition(options)
    const newPart = makePartition(options)
    let oldBytes = 0
    let newBytes = 0
    for (const [index, batch] of batches.entries()) {
      oldPart.ingest(batch)
      newPart.ingest(batch)
      const cut = cuts[index]!
      expect(withoutEstimatedBytes(newPart.snapshot(cut))).toEqual(withoutEstimatedBytes(oldPart.snapshot(cut)))
      expect(newPart.usage().events).toBe(oldPart.usage().events)
      expect(newPart.usage().calls).toBe(oldPart.usage().calls)
      oldBytes = oldPart.usage().bytes
      newBytes = newPart.usage().bytes
    }
    expect(oldBytes).toBeGreaterThan(0)
    expect(newBytes).toBeGreaterThan(0)
    expect(newBytes).toBeLessThan(oldBytes)
  })
})
