import { describe, expect, it } from 'vitest'
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from '@deepseek-ai/dsh-session'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import {
  CallIndexPartition,
  projectCallIndexEvent,
  type CallIndexEvent,
  type CallIndexPartitionOptions,
  type CallIndexRow,
} from '../src/usage/call-index-core.ts'

const T0 = Date.UTC(2026, 10, 8, 12, 0, 0)

interface CallOptions {
  readonly turn?: number
  readonly step?: number
  readonly time?: number
}

function callRaw(seq: number, callId: string, name: string, options: CallOptions = {}): unknown {
  const turn = options.turn ?? 1
  const step = options.step ?? 1
  const time = options.time ?? T0 + seq * 1000
  return {
    type: 'tool/call',
    seq,
    time,
    data: { turn, step, callId, name, arguments: '{"secret":"ARGUMENT-CANARY"}' },
  }
}

interface ResultOptions {
  readonly isError?: boolean
  readonly code?: string
  readonly time?: number
  readonly turn?: number
  readonly step?: number
  readonly surfaceOp?: 'append' | { readonly op: 'replace'; readonly startSeq: number; readonly endSeq: number }
}

function resultRaw(seq: number, callId: string, options: ResultOptions = {}): unknown {
  const isError = options.isError ?? false
  const time = options.time ?? T0 + seq * 1000
  const turn = options.turn ?? 1
  const step = options.step ?? 1
  const data: Record<string, unknown> = {
    turn,
    step,
    message: { toolCallId: callId, isError, content: [{ type: 'text', text: 'PRIVATE TOOL OUTPUT' }] },
  }
  if (options.code !== undefined) {
    data.error = { name: 'PrivateErrorName', code: options.code, reason: 'PRIVATE REASON' }
  }
  return { type: 'tool/result', seq, time, surfaceOp: options.surfaceOp ?? 'append', data }
}

function otherRaw(seq: number, type: string, data: Record<string, unknown> = {}, time = T0 + seq * 1000): unknown {
  return { type, seq, time, data }
}

function projected(raw: unknown): CallIndexEvent {
  const result = projectCallIndexEvent(raw)
  expect(result.reasons).toEqual([])
  if (result.event === undefined) throw new Error('expected a projected event')
  return result.event
}

function ingest(part: CallIndexPartition, raws: readonly unknown[]): void {
  part.ingest(raws.map(projected))
}

function makePartition(overrides: Partial<CallIndexPartitionOptions> = {}): CallIndexPartition {
  return new CallIndexPartition({
    sessionId: overrides.sessionId ?? 'session-1',
    revision: overrides.revision ?? 'rev-1',
    inheritedEventCount: overrides.inheritedEventCount ?? 0,
    maxEvents: overrides.maxEvents,
    maxCalls: overrides.maxCalls,
    maxBytes: overrides.maxBytes,
    maxOrphans: overrides.maxOrphans,
    reserve: overrides.reserve,
    resolveSource: overrides.resolveSource,
  })
}

function rowOf(rows: readonly CallIndexRow[], callId: string): CallIndexRow {
  const found = rows.filter(row => row.callId === callId)
  expect(found).toHaveLength(1)
  return found[0]
}

describe('projectCallIndexEvent', () => {
  it('projects tool/call coordinates without copying arguments', () => {
    const event = projected(callRaw(3, 'call-1', 'files_read'))
    expect(event).toEqual({
      seq: 3,
      time: T0 + 3000,
      kind: 'call',
      callId: 'call-1',
      toolName: 'files_read',
      turn: 1,
      step: 1,
    })
    expect(JSON.stringify(event)).not.toContain('ARGUMENT-CANARY')
  })

  it('projects success and failure results without copying content, error name or reason', () => {
    const success = projected(resultRaw(4, 'call-1'))
    expect(success).toEqual({
      seq: 4,
      time: T0 + 4000,
      kind: 'result',
      callId: 'call-1',
      outcome: 'success',
      turn: 1,
      step: 1,
    })

    const failure = projected(resultRaw(5, 'call-1', { isError: true, code: 'E_TOOL_FAILED' }))
    expect(failure.outcome).toBe('error')
    expect(failure.errorCode).toBe('E_TOOL_FAILED')
    const serialized = JSON.stringify(failure)
    expect(serialized).not.toContain('PRIVATE TOOL OUTPUT')
    expect(serialized).not.toContain('PRIVATE REASON')
    expect(serialized).not.toContain('PrivateErrorName')
  })

  it('maps public cancellation and synthetic recovery codes', () => {
    expect(projected(resultRaw(6, 'c', { isError: true, code: TOOL_ABORTED })).outcome).toBe('cancelled')
    expect(projected(resultRaw(7, 'c', { isError: true, code: TOOL_ABORTED_BEFORE_DISPATCH })).outcome).toBe('cancelled')

    const unknown = projected(resultRaw(8, 'c', { isError: true, code: TOOL_OUTCOME_UNKNOWN }))
    expect(unknown.outcome).toBe('unresolved')
    expect(unknown.replacement).toBe(true)

    const notStarted = projected(resultRaw(9, 'c', { isError: true, code: TOOL_NOT_STARTED }))
    expect(notStarted.outcome).toBe('unresolved')
    expect(notStarted.replacement).toBe(true)
  })

  it('marks a surface replace result as a replacement', () => {
    const event = projected(resultRaw(10, 'c', { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 } }))
    expect(event.outcome).toBe('success')
    expect(event.replacement).toBe(true)
  })

  it('rejects invalid sequence numbers and timestamps', () => {
    const badSeq = projectCallIndexEvent({ type: 'tool/call', seq: -1, time: T0, data: {} })
    expect(badSeq.event).toBeUndefined()
    expect(badSeq.reasons).toContain('invalid-seq')

    const floatSeq = projectCallIndexEvent({ type: 'tool/call', seq: 1.5, time: T0, data: {} })
    expect(floatSeq.reasons).toContain('invalid-seq')

    const stringSeq = projectCallIndexEvent({ type: 'tool/call', seq: '2', time: T0, data: {} })
    expect(stringSeq.reasons).toContain('invalid-seq')

    const badTime = projectCallIndexEvent({ type: 'tool/call', seq: 1, time: Number.NaN, data: {} })
    expect(badTime.reasons).toContain('invalid-time')

    const nonNumericTime = projectCallIndexEvent({ type: 'tool/call', seq: 1, time: 'soon', data: {} })
    expect(nonNumericTime.reasons).toContain('invalid-time')
  })

  it('gaps unknown required events but projects ignorable ones as other', () => {
    const required = projectCallIndexEvent({ type: 'future/thing', seq: 1, time: T0 })
    expect(required.event).toBeUndefined()
    expect(required.reasons).toContain('unknown-required-event')

    const ignorable = projectCallIndexEvent({ type: 'future/thing', seq: 1, time: T0, ignorable: true, data: { content: 'FUTURE-SECRET' } })
    expect(ignorable.reasons).toEqual([])
    expect(ignorable.event?.kind).toBe('other')
    expect(JSON.stringify(ignorable.event)).not.toContain('FUTURE-SECRET')
  })

  it('reads only the closing turn for turn/end and nothing else for turn/start', () => {
    const end = projected(otherRaw(9, 'turn/end', { turn: 2, reason: 'PRIVATE-REASON' }))
    expect(end).toEqual({ seq: 9, time: T0 + 9000, kind: 'other', turnClosed: true, turn: 2 })
    expect(JSON.stringify(end)).not.toContain('PRIVATE-REASON')

    const start = projected(otherRaw(8, 'turn/start', { turn: 5 }))
    expect(start).toEqual({ seq: 8, time: T0 + 8000, kind: 'other' })
  })

  it('never touches forbidden getters on call and result payloads', () => {
    const data: Record<string, unknown> = { turn: 1, step: 1, callId: 'c', name: 'read' }
    for (const key of ['arguments', 'content', 'stream', 'reasoning'] as const) {
      Object.defineProperty(data, key, { enumerable: true, get() { throw new Error(`forbidden:${key}`) } })
    }
    expect(() => projectCallIndexEvent({ type: 'tool/call', seq: 1, time: T0, data })).not.toThrow()

    const message: Record<string, unknown> = { toolCallId: 'c', isError: true }
    Object.defineProperty(message, 'content', { enumerable: true, get() { throw new Error('forbidden:content') } })
    const error: Record<string, unknown> = { code: 'E_FAIL' }
    Object.defineProperty(error, 'name', { enumerable: true, get() { throw new Error('forbidden:name') } })
    Object.defineProperty(error, 'reason', { enumerable: true, get() { throw new Error('forbidden:reason') } })
    const resultData = { turn: 1, step: 1, message, error }
    expect(() => projectCallIndexEvent({ type: 'tool/result', seq: 2, time: T0, surfaceOp: 'append', data: resultData })).not.toThrow()
  })

  it('downgrades a throwing whitelisted getter to a gap instead of throwing', () => {
    const data: Record<string, unknown> = { turn: 1, step: 1, name: 'read' }
    Object.defineProperty(data, 'callId', { enumerable: true, get() { throw new Error('unreadable') } })
    const result = projectCallIndexEvent({ type: 'tool/call', seq: 1, time: T0, data })
    expect(result.event).toBeUndefined()
    expect(result.reasons).toContain('unreadable-field')
  })

  it('enforces bounded field lengths', () => {
    const longId = 'x'.repeat(513)
    const call = projectCallIndexEvent(callRaw(1, longId, 'read'))
    expect(call.event).toBeUndefined()
    expect(call.reasons).toContain('field-too-long')

    const longCode = projectCallIndexEvent(resultRaw(2, 'c', { isError: true, code: 'E'.repeat(81) }))
    expect(longCode.event?.outcome).toBe('error')
    expect(longCode.event?.errorCode).toBeUndefined()

    const nonAsciiCode = projectCallIndexEvent(resultRaw(3, 'c', { isError: true, code: '错误码' }))
    expect(nonAsciiCode.event?.outcome).toBe('error')
    expect(nonAsciiCode.event?.errorCode).toBeUndefined()
  })
})

describe('CallIndexPartition pairing', () => {
  it('pairs concurrent same-name calls by callId, not by tool name', () => {
    const part = makePartition()
    ingest(part, [
      callRaw(1, 'call-a', 'files_read'),
      callRaw(2, 'call-b', 'files_read'),
      resultRaw(3, 'call-b', { isError: true, code: 'E_B' }),
      resultRaw(4, 'call-a'),
    ])
    const snapshot = part.snapshot(5)
    expect(snapshot.rows).toHaveLength(2)
    const a = rowOf(snapshot.rows, 'call-a')
    const b = rowOf(snapshot.rows, 'call-b')
    expect(a.outcome).toBe('success')
    expect(a.resultSeq).toBe(4)
    expect(a.durationMs).toBe(3000)
    expect(b.outcome).toBe('error')
    expect(b.resultSeq).toBe(3)
  })

  it('pairs a result that arrives before its call across batches', () => {
    const part = makePartition()
    part.ingest([projected(resultRaw(5, 'call-a'))])
    expect(part.snapshot(2).rows).toHaveLength(0)
    part.ingest([projected(callRaw(2, 'call-a', 'read'))])
    const snapshot = part.snapshot(6)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0].outcome).toBe('success')
    expect(snapshot.rows[0].resultSeq).toBe(5)
  })

  it('keeps duplicate callId calls as two unknown rows instead of guessing', () => {
    const part = makePartition()
    ingest(part, [
      callRaw(1, 'dup', 'read', { turn: 1, step: 1 }),
      callRaw(2, 'dup', 'read', { turn: 1, step: 1 }),
      resultRaw(3, 'dup', { turn: 1, step: 1 }),
    ])
    const snapshot = part.snapshot(4)
    expect(snapshot.rows).toHaveLength(2)
    expect(snapshot.rows.every(row => row.outcome === 'unknown')).toBe(true)
    expect(snapshot.reasons).toContain('duplicate-call-id')
  })

  it('does not treat different turns as permission to reuse a conflicting callId', () => {
    const part = makePartition()
    ingest(part, [
      callRaw(1, 'dup', 'read', { turn: 1, step: 1 }),
      callRaw(2, 'dup', 'read', { turn: 2, step: 1 }),
      resultRaw(3, 'dup', { turn: 2, step: 1, isError: true, code: 'E' }),
    ])
    const snapshot = part.snapshot(4)
    const byTurn = snapshot.rows.filter(row => row.turn === 2)
    expect(byTurn).toHaveLength(1)
    expect(byTurn[0].outcome).toBe('unknown')
    expect(snapshot.reasons).toContain('duplicate-call-id')
    const first = snapshot.rows.filter(row => row.turn === 1)
    expect(first).toHaveLength(1)
    expect(first[0].outcome).toBe('unknown')
  })

  it('does not pair a result whose turn/step conflicts with the only call', () => {
    const part = makePartition()
    ingest(part, [
      callRaw(1, 'c', 'read', { turn: 1, step: 1 }),
      resultRaw(3, 'c', { turn: 2, step: 1 }),
    ])
    const snapshot = part.snapshot(4)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0].outcome).toBe('unresolved')
    expect(snapshot.reasons).toContain('turn-step-mismatch')
  })

  it('dedupes identical seq and flags conflicting metadata without overriding', () => {
    const part = makePartition()
    ingest(part, [callRaw(1, 'call-a', 'read')])
    ingest(part, [callRaw(1, 'call-a', 'read')])
    expect(part.usage().calls).toBe(1)
    expect(part.usage().events).toBe(1)

    ingest(part, [callRaw(1, 'call-b', 'write')])
    expect(part.usage().calls).toBe(1)
    const snapshot = part.snapshot(2)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0].callId).toBe('call-a')
    expect(snapshot.reasons).toContain('seq-conflict')
  })

  it('picks the earliest real result and rejects a result that precedes its call', () => {
    const part = makePartition()
    part.ingest([projected(callRaw(2, 'c', 'read'))])
    part.ingest([projected(resultRaw(10, 'c'))])
    part.ingest([projected(resultRaw(8, 'c', { isError: true, code: 'E' }))])
    part.ingest([projected(resultRaw(1, 'c'))])

    const snapshot = part.snapshot(11)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0].outcome).toBe('error')
    expect(snapshot.rows[0].resultSeq).toBe(8)
    expect(snapshot.reasons).toContain('result-before-call')
  })

  it('never lets a surface replacement or recovery override a real result', () => {
    const part = makePartition()
    ingest(part, [
      callRaw(1, 'c1', 'read'),
      resultRaw(2, 'c1'),
      resultRaw(3, 'c1', { isError: true, code: 'E_REPLACED', surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } }),
      callRaw(4, 'c2', 'read'),
      resultRaw(5, 'c2', { isError: true, code: TOOL_OUTCOME_UNKNOWN }),
      resultRaw(6, 'c2'),
    ])
    const snapshot = part.snapshot(7)
    const c1 = rowOf(snapshot.rows, 'c1')
    expect(c1.outcome).toBe('success')
    expect(c1.resultSeq).toBe(2)
    const c2 = rowOf(snapshot.rows, 'c2')
    expect(c2.outcome).toBe('success')
    expect(c2.resultSeq).toBe(6)
  })

  it('reports an unresolved row when only a recovery result is present', () => {
    const part = makePartition()
    ingest(part, [
      callRaw(1, 'c', 'read'),
      resultRaw(2, 'c', { isError: true, code: TOOL_NOT_STARTED }),
    ])
    const snapshot = part.snapshot(3)
    expect(snapshot.rows[0].outcome).toBe('unresolved')
    expect(snapshot.rows[0].resultSeq).toBe(2)
  })

  it('marks fork-prefix calls inherited and still pairs a cross-prefix result', () => {
    const part = makePartition({ inheritedEventCount: 5 })
    ingest(part, [
      callRaw(2, 'inherited-call', 'read'),
      callRaw(6, 'live-call', 'read'),
      resultRaw(7, 'inherited-call'),
    ])
    const snapshot = part.snapshot(8)
    expect(rowOf(snapshot.rows, 'inherited-call').inherited).toBe(true)
    expect(rowOf(snapshot.rows, 'inherited-call').outcome).toBe('success')
    expect(rowOf(snapshot.rows, 'live-call').inherited).toBe(false)
  })

  it('leaves duration empty and records a clock anomaly for negative time deltas', () => {
    const part = makePartition()
    ingest(part, [
      callRaw(1, 'c', 'read', { time: T0 + 5000 }),
      resultRaw(2, 'c', { time: T0 + 1000 }),
    ])
    const snapshot = part.snapshot(3)
    expect(snapshot.rows[0].outcome).toBe('success')
    expect(snapshot.rows[0].durationMs).toBeUndefined()
    expect(snapshot.reasons).toContain('clock-anomaly')
  })

  it('keeps a resultless historic call unresolved regardless of a missing turn-end marker', () => {
    const part = makePartition()
    ingest(part, [callRaw(1, 'c', 'read', { turn: 1 })])
    expect(part.snapshot(2).rows[0].outcome).toBe('unresolved')
    ingest(part, [otherRaw(2, 'turn/end', { turn: 1 })])
    expect(part.snapshot(3).rows[0].outcome).toBe('unresolved')
  })
})

describe('CallIndexPartition coverage, capacity and immutability', () => {
  it('reports complete only for a contiguous, gap-free observed range', () => {
    const part = makePartition()
    ingest(part, [
      otherRaw(0, 'session/title', { title: 'x' }),
      callRaw(1, 'c', 'read'),
      resultRaw(2, 'c'),
    ])
    expect(part.snapshot(3).coverage).toBe('complete')

    const sparse = makePartition()
    ingest(sparse, [otherRaw(0, 'session/title'), otherRaw(2, 'session/title')])
    expect(sparse.snapshot(3).coverage).toBe('partial')
  })

  it('keeps rows in a partial snapshot instead of zeroing them', () => {
    const part = makePartition()
    part.ingest([projected(callRaw(2, 'c', 'read'))])
    const snapshot = part.snapshot(3)
    expect(snapshot.coverage).toBe('partial')
    expect(snapshot.rows).toHaveLength(1)
  })

  it('turns an external gap into partial coverage and never stores free text', () => {
    const part = makePartition()
    ingest(part, [otherRaw(0, 'session/title'), callRaw(1, 'c', 'read')])
    expect(part.snapshot(2).coverage).toBe('complete')
    part.addGap('some free-form error text that must not survive')
    const snapshot = part.snapshot(2)
    expect(snapshot.coverage).toBe('partial')
    expect(snapshot.reasons).toContain('projection-gap')
    expect(snapshot.reasons).not.toContain('some free-form error text that must not survive')
  })

  it('stops at the call capacity and refuses to report complete', () => {
    const part = makePartition({ maxCalls: 1 })
    ingest(part, [callRaw(0, 'c1', 'read'), callRaw(1, 'c2', 'read')])
    expect(part.usage().calls).toBe(1)
    const snapshot = part.snapshot(2)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.coverage).toBe('partial')
    expect(snapshot.reasons).toContain('index-capacity')

    ingest(part, [callRaw(2, 'c3', 'read')])
    expect(part.usage().calls).toBe(1)
  })

  it('stops at the event capacity', () => {
    const part = makePartition({ maxEvents: 1 })
    ingest(part, [otherRaw(0, 'session/title'), callRaw(1, 'c', 'read')])
    expect(part.usage().events).toBe(1)
    expect(part.snapshot(2).reasons).toContain('index-capacity')
    expect(part.snapshot(2).coverage).toBe('partial')
  })

  it('stops at the byte budget', () => {
    const part = makePartition({ maxBytes: 1 })
    ingest(part, [callRaw(0, 'c', 'read')])
    const snapshot = part.snapshot(1)
    expect(part.usage().bytes).toBe(0)
    expect(part.usage().events).toBe(0)
    expect(snapshot.reasons).toContain('index-capacity')
    expect(snapshot.coverage).toBe('partial')
  })

  it('honors an external reserve denial and reports it as partial without charging bytes', () => {
    let calls = 0
    const part = makePartition({
      reserve: () => {
        calls += 1
        return false
      },
    })
    ingest(part, [callRaw(0, 'c', 'read')])
    expect(calls).toBe(1)
    expect(part.usage().bytes).toBe(0)
    expect(part.usage().calls).toBe(0)
    const snapshot = part.snapshot(1)
    expect(snapshot.coverage).toBe('partial')
    expect(snapshot.reasons).toContain('reserve-denied')

    ingest(part, [callRaw(1, 'c2', 'read')])
    expect(part.usage().calls).toBe(0)
  })

  it('increases usage.bytes when the reserve budget accepts an entry', () => {
    const reserved: number[] = []
    const part = makePartition({ reserve: (bytes) => { reserved.push(bytes); return true } })
    ingest(part, [callRaw(0, 'c', 'read')])
    expect(reserved.length).toBeGreaterThan(0)
    expect(part.usage().bytes).toBeGreaterThan(0)
    expect(part.usage().bytes).toBe(reserved.reduce((sum, value) => sum + value, 0))
  })

  it('bounds orphan results and reports orphan capacity', () => {
    const part = makePartition({ maxOrphans: 1 })
    ingest(part, [resultRaw(0, 'missing-a'), resultRaw(1, 'missing-b')])
    const snapshot = part.snapshot(2)
    expect(snapshot.reasons).toContain('orphan-capacity')
    expect(snapshot.coverage).toBe('partial')
  })

  it('does not let later ingestion mutate an earlier snapshot', () => {
    const part = makePartition()
    part.ingest([projected(callRaw(1, 'c', 'read'))])
    const before = part.snapshot(3)
    expect(before.rows[0].outcome).toBe('unresolved')
    const frozen = JSON.stringify(before)

    part.ingest([projected(resultRaw(2, 'c'))])
    const after = part.snapshot(3)
    expect(after.rows[0].outcome).toBe('success')

    expect(JSON.stringify(before)).toBe(frozen)
    expect(before.rows[0].outcome).toBe('unresolved')
    expect(before.rows[0].resultSeq).toBeUndefined()
  })

  it('honors the snapshot cut so events at or above cut are excluded', () => {
    const part = makePartition()
    part.ingest([projected(callRaw(1, 'c', 'read')), projected(resultRaw(2, 'c'))])
    expect(part.snapshot(2).rows[0].outcome).toBe('unresolved')
    expect(part.snapshot(3).rows[0].outcome).toBe('success')
    expect(part.snapshot(3).rows[0].resultSeq).toBe(2)
  })

  it('exposes consistent usage counters', () => {
    const part = makePartition()
    ingest(part, [callRaw(1, 'c1', 'read'), callRaw(2, 'c2', 'read'), resultRaw(3, 'c1')])
    const usage = part.usage()
    expect(usage.events).toBe(3)
    expect(usage.calls).toBe(2)
    expect(usage.bytes).toBeGreaterThan(0)
  })
})

describe('callIndex provenance (A1-1)', () => {
  it('stays unknown for every row when no resolver is supplied', () => {
    const part = makePartition()
    ingest(part, [callRaw(1, 'c1', 'read_file'), resultRaw(2, 'c1')])
    const rows = part.snapshot(10).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceKind).toBe('unknown')
    // PTC nesting is never guessed, even when provenance is known.
    expect(rows[0].layer).toBe('unknown')
  })

  it('takes the resolver verdict verbatim for each tool name', () => {
    const verdicts: Record<string, 'mcp' | 'plugin-tool' | 'native' | 'skill' | 'unknown'> = {
      ops_bash: 'native',
      'mcp__github__create_issue': 'mcp',
      some_plugin_tool: 'plugin-tool',
      pending_tool: 'unknown',
    }
    const part = makePartition({ resolveSource: name => verdicts[name] ?? 'unknown' })
    ingest(part, [
      callRaw(1, 'c1', 'ops_bash'), resultRaw(2, 'c1'),
      callRaw(3, 'c2', 'mcp__github__create_issue'), resultRaw(4, 'c2'),
      callRaw(5, 'c3', 'some_plugin_tool'), resultRaw(6, 'c3'),
      callRaw(7, 'c4', 'pending_tool'), resultRaw(8, 'c4'),
    ])
    const rows = part.snapshot(20).rows
    expect(rows.map(row => [row.callId, row.sourceKind])).toEqual([
      ['c1', 'native'],
      ['c2', 'mcp'],
      ['c3', 'plugin-tool'],
      ['c4', 'unknown'],
    ])
  })

  it('never derives a kind from the tool name itself', () => {
    // An `mcp__` prefix is a naming convention, not evidence. With no resolver
    // verdict the row must stay unknown instead of being guessed as MCP.
    const part = makePartition({ resolveSource: () => 'unknown' })
    ingest(part, [callRaw(1, 'c1', 'mcp__github__create_issue'), resultRaw(2, 'c1')])
    expect(rowOf(part.snapshot(10).rows, 'c1').sourceKind).toBe('unknown')
  })

  it('degrades a throwing or bogus resolver to unknown without failing the partition', () => {
    const part = makePartition({
      resolveSource: (name) => {
        if (name === 'explodes') throw new Error('catalog read failed')
        // A resolver is Host-adjacent code; a value outside the union must not leak.
        return 'not-a-kind' as unknown as 'unknown'
      },
    })
    const raws = [callRaw(1, 'c1', 'explodes'), resultRaw(2, 'c1'), callRaw(3, 'c2', 'weird'), resultRaw(4, 'c2')]
    ingest(part, raws)
    const rows = part.snapshot(10).rows
    expect(rows.map(row => row.sourceKind)).toEqual(['unknown', 'unknown'])

    // The real contract: a resolver failure must not be reported as a coverage
    // gap. Compare against an identical partition with no resolver at all.
    const control = makePartition()
    ingest(control, raws)
    expect(part.snapshot(10).coverage).toBe(control.snapshot(10).coverage)
    expect(part.snapshot(10).reasons).toEqual(control.snapshot(10).reasons)
  })

  it('resolves each tool name once, not once per call', () => {
    let lookups = 0
    const part = makePartition({ resolveSource: () => { lookups += 1; return 'native' } })
    const raws: unknown[] = []
    for (let i = 0; i < 20; i += 1) {
      raws.push(callRaw(i * 2 + 1, `c${i}`, 'read_file'), resultRaw(i * 2 + 2, `c${i}`))
    }
    ingest(part, raws)
    const rows = part.snapshot(100).rows
    expect(rows).toHaveLength(20)
    expect(rows.every(row => row.sourceKind === 'native')).toBe(true)
    // Cached per name: a Session with thousands of calls must not hit the
    // catalog once per row.
    expect(lookups).toBe(1)
  })
})
