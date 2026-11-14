/**
 * End-to-end: real wire output -> client adapter.
 *
 * WHY THIS FILE EXISTS: the adapter's mappers (mapCallPage / mapIndexStatus /
 * mapOverview) had NO direct test. Every existing test either built a view model
 * by hand or stubbed the remote, so a mismatch between what `callIndexReply()`
 * actually emits and what the adapter demands could not be caught — which is
 * exactly the bug that made the page print 「Host 返回了无效的响应结构」 while the
 * wire was answering fine.
 *
 * These feed the REAL projector's output into the REAL mapper, so any drift
 * between the two fails here instead of in production.
 */
import { describe, expect, it } from 'vitest'
import { callIndexReply } from '../src/usage/call-index-wire.ts'
import { mapCallPage, mapIndexStatus, mapOverview } from '../src/client/call-index-adapter.ts'

const ROW = {
  sessionId: 'sess-1', callSeq: 1, callId: 'call-1', toolName: 'bash',
  startedAt: Date.UTC(2026, 10, 10, 2, 30), outcome: 'success' as const,
  inherited: false, sourceKind: 'native' as const, layer: 'unknown',
}

const META = {
  corpus: 'persisted-plus-observed-live' as const,
  snapshotId: 'snap-1', generation: 55, asOf: Date.UTC(2026, 10, 10),
  coverage: 'partial' as const, totalExact: false,
  semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
}

const SUMMARY = { total: 1, success: 1, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 }

/** Run the real wire projector, then the real mapper, and require a value. */
function roundTrip(kind: 'calls' | 'status' | 'summary', data: Record<string, unknown>) {
  const wire = callIndexReply({ schemaVersion: 1, ok: true, kind, data })
  expect(wire.ok, `wire rejected the ${kind} payload`).toBe(true)
  return wire
}

describe('wire output is accepted by the client adapter', () => {
  it('maps a calls page the Host actually emits', () => {
    const wire = roundTrip('calls', { ...META, summary: SUMMARY, total: 1, items: [ROW] })
    const mapped = mapCallPage(wire)
    expect(mapped.ok, mapped.ok ? '' : `adapter rejected: ${JSON.stringify(mapped.error)}`).toBe(true)
    if (!mapped.ok) return
    expect(mapped.value.items).toHaveLength(1)
    expect(mapped.value.items[0]?.toolName).toBe('bash')
    expect(mapped.value.totalExact).toBe(false)
  })

  it('maps an empty calls page', () => {
    const wire = roundTrip('calls', { ...META, summary: SUMMARY, total: 0, items: [] })
    const mapped = mapCallPage(wire)
    expect(mapped.ok).toBe(true)
  })

  it('maps a status reply the Host actually emits', () => {
    const wire = roundTrip('status', {
      ...META,
      censusGeneration: 1,
      phase: 'partial',
      eventCoverage: 'partial', enumerationCoverage: 'complete',
      listedSessions: 1, visibleSessions: 1, completedSessions: 1,
      pendingSessions: 0, failedSessions: 0, pendingLive: 0,
      estimatedBytes: 0, reasons: [], totals: SUMMARY,
      scope: { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 },
    })
    const mapped = mapIndexStatus(wire)
    expect(mapped.ok, mapped.ok ? '' : `adapter rejected: ${JSON.stringify(mapped.error)}`).toBe(true)
    if (!mapped.ok) return
    expect(mapped.value.phase).toBe('partial')
    expect(mapped.value.scope.status).toBe('ready')
  })

  it('maps an overview with aggregates the Host actually emits', () => {
    const wire = roundTrip('summary', {
      ...META, summary: SUMMARY, total: 1,
      aggregates: {
        distinctTools: 1,
        bySource: { mcp: 0, 'plugin-tool': 0, native: 1, skill: 0, unknown: 0 },
        byDay: [{ day: '2026-11-10', calls: 1, success: 1, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0 }],
        dayOffsetMinutes: 480,
      },
    })
    const mapped = mapOverview(wire)
    expect(mapped.ok, mapped.ok ? '' : `adapter rejected: ${JSON.stringify(mapped.error)}`).toBe(true)
    if (!mapped.ok) return
    expect(mapped.value.aggregates?.distinctTools).toBe(1)
  })

  it('maps an overview without aggregates', () => {
    const wire = roundTrip('summary', { ...META, summary: SUMMARY, total: 0 })
    expect(mapOverview(wire).ok).toBe(true)
  })
  // The adapter keeps its OWN copy of the phase enum. Fixing the wire allowlist
  // was not enough: `CALL_INDEX_STATUS_PHASES` listed only
  // idle/running/cancelled/failed, so a finished scan ('complete' or 'partial')
  // was rejected here and the page showed 「读取失败：Host 返回了无效的响应结构」
  // while the Host answered perfectly.
  it('accepts every phase the wire can emit', () => {
    for (const phase of ['idle', 'running', 'complete', 'partial', 'cancelled', 'failed'] as const) {
      const wire = roundTrip('status', {
        ...META, censusGeneration: 1, phase,
        eventCoverage: 'partial', enumerationCoverage: 'complete',
        listedSessions: 0, visibleSessions: 0, completedSessions: 0,
        pendingSessions: 0, failedSessions: 0, pendingLive: 0,
        estimatedBytes: 0, reasons: [], totals: SUMMARY,
        scope: { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 },
      })
      const mapped = mapIndexStatus(wire)
      expect(mapped.ok, `adapter rejected phase=${phase}`).toBe(true)
    }
  })
})
