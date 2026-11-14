import { describe, expect, it } from 'vitest'
import { CALL_INDEX_TYPERT_REMOTE, CALL_INDEX_REMOTE_NAMESPACE, CALL_INDEX_REMOTE_PACKAGE } from '../src/client/call-index-remote.ts'
import {
  CALL_INDEX_HOST_FACE_NAMESPACE,
  CALL_INDEX_HOST_FACE_PACKAGE,
  CALL_INDEX_HOST_FACE_SERVICE,
  CALL_INDEX_RUNTIME_SERVICE,
  CALL_INDEX_WIRE_METHODS,
  callIndexHostFace,
} from '../src/usage/call-index-host-face.ts'
import { callIndexError, callIndexReply } from '../src/usage/call-index-wire.ts'

type Dict = Record<string, unknown>
const hostFace = callIndexHostFace()

const EXPECTED = ['getIndexStatus', 'startIndex', 'cancelIndex', 'getSummary', 'listSessions', 'listCalls', 'getCallDetail']

function clientWireTable() {
  const table = new Map<string, [string, boolean][]>()
  for (const descriptor of CALL_INDEX_TYPERT_REMOTE.descriptors) {
    table.set(descriptor.method, descriptor.parameters.map((parameter) => [
      parameter.wire,
      (parameter as { acceptsUndefined?: boolean }).acceptsUndefined === true,
    ]))
  }
  return table
}

function hostWireTable() {
  const table = new Map<string, [string, boolean][]>()
  for (const invocation of hostFace.invocations) {
    table.set(invocation.method, invocation.parameters.map((parameter) => [parameter.wire, parameter.acceptsUndefined === true]))
  }
  return table
}

function row(init: Dict = {}): Dict {
  return {
    sessionId: 's1', callSeq: 1, callId: 'c1', toolName: 'echo', startedAt: 1000,
    outcome: 'success', inherited: false, sourceKind: 'unknown', layer: 'unknown', ...init,
  }
}

describe('callIndex faces are mirrored', () => {
  it('declares the namespace, service and package consistently', () => {
    expect(CALL_INDEX_HOST_FACE_PACKAGE).toBe('dsh-thinking-guard')
    expect(CALL_INDEX_HOST_FACE_PACKAGE).toBe(CALL_INDEX_REMOTE_PACKAGE)
    expect(CALL_INDEX_HOST_FACE_NAMESPACE).toBe('callIndex')
    expect(CALL_INDEX_HOST_FACE_NAMESPACE).toBe(CALL_INDEX_REMOTE_NAMESPACE)
    expect(CALL_INDEX_HOST_FACE_SERVICE).toBe('callIndexGateway')
    expect(CALL_INDEX_RUNTIME_SERVICE).toBe('callIndexRuntime')
    expect(CALL_INDEX_HOST_FACE_SERVICE).not.toBe(CALL_INDEX_RUNTIME_SERVICE)
  })

  it('declares exactly the expected wire methods', () => {
    expect(CALL_INDEX_WIRE_METHODS.map(([method]) => method)).toEqual(EXPECTED)
    expect([...hostWireTable().keys()].sort()).toEqual([...EXPECTED].sort())
    expect([...clientWireTable().keys()].sort()).toEqual([...EXPECTED].sort())
  })

  it('sends the same wire parameters with the same optionality on both faces', () => {
    const host = hostWireTable()
    for (const [method, expected] of clientWireTable()) {
      expect(host.get(method), method).toEqual(expected)
    }
    // Names the request object consistently and marks only optional methods.
    expect(host.get('getIndexStatus')).toEqual([])
    expect(host.get('startIndex')).toEqual([['request', true]])
    expect(host.get('cancelIndex')).toEqual([['request', false]])
    expect(host.get('getCallDetail')).toEqual([['request', false]])
  })

  it('satisfies the registry invocation rules', () => {
    const ids = new Set<string>()
    const endpoints = new Set<string>()
    const wireName = /^[A-Za-z0-9_$.-]+$/
    expect(hostFace.face).toBe('host')
    expect(hostFace.schemas).toEqual([])
    expect(hostFace.model).toEqual({ services: [], events: [], objects: [] })
    for (const invocation of hostFace.invocations) {
      expect(invocation.namespace).toBe(CALL_INDEX_HOST_FACE_NAMESPACE)
      expect(invocation.service).toBe(CALL_INDEX_HOST_FACE_SERVICE)
      expect(invocation.invocation).toEqual({ kind: 'direct' })
      expect(ids.has(invocation.id)).toBe(false)
      ids.add(invocation.id)
      const endpoint = `${invocation.namespace}/${invocation.method}`
      expect(endpoints.has(endpoint)).toBe(false)
      endpoints.add(endpoint)
      expect(invocation.method).toMatch(wireName)
      expect(invocation.result.mode).toBe('strict')
      const wires = new Set<string>()
      for (const parameter of invocation.parameters) {
        expect(parameter.name).toMatch(wireName)
        expect(parameter.wire).toMatch(wireName)
        expect(parameter.source).toBe('json')
        expect(wires.has(parameter.wire)).toBe(false)
        wires.add(parameter.wire)
        expect(parameter.codec.mode).toBe('strict')
      }
    }
  })

  it('mirrors every descriptor id and uses the shared result codec', () => {
    for (const descriptor of CALL_INDEX_TYPERT_REMOTE.descriptors) {
      expect(descriptor.id).toBe(`${CALL_INDEX_REMOTE_PACKAGE}#${CALL_INDEX_REMOTE_NAMESPACE}/${descriptor.method}`)
      expect(descriptor.service).toBe(CALL_INDEX_REMOTE_NAMESPACE)
      expect(descriptor.namespace).toBe(CALL_INDEX_REMOTE_NAMESPACE)
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
      if (descriptor.result.mode !== 'strict') throw new Error('expected a strict result codec')
      expect(descriptor.result.typeSymbol).toBe('dsh-thinking-guard#CallIndexReply')
      for (const parameter of descriptor.parameters) {
        expect(parameter.name).toBe('request')
        expect(parameter.wire).toBe('request')
        expect(parameter.source).toBe('json')
      }
    }
  })

  it('validates request arguments at the host codec', () => {
    const byMethod = new Map(hostFace.invocations.map(invocation => [invocation.method, invocation]))
    const listCalls = byMethod.get('listCalls')!
    expect(listCalls.parameters).toHaveLength(1)
    const listCodec = listCalls.parameters[0]!.codec.create()
    expect(() => listCodec.parse({ limit: 500 })).toThrow()
    expect(listCodec.parse({ limit: 10 })).toEqual({ limit: 10 })

    const start = byMethod.get('startIndex')!
    expect(start.parameters[0]!.codec.create().parse(undefined)).toBeUndefined()
    expect(start.parameters[0]!.acceptsUndefined).toBe(true)
    expect(start.parameters[0]!.codec.create().parse({ mode: 'full' })).toEqual({ mode: 'full' })
    expect(() => start.parameters[0]!.codec.create().parse({ full: true })).toThrow()

    const cancel = byMethod.get('cancelIndex')!
    expect(() => cancel.parameters[0]!.codec.create().parse(undefined)).toThrow()
    expect(cancel.parameters[0]!.codec.create().parse({})).toEqual({})

    expect(byMethod.get('getIndexStatus')!.parameters).toEqual([])
  })
})

describe('callIndex reply projection', () => {
  it('projects status data through the allowlist and drops rows / sessions / secrets', () => {
    const statusData = {
      scope: { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 3 },
      generation: 5,
      censusGeneration: 2,
      phase: 'idle',
      coverage: 'complete',
      eventCoverage: 'complete',
      enumerationCoverage: 'complete',
      semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
      listedSessions: 4,
      visibleSessions: 4,
      completedSessions: 4,
      pendingSessions: 0,
      failedSessions: 0,
      pendingLive: 0,
      estimatedBytes: 1234,
      reasons: [],
      totals: { calls: 10, succeeded: 8, failed: 1, unresolved: 1, unknown: 0, cancelled: 0, running: 0, inherited: 0 },
      rows: [{ sessionId: 'leak' }],
      sessions: [{ sessionId: 'leak' }],
      backend: 'hidden-backend',
      token: 'secret-token',
    }
    const reply = callIndexReply({ schemaVersion: 1, ok: true, kind: 'status', data: statusData })
    expect(reply.ok).toBe(true)
    expect(reply.kind).toBe('status')
    const data = reply.data as Dict
    expect(data).not.toHaveProperty('rows')
    expect(data).not.toHaveProperty('sessions')
    expect(data).not.toHaveProperty('backend')
    expect(data).not.toHaveProperty('token')
    expect(data.generation).toBe(5)
    expect((data.scope as Dict).includesOtherProfiles).toBe(true)
    expect(JSON.stringify(reply)).not.toContain('leak')
    expect(JSON.stringify(reply)).not.toContain('secret-token')
  })

  // D-033: one wrong enum value or one over-long reason code used to reject the
  // ENTIRE status reply, which turned the whole page into 「尚未收到索引状态」.
  // These three are the exact real-world shapes that did it.
  function statusWith(over: Dict): Dict {
    return {
      scope: { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 },
      generation: 55, censusGeneration: 1,
      phase: 'complete', coverage: 'partial', eventCoverage: 'partial', enumerationCoverage: 'complete',
      semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
      listedSessions: 116, visibleSessions: 116, completedSessions: 0, pendingSessions: 0, failedSessions: 0,
      pendingLive: 0, estimatedBytes: 1000, reasons: [],
      totals: { calls: 784, succeeded: 779, failed: 5, unresolved: 0, unknown: 0, cancelled: 0, running: 0, inherited: 0 },
      ...over,
    }
  }

  it('accepts phase partial instead of killing the whole status reply', () => {
    // session-index.ts emits 'partial' for a scan that read some Sessions and
    // skipped others. It was absent from the allowlist, so a realistic scan made
    // status unreadable even though every other field was valid.
    const reply = callIndexReply({ schemaVersion: 1, ok: true, kind: 'status', data: statusWith({ phase: 'partial' }) })
    expect(reply.ok).toBe(true)
    expect((reply.data as Dict).phase).toBe('partial')
  })

  it('truncates an oversized reason list instead of rejecting the reply', () => {
    const reasons = Array.from({ length: 40 }, (_, index) => `code-${index}`)
    const reply = callIndexReply({ schemaVersion: 1, ok: true, kind: 'status', data: statusWith({ reasons }) })
    expect(reply.ok).toBe(true)
    // A diagnostic field must not be able to break the read it explains.
    expect((reply.data as Dict).reasons).toHaveLength(32)
  })

  it('sanitizes an over-long or malformed reason code instead of rejecting', () => {
    const reply = callIndexReply({
      schemaVersion: 1, ok: true, kind: 'status',
      data: statusWith({ reasons: ['x'.repeat(70), 'Bad Code!!'] }),
    })
    expect(reply.ok).toBe(true)
    const codes = (reply.data as Dict).reasons as string[]
    expect(codes[0]).toHaveLength(64)
    expect(codes[1]).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  // D-034: the overview had the same failure mode the status reply had. One
  // missing counter in a day bucket made getSummary answer internal-error, so
  // 总览 printed 「Host 返回了无效的响应结构」 and lost every valid number too.
  function summaryWith(aggregates: Dict): Dict {
    return {
      corpus: 'persisted-plus-observed-live', snapshotId: 'snap-1', generation: 55, asOf: 1,
      coverage: 'partial', totalExact: false,
      semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
      summary: { total: 710, success: 705, error: 5, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 },
      total: 710,
      aggregates,
    }
  }

  it('salvages a day bucket that is missing a counter', () => {
    const reply = callIndexReply({
      schemaVersion: 1, ok: true, kind: 'summary',
      data: summaryWith({
        distinctTools: 32,
        bySource: { mcp: 0, 'plugin-tool': 0, native: 0, skill: 0, unknown: 1586 },
        byDay: [{ day: '2026-11-10', calls: 724, success: 700, error: 5, cancelled: 0, unresolved: 0, unknown: 0 }],
        dayOffsetMinutes: 480,
      }),
    })
    expect(reply.ok).toBe(true)
    const aggregates = (reply.data as Dict).aggregates as Dict
    const bucket = (aggregates.byDay as Dict[])[0]
    // A missing counter is 0, not a reason to discard the whole overview.
    expect(bucket.running).toBe(0)
    expect(bucket.calls).toBe(724)
  })

  it('fills a missing source key instead of rejecting the overview', () => {
    const reply = callIndexReply({
      schemaVersion: 1, ok: true, kind: 'summary',
      data: summaryWith({
        distinctTools: 3,
        bySource: { mcp: 0, native: 0, skill: 0, unknown: 5 },
        dayOffsetMinutes: 480,
      }),
    })
    expect(reply.ok).toBe(true)
    const bySource = ((reply.data as Dict).aggregates as Dict).bySource as Dict
    expect(bySource['plugin-tool']).toBe(0)
    expect(bySource.unknown).toBe(5)
  })

  it('fills the unknown source key when the Host omits it entirely', () => {
    // The previous case still SENT `unknown`, so it could not catch a schema that
    // makes that key mandatory. This one omits it, which is the real regression.
    const reply = callIndexReply({
      schemaVersion: 1, ok: true, kind: 'summary',
      data: summaryWith({
        distinctTools: 3,
        bySource: { mcp: 2, native: 1 },
        dayOffsetMinutes: 480,
      }),
    })
    expect(reply.ok).toBe(true)
    const bySource = ((reply.data as Dict).aggregates as Dict).bySource as Dict
    expect(bySource.unknown).toBe(0)
    expect(bySource.mcp).toBe(2)
  })

  // D-035: the SAME whole-reply failure, third location. A `calls` page whose
  // summary omitted one counter was rejected, so 调用明细 printed 「读取失败 /
  // Host 返回了无效的响应结构」 and dropped all 710 valid rows.
  function callsWith(summary: Dict, totals?: Dict): Dict {
    return {
      corpus: 'persisted-plus-observed-live', snapshotId: 'snap-1', generation: 55,
      coverage: 'partial', totalExact: false,
      semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
      summary, total: 1, droppedItems: 0,
      items: [{ sessionId: 's1', callSeq: 1, callId: 'c1', toolName: 'bash', startedAt: 1, outcome: 'success', inherited: false, sourceKind: 'native', layer: 'unknown' }],
      ...(totals === undefined ? {} : { totals }),
    }
  }

  it('serves a calls page whose summary is missing counters', () => {
    const reply = callIndexReply({
      schemaVersion: 1, ok: true, kind: 'calls',
      data: callsWith({ total: 1, success: 1, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0 }),
    })
    expect(reply.ok).toBe(true)
    const data = reply.data as Dict
    // A missing counter is 0; the rows must survive regardless.
    expect((data.summary as Dict).inherited).toBe(0)
    expect((data.items as unknown[]).length).toBe(1)
  })

  it('serves a status reply whose totals omit a counter', () => {
    const reply = callIndexReply({
      schemaVersion: 1, ok: true, kind: 'status',
      data: {
        scope: { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 },
        generation: 1, censusGeneration: 1, phase: 'complete',
        coverage: 'partial', eventCoverage: 'partial', enumerationCoverage: 'complete',
        semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
        listedSessions: 1, visibleSessions: 1, completedSessions: 1, pendingSessions: 0, failedSessions: 0,
        pendingLive: 0, estimatedBytes: 0, reasons: [],
        totals: { calls: 5, succeeded: 5 },
      },
    })
    expect(reply.ok).toBe(true)
    expect(((reply.data as Dict).totals as Dict).failed).toBe(0)
  })

  it('strips other-profile claims from a non-ready scope', () => {
    const reply = callIndexReply({
      schemaVersion: 1,
      ok: true,
      kind: 'status',
      data: {
        scope: { status: 'disabled', mode: 'disabled', reason: 'not-enabled', includesOtherProfiles: true, epoch: 9 },
        generation: 0,
        censusGeneration: 0,
        phase: 'idle',
        coverage: 'unknown',
        eventCoverage: 'unknown',
        enumerationCoverage: 'unknown',
        semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
        listedSessions: 0,
        visibleSessions: 0,
        completedSessions: 0,
        pendingSessions: 0,
        failedSessions: 0,
        pendingLive: 0,
        estimatedBytes: 0,
        reasons: ['not-enabled'],
        totals: { calls: 0, succeeded: 0, failed: 0, unresolved: 0, unknown: 0, cancelled: 0, running: 0, inherited: 0 },
      },
    })
    expect(reply.ok).toBe(true)
    expect((reply.data as Dict).scope).toEqual({ status: 'disabled', mode: 'disabled', reason: 'not-enabled' })
  })

  it('projects task data and drops unknown fields', () => {
    const reply = callIndexReply({
      schemaVersion: 1,
      ok: true,
      kind: 'task',
      data: { taskId: 't1', mode: 'full', phase: 'running', startedAt: 100, cancelRequested: false, extra: 'x' },
    })
    expect(reply.ok).toBe(true)
    expect(reply.kind).toBe('task')
    expect((reply.data as Dict).taskId).toBe('t1')
    expect(reply.data).not.toHaveProperty('extra')
  })

  it('strips raw arguments / content from call rows', () => {
    const items = [row({ arguments: 'SECRET-ARGS', content: 'SECRET-CONTENT' })]
    const reply = callIndexReply({
      schemaVersion: 1,
      ok: true,
      kind: 'calls',
      data: {
        snapshotId: 'snap',
        generation: 1,
        coverage: 'complete',
        summary: { total: 1, success: 1, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 },
        total: 1,
        items,
      },
    })
    expect(reply.ok).toBe(true)
    const served = ((reply.data as Dict).items as Dict[])[0]!
    expect(served).not.toHaveProperty('arguments')
    expect(served).not.toHaveProperty('content')
    expect(JSON.stringify(reply)).not.toContain('SECRET')
  })

  it('normalizes unknown reasons and rejects malformed replies', () => {
    expect(callIndexError('cursor-stale')).toEqual({ schemaVersion: 1, ok: false, kind: 'error', reason: 'cursor-stale' })
    expect(callIndexError('not-a-real-reason').reason).toBe('internal-error')
    expect(callIndexReply({ schemaVersion: 2, ok: true, kind: 'status', data: {} }).reason).toBe('internal-error')
    expect(callIndexReply({ schemaVersion: 1, ok: true, kind: 'nope', data: {} }).reason).toBe('internal-error')
    expect(callIndexReply({ schemaVersion: 1, ok: true, kind: 'summary', data: { snapshotId: 'x' } }).reason).toBe('internal-error')
  })

  it('drops extra top-level envelope fields', () => {
    const reply = callIndexReply({
      schemaVersion: 1,
      ok: true,
      kind: 'summary',
      data: { snapshotId: 's', generation: 1, coverage: 'complete', summary: { total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 }, total: 0 },
      backend: 'hidden',
      token: 'secret',
    })
    expect(reply.ok).toBe(true)
    expect(reply).not.toHaveProperty('backend')
    expect(reply).not.toHaveProperty('token')
  })
})
