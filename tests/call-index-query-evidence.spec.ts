import { describe, expect, it } from 'vitest'
import { CallIndexQueries, type CallIndexQuerySnapshot, type CallIndexQuerySource } from '../src/usage/call-index-query.ts'
import { SessionCallIndex } from '../src/usage/session-index.ts'
import type { CallIndexRow } from '../src/usage/call-index-core.ts'
const row = (sessionId: string, outcome: 'success' | 'error'): CallIndexRow => ({ sessionId, callSeq: 0, callId: sessionId, toolName: 'echo', startedAt: 1000, outcome, inherited: false, sourceKind: 'unknown', layer: 'unknown' })
function source(rows = [row('a', 'success'), row('b', 'error')]): CallIndexQuerySource {
  const base = new SessionCallIndex({ getMode: () => undefined, getBackend: () => undefined }).snapshot()
  const snapshot: CallIndexQuerySnapshot = {
    ...base, scope: { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 },
    generation: 1, coverage: 'complete', eventCoverage: 'complete', enumerationCoverage: 'complete',
    rows, sessions: rows.map(item => ({ sessionId: item.sessionId, revision: 'r', cut: 1, coverage: 'complete', stale: false, reasons: [] })),
  }
  return { snapshot: () => snapshot, stamp: () => 'one', isSessionVisible: async () => true }
}

describe('N23 query evidence invariants', () => {
  it('binds a snapshot to its filter for an omitted-filter summary and rejects conflicting filters', () => {
    const q = new CallIndexQueries(source())
    const page = q.listCalls({ query: { outcome: 'success' } })
    expect(page.ok).toBe(true)
    const snapshotId = page.data!.snapshotId
    expect(q.getSummary({ snapshotId }).data!.total).toBe(1)
    expect(q.getSummary({ snapshotId, query: { outcome: 'error' } }).reason).toBe('invalid-request')
  })
  it('does not reveal a detail outside the selected snapshot filter', async () => {
    const q = new CallIndexQueries(source())
    const page = q.listCalls({ query: { sessionId: 'a' } })
    expect((await q.getCallDetail({ snapshotId: page.data!.snapshotId, sessionId: 'b', callSeq: 0 })).ok).toBe(false)
  })
  it('rejects impossible date intervals instead of reporting complete zero calls', () => {
    expect(new CallIndexQueries(source()).listCalls({ query: { fromMs: 2000, toMs: 1000 } })).toMatchObject({ ok: false, reason: 'invalid-request' })
  })
  it('does not emit an oversized single row when even one item cannot fit', () => {
    const q = new CallIndexQueries(source(), { maxReplyBytes: 64 })
    expect(q.listCalls()).toMatchObject({ ok: false, reason: 'reply-too-large' })
  })
  it('does not silently drop invalid metadata while claiming complete totals', () => {
    const q = new CallIndexQueries(source([{ ...row('a', 'success'), toolName: 'x'.repeat(513) }]))
    expect(q.getSummary().ok).toBe(false)
  })
  it('marks known-source totals inexact when provenance remains unknown', () => {
    const q = new CallIndexQueries(source())
    const page = q.listCalls({ query: { sourceKind: 'native' } })
    expect(page.ok).toBe(true)
    expect(page.data!.total).toBe(0)
    expect(page.data!.totalExact).toBe(false)
  })
})
