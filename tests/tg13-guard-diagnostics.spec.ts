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

/** A state file path whose parent is a regular file: every write fails ENOTDIR. */
async function blockedStateFile(): Promise<{ dir: string; blocker: string; stateFile: string }> {
  const dir = await tempDir()
  const blocker = join(dir, 'blocked')
  await writeFile(blocker, 'not a directory')
  return { dir, blocker, stateFile: join(blocker, 'capability-menu-policy.json') }
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

    await ctx.capabilityPolicy.updateConfig({ skills: { 'on-demand': ['pending-skill'] } })
    // A real flush must reject: the caller asked for durability and did not get it.
    await expect(ctx.capabilityPolicy.flushPersistence()).rejects.toThrow()
    expect(ctx.capabilityPolicy.getGuardDiagnostics().persistence).toEqual({
      dirty: true, lastErrorCode: 'write-failed',
    })

    // Recover the filesystem: replace the blocking file with a directory.
    await unlink(blocker)
    await mkdir(blocker, { recursive: true })
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

    await ctx.capabilityPolicy.updateConfig({ skills: { 'on-demand': ['debounced-skill'] } })
    // Drive the debounce; the failure happens inside a fire-and-forget write.
    clock.fire()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(ctx.capabilityPolicy.getGuardDiagnostics().persistence).toEqual({
      dirty: true, lastErrorCode: 'write-failed',
    })
    // No unhandled rejection, and the journal is preserved for a later retry.
    await unlink(blocker)
    await mkdir(blocker, { recursive: true })
    await ctx.capabilityPolicy.flushPersistence()
    expect(ctx.capabilityPolicy.getGuardDiagnostics().persistence).toEqual({ dirty: false })
    await rm(dir, { recursive: true, force: true })
  })
})

// - 3. the new remote really round-trips through Host and browser codecs ------

describe('TG-13 - getGuardDiagnostics remote roundtrip', () => {
  it('serves a value the browser descriptor decodes, and both faces agree', async () => {
    const { dir, stateFile } = await blockedStateFile()
    const ctx = await mountPolicy({ stateFile, patchFile: '' })
    await ctx.plugin(guardPlugin, {})
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
