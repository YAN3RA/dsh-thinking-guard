import { describe, expect, it } from 'vitest'
import { EfficiencyGuard, validateGuardConfig } from '../src/guard-core.ts'

describe('agent efficiency guard core', () => {
  it('does not allocate state or warn when disabled', () => {
    const guard = new EfficiencyGuard({ enabled: false })
    const agent = {}
    const call = {}
    expect(guard.admitStep(agent, 1)).toEqual({ kind: 'allow' })
    for (let i = 0; i < 3; i++) guard.observeTool(agent, 1, call)
    expect(guard.states.get(agent)).toBeUndefined()
  })

  it('validates legacy threshold ordering and rejects invalid modes', () => {
    expect(() => validateGuardConfig({ profiles: { normal: {
      softSteps: 8, hardSteps: 8, softToolCalls: 1, hardToolCalls: 2, softDurationMs: 1, hardDurationMs: 2,
    } } as never })).toThrow(/softSteps must be less than hardSteps/)
    expect(() => validateGuardConfig({ stepLimitMode: 'invalid' as never })).toThrow(/stepLimitMode/)
  })

  it('keeps agent and turn counters isolated', () => {
    const guard = new EfficiencyGuard()
    const first = {}, second = {}
    guard.admitStep(first, 1, 0)
    guard.admitStep(first, 1, 1)
    guard.admitStep(second, 1, 2)
    expect(guard.states.get(first)?.modelSteps).toBe(2)
    expect(guard.states.get(second)?.modelSteps).toBe(1)
    guard.admitStep(first, 2, 3)
    expect(guard.states.get(first)).toMatchObject({ turn: 2, modelSteps: 1, startedAt: 3 })
    expect(guard.states.get(second)?.modelSteps).toBe(1)
  })

  it('normalizes both legacy blocking switches even with duplicate detection disabled', () => {
    const guard = new EfficiencyGuard({ stepLimitMode: 'hard-stop', duplicateHardBlock: true, duplicateDetection: false })
    expect(guard.config.stepLimitMode).toBe('warn-only')
    expect(guard.config.duplicateHardBlock).toBe(false)
    const agent = {}
    expect(guard.admitStep(agent, 1, 0)).toEqual({ kind: 'allow' })
    expect(guard.admitStep(agent, 1, 1_000_000)).toEqual({ kind: 'allow' })
    const call = {}
    guard.observeTool(agent, 1, call)
    guard.observeTool(agent, 1, call)
    expect(guard.states.get(agent)?.businessToolCalls).toBe(2)
  })

  it('retains counters and timing past all legacy thresholds without convergence signals', () => {
    const guard = new EfficiencyGuard({ profile: 'quick', profiles: { quick: {
      softSteps: 1, hardSteps: 2, softToolCalls: 1, hardToolCalls: 2, softDurationMs: 10, hardDurationMs: 20,
    } } as never })
    const agent = {}
    guard.admitStep(agent, 1, 0)
    for (let index = 0; index < 100; index++) {
      expect(guard.admitStep(agent, 1, index + 30)).toEqual({ kind: 'allow' })
      guard.observeTool(agent, 1, {}, index + 30)
    }
    expect(guard.states.get(agent)).toMatchObject({ modelSteps: 101, businessToolCalls: 100, startedAt: 0, lastActivityAt: 129 })
  })

  it('excludes control plane calls from business statistics', () => {
    const guard = new EfficiencyGuard()
    const agent = {}
    guard.admitStep(agent, 1, 0)
    guard.observeTool(agent, 1, { controlPlane: true })
    expect(guard.states.get(agent)?.businessToolCalls).toBe(0)
    guard.observeTool(agent, 1, {})
    expect(guard.states.get(agent)?.businessToolCalls).toBe(1)
  })
})
