import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processGuardStats, type GuardStatsSnapshot } from '../src/guard-core.ts'
import { apply as applyGuardState, readGuardStatsFile, writeGuardStatsFile } from '../src/guard-state.ts'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

function snapshot(observations: number): GuardStatsSnapshot {
  return {
    observations,
    reminders: { repeat: 2, cycle: 1 },
    denials: 1,
    outcomes: { success: 3, error: 1, cancelled: 0 },
    lastReminderAt: 1_700_000_000_000,
    since: 1_600_000_000_000,
  }
}

function fakeCtx() {
  const effects: Array<() => unknown> = []
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {} },
    provide(name: string, service: unknown) { ctx[name] = service },
    effect(cb: () => unknown) { const d = cb(); if (typeof d === 'function') effects.push(d as () => unknown) },
  }
  return { ctx, runEffects: async () => { for (const d of effects.splice(0)) await d() } }
}

describe('Guard stats persistence', () => {
  it('round-trips a snapshot through the stats file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-guard-stats-')); dirs.push(dir)
    const file = join(dir, 'guard-stats.json')
    expect(await readGuardStatsFile(file)).toBeUndefined()
    const snap = snapshot(7)
    await writeGuardStatsFile(file, snap)
    expect(await readGuardStatsFile(file)).toEqual(snap)
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1)
  })

  it('restores counters at mount so a restart does not zero the numbers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-guard-stats-')); dirs.push(dir)
    const statsFile = join(dir, 'guard-stats.json')
    await writeGuardStatsFile(statsFile, snapshot(9))
    const { ctx } = fakeCtx()
    await applyGuardState(ctx, { stateFile: join(dir, 'guard.json'), legacyStateFile: '', statsFile })
    const live = processGuardStats.snapshot()
    expect(live.observations).toBe(9)
    expect(live.reminders).toEqual({ repeat: 2, cycle: 1 })
    expect(live.since).toBe(1_600_000_000_000)
  })

  it('flushes new observations on unload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-guard-stats-')); dirs.push(dir)
    const statsFile = join(dir, 'guard-stats.json')
    await writeGuardStatsFile(statsFile, snapshot(4))
    const { ctx, runEffects } = fakeCtx()
    await applyGuardState(ctx, { stateFile: join(dir, 'guard.json'), legacyStateFile: '', statsFile })
    processGuardStats.observe('success')
    await runEffects()
    const stored = await readGuardStatsFile(statsFile)
    expect(stored?.observations).toBe(5)
  })
})
