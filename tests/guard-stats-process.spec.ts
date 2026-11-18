import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { processGuardStats, type GuardStatsSnapshot } from '../src/guard-core.ts'
import { apply as applyGuardState } from '../src/guard-state.ts'

/**
 * Process-scoped Guard counters, proven with *real* new Node child processes.
 *
 * The counters must accumulate only inside the current DSH host process and start
 * from zero after a restart, while the switch/threshold config (`guard.json`) is
 * still persisted across processes. Two facts need genuine process boundaries to
 * be trustworthy:
 *
 *   1. A brand-new Node process never restores a legacy `guard-stats.json` — two
 *      consecutive child rounds both report zero counters and a fresh `since`.
 *   2. Switch/threshold choices still survive a restart via `guard.json`.
 *
 * The child is spawned with `process.execPath` (the same Node that runs the
 * tests, which strips TypeScript on load) and imports the real source modules via
 * absolute file: URLs. Paths come from `tmpdir()` + `node:path`.
 */

const exec = promisify(execFile)
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-guard-proc-'))
  dirs.push(dir)
  return dir
}

const GUARD_STATE_URL = new URL('../src/guard-state.ts', import.meta.url).href
const GUARD_CORE_URL = new URL('../src/guard-core.ts', import.meta.url).href

/** Write the child harness that mounts the real state service and prints JSON. */
async function writeRunner(dir: string): Promise<string> {
  const runner = join(dir, 'runner.mjs')
  const source = [
    'import { apply } from ' + JSON.stringify(GUARD_STATE_URL),
    'import { processGuardStats } from ' + JSON.stringify(GUARD_CORE_URL),
    'const [stateFile, statsFile, action] = process.argv.slice(2)',
    'const ctx = { logger: { info() {}, warn() {}, error() {} }, provide(name, service) { ctx[name] = service } }',
    'await apply(ctx, { stateFile, legacyStateFile: "", statsFile })',
    'if (action === "set-threshold") { await ctx.thinkingGuardState.updateGuard({ enabled: false, repeatThresholds: [2, 4] }) }',
    'if (action === "record") { processGuardStats.observe("success"); processGuardStats.observe("success"); processGuardStats.observe("error"); processGuardStats.remind("repeat"); processGuardStats.deny() }',
    'process.stdout.write(JSON.stringify({ stats: processGuardStats.snapshot(), guard: ctx.thinkingGuardState.getGuard() }))',
    '',
  ].join('\n')
  await writeFile(runner, source)
  return runner
}

interface ChildResult {
  readonly stats: GuardStatsSnapshot
  readonly guard: { readonly enabled: boolean; readonly repeatThresholds: readonly number[] }
}

async function runChild(dir: string, runner: string, stateFile: string, statsFile: string, action?: string): Promise<ChildResult> {
  const args = [runner, stateFile, statsFile]
  if (action !== undefined) args.push(action)
  const { stdout } = await exec(process.execPath, args, { cwd: dir, timeout: 30_000 })
  return JSON.parse(stdout) as ChildResult
}

function fakeCtx() {
  const effects: Array<() => unknown> = []
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {} },
    provide(name: string, service: unknown) { ctx[name] = service },
    effect(cb: () => unknown) { const d = cb(); if (typeof d === 'function') effects.push(d as () => unknown) },
  }
  return { ctx, effects }
}

const legacyStats = JSON.stringify({
  version: 1,
  stats: {
    observations: 123_456,
    reminders: { repeat: 999, cycle: 999 },
    denials: 999,
    outcomes: { success: 1, error: 2, cancelled: 3 },
    since: 1_000,
  },
})

describe('process-scoped Guard counters', () => {
  it('records non-zero in one new process then starts from zero in the next (counters reset on restart)', async () => {
    const dir = await tempDir()
    const runner = await writeRunner(dir)
    const stateFile = join(dir, 'guard.json')
    const statsFile = join(dir, 'guard-stats.json')
    await writeFile(statsFile, legacyStats)
    const beforeBytes = await readFile(statsFile, 'utf8')

    // Round 1: a fresh process starts at zero and really accumulates. The seeded
    // 123_456 must NOT leak in; the snapshot shows exactly what this run recorded.
    const firstBefore = Date.now()
    const first = await runChild(dir, runner, stateFile, statsFile, 'record')
    const firstAfter = Date.now()
    expect(first.stats.observations).toBe(3)
    expect(first.stats.outcomes).toEqual({ success: 2, error: 1, cancelled: 0 })
    expect(first.stats.reminders).toEqual({ repeat: 1, cycle: 0 })
    expect(first.stats.denials).toBe(1)
    expect(first.stats.since).toBeGreaterThan(1_000)
    expect(first.stats.since).toBeGreaterThanOrEqual(firstBefore)
    expect(first.stats.since).toBeLessThanOrEqual(firstAfter)

    // Round 2: a genuinely new process is back to zero — nothing was persisted.
    const secondBefore = Date.now()
    const second = await runChild(dir, runner, stateFile, statsFile)
    const secondAfter = Date.now()
    expect(second.stats.observations).toBe(0)
    expect(second.stats.reminders).toEqual({ repeat: 0, cycle: 0 })
    expect(second.stats.denials).toBe(0)
    expect(second.stats.outcomes).toEqual({ success: 0, error: 0, cancelled: 0 })
    expect(second.stats.since).toBeGreaterThanOrEqual(secondBefore)
    expect(second.stats.since).toBeLessThanOrEqual(secondAfter)
    expect(second.stats.since).toBeGreaterThanOrEqual(first.stats.since)

    // Neither process read, wrote or deleted the legacy file.
    expect(await readFile(statsFile, 'utf8')).toBe(beforeBytes)
  })

  it('persists switch and threshold config across two separate Node processes', async () => {
    const dir = await tempDir()
    const runner = await writeRunner(dir)
    const stateFile = join(dir, 'guard.json')
    const statsFile = join(dir, 'guard-stats.json')

    const writer = await runChild(dir, runner, stateFile, statsFile, 'set-threshold')
    expect(writer.guard.enabled).toBe(false)
    expect(writer.guard.repeatThresholds).toEqual([2, 4])

    // The file is the versioned guard.json envelope, not a stats file.
    const persisted = JSON.parse(await readFile(stateFile, 'utf8')) as { version: number; guard: Record<string, unknown> }
    expect(persisted.version).toBe(1)
    expect(persisted.guard).toMatchObject({ enabled: false, repeatThresholds: [2, 4] })

    // A second, fresh process reads the same choices back from disk.
    const reader = await runChild(dir, runner, stateFile, statsFile)
    expect(reader.guard.enabled).toBe(false)
    expect(reader.guard.repeatThresholds).toEqual([2, 4])
  })

  it('keeps counters across a service remount in the same process (apply never resets them)', async () => {
    const dir = await tempDir()
    const before = processGuardStats.snapshot()

    processGuardStats.observe('success')
    processGuardStats.observe('error')
    processGuardStats.remind('cycle')
    const mid = processGuardStats.snapshot()
    expect(mid.observations).toBe(before.observations + 2)

    // Two mounts simulate a settings-page reload / plugin re-apply in one host process.
    await applyGuardState(fakeCtx().ctx, { stateFile: join(dir, 'first.json'), legacyStateFile: '' })
    await applyGuardState(fakeCtx().ctx, { stateFile: join(dir, 'second.json'), legacyStateFile: '' })

    const after = processGuardStats.snapshot()
    expect(after.observations).toBe(mid.observations)
    expect(after.reminders).toEqual(mid.reminders)
    expect(after.denials).toBe(mid.denials)
    expect(after.since).toBe(before.since)
  })
})
