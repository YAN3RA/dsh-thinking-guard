import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import { DEFAULT_REPEAT_THRESHOLDS } from '../src/guard-loop-core.ts'
import { processGuardStats } from '../src/guard-core.ts'
import { mountTestExecutor } from './stubs/test-executor.ts'

/**
 * End-to-end Guard settings through the REAL policy service.
 *
 * The switch surface is where the bug was reported ("阈值3-5-8次数无法修改"): the
 * page wrote what the Host offered, and the Host offered a constant. These tests
 * therefore mount the policy plugin itself rather than stubbing
 * `capabilityPolicy`, so `updateGuard` validation, the persisted state file and
 * the Guard's own reads are all shipped code paths.
 */
async function boot(stateFile: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(registry, { stateFile: '' })
  await ctx.plugin(policy, { stateFile, patchFile: '' })
  return ctx
}

async function tempStateFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-guard-policy-'))
  return join(dir, 'capability-menu-policy.json')
}

describe('Guard thresholds through the policy service', () => {
  it('persists an edited threshold list and reports it back', async () => {
    const stateFile = await tempStateFile()
    const ctx = await boot(stateFile)
    expect(ctx.capabilityPolicy.getGuard().repeatThresholds).toEqual([3, 5, 8])

    await ctx.capabilityPolicy.updateGuard({ repeatThresholds: [2, 4, 6] })

    expect(ctx.capabilityPolicy.getGuard().repeatThresholds).toEqual([2, 4, 6])
    // Persisted through the existing state file — no second store.
    const saved = JSON.parse(await readFile(stateFile, 'utf8')) as { guard?: { repeatThresholds?: number[] } }
    expect(saved.guard?.repeatThresholds).toEqual([2, 4, 6])
  })

  it('reloads the edited thresholds from the state file', async () => {
    const stateFile = await tempStateFile()
    const first = await boot(stateFile)
    await first.capabilityPolicy.updateGuard({ repeatThresholds: [2, 7] })

    // A fresh mount (a plugin reload) reads the same file back.
    const second = await boot(stateFile)
    expect(second.capabilityPolicy.getGuard().repeatThresholds).toEqual([2, 7])
  })

  it('falls back to the shipped 3/5/8 list when the state file predates the field', async () => {
    const stateFile = await tempStateFile()
    // Exactly what an older release wrote: four booleans, no thresholds.
    await writeFile(stateFile, JSON.stringify({
      version: 3,
      tools: { bash: 'on-demand' },
      skills: {},
      guard: {
        enabled: true,
        duplicateDetection: false,
        alternatingCycleDetection: true,
        noProgressProtection: true,
      },
      search: { descriptions: {} },
    }))

    const ctx = await boot(stateFile)
    const guard = ctx.capabilityPolicy.getGuard()
    // The absent field must not read as an empty list (which would mean "never
    // remind"), and it must not throw on load either.
    expect(guard.repeatThresholds).toEqual(DEFAULT_REPEAT_THRESHOLDS)
    expect(guard.repeatThresholds).toEqual([3, 5, 8])
    // The saved booleans still win over the defaults.
    expect(guard.duplicateDetection).toBe(false)
    // The unrelated tier section survives the load.
    expect(ctx.capabilityPolicy.getConfig().tools?.['on-demand']).toEqual(['bash'])
  })

  /**
   * "非法输入必须拒绝" — each case is a list the detector would either reject
   * later (fail-open, so the setting would silently do nothing) or mis-read.
   * Rejecting at the write makes the settings page show the error instead.
   */
  const invalid: ReadonlyArray<readonly [string, unknown]> = [
    ['an empty list', []],
    ['a non-array', '3,5,8'],
    ['more than five entries', [2, 3, 4, 5, 6, 7]],
    ['a non-integer', [3, 4.5]],
    ['a value below 2', [1, 3]],
    ['a value above 50', [3, 51]],
    ['a duplicate', [3, 3, 8]],
    ['a descending list', [8, 5, 3]],
  ]

  for (const [label, value] of invalid) {
    it('rejects ' + label, async () => {
      const stateFile = await tempStateFile()
      const ctx = await boot(stateFile)
      const before = ctx.capabilityPolicy.getGuard()
      await expect(ctx.capabilityPolicy.updateGuard({ repeatThresholds: value as number[] }))
        .rejects.toThrow(/repeatThresholds/)
      // Rejected means unchanged, not partially applied.
      expect(ctx.capabilityPolicy.getGuard()).toEqual(before)
    })
  }

  it('rejects an illegal list in memory even when there is no state file to validate', async () => {
    // `stateFile: ''` skips persistence entirely, so this isolates the service's
    // OWN validation: the settings page must get an error from the live switch
    // write, not only from the disk layer.
    const ctx = await boot('')
    const before = ctx.capabilityPolicy.getGuard()
    await expect(ctx.capabilityPolicy.updateGuard({ repeatThresholds: [8, 3] }))
      .rejects.toThrow(/repeatThresholds/)
    expect(ctx.capabilityPolicy.getGuard()).toEqual(before)
    await expect(ctx.capabilityPolicy.updateGuard({ repeatThresholds: [] }))
      .rejects.toThrow(/repeatThresholds/)
  })

  it('rejects a malformed list already present in the state file instead of coercing it', async () => {
    const stateFile = await tempStateFile()
    await writeFile(stateFile, JSON.stringify({
      version: 3,
      tools: {},
      skills: {},
      guard: { repeatThresholds: [8, 3] },
      search: { descriptions: {} },
    }))
    await expect(boot(stateFile)).rejects.toThrow(/repeatThresholds/)
  })

  it('accepts the boundaries of the legal range', async () => {
    const stateFile = await tempStateFile()
    const ctx = await boot(stateFile)
    await ctx.capabilityPolicy.updateGuard({ repeatThresholds: [2] })
    expect(ctx.capabilityPolicy.getGuard().repeatThresholds).toEqual([2])
    await ctx.capabilityPolicy.updateGuard({ repeatThresholds: [2, 3, 4, 5, 50] })
    expect(ctx.capabilityPolicy.getGuard().repeatThresholds).toEqual([2, 3, 4, 5, 50])
  })
})

describe('Guard counters through the policy service', () => {
  it('serves the process counter snapshot with counts and timestamps only', async () => {
    const stateFile = await tempStateFile()
    const ctx = await boot(stateFile)
    const stats = ctx.capabilityPolicy.getGuardStats()

    // Shape: exactly the documented fields, all numbers or nested counters.
    expect(Object.keys(stats).sort()).toEqual(['denials', 'observations', 'outcomes', 'reminders', 'since'])
    expect(stats.since).toBeLessThanOrEqual(Date.now())
    expect(stats.observations).toBeTypeOf('number')
    expect(stats.reminders).toEqual({ repeat: expect.any(Number), cycle: expect.any(Number) })
    expect(stats.outcomes).toEqual({
      success: expect.any(Number), error: expect.any(Number), cancelled: expect.any(Number),
    })
    // Same process-wide recorder the Guard increments: a snapshot read twice
    // cannot go backwards.
    const again = ctx.capabilityPolicy.getGuardStats()
    expect(again.observations).toBeGreaterThanOrEqual(stats.observations)
    expect(again.since).toBe(stats.since)
    expect(processGuardStats.snapshot().since).toBe(stats.since)
  })
})
