import type { Context } from '@deepseek-ai/cordis'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply, Config } from '../src/guard.ts'
import { FINGERPRINT_MAX_BYTES } from '../src/guard-loop-core.ts'

/**
 * Counts real fingerprint computations without changing them. The wrapper
 * delegates to the shipped implementation, so every other assertion in this file
 * sees unchanged behaviour while these tests can prove a payload was never
 * canonicalized at all — as opposed to being hashed and then discarded.
 */
const fingerprintCalls = vi.hoisted(() => ({ result: 0, signature: 0 }))
vi.mock('../src/guard-loop-core.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/guard-loop-core.ts')>()
  return {
    ...actual,
    guardResultFingerprint: (...args: Parameters<typeof actual.guardResultFingerprint>) => {
      fingerprintCalls.result += 1
      return actual.guardResultFingerprint(...args)
    },
    guardToolSignature: (...args: Parameters<typeof actual.guardToolSignature>) => {
      fingerprintCalls.signature += 1
      return actual.guardToolSignature(...args)
    },
  }
})

type Execution = { callId: string; agent: { inject: ReturnType<typeof vi.fn> }; name: string; arguments: unknown }
type Result = { isError: boolean; value?: unknown; error?: { message: string; info?: { name: string; code: string } }; content: Array<{ type: string; text?: string }> }

function injectedText(agent: Execution['agent']): string {
  return agent.inject.mock.calls.flat().map((message) => {
    const value = message as { content?: Array<{ type?: string; text?: string }> }
    return value.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? ''
  }).join('\n')
}

function setup(config: Parameters<typeof apply>[1] = {}) {
  const hooks = new Map<string, (...args: any[]) => any>()
  const warn = vi.fn(), info = vi.fn(), toolGuard = vi.fn(), toolBodies = vi.fn()
  let registeredGuard: ((execution: any) => string | undefined) | undefined
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  const capabilityPolicy = { metaTools: vi.fn(() => ['meta_search', 'meta_invoke']) }
  let cleanup: (() => void) | undefined
  const ctx = {
    logger: { warn, info }, capabilityPolicy,
    // The Guard reads live switches through `ctx.get('capabilityPolicy')`; a
    // host without that service falls back to the patch config, which is what
    // `undefined` models here.
    get: (key: string) => (key === 'capabilityPolicy' ? undefined : undefined),
    tools: { guard: (callback: (execution: any) => string | undefined) => {
      toolGuard(callback)
      registeredGuard = callback
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    } },
    on: (name: string, handler: (...args: any[]) => any) => {
      hooks.set(name, handler)
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    },
    effect: (factory: () => () => void) => { cleanup = factory() },
  }
  apply(ctx as unknown as Context, config)
  return { hooks, warn, info, toolGuard, toolBodies, capabilityPolicy, registeredGuard: () => registeredGuard, disposers, cleanup: () => cleanup?.() }
}

type TestHost = ReturnType<typeof setup>

function execution(agent: Execution['agent'], name: string, args: unknown, callId: string): Execution {
  return { agent, name, arguments: args, callId }
}

function success(value: unknown, text = JSON.stringify(value)): Result {
  return { isError: false, value, content: [{ type: 'text', text }] }
}

async function prepareTurn(host: TestHost, agent: Execution['agent']): Promise<void> {
  const next = vi.fn(async () => ({ kind: 'continue' }))
  await host.hooks.get('agent/pre-step')!({ agent, turn: 1 }, next)
}

async function executeOnly(host: TestHost, call: Execution, result: Result = success({ ok: true }), prepared = false): Promise<void> {
  if (!prepared) await prepareTurn(host, call.agent)
  const execute = host.hooks.get('tools/execute')!
  const next = vi.fn(async () => result)
  await execute(call, next)
  if (next.mock.calls.length > 0) host.toolBodies(call)
}

function resultOnly(host: TestHost, call: Execution, result: Result): void {
  host.hooks.get('tools/result')!(call, result)
}

async function runTool(host: TestHost, call: Execution, result: Result): Promise<string | undefined> {
  await prepareTurn(host, call.agent)
  const denial = host.registeredGuard()!(call)
  if (denial !== undefined) {
    resultOnly(host, call, { isError: true, error: { message: denial }, content: [{ type: 'text', text: denial }] })
    return denial
  }
  await executeOnly(host, call, result, true)
  resultOnly(host, call, result)
  return undefined
}

describe('Guard Host hooks', () => {
  it('reports disabled state and does not inject reminders', async () => {
    const host = setup({ enabled: false })
    expect(host.info.mock.calls.flat().join(' ')).toContain('thinking-guard: disabled;')
    const agent = { inject: vi.fn() }
    const next = vi.fn(async () => ({ kind: 'continue' }))
    expect(await host.hooks.get('agent/pre-step')!({ agent, turn: 1 }, next)).toEqual({ kind: 'continue' })
    expect(await host.hooks.get('tools/execute')!(execution(agent, 'write', {}, 'd1'), next)).toEqual({ kind: 'continue' })
    expect(agent.inject).not.toHaveBeenCalled()
  })

  it('accepts legacy schema switches and keeps steps running without convergence prompts', async () => {
    const parsed = Config({ stepLimitMode: 'hard-stop', duplicateHardBlock: true })
    const host = setup(parsed)
    expect(host.warn).toHaveBeenCalledTimes(2)
    expect(host.warn.mock.calls.flat().join(' ')).toMatch(/stepLimitMode=hard-stop/)
    expect(host.warn.mock.calls.flat().join(' ')).toMatch(/duplicateHardBlock/)
    expect(host.toolGuard).toHaveBeenCalledOnce()
    expect(host.registeredGuard()).toBeTypeOf('function')
    expect(host.hooks.has('agent/turn-stopping')).toBe(false)
    const agent = { inject: vi.fn() }, messages: unknown[] = []
    const next = vi.fn(async () => ({ kind: 'continue' }))
    for (let i = 0; i < 30; i++) {
      expect(await host.hooks.get('agent/pre-step')!({ agent, turn: 1, messages }, next)).toEqual({ kind: 'continue' })
    }
    expect(next).toHaveBeenCalledTimes(30)
    expect(agent.inject).not.toHaveBeenCalled()
    expect(messages).toEqual([])
  })

  it('warns at repeat thresholds and only locally denies after unchanged evidence', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const callFor = (index: number) => execution(agent, 'write', { path: 'same' }, `w-${index}`)
    const same = success({ rows: [1] })
    for (let i = 1; i <= 8; i++) {
      expect(await runTool(host, callFor(i), same)).toBeUndefined()
      if ([3, 5, 8].includes(i)) expect(injectedText(agent)).toContain(`第 ${i} 次`)
    }
    expect(await runTool(host, callFor(9), same)).toContain('局部拒绝')
    expect(await runTool(host, callFor(10), same)).toBeUndefined()
    expect(await runTool(host, callFor(11), same)).toBeUndefined()
  })

  it('does not locally block common read-only tools even when their result is unchanged', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const same = success({ rows: ['same'] })
    for (let i = 1; i <= 10; i++) {
      expect(await runTool(host, execution(agent, 'read', { path: 'a' }, `r-${i}`), same)).toBeUndefined()
    }
    expect(injectedText(agent)).toContain('第 3 次')
    expect(injectedText(agent)).toContain('第 5 次')
    expect(injectedText(agent)).toContain('第 8 次')
  })

  it('excludes configured polling tools and default image/job status polling', async () => {
    const host = setup({ excludedTools: ['custom_poll'], pollingTools: ['custom_wait'] })
    const agent = { inject: vi.fn() }
    for (const name of ['get_image_generation_task', 'job_output', 'custom_poll', 'custom_wait']) {
      for (let i = 0; i < 10; i++) {
        expect(await runTool(host, execution(agent, name, { id: 'job-1' }, `${name}-${i}`), success({ status: 'running' }))).toBeUndefined()
      }
    }
    expect(injectedText(agent)).toBe('')
    expect(host.registeredGuard()!(execution(agent, 'job_output', { id: 'job-1' }, 'poll-next'))).toBeUndefined()
  })

  it('uses live policy metaTools and excludes the reserved run_code transport', async () => {
    const host = setup()
    host.capabilityPolicy.metaTools.mockReturnValue(['meta_find'])
    const agent = { inject: vi.fn() }
    for (const name of ['meta_find', 'run_code']) {
      for (let i = 0; i < 10; i++) {
        await runTool(host, execution(agent, name, { query: 'x' }, `${name}-${i}`), success({ ok: true }))
      }
    }
    expect(injectedText(agent)).toBe('')
  })

  it('orders parallel results by callId dispatch sequence instead of completion order', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const calls = [
      execution(agent, 'tool-a', { id: 'a1' }, 'a1'),
      execution(agent, 'tool-a', { id: 'a2' }, 'a2'),
      execution(agent, 'tool-b', { id: 'b1' }, 'b1'),
      execution(agent, 'tool-b', { id: 'b2' }, 'b2'),
    ]
    for (const call of calls) await executeOnly(host, call)
    const unchanged = success({ stable: true })
    for (const index of [0, 2, 1, 3]) resultOnly(host, calls[index], unchanged)
    expect(injectedText(agent)).not.toContain('交替工具调用序列')
    expect(host.registeredGuard()!(execution(agent, 'tool-a', { id: 'a3' }, 'a3'))).toBeUndefined()
  })

  it('fails open when an earlier dispatch result is unresolved beyond the bounded queue', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    for (let i = 0; i < 65; i++) await executeOnly(host, execution(agent, 'write', { i }, `gap-${i}`))
    for (let i = 0; i < 65; i++) resultOnly(host, execution(agent, 'write', { i }, `gap-${i}`), success({ stable: true }))
    expect(host.registeredGuard()!(execution(agent, 'write', { i: 99 }, 'after-overflow'))).toBeUndefined()
  })

  it('does not count a Guard denial or feed its result back into loop evidence', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const call = (i: number) => execution(agent, 'write', { path: 'same' }, `deny-${i}`)
    const same = success({ stable: true })
    for (let i = 1; i <= 8; i++) await runTool(host, call(i), same)
    expect(await runTool(host, call(9), same)).toContain('局部拒绝')
    expect(host.toolBodies).toHaveBeenCalledTimes(8)
    expect(await runTool(host, call(10), same)).toBeUndefined()
    expect(host.toolBodies).toHaveBeenCalledTimes(9)
  })

  it('resets loop evidence on real user input but ignores synthetic Guard reminders', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const makeCall = (i: number) => execution(agent, 'write', { path: 'same' }, `steer-${i}`)
    const same = success({ stable: true })
    for (let i = 1; i <= 8; i++) await runTool(host, makeCall(i), same)
    const reminder = agent.inject.mock.calls[0]?.[0] as { id: string; source: { kind: string } }
    expect(reminder?.source.kind).toBe('thinking-guard')
    host.hooks.get('agent/inbox/inserted')!({ agent, message: reminder })
    expect(await runTool(host, makeCall(9), same)).toContain('局部拒绝')
    host.hooks.get('agent/inbox/inserted')!({ agent, message: { id: 'user-1', source: { kind: 'user' } } })
    for (let i = 10; i <= 17; i++) expect(await runTool(host, makeCall(i), same)).toBeUndefined()
    expect(await runTool(host, makeCall(18), same)).toContain('局部拒绝')
  })

  it('uses error and cancellation fingerprints and resets the chain on a user steer', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const call = (i: number) => execution(agent, 'fetch', { url: 'https://example.invalid' }, `err-${i}`)
    const failed: Result = { isError: true, error: { message: 'network failure', info: { name: 'Error', code: 'NETWORK' } }, content: [] }
    for (let i = 1; i <= 8; i++) await runTool(host, call(i), failed)
    expect(injectedText(agent)).toContain('连续重复')
    expect(await runTool(host, call(9), failed)).toContain('局部拒绝')
    const cancelledCall = (i: number) => execution(agent, 'fetch-cancelled', { url: 'https://example.invalid' }, `cancel-${i}`)
    const cancelled: Result = { isError: true, error: { message: 'cancelled', info: { name: 'AbortError', code: TOOL_ABORTED } }, content: [] }
    for (let i = 10; i <= 17; i++) await runTool(host, cancelledCall(i), cancelled)
    expect(await runTool(host, cancelledCall(18), cancelled)).toContain('局部拒绝')
  })

  it('does not treat content changes as unchanged when canonical values are equal', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    for (let i = 1; i <= 8; i++) {
      expect(await runTool(host, execution(agent, 'write', { id: 1 }, `content-${i}`), success({ stable: true }, `content-${i}`))).toBeUndefined()
    }
    expect(host.registeredGuard()!(execution(agent, 'write', { id: 1 }, 'content-next'))).toBeUndefined()
  })

  it('keeps the disabled switch silent and disposes every registered hook', async () => {
    const disabled = setup({ duplicateDetection: false })
    const agent = { inject: vi.fn() }
    for (let i = 1; i <= 10; i++) await runTool(disabled, execution(agent, 'write', { id: 1 }, `disabled-${i}`), success({ stable: true }))
    expect(injectedText(agent)).toBe('')
    expect(disabled.registeredGuard()!(execution(agent, 'write', { id: 1 }, 'disabled-next'))).toBeUndefined()

    const host = setup()
    const cleanAgent = { inject: vi.fn() }
    await runTool(host, execution(cleanAgent, 'meta_invoke', {}, 'meta-1'), success({}))
    expect(cleanAgent.inject).not.toHaveBeenCalled()
    host.hooks.get('agent/disposed')!({ agent: cleanAgent })
    host.cleanup()
    for (const dispose of host.disposers) expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('Guard live switches from the settings page', () => {
  /**
   * The settings page writes through the policy service. These tests install a
   * fake policy that returns those switches, so they fail if the Guard ever
   * reads a stale copy: the whole point is that a toggle applies without a reload.
   */
  function setupWithSwitches(initial: {
    enabled: boolean; duplicateDetection: boolean
    alternatingCycleDetection: boolean; noProgressProtection: boolean
  }) {
    const switches = { ...initial }
    const hooks = new Map<string, (...args: any[]) => any>()
    const info = vi.fn()
    let registeredGuard: ((execution: any) => string | undefined) | undefined
    const ctx = {
      logger: { warn: vi.fn(), info },
      capabilityPolicy: { metaTools: () => ['meta_search', 'meta_invoke'], getGuard: () => switches },
      get: (key: string) => (key === 'capabilityPolicy' ? { getGuard: () => switches } : undefined),
      tools: {
        guard: (callback: (execution: any) => string | undefined) => {
          registeredGuard = callback
          return vi.fn()
        },
      },
      on: (name: string, handler: (...args: any[]) => any) => {
        hooks.set(name, handler)
        return vi.fn()
      },
      effect: () => undefined,
    }
    apply(ctx as unknown as Context, {})
    return {
      hooks,
      switches,
      guard: () => registeredGuard!,
      toggle: (patch: Partial<typeof switches>) => Object.assign(switches, patch),
    }
  }

  /** Drive N identical calls that all share one result fingerprint. */
  async function repeatIdentical(
    host: ReturnType<typeof setupWithSwitches>,
    agent: { inject: ReturnType<typeof vi.fn> },
    times: number,
  ): Promise<string[]> {
    const denials: string[] = []
    const next = vi.fn(async () => ({ kind: 'continue' }))
    await host.hooks.get('agent/pre-step')!({ agent, turn: 1 }, next)
    for (let i = 0; i < times; i += 1) {
      const call = execution(agent, 'write', { same: true }, `same-${i}`)
      const denial = host.guard()(call)
      if (denial !== undefined) {
        denials.push(denial)
        host.hooks.get('tools/result')!(call, {
          isError: true, error: { message: denial }, content: [{ type: 'text', text: denial }],
        })
        continue
      }
      await host.hooks.get('tools/execute')!(call, vi.fn(async () => success({ ok: true })))
      host.hooks.get('tools/result')!(call, success({ ok: true }))
    }
    return denials
  }

  /**
   * One full business-tool round trip through the real hooks, so the dispatch
   * record and the ordered observation queue both run.
   */
  async function runLive(
    host: ReturnType<typeof setupWithSwitches>,
    agent: { inject: ReturnType<typeof vi.fn> },
    name: string,
    args: unknown,
    callId: string,
  ): Promise<string | undefined> {
    const call = execution(agent, name, args, callId)
    const denial = host.guard()(call)
    if (denial !== undefined) {
      host.hooks.get('tools/result')!(call, {
        isError: true, error: { message: denial }, content: [{ type: 'text', text: denial }],
      })
      return denial
    }
    await host.hooks.get('tools/execute')!(call, vi.fn(async () => success({ ok: true })))
    host.hooks.get('tools/result')!(call, success({ ok: true }))
    return undefined
  }

  it('keeps detecting an A-B-A-B cycle and denies it when only duplicate detection is off', async () => {
    const host = setupWithSwitches({
      enabled: true, duplicateDetection: false, alternatingCycleDetection: true, noProgressProtection: true,
    })
    const agent = { inject: vi.fn() }
    const next = vi.fn(async () => ({ kind: 'continue' }))
    await host.hooks.get('agent/pre-step')!({ agent, turn: 1 }, next)

    // A -> B -> A -> B with an unchanged result on every leg: exact-repeat detection
    // is off, so any cycle evidence here can only come from the cycle detector.
    expect(await runLive(host, agent, 'tool-a', { step: 1 }, 'cycle-1')).toBeUndefined()
    expect(await runLive(host, agent, 'tool-b', { step: 2 }, 'cycle-2')).toBeUndefined()
    expect(await runLive(host, agent, 'tool-a', { step: 1 }, 'cycle-3')).toBeUndefined()
    expect(await runLive(host, agent, 'tool-b', { step: 2 }, 'cycle-4')).toBeUndefined()
    expect(injectedText(agent)).toContain('交替工具调用循环')

    // The pending candidate carries source 'cycle', which duplicateDetection=false
    // must not clear; the matching next call is denied locally.
    expect(await runLive(host, agent, 'tool-b', { step: 2 }, 'cycle-5')).toContain('局部拒绝')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('still reminds and denies exact repeats when only alternating-cycle detection is off', async () => {
    const host = setupWithSwitches({
      enabled: true, duplicateDetection: true, alternatingCycleDetection: false, noProgressProtection: true,
    })
    const agent = { inject: vi.fn() }
    const denials = await repeatIdentical(host, agent, 9)
    expect(agent.inject).toHaveBeenCalled()
    expect(injectedText(agent)).toContain('第 8 次')
    expect(denials.length).toBeGreaterThan(0)
  })

  it('only reminds, never denies, for both paths once no-progress protection is off', async () => {
    const host = setupWithSwitches({
      enabled: true, duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: false,
    })
    const repeatAgent = { inject: vi.fn() }
    expect(await repeatIdentical(host, repeatAgent, 9)).toEqual([])
    expect(injectedText(repeatAgent)).toContain('第 8 次')

    const cycleAgent = { inject: vi.fn() }
    const next = vi.fn(async () => ({ kind: 'continue' }))
    await host.hooks.get('agent/pre-step')!({ agent: cycleAgent, turn: 1 }, next)
    const cycleCalls: Array<[string, unknown, string]> = [
      ['tool-a', { step: 1 }, 'guard-off-1'],
      ['tool-b', { step: 2 }, 'guard-off-2'],
      ['tool-a', { step: 1 }, 'guard-off-3'],
      ['tool-b', { step: 2 }, 'guard-off-4'],
      ['tool-b', { step: 2 }, 'guard-off-5'],
      ['tool-b', { step: 2 }, 'guard-off-6'],
    ]
    for (const [toolName, toolArgs, id] of cycleCalls) {
      expect(await runLive(host, cycleAgent, toolName, toolArgs, id)).toBeUndefined()
    }
    expect(injectedText(cycleAgent)).toContain('交替工具调用循环')
  })

  it('produces no reminders and no denials while the master switch is off', async () => {
    const host = setupWithSwitches({
      enabled: false, duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: true,
    })
    const agent = { inject: vi.fn() }
    const denials = await repeatIdentical(host, agent, 9)
    expect(denials).toEqual([])
    expect(agent.inject).not.toHaveBeenCalled()
  })

  it('reminds but never denies once no-progress protection is turned off', async () => {
    const host = setupWithSwitches({
      enabled: true, duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: false,
    })
    const agent = { inject: vi.fn() }
    const denials = await repeatIdentical(host, agent, 9)
    // Reminders still land…
    expect(agent.inject).toHaveBeenCalled()
    // …but the local denial never fires.
    expect(denials).toEqual([])
  })

  it('starts denying the repeated call when no-progress protection is on', async () => {
    const host = setupWithSwitches({
      enabled: true, duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: true,
    })
    const agent = { inject: vi.fn() }
    const denials = await repeatIdentical(host, agent, 9)
    expect(denials.length).toBeGreaterThan(0)
  })

  it('applies a flipped switch immediately, without re-applying the plugin', async () => {
    const host = setupWithSwitches({
      enabled: true, duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: true,
    })
    const agent = { inject: vi.fn() }
    host.toggle({ enabled: false })
    const denials = await repeatIdentical(host, agent, 9)
    expect(denials).toEqual([])
  })
})

describe('Guard fingerprint budget at the host hooks', () => {
  /** One full round trip that also reports how the result stage behaved. */
  async function roundTrip(host: TestHost, agent: Execution['agent'], name: string, args: unknown, callId: string, result: Result) {
    await prepareTurn(host, agent)
    const call = execution(agent, name, args, callId)
    expect(host.registeredGuard()!(call)).toBeUndefined()
    await executeOnly(host, call, result, true)
    resultOnly(host, call, result)
    return call
  }

  it('computes no result fingerprint for polling and warn-only tools', async () => {
    const host = setup({ pollingTools: ['custom_wait'] })
    const agent = { inject: vi.fn() }
    const before = fingerprintCalls.result
    // `job_output` is a default polling tool, `read` a default warn-only tool, and
    // `meta_search` a control-plane tool: none may ever become blockable.
    for (const name of ['job_output', 'custom_wait', 'read', 'meta_search']) {
      for (let index = 0; index < 3; index += 1) {
        await roundTrip(host, agent, name, { id: 'job-1' }, `${name}-${index}`, success({ status: 'running' }))
      }
    }
    expect(fingerprintCalls.result).toBe(before)
  })

  it('computes a result fingerprint for a normal business tool', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const before = fingerprintCalls.result
    await roundTrip(host, agent, 'write', { path: 'a' }, 'write-1', success({ ok: true }))
    expect(fingerprintCalls.result).toBe(before + 1)
  })

  it('returns an oversized tool result to the caller unchanged and never blocks on it', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    const huge = { content: [{ type: 'text', text: 'z'.repeat(FINGERPRINT_MAX_BYTES + 4096) }], rows: [{ id: 1 }] }
    const result = success(huge)
    const before = fingerprintCalls.result
    for (let index = 1; index <= 9; index += 1) {
      await roundTrip(host, agent, 'write', { path: 'big' }, `big-${index}`, result)
    }
    // The Guard does attempt the fingerprint for a normal tool…
    expect(fingerprintCalls.result).toBe(before + 9)
    // …the real result is untouched, and with no fingerprint no denial is produced.
    expect(result.value).toBe(huge)
    expect(result.isError).toBe(false)
    expect(injectedText(agent)).not.toContain('局部拒绝')
    expect(host.registeredGuard()!(execution(agent, 'write', { path: 'big' }, 'big-next'))).toBeUndefined()
  })

  it('keeps processing tools/result after an internal Guard fault', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    // A throwing `arguments` getter makes the signature step explode; the result
    // stage must still consume the record and leave no stuck queue behind.
    const hostile = {
      agent, name: 'write', callId: 'hostile-1',
      get arguments(): unknown { throw new Error('hostile arguments getter') },
    } as unknown as Execution
    await prepareTurn(host, agent)
    expect(() => host.registeredGuard()!(hostile)).not.toThrow()
    const next = vi.fn(async () => success({ ok: true }))
    await expect(host.hooks.get('tools/execute')!(hostile, next)).resolves.toBeDefined()
    expect(next).toHaveBeenCalledOnce()

    // Normal detection is unaffected afterwards: 8 identical calls still escalate
    // and the 9th is locally denied.
    const same = success({ stable: true })
    for (let index = 1; index <= 8; index += 1) {
      expect(await runTool(host, execution(agent, 'write', { path: 'same' }, `after-${index}`), same)).toBeUndefined()
    }
    expect(await runTool(host, execution(agent, 'write', { path: 'same' }, 'after-9'), same)).toContain('局部拒绝')
  })

  it('does not disturb tools/result when the result payload itself is unhashable', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    await prepareTurn(host, agent)
    const cyclic: Record<string, unknown> = { content: [{ type: 'text', text: 'x' }] }
    cyclic.self = cyclic
    const call = execution(agent, 'write', { path: 'cyclic' }, 'cyclic-1')
    await executeOnly(host, call, success(cyclic, 'cyclic-payload'), true)
    const result = success(cyclic, 'cyclic-payload')
    expect(() => resultOnly(host, call, result)).not.toThrow()
    expect(result.value).toBe(cyclic)
    expect(agent.inject).not.toHaveBeenCalled()
  })

  it('keeps tools/result non-throwing when the host supplies a malformed error result', async () => {
    const host = setup()
    const agent = { inject: vi.fn() }
    await prepareTurn(host, agent)
    const call = execution(agent, 'write', { path: 'broken' }, 'broken-1')
    await executeOnly(host, call, success({ ok: true }), true)
    // `isError: true` without an `error` object is malformed; reading it throws
    // inside the Guard's own bookkeeping. The host must still be free to continue.
    const malformed = { isError: true, content: [] } as unknown as Result
    expect(() => resultOnly(host, call, malformed)).not.toThrow()

    // Detection keeps working for later calls in the same turn.
    const same = success({ stable: true })
    for (let index = 1; index <= 8; index += 1) {
      expect(await runTool(host, execution(agent, 'write', { path: 'same' }, `ok-${index}`), same)).toBeUndefined()
    }
    expect(await runTool(host, execution(agent, 'write', { path: 'same' }, 'ok-9'), same)).toContain('局部拒绝')
  })

  it('fails open and resets detection when injecting a reminder throws', async () => {
    const host = setup()
    // The host Agent can be disposed mid-flight; `inject` throwing must not escape
    // tools/result, and the half-drained queue must not stall the rest of the turn.
    const agent = { inject: vi.fn(() => { throw new Error('agent disposed') }) }
    const same = success({ stable: true })
    await prepareTurn(host, agent)
    for (let index = 1; index <= 3; index += 1) {
      await executeOnly(host, execution(agent, 'write', { path: 'boom' }, `boom-${index}`), same, true)
      expect(() => resultOnly(host, execution(agent, 'write', { path: 'boom' }, `boom-${index}`), same)).not.toThrow()
    }
    expect(agent.inject).toHaveBeenCalled()

    // After the fault the Guard fails open for this turn rather than staying stuck.
    const healthy = { inject: vi.fn() }
    const other = success({ stable: true })
    for (let index = 1; index <= 8; index += 1) {
      expect(await runTool(host, execution(healthy, 'write', { path: 'same' }, `healthy-${index}`), other)).toBeUndefined()
    }
    expect(await runTool(host, execution(healthy, 'write', { path: 'same' }, 'healthy-9'), other)).toContain('局部拒绝')
  })
})
