/**
 * TG-13 regression: configuration and persistence failures must be visible.
 *
 * Three behaviours are pinned:
 *  - an illegal patch disables ONLY the Guard sub-plugin and reports a fixed
 *    code, instead of throwing out of apply with no machine-readable answer;
 *  - an explicit flush REJECTS when the write really failed, and the journal
 *    survives so the next attempt can succeed;
 *  - the debounce path swallows its rejection but exposes dirty + a fixed code.
 *
 * Plus a real Host<->client roundtrip for the new diagnostics remote: the
 * gateway returns it and the browser descriptor's strict codec decodes it.
 */
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import * as guardPlugin from '../src/guard.ts'
import { CapabilityPolicyGateway } from '../src/server/remote.ts'
import { TYPERT_REMOTE } from '../src/client/remote.ts'
import { capabilityPolicyHostFace } from '../src/host-face.ts'
import { mountTestExecutor } from './stubs/test-executor.ts'

class ManualClock implements policy.PolicyTimer {
  private readonly pending = new Map<number, () => void>()
  private lastId = 0
  set(callback: () => void): unknown {
    this.lastId += 1
    this.pending.set(this.lastId, callback)
    return this.lastId
  }
  clear(handle: unknown): void { this.pending.delete(handle as number) }
  fire(): void {
    const due = [...this.pending.values()]
    this.pending.clear()
    for (const callback of due) callback()
  }
}

async function mountPolicy(config: policy.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(registry, { stateFile: '' })
  await ctx.plugin(policy, config)
  return ctx
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-tg13-'))
}

/**
 * A state file that mounts fine and then refuses every write.
 *
 * The write must fail AFTER apply has read the (empty) state: making the parent a
 * regular file up front fails earlier and for a different reason - apply throws
 * `ENOTDIR` out of the state read, which is not the write-failure path TG-13 is
 * about. So the file starts as a valid, empty state and the *directory* is
 * replaced by a regular file, which makes every later write and atomic rename
 * fail with ENOTDIR on every platform (a read-only directory would not: POSIX
 * lets root ignore the mode bits, and the Windows CI job has no such bits).
 */
async function blockedStateFile(): Promise<{ dir: string; blocker: string; stateFile: string }> {
  const dir = await tempDir()
  const blocker = join(dir, 'blocked')
  await mkdir(blocker, { recursive: true })
  const stateFile = join(blocker, 'capability-menu-policy.json')
  await writeFile(stateFile, JSON.stringify({ version: 3 }))
  return { dir, blocker, stateFile }
}

/** Replace the state file's directory with a regular file: writes now fail ENOTDIR. */
async function blockWrites(blocker: string): Promise<void> {
  await rm(blocker, { recursive: true, force: true })
  await writeFile(blocker, 'not a directory')
}

/** Turn the blocker back into a writable directory. */
async function unblockWrites(blocker: string): Promise<void> {
  await unlink(blocker)
  await mkdir(blocker, { recursive: true })
}

// - 1. illegal patch: only the Guard sub-plugin is disabled -------------------

describe('TG-13 - illegal patch degrades only the Guard', () => {
  it('does not throw, registers no hooks, and reports invalid-patch', async () => {
    const ctx = await mountPolicy({ stateFile: '' })
    const policyService = ctx.capabilityPolicy

    const hooks = new Map<string, unknown>()
    const toolGuard = vi.fn()
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    const fakeCtx = {
      logger,
      capabilityPolicy: policyService,
      get: (key: string) => (key === 'capabilityPolicy' ? policyService : undefined),
      tools: { guard: (callback: unknown) => { toolGuard(callback); return vi.fn() } },
      on: (name: string, handler: unknown) => { hooks.set(name, handler); return vi.fn() },
      effect: (factory: () => () => void) => factory(),
    }

    // [3,3] is a legal array of numbers at the schema layer and illegal to the
    // detector: this must be caught inside apply, not escape the fiber.
    expect(() => guardPlugin.apply(fakeCtx as never, { repeatThresholds: [3, 3] })).not.toThrow()
    expect(toolGuard).not.toHaveBeenCalled()
    expect(hooks.size).toBe(0)
    expect(logger.error).toHaveBeenCalled()
    const logged = String(logger.error.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain('invalid patch')

    // The rest of the plugin keeps working, and the diagnosis is machine-read.
    expect(policyService.classifyAll()).toEqual([])
    expect(policyService.getGuardDiagnostics()).toEqual({
      available: false,
      reasons: ['invalid-patch', 'not-mounted'],
      persistence: { dirty: false },
    })
  })

  it('reports invalid-patch on the real cordis mount without taking siblings down', async () => {
    const ctx = await mountPolicy({ stateFile: '' })
    await ctx.plugin(guardPlugin, { profiles: { normal: {
      softSteps: 8, hardSteps: 8, softToolCalls: 1, hardToolCalls: 2, softDurationMs: 1, hardDurationMs: 2,
    } } })
    // A sibling sub-plugin (the gateway) still answers.
    const gateway = new CapabilityPolicyGateway(ctx)
    expect(gateway.getGuardDiagnostics().available).toBe(false)
    expect(gateway.getGuardDiagnostics().reasons).toContain('invalid-patch')
    expect(gateway.getGuard().enabled).toBe(true)
  })
})

// - 2. explicit flush rejects, journal survives, retry succeeds -----------------

describe('TG-13 - explicit flush reports a real write failure', () => {
  it('rejects on failure, keeps the pending move, and succeeds after recovery', async () => {
    const { dir, blocker, stateFile } = await blockedStateFile()
    const clock = new ManualClock()
    const ctx = await mountPolicy({ stateFile, patchFile: '', persistDebounceMs: 50, timer: clock })
    await blockWrites(blocker)

    await ctx.capabilityPolicy.updateConfig({ skills: { 'on-demand': ['pending-skill'] } })
    // A real flush must reject: the caller asked for durability and did not get it.
    await expect(ctx.capabilityPolicy.flushPersistence()).rejects.toThrow()
    expect(ctx.capabilityPolicy.getGuardDiagnostics().persistence).toEqual({
      dirty: true, lastErrorCode: 'write-failed',
    })

    // Recover the filesystem: replace the blocking file with a directory.
    await unblockWrites(blocker)
    await ctx.capabilityPolicy.flushPersistence()
    expect(ctx.capabilityPolicy.getGuardDiagnostics().persistence).toEqual({ dirty: false })
    const saved = JSON.parse(await (await import('node:fs/promises')).readFile(stateFile, 'utf8')) as {
      skills?: Record<string, string>
    }
    expect(saved.skills?.['pending-skill']).toBe('on-demand')
    await rm(dir, { recursive: true, force: true })
  })

  it('leaves the debounce rejection swallowed but exposes dirty + write-failed', async () => {
    const { dir, blocker, stateFile } = await blockedStateFile()
    const clock = new ManualClock()
    const ctx = await mountPolicy({ stateFile, patchFile: '', persistDebounceMs: 50, timer: clock })
    await blockWrites(blocker)

    await ctx.capabilityPolicy.updateConfig({ skills: { 'on-demand': ['debounced-skill'] } })
    // Drive the debounce; the failure happens inside a fire-and-forget write.
    clock.fire()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(ctx.capabilityPolicy.getGuardDiagnostics().persistence).toEqual({
      dirty: true, lastErrorCode: 'write-failed',
    })
    // No unhandled rejection, and the journal is preserved for a later retry.
    await unblockWrites(blocker)
    await ctx.capabilityPolicy.flushPersistence()
    expect(ctx.capabilityPolicy.getGuardDiagnostics().persistence).toEqual({ dirty: false })
    await rm(dir, { recursive: true, force: true })
  })
})

// - 3. the new remote really round-trips through Host and browser codecs ------

describe('TG-13 - getGuardDiagnostics remote roundtrip', () => {
  it('serves a value the browser descriptor decodes, and both faces agree', async () => {
    const { dir, blocker, stateFile } = await blockedStateFile()
    const ctx = await mountPolicy({ stateFile, patchFile: '' })
    await ctx.plugin(guardPlugin, {})
    await blockWrites(blocker)
    await ctx.capabilityPolicy.updateConfig({ skills: { 'on-demand': ['rt-skill'] } })
    await expect(ctx.capabilityPolicy.flushPersistence()).rejects.toThrow()

    const gateway = new CapabilityPolicyGateway(ctx)
    const served = gateway.getGuardDiagnostics()
    expect(served).toEqual({
      available: true, reasons: [], persistence: { dirty: true, lastErrorCode: 'write-failed' },
    })

    // Browser side: the descriptor exists, and its strict schema parses the value.
    const descriptor = TYPERT_REMOTE.descriptors.find(entry => entry.method === 'getGuardDiagnostics')
    expect(descriptor).toBeDefined()
    const codec = descriptor!.result as unknown as { create: () => { parse: (value: unknown) => unknown } }
    const decoded = codec.create().parse(JSON.parse(JSON.stringify(served)))
    expect(decoded).toEqual(served)
    // The closed allowlist rejects anything that is not a fixed code.
    expect(() => codec.create().parse({
      available: false, reasons: ['oauth-token-expired'], persistence: { dirty: false },
    })).toThrow()
    expect(() => codec.create().parse({
      available: true, reasons: [], persistence: { dirty: false, lastErrorCode: 'EACCES /home/x' },
    })).toThrow()
    // Host face advertises the same endpoint.
    const endpoints = capabilityPolicyHostFace().invocations.map(entry => entry.method)
    expect(endpoints).toContain('getGuardDiagnostics')
    await rm(dir, { recursive: true, force: true })
  })
})
