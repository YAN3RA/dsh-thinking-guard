import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/guard.ts'
import {
  DEFAULT_REPEAT_THRESHOLDS,
  FINGERPRINT_MAX_BYTES,
  REPEAT_THRESHOLD_MAX,
  createGuardLoopState,
  observeGuardLoop,
} from '../src/guard-loop-core.ts'

/**
 * TG-03 regression: a legal repeat threshold above 16 must stay reachable.
 *
 * The detector keeps only a 16-entry cyclic history, but the consecutive-repeat
 * count must NOT be derived from that truncated window. These cases drive long
 * identical runs and assert the reminder fires at the exact legal threshold while
 * the history itself stays bounded.
 */

type LoopOptions = Parameters<typeof observeGuardLoop>[3]

/** Drive `times` identical calls (same name+args) and collect every decision. */
function driveRepeats(
  thresholds: readonly number[],
  times: number,
  fingerprint: (index: number) => string = () => 'same',
) {
  const options: LoopOptions = { repeatThresholds: thresholds, alternatingCycleEnabled: false }
  let state = createGuardLoopState(1)
  const decisions = []
  for (let index = 1; index <= times; index += 1) {
    const observed = observeGuardLoop(state, 1, {
      name: 'read',
      arguments: { path: 'same' },
      outcome: 'success',
      resultFingerprint: fingerprint(index),
    }, options)
    state = observed.state
    decisions.push(observed.decision)
  }
  return { state, decisions }
}

/** The repeat thresholds that actually produced a reminder, in order. */
function reminderThresholds(decisions: ReturnType<typeof driveRepeats>['decisions']): number[] {
  return decisions
    .filter(decision => decision.warning === 'repeat')
    .map(decision => decision.repeatThreshold ?? -1)
}

describe('TG-03: legal high repeat thresholds are reachable', () => {
  it('reminds exactly at an [18] threshold the 16-entry history cannot hold', () => {
    const { state, decisions } = driveRepeats([18], 18)

    expect(decisions[16]).toMatchObject({ repeatCount: 17, warning: 'none' })
    expect(decisions[16].repeatThreshold).toBeUndefined()
    expect(decisions[17]).toMatchObject({
      repeatCount: 18,
      repeatThreshold: 18,
      warning: 'repeat',
      blockCandidate: true,
      blockSource: 'repeat',
      noProgressEvidence: 'unchanged-result',
    })
    // The count outruns the retained history: proof it is an independent counter.
    expect(decisions[17].repeatCount).toBeGreaterThan(state.history.length)
    expect(state.history).toHaveLength(16)
  })

  it('reminds exactly at 20, 30 and 50, and never after the highest threshold', () => {
    const { state, decisions } = driveRepeats([20, 30, 50], 60)

    expect(reminderThresholds(decisions)).toEqual([20, 30, 50])
    expect(decisions[19]).toMatchObject({ repeatCount: 20, warning: 'repeat' })
    expect(decisions[29]).toMatchObject({ repeatCount: 30, warning: 'repeat' })
    expect(decisions[49]).toMatchObject({ repeatCount: 50, warning: 'repeat' })
    // No phantom reminder once past the highest threshold.
    for (let index = 50; index < 60; index += 1) {
      expect(decisions[index].warning).toBe('none')
    }
    // The block candidate only appears at/after the highest threshold with evidence.
    expect(decisions[48].blockCandidate).toBe(false) // 49th call
    expect(decisions[49]).toMatchObject({
      blockCandidate: true,
      blockSource: 'repeat',
      noProgressEvidence: 'unchanged-result',
    })
    expect(decisions[59].blockCandidate).toBe(true)
    // History stays bounded while the saturated counter keeps its value.
    expect(state.history).toHaveLength(16)
    expect(decisions[59].repeatCount).toBeGreaterThanOrEqual(50)
    expect(decisions[59].repeatCount).toBeLessThanOrEqual(REPEAT_THRESHOLD_MAX + 1)
  })

  it('keeps the shipped 3/5/8 behaviour unchanged', () => {
    const { decisions } = driveRepeats(DEFAULT_REPEAT_THRESHOLDS, 8)
    expect(reminderThresholds(decisions)).toEqual([3, 5, 8])
    expect(decisions[7]).toMatchObject({
      repeatCount: 8,
      repeatThreshold: 8,
      blockCandidate: true,
      blockSource: 'repeat',
    })
  })

  it('counts the run but never fabricates no-progress evidence when results change', () => {
    const { decisions } = driveRepeats([20, 30, 50], 60, index => `value-${index}`)

    // Identical calls still remind at the thresholds even with changing results...
    expect(reminderThresholds(decisions)).toEqual([20, 30, 50])
    // ...but a changed result is not "no progress", so nothing is ever blockable.
    for (const decision of decisions) {
      expect(decision.blockCandidate).toBe(false)
      expect(decision.noProgressEvidence).toBe('none')
    }
  })

  it('resets the independent counter when the signature changes after a long run', () => {
    const options: LoopOptions = { repeatThresholds: [20, 30, 50], alternatingCycleEnabled: false }
    let state = createGuardLoopState(1)
    for (let index = 0; index < 30; index += 1) {
      state = observeGuardLoop(state, 1, {
        name: 'read', arguments: { path: 'a' }, outcome: 'success', resultFingerprint: 'same',
      }, options).state
    }

    let observed = observeGuardLoop(state, 1, {
      name: 'write', arguments: { path: 'a' }, outcome: 'success', resultFingerprint: 'same',
    }, options)
    expect(observed.decision).toMatchObject({ repeatCount: 1, warning: 'none' })
    state = observed.state

    observed = observeGuardLoop(state, 1, {
      name: 'read', arguments: { path: 'a' }, outcome: 'success', resultFingerprint: 'same',
    }, options)
    expect(observed.decision.repeatCount).toBe(1)
    state = observed.state
    observed = observeGuardLoop(state, 1, {
      name: 'read', arguments: { path: 'a' }, outcome: 'success', resultFingerprint: 'same',
    }, options)
    expect(observed.decision.repeatCount).toBe(2)
  })

  it('starts a fresh counter on a new turn', () => {
    const options: LoopOptions = { repeatThresholds: DEFAULT_REPEAT_THRESHOLDS }
    let state = createGuardLoopState(1)
    for (let index = 0; index < 20; index += 1) {
      state = observeGuardLoop(state, 1, {
        name: 'read', arguments: {}, outcome: 'success', resultFingerprint: 'same',
      }, options).state
    }
    const nextTurn = observeGuardLoop(state, 2, {
      name: 'read', arguments: {}, outcome: 'success', resultFingerprint: 'same',
    }, options)
    expect(nextTurn.state.turn).toBe(2)
    expect(nextTurn.decision.repeatCount).toBe(1)
    expect(nextTurn.state.history).toHaveLength(1)
  })

  it('does not let an unfingerprintable observation inflate or reset the run', () => {
    const options: LoopOptions = { repeatThresholds: [20, 30, 50], alternatingCycleEnabled: false }
    let state = createGuardLoopState(1)
    for (let index = 0; index < 20; index += 1) {
      state = observeGuardLoop(state, 1, {
        name: 'read', arguments: { path: 'same' }, outcome: 'success', resultFingerprint: 'same',
      }, options).state
    }

    const ignored = observeGuardLoop(state, 1, {
      name: 'read',
      arguments: { path: 'same', blob: 'x'.repeat(FINGERPRINT_MAX_BYTES + 1024) },
      outcome: 'success',
      resultFingerprint: 'same',
    }, options)
    expect(ignored.decision.ignored).toBe(true)
    expect(ignored.decision.repeatCount).toBe(0)
    // An incomparable event is invisible: it neither advances nor resets the run.
    expect(ignored.state).toBe(state)

    const continued = observeGuardLoop(state, 1, {
      name: 'read', arguments: { path: 'same' }, outcome: 'success', resultFingerprint: 'same',
    }, options)
    expect(continued.decision.repeatCount).toBe(21)
  })
})

/**
 * End-to-end through the real Guard hooks (no core mock): proves the highest
 * threshold's candidate turns into at most ONE local denial, on a later call.
 */
describe('TG-03: high thresholds through the live Guard hooks', () => {
  type Execution = { callId: string; agent: { inject: ReturnType<typeof vi.fn> }; name: string; arguments: unknown }
  type Result = {
    isError: boolean
    value?: unknown
    error?: { message: string }
    content: Array<{ type: string; text?: string }>
  }

  function setupGuard(config: Partial<Config> = {}) {
    const hooks = new Map<string, (...args: any[]) => any>()
    let registered: ((execution: any) => string | undefined) | undefined
    const capabilityPolicy = { metaTools: () => [] as string[] }
    const ctx = {
      logger: { warn: vi.fn(), info: vi.fn() },
      capabilityPolicy,
      get: (_key: string) => undefined,
      tools: {
        guard: (callback: (execution: any) => string | undefined) => {
          registered = callback
          return vi.fn()
        },
      },
      on: (name: string, handler: (...args: any[]) => any) => {
        hooks.set(name, handler)
        return vi.fn()
      },
      effect: (_factory: () => () => void) => undefined,
    }
    apply(ctx as unknown as Context, config)
    return { hooks, guard: () => registered! }
  }

  function injectedText(agent: { inject: ReturnType<typeof vi.fn> }): string {
    return agent.inject.mock.calls.flat().map((message: any) => {
      const content = message?.content as Array<{ type?: string; text?: string }> | undefined
      return content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? ''
    }).join('\n')
  }

  const success = (value: unknown): Result => ({ isError: false, value, content: [{ type: 'text', text: JSON.stringify(value) }] })

  it('[20,30,50] reminds at 20/30/50 and denies at most once for sixty identical calls', async () => {
    const host = setupGuard({ repeatThresholds: [20, 30, 50] })
    const agent = { inject: vi.fn() }
    const execute = host.hooks.get('tools/execute')!
    const result = host.hooks.get('tools/result')!
    await host.hooks.get('agent/pre-step')!({ agent, turn: 1 }, vi.fn(async () => ({ kind: 'continue' })))

    const denials: string[] = []
    for (let index = 0; index < 60; index += 1) {
      const call: Execution = { agent, name: 'write', arguments: { same: true }, callId: `same-${index}` }
      const denial = host.guard()(call)
      if (denial !== undefined) {
        denials.push(denial)
        result(call, { isError: true, error: { message: denial }, content: [{ type: 'text', text: denial }] })
        continue
      }
      await execute(call, vi.fn(async () => success({ ok: true })))
      result(call, success({ ok: true }))
    }

    expect(denials).toHaveLength(1)
    const text = injectedText(agent)
    expect(text).toContain('第 20 次')
    expect(text).toContain('第 30 次')
    expect(text).toContain('第 50 次')
    expect(text).not.toContain('第 21 次')
    expect(text).not.toContain('第 51 次')
  })
})
