/**
 * TG-05: intent-level tier moves (service + real gateway roundtrip).
 *
 * One client's whole-table read-modify-write used to revert another client's
 * move because the payload carried a stale copy of every list. These tests pin
 * the replacement contract: a move names only its kind/ids/target, the Host
 * applies it to its LATEST state, journals/persists only those ids, and a failed
 * write rolls back ONLY its own ids (never another window's pending move).
 *
 * An advanced whole-set replace API is intentionally absent: the v3 per-id state
 * map cannot persist a removal, so it would report success while a remount
 * restored the old rule. `updateConfig` stays the legacy full-replace/LWW API.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import type { CapabilityPolicyService, Config } from '../src/policy.ts'
import type { CapabilityService } from '../src/registry.ts'
import { readTierState } from '../src/policy-state.ts'
import { CapabilityPolicyGateway } from '../src/server/remote.ts'
import { TYPERT_REMOTE } from '../src/client/remote.ts'
import { mountTestExecutor } from './stubs/test-executor.ts'

// Inject a single transient write failure to open the real async failure window
// deterministically; every other write still goes through the real state file.
const inject = vi.hoisted(() => ({ failWrites: 0, failDelayMs: 0, delayWrites: 0, delayMs: 0 }))
vi.mock('../src/policy-state.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/policy-state.ts')>()
  return {
    ...actual,
    writeTierState: async (file: string, moves: unknown) => {
      if (inject.delayWrites > 0) {
        inject.delayWrites -= 1
        if (inject.delayMs > 0) await new Promise(resolve => setTimeout(resolve, inject.delayMs))
      }
      if (inject.failWrites > 0) {
        inject.failWrites -= 1
        if (inject.failDelayMs > 0) await new Promise(resolve => setTimeout(resolve, inject.failDelayMs))
        throw Object.assign(new Error('injected EACCES'), { code: 'EACCES' })
      }
      return actual.writeTierState(file, moves as Parameters<typeof actual.writeTierState>[1])
    },
  }
})

async function setup(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(registry, { stateFile: '' })
  await ctx.plugin(policy, config.patchFile === undefined && config.stateFile === undefined
    ? { ...config, stateFile: '' }
    : config)
  return ctx
}

function registerTool(ctx: Context, name: string): void {
  ctx.tools.register(defineTool({
    name,
    description: 'A tool',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false }, render: () => [{ type: 'text', text: 'ok' }] },
    async execute() { return {} },
  }))
}

/** A context whose registry is a stub so a tool and a skill can share one id. */
async function stubSetup(config: Config, rows: ReadonlyArray<{ id: string; kind: 'tool' | 'skill' }>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  ctx.provide('capability', {
    search: () => [],
    get: (id: string, kind?: string) => rows.some(row => row.id === id && row.kind === kind) ? { id, kind } : undefined,
    refresh: async () => {},
    version: () => 0,
    summaryMaxChars: () => 320,
    searchSettingsEnabled: () => true,
    skillDirs: () => [],
    diagnostics: () => ({}),
  } as unknown as CapabilityService)
  await ctx.plugin(policy, { stateFile: '', ...config })
  return ctx
}

describe('TG-05 intent moves · concurrent clients', () => {
  it('applies two different-id intents instead of reverting one (V-P config0 counterexample)', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['toolA', 'toolB'] } })
    registerTool(ctx, 'toolA')
    registerTool(ctx, 'toolB')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    await svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })
    await svc.moveCapabilities({ kind: 'tool', ids: ['toolB'], target: 'resident' })

    expect(svc.classifyCapability('toolA')).toBe('disabled')
    expect(svc.classifyCapability('toolB')).toBe('resident')
    expect(svc.getConfig().tools?.disabled).toContain('toolA')
    expect(svc.getConfig().tools?.resident).toContain('toolB')
  })

  it('resolves a same-id race as last-write-wins at the Host, with no error', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['toolA'] } })
    registerTool(ctx, 'toolA')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    await svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })
    await svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'resident' })
    expect(svc.classifyCapability('toolA')).toBe('resident')
  })

  it('a failed write rolls back only its own id, never another window’s success (real temp state + Promise.all)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tg05-conc-'))
    const stateFile = join(home, 'capability-menu-policy.json')
    const patchFile = join(home, 'cordis.patch.yml')
    const ctx = await setup({ patchFile, stateFile })
    registerTool(ctx, 'toolA')
    registerTool(ctx, 'toolB')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    // A's first write attempt fails after a short delay, so B is already applied
    // in memory (the real failure window) when A's rejection lands.
    inject.failWrites = 1
    inject.failDelayMs = 25
    const [a, b] = await Promise.allSettled([
      svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' }),
      svc.moveCapabilities({ kind: 'tool', ids: ['toolB'], target: 'disabled' }),
    ])

    expect(a.status).toBe('rejected')
    expect(b.status).toBe('fulfilled')
    // A rolled back only itself; B's move survives in memory.
    expect(svc.classifyCapability('toolA')).toBe('resident')
    expect(svc.classifyCapability('toolB')).toBe('disabled')
    // B really landed on disk — A's failure did not swallow the shared journal.
    const saved = await readTierState(stateFile)
    expect(saved.tool.get('toolB')).toBe('disabled')
    expect(saved.tool.get('toolA')).toBeUndefined()
    expect(svc.getGuardDiagnostics().persistence.dirty).toBe(false)

    // A fresh mount of the same state file recovers B (and not A).
    const remounted = await setup({ patchFile, stateFile })
    expect(remounted.capabilityPolicy.classifyCapability('toolB')).toBe('disabled')
    expect(remounted.capabilityPolicy.classifyCapability('toolA')).toBe('resident')
  })

  it('a failed slow write does not revert a later SAME-id SAME-target move (same-id LWW)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tg05-sameid-'))
    const stateFile = join(home, 'capability-menu-policy.json')
    const patchFile = join(home, 'cordis.patch.yml')
    const ctx = await setup({ patchFile, stateFile })
    registerTool(ctx, 'toolA')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    inject.failWrites = 1
    inject.failDelayMs = 25
    // A grabs a slow first write; B issues the SAME id+target while it is
    // pending. A's failure must NOT revert B's later intent.
    const a = svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })
    const b = svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })
    const [ra, rb] = await Promise.allSettled([a, b])

    expect(ra.status).toBe('rejected')
    expect(rb.status).toBe('fulfilled')
    expect(svc.classifyCapability('toolA')).toBe('disabled')
    const saved = await readTierState(stateFile)
    expect(saved.tool.get('toolA')).toBe('disabled')
    expect(svc.getGuardDiagnostics().persistence.dirty).toBe(false)

    const remounted = await setup({ patchFile, stateFile })
    expect(remounted.capabilityPolicy.classifyCapability('toolA')).toBe('disabled')
  })

  it('a failing move does not swallow a concurrent legacy updateConfig journal', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tg05-legacy-'))
    const stateFile = join(home, 'capability-menu-policy.json')
    const patchFile = join(home, 'cordis.patch.yml')
    const ctx = await setup({ patchFile, stateFile, persistDebounceMs: 20 })
    registerTool(ctx, 'toolA')
    registerTool(ctx, 'toolB')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    inject.failWrites = 1
    inject.failDelayMs = 25
    // Legacy whole-config replace schedules a debounced write...
    void svc.updateConfig({ tools: { 'on-demand': ['toolB'] } })
    // ...while a failing intent move is already writing. The failed move must
    // not clear the legacy journal entry; its own timer still persists it.
    await expect(svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })).rejects.toThrow()
    await new Promise(resolve => setTimeout(resolve, 150))

    expect(svc.classifyCapability('toolB')).toBe('on-demand')
    const saved = await readTierState(stateFile)
    expect(saved.tool.get('toolB')).toBe('on-demand')
    expect(saved.tool.get('toolA')).toBeUndefined()
  })
})

describe('TG-05 intent moves · instance lifecycle', () => {
  it('rejects a NOT-YET-STARTED move when the fiber is disposed immediately (no post-dispose write)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tg05-immediate-'))
    const stateFile = join(home, 'capability-menu-policy.json')
    const patchFile = join(home, 'cordis.patch.yml')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    const fiber = await ctx.plugin(policy, { patchFile, stateFile })
    registerTool(ctx, 'toolA')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    // Enqueue without yielding: the queued task has NOT started when dispose
    // clears the fiber uid. This is the minimal window the effect-only flag
    // missed.
    const p = svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })
    const d = fiber.dispose()
    const [rp, rd] = await Promise.allSettled([p, d])

    expect(rd.status).toBe('fulfilled')
    expect(rp.status).toBe('rejected')
    if (rp.status === 'rejected') expect(String(rp.reason)).toMatch(/disposed/)
    // Nothing was written: the not-yet-started move never touched the disk.
    const saved = await readTierState(stateFile)
    expect(saved.tool.get('toolA')).toBeUndefined()
  })

  it('drops queued mutations once the policy fiber is unloaded (no post-dispose write)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tg05-unload-'))
    const stateFile = join(home, 'capability-menu-policy.json')
    const patchFile = join(home, 'cordis.patch.yml')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    const fiber = await ctx.plugin(policy, { patchFile, stateFile })
    registerTool(ctx, 'toolA')
    registerTool(ctx, 'toolB')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    inject.delayWrites = 1
    inject.delayMs = 60
    // A starts and enters its delayed write; B is queued behind it.
    const a = svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })
    await new Promise(resolve => setTimeout(resolve, 10))
    const b = svc.moveCapabilities({ kind: 'tool', ids: ['toolB'], target: 'disabled' })

    await fiber.dispose()

    // The queued mutation is rejected and never touches the state file.
    await expect(b).rejects.toThrow(/disposed/)
    await expect(a).resolves.toBeUndefined()
    const saved = await readTierState(stateFile)
    expect(saved.tool.get('toolA')).toBe('disabled')
    expect(saved.tool.get('toolB')).toBeUndefined()
  })
})

describe('TG-05 intent moves · validation', () => {
  it('rejects an unknown id and leaves the config untouched', async () => {
    const ctx = await setup({ tools: { resident: ['toolA'] } })
    registerTool(ctx, 'toolA')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy
    await expect(svc.moveCapabilities({ kind: 'tool', ids: ['does-not-exist'], target: 'disabled' }))
      .rejects.toThrow(/unknown-capability/)
    expect(svc.classifyCapability('toolA')).toBe('resident')
  })

  it('rejects an illegal target, empty ids, and an illegal kind', async () => {
    const ctx = await setup()
    registerTool(ctx, 'toolA')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy
    await expect(svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'nope' as never }))
      .rejects.toThrow(/invalid-target/)
    await expect(svc.moveCapabilities({ kind: 'tool', ids: [], target: 'resident' }))
      .rejects.toThrow(/empty-ids/)
    await expect(svc.moveCapabilities({ kind: 'server' as never, ids: ['toolA'], target: 'resident' }))
      .rejects.toThrow(/invalid-kind/)
  })

  it('refuses to hide a control-plane meta tool', async () => {
    const ctx = await setup()
    const svc = ctx.capabilityPolicy
    await expect(svc.moveCapabilities({ kind: 'tool', ids: ['meta_search'], target: 'disabled' }))
      .rejects.toThrow(/control-plane/)
    await expect(svc.moveCapabilities({ kind: 'tool', ids: ['meta_search'], target: 'resident' })).resolves.toBeUndefined()
  })

  it('keeps a same-named tool and skill independent (kind is explicit)', async () => {
    const ctx = await stubSetup(
      { tools: { resident: ['dup'] }, skills: { resident: ['dup'] } },
      [{ id: 'dup', kind: 'tool' }, { id: 'dup', kind: 'skill' }],
    )
    const svc = ctx.capabilityPolicy
    await svc.moveCapabilities({ kind: 'skill', ids: ['dup'], target: 'disabled' })
    expect(svc.classifyCapability('dup', 'skill')).toBe('disabled')
    expect(svc.classifyCapability('dup', 'tool')).toBe('resident')
  })
})

describe('TG-05 intent moves · persistence', () => {
  it('surfaces a real write failure, leaves the view unchanged, and recovers on retry', async () => {
    const prefix = ['dsh', 'tg05', 'persist'].join('-')
    const home = await mkdtemp(join(tmpdir(), prefix))
    const stateFile = join(home, 'capability-menu-policy.json')
    const ctx = await setup({ patchFile: join(home, 'cordis.patch.yml'), stateFile })
    registerTool(ctx, 'toolA')
    await ctx.capability.refresh()
    const svc = ctx.capabilityPolicy

    // Another writer corrupts the file: our persist fails, no false success.
    await writeFile(stateFile, '{ not json', 'utf8')
    await expect(svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })).rejects.toThrow()
    expect(svc.classifyCapability('toolA')).toBe('resident')

    // Repair and retry: the same intent now lands, persisted per id.
    await writeFile(stateFile, JSON.stringify({ version: 3, tools: {}, skills: {}, guard: {}, search: { descriptions: {} } }), 'utf8')
    await expect(svc.moveCapabilities({ kind: 'tool', ids: ['toolA'], target: 'disabled' })).resolves.toBeUndefined()
    expect(svc.classifyCapability('toolA')).toBe('disabled')
    const saved = await readTierState(stateFile)
    expect(saved.tool.get('toolA')).toBe('disabled')
  })

  it('does not provide an advanced whole-set replace (v3 per-id state cannot persist a removal)', async () => {
    // Documents the deliberate limitation: no such method/descriptor ships, so a
    // caller cannot get a false "removed" success that a remount would undo.
    const ctx = await setup()
    const svc = ctx.capabilityPolicy as unknown as Record<string, unknown>
    expect(typeof svc.replaceCapabilityRules).toBe('undefined')
    expect(TYPERT_REMOTE.descriptors.some(descriptor => descriptor.method === 'replaceCapabilityRules')).toBe(false)
    expect(TYPERT_REMOTE.descriptors.some(descriptor => descriptor.method === 'getConfigRevision')).toBe(false)
  })
})

describe('TG-05 intent moves · real gateway roundtrip', () => {
  it('forwards moveCapabilities through the decorated gateway and both codecs agree', async () => {
    const calls: unknown[] = []
    const ctx = new Context()
    ctx.provide('capabilityPolicy', {
      moveCapabilities: async (request: unknown) => { calls.push(request) },
    } as unknown as CapabilityPolicyService)
    ctx.provide('capability', {} as unknown as CapabilityService)
    const gateway = new CapabilityPolicyGateway(ctx)

    const move = TYPERT_REMOTE.descriptors.find(descriptor => descriptor.method === 'moveCapabilities')
    expect(move).toBeDefined()
    const request = { kind: 'tool', ids: ['toolA'], target: 'disabled' }
    type Codec = { create(): { parse(value: unknown): unknown } }
    const paramCodec = move!.parameters[0].codec as unknown as Codec
    const decoded = paramCodec.create().parse(request)
    const result = await gateway.moveCapabilities(decoded as never)
    const resultCodec = move!.result as unknown as Codec
    expect(resultCodec.create().parse(result)).toBeUndefined()
    expect(calls[0]).toEqual(request)
  })
})
