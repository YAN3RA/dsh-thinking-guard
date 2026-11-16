/**
 * TG-02 regression: default < Guard patch base < explicit persisted override.
 *
 * Two layers of evidence live here:
 *
 * 1. REAL cordis lifecycle - the policy and Guard are mounted as actual cordis
 *    plugins, so base registration, withdrawal on Guard unload, and
 *    re-registration after a policy replacement are the real fiber paths,
 *    not a hand-rolled fake.
 * 2. Hook-level behaviour - the same real policy service is driven through the
 *    Guard hooks, so the effective switch (not a stale patch snapshot) is what
 *    decides whether a reminder or a denial happens.
 *
 * The defect being pinned: getGuard() used to return a fully defaulted object,
 * so live?.key ?? patch.key always took the default and every patch value was
 * lost; separately, admitStep/observeTool read the construction-time config,
 * so the core and the hooks could disagree about enabled.
 */
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
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
import { mountTestExecutor } from './stubs/test-executor.ts'

const DEFAULT_PATCH = {
  duplicateDetection: false,
  alternatingCycleDetection: false,
  noProgressProtection: false,
  repeatThresholds: [20, 30, 50] as number[],
}

/** Mount the policy plugin alone; the Guard is mounted per-test. */
async function mountPolicy(stateFile = ''): Promise<Context> {
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
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tg02-'))
  return join(dir, 'capability-menu-policy.json')
}

/**
 * A minimal host that only needs what the Guard touches, but whose policy face
 * is the REAL service from a mounted policy plugin. inject is deliberately
 * absent so the Guard exercises its "policy already here" fallback path.
 */
function fakeHost(service: policy.CapabilityPolicyService) {
  const hooks = new Map<string, (...args: unknown[]) => unknown>()
  let registeredGuard: ((execution: unknown) => string | undefined) | undefined
  const disposers: Array<() => void> = []
  let cleanup: (() => void) | undefined
  const ctx = {
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    capabilityPolicy: service,
    get: (key: string) => (key === 'capabilityPolicy' ? service : undefined),
    tools: {
      guard: (callback: (execution: unknown) => string | undefined) => {
        registeredGuard = callback
        const dispose = vi.fn()
        disposers.push(dispose)
        return dispose
      },
    },
    on: (name: string, handler: (...args: unknown[]) => unknown) => {
      hooks.set(name, handler)
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    },
    effect: (factory: () => () => void) => { cleanup = factory() },
  }
  return {
    ctx: ctx as unknown as Context,
    hooks,
    guard: () => registeredGuard!,
    dispose: () => { cleanup?.(); for (const disposer of disposers.splice(0)) disposer() },
  }
}

type Host = ReturnType<typeof fakeHost>
type Agent = { inject: ReturnType<typeof vi.fn> }

function success(value: unknown) {
  return { isError: false, value, content: [{ type: 'text', text: JSON.stringify(value) }] }
}

async function preStep(host: Host, agent: Agent, turn = 1): Promise<void> {
  const next = vi.fn(async () => ({ kind: 'continue' }))
  await host.hooks.get('agent/pre-step')!({ agent, turn }, next)
}

/** One identical business call through the real hooks; returns the denial text, if any. */
async function runTool(host: Host, agent: Agent, index: number, result: unknown): Promise<string | undefined> {
  const call = { agent, name: 'write', arguments: { path: 'same' }, callId: 'c-' + index }
  const denial = host.guard()(call)
  if (denial !== undefined) {
    host.hooks.get('tools/result')!(call, { isError: true, error: { message: denial }, content: [{ type: 'text', text: denial }] })
    return denial
  }
  const next = vi.fn(async () => result)
  await host.hooks.get('tools/execute')!(call, next)
  host.hooks.get('tools/result')!(call, result)
  return undefined
}

function injected(agent: Agent): string {
  return agent.inject.mock.calls.flat().map((message) => {
    const value = message as { content?: Array<{ type?: string; text?: string }> }
    return value.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? ''
  }).join('\n')
}

// - 1. REAL cordis: base registration, withdrawal, re-registration ----------

describe('TG-02 - real cordis base lifecycle', () => {
  it('applies the patch values when no UI choice was ever saved', async () => {
    const ctx = await mountPolicy()
    expect(ctx.capabilityPolicy.getGuard().duplicateDetection).toBe(true)
    await ctx.plugin(guardPlugin, DEFAULT_PATCH)

    const live = ctx.capabilityPolicy.getGuard()
    expect(live.duplicateDetection).toBe(false)
    expect(live.alternatingCycleDetection).toBe(false)
    expect(live.noProgressProtection).toBe(false)
    expect(live.repeatThresholds).toEqual([20, 30, 50])
    expect(ctx.capabilityPolicy.getGuardDiagnostics()).toEqual({
      available: true, reasons: [], persistence: { dirty: false },
    })
  })

  it('withdraws the base when the Guard unloads and cannot claim it still runs', async () => {
    const ctx = await mountPolicy()
    const guardFiber = await ctx.plugin(guardPlugin, DEFAULT_PATCH)
    expect(ctx.capabilityPolicy.getGuard().duplicateDetection).toBe(false)

    await guardFiber.dispose()

    // Back to the shipped defaults: the patch value is gone with its owner.
    expect(ctx.capabilityPolicy.getGuard().duplicateDetection).toBe(true)
    // available is NOT "no reasons": it is proven by a live registration.
    expect(ctx.capabilityPolicy.getGuardDiagnostics()).toEqual({
      available: false, reasons: ['not-mounted'], persistence: { dirty: false },
    })
  })

  it('re-registers on a replacement policy instance without a stale base', async () => {
    const stateFile = await tempStateFile()
    const first = await mountPolicy(stateFile)
    await first.plugin(guardPlugin, DEFAULT_PATCH)
    expect(first.capabilityPolicy.getGuard().duplicateDetection).toBe(false)

    // A reload replaces the policy plugin: the Guard must land its base on the
    // NEW service, not keep the old one alive.
    const second = await mountPolicy(stateFile)
    await second.plugin(guardPlugin, DEFAULT_PATCH)
    expect(second.capabilityPolicy.getGuard().duplicateDetection).toBe(false)
    expect(second.capabilityPolicy.getGuardDiagnostics().available).toBe(true)
  })

  it('reports not-mounted when only the policy is mounted', async () => {
    const ctx = await mountPolicy()
    expect(ctx.capabilityPolicy.getGuardDiagnostics()).toEqual({
      available: false, reasons: ['not-mounted'], persistence: { dirty: false },
    })
  })
})

// - 2. precedence through the real policy service ----------------------------

describe('TG-02 - precedence', () => {
  it('lets one explicit UI key win without resetting the other patch keys', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, DEFAULT_PATCH)

    await service.updateGuard({ noProgressProtection: true })
    const live = service.getGuard()
    expect(live.noProgressProtection).toBe(true)
    expect(live.duplicateDetection).toBe(false)
    expect(live.alternatingCycleDetection).toBe(false)
    expect(live.repeatThresholds).toEqual([20, 30, 50])
    host.dispose()
  })

  it('keeps an explicit override even when it equals the shipped default', async () => {
    const stateFile = await tempStateFile()
    const service = (await mountPolicy(stateFile)).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, DEFAULT_PATCH)

    // duplicateDetection defaults to true; the patch says false. An explicit
    // "true" is still a real choice and must NOT be mistaken for "unset".
    await service.updateGuard({ duplicateDetection: true })
    expect(service.getGuard().duplicateDetection).toBe(true)
    const saved = JSON.parse(await readFile(stateFile, 'utf8')) as { guard?: { duplicateDetection?: boolean } }
    expect(saved.guard?.duplicateDetection).toBe(true)

    const reloaded = (await mountPolicy(stateFile)).capabilityPolicy
    expect(reloaded.getGuard().duplicateDetection).toBe(true)
    host.dispose()
  })

  it('does not rewrite the state file merely by loading it', async () => {
    const stateFile = await tempStateFile()
    await writeFile(stateFile, JSON.stringify({
      version: 3, tools: {}, skills: {}, guard: { duplicateDetection: true }, search: { descriptions: {} },
    }))
    const before = await stat(stateFile)
    const ctx = await mountPolicy(stateFile)
    await ctx.plugin(guardPlugin, DEFAULT_PATCH)
    const after = await stat(stateFile)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(ctx.capabilityPolicy.getGuard().duplicateDetection).toBe(true)
  })
})

// - 3. hook behaviour: patch false is really off; live switch really switches -

describe('TG-02 - live switches drive the hooks', () => {
  it('honours patch-false detection with zero reminders and zero denials', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, DEFAULT_PATCH)
    const agent: Agent = { inject: vi.fn() }
    await preStep(host, agent)
    const same = success({ rows: [1] })
    for (let index = 1; index <= 10; index += 1) {
      expect(await runTool(host, agent, index, same)).toBeUndefined()
    }
    expect(injected(agent)).toBe('')
    host.dispose()
  })

  it('switches off and back on within one turn and on the next turn', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, {})
    const agent: Agent = { inject: vi.fn() }
    const same = success({ rows: [2] })

    await service.updateGuard({ enabled: false })
    await preStep(host, agent, 1)
    for (let index = 1; index <= 5; index += 1) expect(await runTool(host, agent, index, same)).toBeUndefined()
    expect(injected(agent)).toBe('')

    // Same turn: flip on, the very next calls must start counting.
    await service.updateGuard({ enabled: true })
    for (let index = 6; index <= 8; index += 1) expect(await runTool(host, agent, index, same)).toBeUndefined()
    expect(injected(agent)).toContain('第 3 次')

    // New turn: flip off again and the fresh turn stays silent.
    await service.updateGuard({ enabled: false })
    const silent: Agent = { inject: vi.fn() }
    await preStep(host, silent, 2)
    for (let index = 1; index <= 8; index += 1) expect(await runTool(host, silent, index, same)).toBeUndefined()
    expect(injected(silent)).toBe('')
    host.dispose()
  })

  it('lets the core and the hooks agree: patch-off + UI-on still builds state and reminds', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, { enabled: false })
    await service.updateGuard({ enabled: true })

    const agent: Agent = { inject: vi.fn() }
    await preStep(host, agent)
    const same = success({ rows: [3] })
    for (let index = 1; index <= 3; index += 1) expect(await runTool(host, agent, index, same)).toBeUndefined()
    // A reminder only exists if admitStep DID create turn state - the exact
    // case the old construction-time switch made impossible.
    expect(injected(agent)).toContain('第 3 次')
    host.dispose()
  })

  it('keeps the two detectors independent at the patch layer', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, { duplicateDetection: false, alternatingCycleDetection: true })
    const agent: Agent = { inject: vi.fn() }
    await preStep(host, agent)

    const legs = [['tool-a', 1], ['tool-b', 2], ['tool-a', 1], ['tool-b', 2]] as const
    for (let index = 0; index < legs.length; index += 1) {
      const name = legs[index][0]
      const step = legs[index][1]
      const call = { agent, name, arguments: { step }, callId: 'cycle-' + index }
      const next = vi.fn(async () => success({ ok: true }))
      await host.hooks.get('tools/execute')!(call, next)
      host.hooks.get('tools/result')!(call, success({ ok: true }))
    }
    expect(injected(agent)).toContain('交替工具调用循环')
    host.dispose()
  })
})

// - 4. turn isolation: no evidence may cross a turn boundary ---------------

describe('TG-02 - turn isolation without disabling the Guard', () => {
  /** 8 identical calls build a pending block candidate at threshold 8. */
  async function buildPendingCandidate(host: Host, agent: Agent, same: unknown): Promise<void> {
    for (let index = 1; index <= 8; index += 1) {
      expect(await runTool(host, agent, index, same)).toBeUndefined()
    }
  }

  it('drops the previous turn pending candidate when switched off across a turn', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, { duplicateDetection: true, alternatingCycleDetection: false, noProgressProtection: true })
    const agent: Agent = { inject: vi.fn() }
    const same = success({ rows: [7] })

    await preStep(host, agent, 1)
    await buildPendingCandidate(host, agent, same)

    // Off for the turn boundary, then on again before the first tool call.
    await service.updateGuard({ enabled: false })
    await preStep(host, agent, 2)
    await service.updateGuard({ enabled: true })

    // Turn 2's first identical call must NOT consume turn 1's candidate.
    expect(await runTool(host, agent, 9, same)).toBeUndefined()
    host.dispose()
  })

  it('drops the previous turn repeat history when switched off across a turn', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, { duplicateDetection: true, alternatingCycleDetection: false, noProgressProtection: true })
    const agent: Agent = { inject: vi.fn() }
    const same = success({ rows: [8] })

    await preStep(host, agent, 1)
    // Four calls: history exists, no block candidate yet (candidates come at 8).
    for (let index = 1; index <= 4; index += 1) expect(await runTool(host, agent, index, same)).toBeUndefined()
    expect(injected(agent)).toContain('第 3 次')

    await service.updateGuard({ enabled: false })
    await preStep(host, agent, 2)
    await service.updateGuard({ enabled: true })

    // If the old count of 4 survived, this call would be the 5th and remind.
    expect(await runTool(host, agent, 9, same)).toBeUndefined()
    expect(injected(agent)).not.toContain('第 5 次')
    host.dispose()
  })

  it('does not let a late result from the old turn pollute the new turn', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, { duplicateDetection: true, alternatingCycleDetection: false, noProgressProtection: true })
    const agent: Agent = { inject: vi.fn() }
    const same = success({ rows: [9] })

    await preStep(host, agent, 1)
    // Dispatch in turn 1 but do not settle it yet.
    const oldCall = { agent, name: 'write', arguments: { path: 'same' }, callId: 'late-1' }
    const next = vi.fn(async () => same)
    await host.hooks.get('tools/execute')!(oldCall, next)

    await service.updateGuard({ enabled: false })
    await preStep(host, agent, 2)
    await service.updateGuard({ enabled: true })

    // The old turn's result arrives after turn 2 has begun.
    host.hooks.get('tools/result')!(oldCall, same)

    // Two fresh turn-2 calls must be counted from one, not from the stale record.
    expect(await runTool(host, agent, 10, same)).toBeUndefined()
    expect(await runTool(host, agent, 11, same)).toBeUndefined()
    expect(injected(agent)).not.toContain('第 3 次')
    host.dispose()
  })

  it('keeps same-turn hot switching working (no regression)', async () => {
    const service = (await mountPolicy()).capabilityPolicy
    const host = fakeHost(service)
    guardPlugin.apply(host.ctx, {})
    const agent: Agent = { inject: vi.fn() }
    const same = success({ rows: [10] })
    await preStep(host, agent, 1)
    for (let index = 1; index <= 2; index += 1) expect(await runTool(host, agent, index, same)).toBeUndefined()
    await service.updateGuard({ enabled: false })
    expect(await runTool(host, agent, 3, same)).toBeUndefined()
    await service.updateGuard({ enabled: true })
    expect(await runTool(host, agent, 4, same)).toBeUndefined()
    // Counting resumed inside the SAME turn: the third observed call reminds.
    expect(injected(agent)).toContain('第 3 次')
    host.dispose()
  })
})
