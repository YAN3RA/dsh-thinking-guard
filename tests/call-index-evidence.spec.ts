import { describe, expect, it } from 'vitest'
import { CallIndexPartition, type CallIndexEvent } from '../src/usage/call-index-core.ts'
const call = (seq: number, turn = 1): CallIndexEvent => ({ seq, time: 1000 + seq, kind: 'call', callId: 'same-id', toolName: 'echo', turn, step: 1 })
const result = (seq: number): CallIndexEvent => ({ seq, time: 1000 + seq, kind: 'result', callId: 'same-id', outcome: 'success', turn: 1, step: 1 })
const partition = () => new CallIndexPartition({ sessionId: 'evidence', revision: 'r', inheritedEventCount: 0 })

describe('call-index evidence boundaries from the accepted plan', () => {
  it('does not infer that a historic call is currently running from an unclosed log', () => {
    const part = partition()
    part.ingest([call(0)])
    expect(part.snapshot(1).rows[0]!.outcome).toBe('unresolved')
  })
  it('marks all duplicate callId rows unknown even if one completed before the conflict', () => {
    const part = partition()
    part.ingest([call(0), result(1), call(2, 2)])
    const snapshot = part.snapshot(3)
    expect(snapshot.rows.map(row => row.outcome)).toEqual(['unknown', 'unknown'])
    expect(snapshot.reasons).toContain('duplicate-call-id')
    expect(snapshot.coverage).toBe('partial')
  })
  it('cannot describe a result-only log as complete zero-call history', () => {
    const part = partition()
    part.ingest([result(0)])
    expect(part.snapshot(1).coverage).toBe('partial')
    expect(part.snapshot(1).reasons).toContain('orphan-result')
  })
})
