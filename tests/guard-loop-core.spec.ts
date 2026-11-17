import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPEAT_THRESHOLDS,
  FINGERPRINT_MAX_BYTES,
  FINGERPRINT_MAX_DEPTH,
  FINGERPRINT_MAX_NODES,
  LOOP_HISTORY_LIMIT,
  createGuardLoopState,
  guardResultFingerprint,
  guardToolSignature,
  observeGuardLoop,
} from '../src/guard-loop-core.ts'

/** Nest `levels` objects around a scalar, so the leaf scalar sits at depth levels + 1. */
function nest(levels: number): unknown {
  let value: unknown = 'leaf'
  for (let index = 0; index < levels; index += 1) value = { child: value }
  return value
}

describe('guard loop core', () => {
  it('canonicalizes argument object key order into an exact repeat signature', () => {
    expect(guardToolSignature('read', { z: 2, a: { y: 1, x: 0 } }))
      .toBe(guardToolSignature('read', { a: { x: 0, y: 1 }, z: 2 }))
    expect(guardToolSignature('read', { path: 'a' }))
      .not.toBe(guardToolSignature('write', { path: 'a' }))
  })

  it('escalates warnings at 3, 5, and 8 consecutive calls while allowing changed results', () => {
    let state = createGuardLoopState(3)
    for (let count = 1; count <= 8; count += 1) {
      const result = observeGuardLoop(state, 3, {
        name: 'read', arguments: { path: 'changing' }, outcome: 'success', resultFingerprint: `value-${count}`,
      })
      state = result.state
      if ([3, 5, 8].includes(count)) {
        expect(result.decision).toMatchObject({ repeatCount: count, repeatThreshold: count, warning: 'repeat', blockCandidate: false })
      } else {
        expect(result.decision.warning).toBe('none')
        expect(result.decision.repeatThreshold).toBeUndefined()
      }
    }
  })

  it('warns on an A-B-A-B alternating sequence without blocking when both results change', () => {
    let state = createGuardLoopState(4)
    const call = (name: string, value: number, fingerprint: string) => {
      const result = observeGuardLoop(state, 4, {
        name,
        arguments: { value },
        outcome: 'success',
        resultFingerprint: fingerprint,
      })
      state = result.state
      return result.decision
    }

    expect(call('tool-a', 1, 'a-before').warning).toBe('none')
    expect(call('tool-b', 2, 'b-before').warning).toBe('none')
    expect(call('tool-a', 1, 'a-after').warning).toBe('none')
    expect(call('tool-b', 2, 'b-after')).toMatchObject({
      alternatingCycle: true,
      warning: 'alternating-cycle',
      blockCandidate: false,
      noProgressEvidence: 'none',
    })
  })

  it('counts only consecutive exact repeats', () => {
    let state = createGuardLoopState(1)
    state = observeGuardLoop(state, 1, { name: 'read', arguments: {}, outcome: 'success', resultFingerprint: 'same' }).state
    state = observeGuardLoop(state, 1, { name: 'write', arguments: {}, outcome: 'success', resultFingerprint: 'changed' }).state
    const result = observeGuardLoop(state, 1, { name: 'read', arguments: {}, outcome: 'success', resultFingerprint: 'same' })
    expect(result.decision).toMatchObject({ repeatCount: 1, warning: 'none', blockCandidate: false })
  })

  it('detects a repeated three-tool cycle and only candidate-blocks an unchanged cycle', () => {
    let state = createGuardLoopState(2)
    for (const [name, fingerprint] of [['tool-a', 'a'], ['tool-b', 'b'], ['tool-c', 'c'], ['tool-a', 'a'], ['tool-b', 'b']] as const) {
      state = observeGuardLoop(state, 2, { name, arguments: {}, outcome: 'success', resultFingerprint: fingerprint }).state
    }
    const result = observeGuardLoop(state, 2, { name: 'tool-c', arguments: {}, outcome: 'success', resultFingerprint: 'c' })
    expect(result.decision).toMatchObject({
      alternatingCycle: true,
      warning: 'alternating-cycle',
      blockCandidate: true,
      noProgressEvidence: 'unchanged-cycle',
    })
  })

  it('marks an unchanged complete alternating cycle as a block candidate', () => {
    let state = createGuardLoopState(4)
    for (const [name, fingerprint] of [['tool-a', 'a'], ['tool-b', 'b'], ['tool-a', 'a']] as const) {
      state = observeGuardLoop(state, 4, {
        name, arguments: {}, outcome: 'success', resultFingerprint: fingerprint,
      }).state
    }
    const result = observeGuardLoop(state, 4, {
      name: 'tool-b', arguments: {}, outcome: 'success', resultFingerprint: 'b',
    })
    expect(result.decision).toMatchObject({
      alternatingCycle: true,
      warning: 'alternating-cycle',
      blockCandidate: true,
      noProgressEvidence: 'unchanged-cycle',
    })
  })

  it('does not make a block candidate when an exact repeat produces changed output', () => {
    const first = observeGuardLoop(createGuardLoopState(1), 1, {
      name: 'read', arguments: { path: 'file' }, outcome: 'success', resultFingerprint: 'old',
    })
    const second = observeGuardLoop(first.state, 1, {
      name: 'read', arguments: { path: 'file' }, outcome: 'success', resultFingerprint: 'new',
    })
    expect(second.decision).toMatchObject({ warning: 'none', blockCandidate: false, noProgressEvidence: 'none' })
  })

  it('requires unchanged error evidence and the highest repeat threshold before a block candidate', () => {
    let state = createGuardLoopState(1)
    const fingerprint = guardResultFingerprint('error', { code: 'EHOSTUNREACH' })
    for (let index = 1; index < 8; index += 1) {
      const result = observeGuardLoop(state, 1, {
        name: 'request', arguments: { id: 1 }, outcome: 'error', resultFingerprint: fingerprint,
      })
      state = result.state
      expect(result.decision.blockCandidate).toBe(false)
    }
    const eighth = observeGuardLoop(state, 1, {
      name: 'request', arguments: { id: 1 }, outcome: 'error', resultFingerprint: fingerprint,
    })
    expect(eighth.decision).toMatchObject({
      repeatCount: 8,
      repeatThreshold: 8,
      warning: 'repeat',
      blockCandidate: true,
      noProgressEvidence: 'unchanged-error',
    })
  })

  it('does not candidate-block a repeated call when the outcome class changes', () => {
    const first = observeGuardLoop(createGuardLoopState(1), 1, {
      name: 'request', arguments: {}, outcome: 'error', resultFingerprint: 'same',
    })
    const second = observeGuardLoop(first.state, 1, {
      name: 'request', arguments: {}, outcome: 'success', resultFingerprint: 'same',
    })
    expect(second.decision.blockCandidate).toBe(false)
  })

  it('ignores excluded and polling tools without shifting the detector window', () => {
    const initial = observeGuardLoop(createGuardLoopState(1), 1, {
      name: 'read', arguments: { path: 'x' }, outcome: 'success', resultFingerprint: 'v1',
    })
    const excluded = observeGuardLoop(initial.state, 1, {
      name: 'meta_search', arguments: { query: 'x' }, outcome: 'success', resultFingerprint: 'meta',
    }, { excludedTools: new Set(['meta_search']) })
    const polling = observeGuardLoop(excluded.state, 1, {
      name: 'wait_status', arguments: { job: 'x' }, outcome: 'success', resultFingerprint: 'pending',
    }, { pollingTools: new Set(['wait_status']) })

    expect(excluded.decision.ignored).toBe(true)
    expect(polling.decision.ignored).toBe(true)
    expect(polling.state).toBe(initial.state)
    const repeated = observeGuardLoop(polling.state, 1, {
      name: 'read', arguments: { path: 'x' }, outcome: 'success', resultFingerprint: 'v1',
    })
    expect(repeated.decision).toMatchObject({ repeatCount: 2, warning: 'none', blockCandidate: false })
  })

  it('retains only hashes, never raw arguments or results', () => {
    const rawArgument = 'private-path-7f21e'
    const rawResult = { content: 'private-result-90bc3' }
    const observed = observeGuardLoop(createGuardLoopState(6), 6, {
      name: 'read', arguments: { path: rawArgument }, outcome: 'success', result: rawResult,
    })
    const retained = JSON.stringify(observed.state)
    expect(retained).not.toContain(rawArgument)
    expect(retained).not.toContain(rawResult.content)
    expect(observed.state.history[0].signature).toMatch(/^[a-f0-9]{64}$/)
    expect(observed.state.history[0].resultFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('bounds retained history to the most recent 16 observations', () => {
    let state = createGuardLoopState(9)
    for (let i = 0; i < LOOP_HISTORY_LIMIT + 5; i += 1) {
      state = observeGuardLoop(state, 9, {
        name: 'write', arguments: { index: i }, outcome: 'success', resultFingerprint: `result-${i}`,
      }).state
    }
    expect(state.history).toHaveLength(LOOP_HISTORY_LIMIT)
    expect(state.history.at(-1)?.signature).toBe(guardToolSignature('write', { index: LOOP_HISTORY_LIMIT + 4 }))
  })

  it('resets history at a new turn and keeps caller-controlled Agent isolation', () => {
    const agentA = observeGuardLoop(createGuardLoopState(1), 1, {
      name: 'read', arguments: {}, outcome: 'success', resultFingerprint: 'same',
    }).state
    const agentB = createGuardLoopState(1)
    const otherAgent = observeGuardLoop(agentB, 1, {
      name: 'read', arguments: {}, outcome: 'success', resultFingerprint: 'same',
    })
    expect(otherAgent.decision.repeatCount).toBe(1)

    const nextTurn = observeGuardLoop(agentA, 2, {
      name: 'read', arguments: {}, outcome: 'success', resultFingerprint: 'same',
    })
    expect(nextTurn.state.turn).toBe(2)
    expect(nextTurn.decision.repeatCount).toBe(1)
  })

  it('uses deterministic 3/5/8 repeat warning thresholds', () => {
    expect(DEFAULT_REPEAT_THRESHOLDS).toEqual([3, 5, 8])
  })
})

describe('Guard switch independence', () => {
  /** Drive a strict A -> B -> A -> B sequence with unchanged fingerprints. */
  function alternating(options: Parameters<typeof observeGuardLoop>[3]): ReturnType<typeof observeGuardLoop> {
    let state = createGuardLoopState(1)
    let last = observeGuardLoop(state, 1, { name: 'a', arguments: {}, outcome: 'success', resultFingerprint: 'x' }, options)
    state = last.state
    const plan = ['b', 'a', 'b']
    for (const name of plan) {
      last = observeGuardLoop(state, 1, { name, arguments: {}, outcome: 'success', resultFingerprint: 'x' }, options)
      state = last.state
    }
    return last
  }

  it('reports an alternating cycle when the switch is on', () => {
    const result = alternating({ alternatingCycleEnabled: true })
    expect(result.decision.alternatingCycle).toBe(true)
    expect(result.decision.warning).toBe('alternating-cycle')
  })

  it('reports no cycle when the alternating-cycle switch is off', () => {
    const result = alternating({ alternatingCycleEnabled: false })
    expect(result.decision.alternatingCycle).toBe(false)
    expect(result.decision.warning).not.toBe('alternating-cycle')
  })

  it('still reminds about repeats when no-progress protection is off', () => {
    // Three identical calls reach the first threshold, so a reminder is due; the
    // switch only governs whether the call can become a local denial.
    let state = createGuardLoopState(1)
    let last = observeGuardLoop(state, 1, { name: 'r', arguments: {}, outcome: 'success', resultFingerprint: 'same' })
    state = last.state
    for (let i = 0; i < 2; i += 1) {
      last = observeGuardLoop(state, 1, { name: 'r', arguments: {}, outcome: 'success', resultFingerprint: 'same' }, { noProgressProtection: false })
      state = last.state
    }
    expect(last.decision.warning).toBe('repeat')
    expect(last.decision.blockCandidate).toBe(false)
  })

  it('may deny a repeated call when no-progress protection is on', () => {
    let state = createGuardLoopState(1)
    let last = observeGuardLoop(state, 1, { name: 'r', arguments: {}, outcome: 'success', resultFingerprint: 'same' })
    state = last.state
    // 3/5/8 thresholds: reach 8 identical calls with the same fingerprint.
    for (let i = 0; i < 7; i += 1) {
      last = observeGuardLoop(state, 1, { name: 'r', arguments: {}, outcome: 'success', resultFingerprint: 'same' })
      state = last.state
    }
    expect(last.decision.repeatCount).toBe(8)
    expect(last.decision.blockCandidate).toBe(true)
  })

  /** Drive `times` identical calls that all share one unchanged fingerprint. */
  function repeating(options: Parameters<typeof observeGuardLoop>[3], times = 8): ReturnType<typeof observeGuardLoop> {
    let state = createGuardLoopState(1)
    let last = observeGuardLoop(state, 1, { name: 'r', arguments: {}, outcome: 'success', resultFingerprint: 'same' }, options)
    state = last.state
    for (let index = 1; index < times; index += 1) {
      last = observeGuardLoop(state, 1, { name: 'r', arguments: {}, outcome: 'success', resultFingerprint: 'same' }, options)
      state = last.state
    }
    return last
  }

  it('suppresses only the repeat reminder when repeat detection is off, and keeps counting', () => {
    const off = repeating({ repeatDetection: false })
    expect(off.decision.repeatCount).toBe(8)
    expect(off.decision.warning).toBe('none')
    // Only the reminder and the candidate are suppressed; the counts stay for diagnostics.
    expect(off.decision.repeatThreshold).toBe(8)
    expect(off.decision.blockCandidate).toBe(false)
    expect(off.decision.blockSource).toBeUndefined()
    // The alternating-cycle path still sees the same history.
    const cycle = alternating({ repeatDetection: false, alternatingCycleEnabled: true })
    expect(cycle.decision).toMatchObject({ alternatingCycle: true, warning: 'alternating-cycle', blockCandidate: true, blockSource: 'cycle' })
  })

  it('keeps the cycle path independent of the repeat path when repeat detection is on', () => {
    const cycle = alternating({ repeatDetection: true, alternatingCycleEnabled: true })
    expect(cycle.decision).toMatchObject({ warning: 'alternating-cycle', blockSource: 'cycle' })
    const repeated = repeating({ repeatDetection: true, alternatingCycleEnabled: false })
    expect(repeated.decision).toMatchObject({ warning: 'repeat', repeatThreshold: 8, blockSource: 'repeat' })
  })

  /**
   * §4.3 full matrix. `duplicateDetection` is `repeatDetection` in the detector;
   * the master `enabled` switch is enforced at the src/guard.ts entry and covered
   * end-to-end by tests/guard.spec.ts, so its row is expressed here as "every
   * detector idle", which is exactly what the core sees when it is off.
   */
  const matrix = [
    {
      label: 'duplicate on × cycle on × no-progress on',
      duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: true,
      repeatReminder: true, cycleReminder: true, repeatBlock: true, cycleBlock: true,
    },
    {
      label: 'duplicate off × cycle on × no-progress on',
      duplicateDetection: false, alternatingCycleDetection: true, noProgressProtection: true,
      repeatReminder: false, cycleReminder: true, repeatBlock: false, cycleBlock: true,
    },
    {
      label: 'duplicate on × cycle off × no-progress on',
      duplicateDetection: true, alternatingCycleDetection: false, noProgressProtection: true,
      repeatReminder: true, cycleReminder: false, repeatBlock: true, cycleBlock: false,
    },
    {
      label: 'duplicate on × cycle on × no-progress off',
      duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: false,
      repeatReminder: true, cycleReminder: true, repeatBlock: false, cycleBlock: false,
    },
    {
      label: 'duplicate off × cycle off × no-progress on',
      duplicateDetection: false, alternatingCycleDetection: false, noProgressProtection: true,
      repeatReminder: false, cycleReminder: false, repeatBlock: false, cycleBlock: false,
    },
    {
      label: 'master switch off (all detectors idle) × no-progress off',
      duplicateDetection: false, alternatingCycleDetection: false, noProgressProtection: false,
      repeatReminder: false, cycleReminder: false, repeatBlock: false, cycleBlock: false,
    },
  ] as const

  for (const row of matrix) {
    it(`matrix: ${row.label}`, () => {
      const options = {
        repeatDetection: row.duplicateDetection,
        alternatingCycleEnabled: row.alternatingCycleDetection,
        noProgressProtection: row.noProgressProtection,
      }

      const repeated = repeating(options)
      // Counting and cycle evidence stay live even when a detector is switched off.
      expect(repeated.decision.repeatCount).toBe(8)
      expect(repeated.decision.warning).toBe(row.repeatReminder ? 'repeat' : 'none')
      expect(repeated.decision.blockCandidate).toBe(row.repeatBlock)
      expect(repeated.decision.blockSource).toBe(row.repeatBlock ? 'repeat' : undefined)

      const cycled = alternating(options)
      expect(cycled.decision.alternatingCycle).toBe(row.cycleReminder)
      expect(cycled.decision.warning).toBe(row.cycleReminder ? 'alternating-cycle' : 'none')
      expect(cycled.decision.blockCandidate).toBe(row.cycleBlock)
      expect(cycled.decision.blockSource).toBe(row.cycleBlock ? 'cycle' : undefined)
    })
  }
})

describe('fingerprint budgets', () => {
  it('keeps the budgets large enough for ordinary tool payloads', () => {
    // Guards against tuning the limits down until normal results stop being
    // fingerprintable, which would silently weaken detection.
    expect(FINGERPRINT_MAX_NODES).toBeGreaterThanOrEqual(10_000)
    expect(FINGERPRINT_MAX_DEPTH).toBeGreaterThanOrEqual(32)
    expect(FINGERPRINT_MAX_BYTES).toBeGreaterThanOrEqual(64 * 1024)
  })

  it('still fingerprints and detects a repeated small result', () => {
    const result = { content: [{ type: 'text', text: 'small but real payload' }], rows: [{ id: 1 }] }
    const first = observeGuardLoop(createGuardLoopState(1), 1, { name: 'read', arguments: { path: 'a' }, outcome: 'success', result })
    expect(first.decision.ignored).toBe(false)
    expect(first.state.history[0].resultFingerprint).toMatch(/^[a-f0-9]{64}$/)
    // Same result again is proven unchanged evidence, not merely "same call".
    const second = observeGuardLoop(first.state, 1, { name: 'read', arguments: { path: 'a' }, outcome: 'success', result })
    expect(second.decision.noProgressEvidence).toBe('unchanged-result')
  })

  it('produces no fingerprint and no block candidate when the result exceeds the byte budget', () => {
    const oversized = { content: [{ type: 'text', text: 'x'.repeat(FINGERPRINT_MAX_BYTES + 1024) }] }
    expect(guardResultFingerprint('success', oversized)).toBeUndefined()

    // Eight identical oversized results: with no fingerprint there is no evidence,
    // so the reminder may fire but the call must never become blockable.
    let state = createGuardLoopState(1)
    let last = observeGuardLoop(state, 1, { name: 'read', arguments: { path: 'big' }, outcome: 'success', result: oversized })
    state = last.state
    for (let index = 0; index < 7; index += 1) {
      last = observeGuardLoop(state, 1, { name: 'read', arguments: { path: 'big' }, outcome: 'success', result: oversized })
      state = last.state
    }
    expect(last.decision.repeatCount).toBe(8)
    expect(last.decision.blockCandidate).toBe(false)
    expect(last.decision.noProgressEvidence).toBe('none')
    expect(state.history.every(entry => entry.resultFingerprint === undefined)).toBe(true)
  })

  it('drops an observation whose argument signature exceeds the budget instead of comparing it', () => {
    const oversizedArgs = { path: 'a', blob: 'y'.repeat(FINGERPRINT_MAX_BYTES + 1024) }
    expect(guardToolSignature('read', oversizedArgs)).toBeUndefined()

    const first = observeGuardLoop(createGuardLoopState(1), 1, {
      name: 'read', arguments: oversizedArgs, outcome: 'success', resultFingerprint: 'same',
    })
    expect(first.decision.ignored).toBe(true)
    expect(first.decision.blockCandidate).toBe(false)
    expect(first.state.history).toHaveLength(0)
  })

  it('does not overflow the stack on nesting deeper than the depth budget', () => {
    const tooDeep = nest(FINGERPRINT_MAX_DEPTH + 1)
    expect(() => guardResultFingerprint('success', tooDeep)).not.toThrow()
    expect(guardResultFingerprint('success', tooDeep)).toBeUndefined()
    // Far past any recursive walk's limit: still a clean `undefined`, never a throw.
    expect(guardResultFingerprint('success', nest(20_000))).toBeUndefined()
    expect(guardToolSignature('read', nest(20_000))).toBeUndefined()

    const observed = observeGuardLoop(createGuardLoopState(1), 1, {
      name: 'read', arguments: { path: 'a' }, outcome: 'success', result: nest(20_000),
    })
    expect(observed.decision.blockCandidate).toBe(false)
    expect(observed.state.history[0].resultFingerprint).toBeUndefined()
  })

  it('accepts nesting inside the depth budget', () => {
    expect(guardResultFingerprint('success', nest(FINGERPRINT_MAX_DEPTH - 1))).toMatch(/^[a-f0-9]{64}$/)
  })

  it('stops at the node budget without returning a partial fingerprint', () => {
    const tooManyNodes = Array.from({ length: FINGERPRINT_MAX_NODES + 1 }, (_, index) => index)
    expect(guardResultFingerprint('success', tooManyNodes)).toBeUndefined()
    // A wide-but-shallow object under budget still fingerprints normally.
    expect(guardResultFingerprint('success', { items: Array.from({ length: 500 }, (_, index) => index) }))
      .toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps the loop lifecycle intact across cyclic and throwing inputs', () => {
    const cyclic: Record<string, unknown> = { name: 'cycle' }
    cyclic.self = cyclic
    expect(guardResultFingerprint('success', cyclic)).toBeUndefined()
    expect(guardToolSignature('read', cyclic)).toBeUndefined()

    const throwing = { get boom(): string { throw new Error('getter exploded') } }
    expect(guardResultFingerprint('success', throwing)).toBeUndefined()

    // A result that cannot be fingerprinted must not break the run: the call is
    // still recorded (signature is fine) and the next normal call keeps working.
    let state = createGuardLoopState(1)
    const withCyclic = observeGuardLoop(state, 1, { name: 'read', arguments: { path: 'c' }, outcome: 'success', result: cyclic })
    expect(withCyclic.decision.ignored).toBe(false)
    state = withCyclic.state
    const withThrowing = observeGuardLoop(state, 1, { name: 'read', arguments: { path: 'c' }, outcome: 'success', result: throwing })
    state = withThrowing.state
    expect(state.history).toHaveLength(2)
    expect(state.history.every(entry => entry.resultFingerprint === undefined)).toBe(true)
    expect(withThrowing.decision.blockCandidate).toBe(false)

    const normal = observeGuardLoop(state, 1, { name: 'read', arguments: { path: 'c' }, outcome: 'success', result: { ok: true } })
    expect(normal.state.history).toHaveLength(3)
    expect(normal.state.history.at(-1)?.resultFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(normal.state.turn).toBe(1)
  })

  it('never treats a missing fingerprint as an unchanged result', () => {
    // Same call, one fingerprinted result and one over budget: no evidence.
    const first = observeGuardLoop(createGuardLoopState(1), 1, {
      name: 'read', arguments: { path: 'a' }, outcome: 'success', result: { ok: true },
    })
    const second = observeGuardLoop(first.state, 1, {
      name: 'read', arguments: { path: 'a' }, outcome: 'success',
      result: { content: [{ type: 'text', text: 'x'.repeat(FINGERPRINT_MAX_BYTES + 1) }] },
    })
    expect(second.decision.repeatCount).toBe(2)
    expect(second.decision.noProgressEvidence).toBe('none')
    expect(second.decision.blockCandidate).toBe(false)
  })
})
