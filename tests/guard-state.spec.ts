import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_GUARD_SWITCHES,
  apply,
  readGuardState,
  type GuardStateService,
} from '../src/guard-state.ts'
import { DEFAULT_REPEAT_THRESHOLDS } from '../src/guard-loop-core.ts'

/**
 * The Guard's own state service — the replacement for the capability policy's
 * `guard` section.
 *
 * What is pinned here is the contract the settings page and `src/guard.ts` rely
 * on, in the order the module documents it: three-layer precedence, sparse
 * per-key persistence, threshold validation, one-shot 0.1.x migration, the
 * closed-allowlist diagnostics, and the durability answer when a write fails.
 *
 * `apply` is an async cordis plugin, so every test mounts it on a minimal fake
 * Context (logger + `provide`) and asserts on the service it publishes. No real
 * cordis host is involved, and every path below is built from `tmpdir()` with
 * `node:path` — never a hard-coded POSIX path.
 */

interface TestHost {
  readonly service: GuardStateService
  readonly info: ReturnType<typeof vi.fn>
  readonly warn: ReturnType<typeof vi.fn>
}

/** Mount `src/guard-state.ts` on a fake Context and hand back the published service. */
async function mount(config: { stateFile?: string; legacyStateFile?: string }): Promise<TestHost> {
  const info = vi.fn()
  const warn = vi.fn()
  let published: GuardStateService | undefined
  const ctx = {
    logger: { info, warn },
    provide: (name: string, service: unknown) => {
      if (name !== 'thinkingGuardState') throw new Error(`unexpected service: ${name}`)
      published = service as GuardStateService
    },
  }
  await apply(ctx as unknown as Context, config)
  if (published === undefined) throw new Error('apply did not provide thinkingGuardState')
  return { service: published, info, warn }
}

/** A fresh temp directory per test; the state file lives inside it. */
async function tempFile(name = 'guard.json'): Promise<{ dir: string; stateFile: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-guard-state-'))
  return { dir, stateFile: join(dir, name) }
}

const STATE_VERSION = 1

describe('guard state precedence', () => {
  it('resolves shipped default < registered patch base < persisted override', async () => {
    const { stateFile } = await tempFile()
    await writeFile(stateFile, JSON.stringify({ version: STATE_VERSION, guard: { enabled: false } }))
    const host = await mount({ stateFile, legacyStateFile: '' })

    // Layer 3: the operator's explicit override, read from the file at mount.
    expect(host.service.getGuard().enabled).toBe(false)
    expect(host.service.getGuard().duplicateDetection).toBe(true)

    // Layer 2: the patch file's base wins over the shipped default…
    const withdraw = host.service.registerGuardBase({ enabled: true, duplicateDetection: false })
    expect(host.service.getGuard().duplicateDetection).toBe(false)
    // …but never over an explicit override, and untouched keys stay at their default.
    expect(host.service.getGuard().enabled).toBe(false)
    expect(host.service.getGuard().noProgressProtection).toBe(true)
    expect(host.service.getGuard().alternatingCycleDetection).toBe(true)

    // Withdrawing returns to the layer below: base gone, override kept.
    withdraw()
    expect(host.service.getGuard().duplicateDetection).toBe(true)
    expect(host.service.getGuard().enabled).toBe(false)
  })

  it('withdraws only its own registration and ignores a double withdrawal', async () => {
    const { stateFile } = await tempFile()
    const host = await mount({ stateFile, legacyStateFile: '' })
    const first = host.service.registerGuardBase({ enabled: false })
    host.service.registerGuardBase({ duplicateDetection: false })

    first()
    first()
    // A second withdrawal must not remove the other registration.
    expect(host.service.getGuard()).toMatchObject({ duplicateDetection: false, enabled: true })
  })
})

describe('guard state persistence', () => {
  it('writes only the changed keys and merges them with the existing file', async () => {
    const { stateFile } = await tempFile()
    await writeFile(stateFile, JSON.stringify({ version: STATE_VERSION, guard: { repeatThresholds: [4] } }))
    const host = await mount({ stateFile, legacyStateFile: '' })

    // Two independent edits: neither may drop the other key or the pre-existing one.
    await host.service.updateGuard({ enabled: false })
    await host.service.updateGuard({ duplicateDetection: false })

    expect(await readGuardState(stateFile)).toEqual({
      repeatThresholds: [4],
      enabled: false,
      duplicateDetection: false,
    })
    expect(host.service.getGuard()).toMatchObject({
      enabled: false,
      duplicateDetection: false,
      alternatingCycleDetection: true,
      noProgressProtection: true,
      repeatThresholds: [4],
    })
  })

  it('rejects illegal repeat thresholds and leaves the file and memory untouched', async () => {
    const { stateFile } = await tempFile()
    const host = await mount({ stateFile, legacyStateFile: '' })

    const illegal: unknown[] = [
      [5, 3], // not ascending
      [3, 3], // not strictly ascending
      [1, 4], // below the minimum
      [3, 51], // above the maximum
      [2, 3, 4, 5, 6, 7], // too many entries
      [], // no entry at all
      [3.5], // not an integer
      [3, '5'], // not a number
      3, // not an array
    ]
    for (const value of illegal) {
      await expect(host.service.updateGuard({ repeatThresholds: value as never }))
        .rejects.toThrow(/repeatThresholds/)
    }
    // Nothing was written at all — the file only appears on a successful save.
    await expect(stat(stateFile)).rejects.toBeDefined()
    expect(host.service.getGuard().repeatThresholds).toEqual(DEFAULT_REPEAT_THRESHOLDS)
    expect(host.service.getGuardDiagnostics().persistence.lastErrorCode).toBeUndefined()
  })

  it('normalizes a legal repeat list and persists the validated copy', async () => {
    const { stateFile } = await tempFile()
    const host = await mount({ stateFile, legacyStateFile: '' })

    await host.service.updateGuard({ repeatThresholds: [2, 4] })
    const effective = host.service.getGuard().repeatThresholds
    expect([...effective]).toEqual([2, 4])
    expect(Object.isFrozen(effective)).toBe(true)
    expect((await readGuardState(stateFile)).repeatThresholds).toEqual([2, 4])

    // A later save of a different key keeps the threshold list.
    await host.service.updateGuard({ enabled: false })
    expect(await readGuardState(stateFile)).toEqual({ repeatThresholds: [2, 4], enabled: false })
  })

  it('applies switches in memory when persistence is disabled', async () => {
    const host = await mount({ stateFile: '', legacyStateFile: '' })
    expect(host.service.stateFilePath()).toBe('')
    await host.service.updateGuard({ enabled: false })
    expect(host.service.getGuard().enabled).toBe(false)
    expect(host.service.getGuardDiagnostics().persistence).toEqual({ dirty: false })
  })
})

describe('guard state migration from the 0.1.x policy file', () => {
  it('imports the legacy guard section once and writes it to its own file', async () => {
    const { dir, stateFile } = await tempFile(join('dsh-thinking-guard', 'guard.json'))
    const legacyFile = join(dir, 'capability-menu-policy.json')
    await writeFile(legacyFile, JSON.stringify({
      version: 2,
      tools: { bash: 'resident' },
      guard: { enabled: false, repeatThresholds: [2, 4] },
    }))

    const host = await mount({ stateFile, legacyStateFile: legacyFile })
    expect(host.info.mock.calls.flat().join(' ')).toContain('migrated Guard switches')
    expect(host.service.getGuard()).toMatchObject({ enabled: false, repeatThresholds: [2, 4] })

    // Written to this plugin's own file, in the versioned envelope.
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({
      version: STATE_VERSION,
      guard: { enabled: false, repeatThresholds: [2, 4] },
    })
    // The legacy file is still the capability menu's tier state: untouched.
    expect(JSON.parse(await readFile(legacyFile, 'utf8')).tools).toEqual({ bash: 'resident' })
  })

  it('never overwrites a state file that already has choices', async () => {
    const { dir, stateFile } = await tempFile()
    const legacyFile = join(dir, 'capability-menu-policy.json')
    await writeFile(stateFile, JSON.stringify({
      version: STATE_VERSION,
      guard: { enabled: true, duplicateDetection: false },
    }))
    await writeFile(legacyFile, JSON.stringify({ guard: { enabled: false, noProgressProtection: false } }))

    const host = await mount({ stateFile, legacyStateFile: legacyFile })
    expect(host.info.mock.calls.flat().join(' ')).not.toContain('migrated Guard switches')
    expect(host.service.getGuard()).toMatchObject({ enabled: true, duplicateDetection: false, noProgressProtection: true })
    expect(await readGuardState(stateFile)).toEqual({ enabled: true, duplicateDetection: false })
  })

  for (const [label, legacyContent] of [
    ['unparseable JSON', '{ this is not json'],
    ['a corrupt guard section', JSON.stringify({ version: 2, guard: { enabled: 'yes' } })],
    ['an illegal threshold list', JSON.stringify({ version: 2, guard: { repeatThresholds: [5, 3] } })],
    ['no guard section', JSON.stringify({ version: 2, tools: { bash: 'resident' } })],
  ] as const) {
    it(`ignores ${label} in the legacy file and keeps running`, async () => {
      const { dir, stateFile } = await tempFile()
      const legacyFile = join(dir, 'capability-menu-policy.json')
      await writeFile(legacyFile, legacyContent)

      // Must not throw, and must not create a state file from a broken source.
      const host = await mount({ stateFile, legacyStateFile: legacyFile })
      expect(host.service.getGuard()).toEqual(DEFAULT_GUARD_SWITCHES)
      await expect(stat(stateFile)).rejects.toBeDefined()
    })
  }

  it('says nothing and uses defaults when the legacy file does not exist', async () => {
    const { dir, stateFile } = await tempFile()
    const host = await mount({ stateFile, legacyStateFile: join(dir, 'capability-menu-policy.json') })
    expect(host.service.getGuard()).toEqual(DEFAULT_GUARD_SWITCHES)
    expect(host.service.getGuardDiagnostics().persistence).toEqual({ dirty: false })
  })
})

describe('guard state diagnostics', () => {
  it('reports not-mounted and invalid-patch until both registrations are withdrawn', async () => {
    const { stateFile } = await tempFile()
    const host = await mount({ stateFile, legacyStateFile: '' })

    // No Guard instance registered a base: the state service alone proves nothing.
    expect(host.service.getGuardDiagnostics()).toEqual({
      available: false,
      reasons: ['not-mounted'],
      persistence: { dirty: false },
    })

    const withdrawBase = host.service.registerGuardBase({ enabled: true })
    expect(host.service.getGuardDiagnostics()).toEqual({
      available: true,
      reasons: [],
      persistence: { dirty: false },
    })

    const withdrawUnavailable = host.service.noteGuardUnavailable()
    const broken = host.service.getGuardDiagnostics()
    expect(broken.available).toBe(false)
    expect(broken.reasons).toContain('invalid-patch')
    // The Guard is mounted; only its construction failed.
    expect(broken.reasons).not.toContain('not-mounted')

    withdrawUnavailable()
    expect(host.service.getGuardDiagnostics()).toMatchObject({ available: true, reasons: [] })

    withdrawBase()
    expect(host.service.getGuardDiagnostics()).toMatchObject({ available: false, reasons: ['not-mounted'] })
  })

  it('reports write-failed, keeps the in-memory override, and clears the error on the next success', async () => {
    const { dir } = await tempFile()
    // "Parent path is a FILE": creating <blocker>/dsh-thinking-guard/guard.json must fail.
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'not a directory')
    const stateFile = join(blocker, 'guard.json')
    const host = await mount({ stateFile, legacyStateFile: '' })

    await expect(host.service.updateGuard({ enabled: false })).rejects.toThrow(/cannot persist Guard switches/)
    expect(host.warn.mock.calls.flat().join(' ')).toContain('cannot persist Guard switches')
    const failed = host.service.getGuardDiagnostics()
    expect(failed.persistence).toEqual({ dirty: false, lastErrorCode: 'write-failed' })
    // The write threw before the override layer moved: memory still says "enabled".
    expect(host.service.getGuard().enabled).toBe(true)

    // Once the path works again the pending state is durable and the error is gone.
    await unlink(blocker)
    await host.service.updateGuard({ enabled: false })
    expect(host.service.getGuard().enabled).toBe(false)
    expect(host.service.getGuardDiagnostics().persistence).toEqual({ dirty: false })
    expect((await readGuardState(stateFile)).enabled).toBe(false)
  })
})
