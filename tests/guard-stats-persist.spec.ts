import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processGuardStats, type GuardStatsSnapshot } from '../src/guard-core.ts'
import { apply as applyGuardState } from '../src/guard-state.ts'

/**
 * The Guard counters are process-scoped now: a running host accumulates them in
 * memory and a restart starts from zero. This spec pins the *removal* of the old
 * persistence path — a legacy `guard-stats.json` must never be read, written or
 * deleted — and that mounting the state service does not register any flush timer
 * or unload handler. Cross-process behaviour (a genuinely new Node process, and
 * the still-persisted switch/threshold config) lives in guard-stats-process.spec.ts.
 *
 * Every path is built from `tmpdir()` + `node:path`; nothing is hard-coded.
 */

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-guard-stats-'))
  dirs.push(dir)
  return dir
}

/** The exact envelope the old writer produced: { version: 1, stats: GuardStatsSnapshot }. */
function legacyStatsFile(observations: number): string {
  const stats: GuardStatsSnapshot = {
    observations,
    reminders: { repeat: 2, cycle: 1 },
    denials: 1,
    outcomes: { success: 3, error: 1, cancelled: 0 },
    lastReminderAt: 1_700_000_000_000,
    since: 1_600_000_000_000,
  }
  return JSON.stringify({ version: 1, stats }, null, 2) + '\n'
}

function fakeCtx() {
  const effects: Array<() => unknown> = []
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {} },
    provide(name: string, service: unknown) { ctx[name] = service },
    effect(cb: () => unknown) {
      const dispose = cb()
      if (typeof dispose === 'function') effects.push(dispose as () => unknown)
    },
  }
  return { ctx, effects, runEffects: async () => { for (const d of effects.splice(0)) await d() } }
}

describe('legacy guard-stats.json is ignored', () => {
  it('does not restore counters from a valid stats file and leaves the file byte-for-byte intact', async () => {
    const dir = await tempDir()
    const statsFile = join(dir, 'guard-stats.json')
    await writeFile(statsFile, legacyStatsFile(999))

    const beforeBytes = await readFile(statsFile, 'utf8')
    const beforeStat = await stat(statsFile)
    const before = processGuardStats.snapshot()

    const { ctx } = fakeCtx()
    await applyGuardState(ctx, { stateFile: join(dir, 'guard.json'), legacyStateFile: '', statsFile })

    const after = processGuardStats.snapshot()
    // No restore: the counters are exactly what this process already had.
    expect(after.observations).toBe(before.observations)
    expect(after.reminders).toEqual(before.reminders)
    expect(after.denials).toBe(before.denials)
    expect(after.outcomes).toEqual(before.outcomes)
    expect(after.since).toBe(before.since)

    // Not deleted, not rewritten: identical bytes and untouched metadata.
    expect(await readFile(statsFile, 'utf8')).toBe(beforeBytes)
    const afterStat = await stat(statsFile)
    expect(afterStat.size).toBe(beforeStat.size)
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs)
  })

  it('ignores a corrupt stats file without throwing and without touching it', async () => {
    const dir = await tempDir()
    const statsFile = join(dir, 'guard-stats.json')
    const corrupt = '{ this is not valid json'
    await writeFile(statsFile, corrupt)

    const before = processGuardStats.snapshot()
    const { ctx } = fakeCtx()
    await expect(
      applyGuardState(ctx, { stateFile: join(dir, 'guard.json'), legacyStateFile: '', statsFile }),
    ).resolves.toBeUndefined()

    expect(processGuardStats.snapshot().observations).toBe(before.observations)
    expect(await readFile(statsFile, 'utf8')).toBe(corrupt)
  })

  it('mounts without a flush timer or unload handler and never creates a stats file', async () => {
    const dir = await tempDir()
    const statsFile = join(dir, 'guard-stats.json')
    const { ctx, effects, runEffects } = fakeCtx()

    vi.useFakeTimers()
    try {
      await applyGuardState(ctx, { stateFile: join(dir, 'guard.json'), legacyStateFile: '', statsFile })
      // The old 5s sweep would have scheduled a timer; there must be none.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }

    // No unload effect was registered either, so "observe then unmount" cannot flush.
    expect(effects).toHaveLength(0)
    processGuardStats.observe('success')
    await runEffects()
    await expect(stat(statsFile)).rejects.toBeDefined()
  })

  it('keeps the deprecated statsFile config inert even when it points at an existing file', async () => {
    const dir = await tempDir()
    const statsFile = join(dir, 'guard-stats.json')
    await writeFile(statsFile, legacyStatsFile(42))
    const beforeBytes = await readFile(statsFile, 'utf8')
    const before = processGuardStats.snapshot()

    const { ctx } = fakeCtx()
    await applyGuardState(ctx, { stateFile: join(dir, 'guard.json'), legacyStateFile: '', statsFile })

    expect(processGuardStats.snapshot().observations).toBe(before.observations)
    expect(await readFile(statsFile, 'utf8')).toBe(beforeBytes)
  })
})
