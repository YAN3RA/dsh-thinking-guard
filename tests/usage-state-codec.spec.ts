import { describe, expect, it } from 'vitest'
import {
  DEFAULT_USAGE_STATE_CODEC_LIMITS,
  UsageStateCodecError,
  decodeUsageState,
  decodeUsageStateJson,
  encodeUsageState,
  encodeUsageStateJson,
  type UsageStateCodecErrorCode,
} from '../src/usage/usage-state-codec.ts'
import {
  applyUsageEvent,
  buildUsageReport,
  createUsageState,
  markUsageSessionSkipped,
  recordUsageCoverage,
  type UsageEvent,
  type UsageState,
  type UsageToolCallEvent,
  type UsageToolResultEvent,
} from '../src/usage/usage-core.ts'

const TIME = Date.UTC(2026, 10, 4, 10, 0, 0)
const eventTimeWorkspace = { workspaceId: 'ws-a', attribution: 'event-time' as const }
const unknownWorkspace = { attribution: 'unknown' as const }

type MutableRecord = Record<string, unknown>

/**
 * A coverage row: the tests mutate `reasons` in place to probe the decoder.
 *
 * `unknown[]` on purpose — one case injects a non-string reason to prove the
 * decoder rejects it, so the element type must not be narrowed here.
 */
interface MutableCoverage {
  reasons: unknown[]
  [key: string]: unknown
}

/** An aggregate row: the tests mutate the nested error `code`. */
interface MutableAggregate {
  errors: Array<{ code: string; [key: string]: unknown }>
  [key: string]: unknown
}

interface MutableDocument {
  schema: unknown
  version: unknown
  limits: Record<string, unknown>
  seenEvents: MutableRecord[]
  calls: MutableRecord[]
  aggregates: MutableAggregate[]
  coverage: MutableCoverage[]
  totals: Record<string, unknown>
  [key: string]: unknown
}

function toolCall(overrides: Partial<UsageToolCallEvent> = {}): UsageToolCallEvent {
  return {
    type: 'tool-call',
    sessionId: 'session-a',
    seq: 1,
    time: TIME,
    callId: 'call-1',
    capabilityId: 'mcp__files__read',
    source: { kind: 'mcp', providerId: 'files' },
    workspace: eventTimeWorkspace,
    ...overrides,
  }
}

function toolResult(overrides: Partial<UsageToolResultEvent> = {}): UsageToolResultEvent {
  return {
    type: 'tool-result',
    sessionId: 'session-a',
    seq: 2,
    time: TIME + 1_000,
    callId: 'call-1',
    outcome: 'success',
    workspace: eventTimeWorkspace,
    ...overrides,
  }
}

function apply(state: UsageState, event: UsageEvent): UsageState {
  const result = applyUsageEvent(state, event)
  expect(result.accepted).toBe(true)
  return result.state
}

function richState(): UsageState {
  let state = createUsageState({
    maxEvents: 64,
    maxCalls: 32,
    maxCoverageReasons: 4,
    maxErrorCodeLength: 16,
  })
  state = apply(state, toolCall())
  state = apply(state, toolResult({ outcome: 'error', errorCode: 'E_TIMEOUT' }))
  state = apply(state, toolCall({
    seq: 3,
    callId: 'call-2',
    capabilityId: 'unknown-tool',
    source: { kind: 'unknown', reason: 'owner-not-exposed' },
    workspace: unknownWorkspace,
  }))
  state = apply(state, toolResult({
    seq: 4,
    callId: 'call-2',
    outcome: 'denied',
    workspace: unknownWorkspace,
  }))
  state = apply(state, toolCall({
    sessionId: 'session-b',
    seq: 5,
    time: TIME + 4_000,
    callId: 'call-3',
    capabilityId: 'native-tool',
    source: { kind: 'native' },
    workspace: { workspaceId: 'ws-b', attribution: 'current-mapping' },
  }))
  state = apply(state, {
    type: 'skill-load',
    sessionId: 'session-b',
    seq: 6,
    time: TIME + 5_000,
    skillId: 'skill-a',
    providerId: 'bundle-a',
    entry: 'meta-invoke',
    outcome: 'success',
    workspace: { workspaceId: 'ws-b', attribution: 'current-mapping' },
  })
  state = markUsageSessionSkipped(state, 'session-c', 'oversize-session', 3)
  state = recordUsageCoverage(state, 'session-d', { status: 'unknown', skippedSessions: 1 })
  return state
}

function rawDocument(state: UsageState): MutableDocument {
  return JSON.parse(encodeUsageStateJson(state)) as MutableDocument
}

function codecError(run: () => unknown): UsageStateCodecError {
  try {
    run()
  } catch (error) {
    if (error instanceof UsageStateCodecError) return error
    throw error
  }
  throw new Error('expected UsageStateCodecError')
}

function expectCode(run: () => unknown, code: UsageStateCodecErrorCode): void {
  expect(codecError(run).code).toBe(code)
}

describe('usage state codec', () => {
  it('round-trips the full usage state without losing metadata', () => {
    const state = richState()
    const document = encodeUsageState(state)
    expect(document.schema).toBe('dsh-thinking-guard/usage-state')
    expect(document.version).toBe(1)
    expect(() => JSON.stringify(document)).not.toThrow()

    const decoded = decodeUsageStateJson(encodeUsageStateJson(state))
    expect(decoded.limits).toEqual(state.limits)
    expect([...decoded.seenEvents]).toEqual([...state.seenEvents])
    expect([...decoded.calls.entries()]).toEqual([...state.calls.entries()])
    expect([...decoded.aggregates.entries()]).toEqual([...state.aggregates.entries()])
    expect([...decoded.coverage.entries()]).toEqual([...state.coverage.entries()])
    expect(buildUsageReport(decoded)).toEqual(buildUsageReport(state))
    expect(decoded).toMatchObject({
      totalEvents: state.totalEvents,
      totalCalls: state.totalCalls,
      stoppedByLimit: state.stoppedByLimit,
      orphanResults: state.orphanResults,
      duplicateResults: state.duplicateResults,
    })
  })

  it('round-trips an empty state', () => {
    const state = createUsageState()
    const document = encodeUsageState(state)
    expect(document.seenEvents).toEqual([])
    expect(document.calls).toEqual([])
    expect(document.aggregates).toEqual([])
    expect(document.coverage).toEqual([])

    const decoded = decodeUsageState(document)
    expect(decoded.totalEvents).toBe(0)
    expect(decoded.totalCalls).toBe(0)
    expect(decoded.seenEvents.size).toBe(0)
    expect(decoded.calls.size).toBe(0)
    expect(decoded.aggregates.size).toBe(0)
    expect(decoded.coverage.size).toBe(0)
  })

  it('constructs independent maps and sets on import', () => {
    const state = richState()
    const decoded = decodeUsageStateJson(encodeUsageStateJson(state))

    decoded.seenEvents.add('injected')
    expect(state.seenEvents.has('injected')).toBe(false)

    const decodedAggregate = [...decoded.aggregates.values()][0]
    decodedAggregate.errors.set('INJECTED', 1)
    expect([...state.aggregates.values()].some(row => row.errors.has('INJECTED'))).toBe(false)

    decoded.coverage.get('session-a')!.reasons.push('injected')
    expect(state.coverage.get('session-a')!.reasons).not.toContain('injected')
  })

  it('does not mutate the document it decodes', () => {
    const document = rawDocument(richState())
    const snapshot = JSON.parse(JSON.stringify(document)) as MutableDocument
    decodeUsageState(document)
    expect(document).toEqual(snapshot)
  })

  it('encodes only allow-listed metadata, never raw event payloads', () => {
    const event = {
      ...toolCall({ sessionId: 'session-private' }),
      arguments: 'PRIVATE_ARGUMENT',
      messages: [{ content: 'PRIVATE_MESSAGE' }],
      credentials: { token: 'PRIVATE_TOKEN' },
    } as unknown as UsageToolCallEvent
    const state = applyUsageEvent(createUsageState(), event).state

    const document = encodeUsageState(state)
    const json = JSON.stringify(document)
    expect(json).not.toContain('PRIVATE')
    expect(Object.keys(document).sort()).toEqual([
      'aggregates',
      'calls',
      'coverage',
      'limits',
      'schema',
      'seenEvents',
      'totals',
      'version',
    ])
  })

  it('rejects unsupported or missing versions without inventing a migration', () => {
    const document = rawDocument(richState())
    expectCode(() => decodeUsageState({ ...document, version: 2 }), 'unsupported-version')
    expectCode(() => decodeUsageState({ ...document, version: '1' }), 'invalid-document')
    expectCode(() => decodeUsageState({ ...document, version: 0 }), 'invalid-document')

    const missing = rawDocument(richState())
    delete (missing as Record<string, unknown>).version
    expectCode(() => decodeUsageState(missing), 'invalid-document')
  })

  it('rejects unknown or missing fields instead of ignoring them', () => {
    expectCode(() => decodeUsageState(null), 'invalid-document')
    expectCode(() => decodeUsageState([]), 'invalid-document')

    const extraTopLevel = { ...rawDocument(richState()), events: [] }
    expectCode(() => decodeUsageState(extraTopLevel), 'invalid-document')

    const missingTotals = rawDocument(richState())
    delete (missingTotals as Record<string, unknown>).totals
    expectCode(() => decodeUsageState(missingTotals), 'invalid-document')

    const extraAggregate = rawDocument(richState())
    extraAggregate.aggregates[0].arguments = 'PRIVATE_ARGUMENT'
    expectCode(() => decodeUsageState(extraAggregate), 'invalid-document')

    const extraCoverage = rawDocument(richState())
    extraCoverage.coverage[0].messages = []
    expectCode(() => decodeUsageState(extraCoverage), 'invalid-document')

    const extraLimit = rawDocument(richState())
    extraLimit.limits.maxEventsExtra = 1
    expectCode(() => decodeUsageState(extraLimit), 'invalid-document')

    const extraTotals = rawDocument(richState())
    extraTotals.totals.skipped = 1
    expectCode(() => decodeUsageState(extraTotals), 'invalid-document')
  })

  it('rejects malformed scalar values and enums', () => {
    const cases: Array<[string, (document: MutableDocument) => void]> = [
      ['sessionId type', document => { document.seenEvents[0].sessionId = 42 }],
      ['seq negative', document => { document.seenEvents[0].seq = -1 }],
      ['seq fractional', document => { document.seenEvents[0].seq = 1.5 }],
      ['status enum', document => { document.coverage[0].status = 'maybe' }],
      ['capability kind enum', document => { document.aggregates[0].capabilityKind = 'tool' }],
      ['result enum', document => { document.calls[0].result = 'ok' }],
      ['boolean type', document => { document.totals.stoppedByLimit = 1 }],
      ['reason type', document => { document.coverage[0].reasons = [42] }],
      ['date format', document => { document.aggregates[0].date = '2026/11/04' }],
      ['timestamp type', document => { document.aggregates[0].firstObservedAt = 'yesterday' }],
    ]

    for (const [label, mutate] of cases) {
      const document = rawDocument(richState())
      mutate(document)
      expect(codecError(() => decodeUsageState(document)).code, label).toBe('invalid-document')
    }
  })

  it('rejects inconsistent counters, duplicate rows, and dangling references', () => {
    const cases: Array<[string, (document: MutableDocument) => void]> = [
      ['totalEvents mismatch', document => {
        document.totals.totalEvents = Number(document.totals.totalEvents) + 1
      }],
      ['totalCalls mismatch', document => {
        document.totals.totalCalls = Number(document.totals.totalCalls) + 1
      }],
      ['aggregate counter sum', document => {
        document.aggregates[0].succeeded = Number(document.aggregates[0].succeeded) + 1
      }],
      ['dangling aggregate index', document => {
        document.calls[0].aggregateIndex = 99
      }],
      ['cross-session aggregate reference', document => {
        document.calls[0].aggregateIndex = 3
      }],
      ['duplicate seen event', document => {
        document.seenEvents.push({ ...document.seenEvents[0] })
      }],
      ['duplicate call', document => {
        document.calls.push({ ...document.calls[0] })
      }],
      ['duplicate coverage', document => {
        document.coverage.push({ ...document.coverage[0] })
      }],
      ['error count over failed', document => {
        document.aggregates[0].errors = [{ code: 'E_TIMEOUT', count: 2 }]
      }],
      ['event-time without workspace', document => {
        delete document.aggregates[0].workspaceId
      }],
      ['mcp without provider', document => {
        delete document.aggregates[0].providerId
      }],
      ['truncated flag mismatch', document => {
        document.coverage[0].reasonsTruncated = true
      }],
      ['orphan result over events', document => {
        document.totals.orphanResults = Number(document.totals.totalEvents) + 1
      }],
    ]

    for (const [label, mutate] of cases) {
      const document = rawDocument(richState())
      mutate(document)
      expect(codecError(() => decodeUsageState(document)).code, label).toBe('inconsistent-state')
    }
  })

  it('enforces UsageLimits row budgets at the exact boundary', () => {
    let eventState = createUsageState({
      maxEvents: 2,
      maxCalls: 2,
      maxCoverageReasons: 2,
      maxErrorCodeLength: 8,
    })
    eventState = apply(eventState, toolCall())
    eventState = apply(eventState, toolResult())
    const eventDocument = rawDocument(eventState)
    expect(() => decodeUsageState(eventDocument)).not.toThrow()
    eventDocument.seenEvents.push({ sessionId: 'session-over', seq: 3 })
    eventDocument.totals.totalEvents = 3
    expectCode(() => decodeUsageState(eventDocument), 'limit-exceeded')

    let callState = createUsageState({
      maxEvents: 8,
      maxCalls: 2,
      maxCoverageReasons: 2,
      maxErrorCodeLength: 8,
    })
    callState = apply(callState, toolCall({ seq: 1, callId: 'call-1' }))
    callState = apply(callState, toolCall({ seq: 2, callId: 'call-2' }))
    const callDocument = rawDocument(callState)
    expect(() => decodeUsageState(callDocument)).not.toThrow()
    callDocument.limits.maxCalls = 1
    expectCode(() => decodeUsageState(callDocument), 'limit-exceeded')

    let reasonState = createUsageState({
      maxEvents: 8,
      maxCalls: 2,
      maxCoverageReasons: 2,
      maxErrorCodeLength: 8,
    })
    reasonState = recordUsageCoverage(reasonState, 'session-r', { status: 'partial', reason: 'one' })
    reasonState = recordUsageCoverage(reasonState, 'session-r', { status: 'partial', reason: 'two' })
    const reasonDocument = rawDocument(reasonState)
    expect(() => decodeUsageState(reasonDocument)).not.toThrow()
    reasonDocument.coverage[0].reasons.push('three')
    expectCode(() => decodeUsageState(reasonDocument), 'limit-exceeded')
  })

  it('rejects over-long identifiers, reasons, and error codes instead of truncating', () => {
    const maxSessionId = 's'.repeat(DEFAULT_USAGE_STATE_CODEC_LIMITS.maxSessionIdLength)
    let maxIdState = createUsageState()
    maxIdState = apply(maxIdState, toolCall({ sessionId: maxSessionId }))
    expect(() => encodeUsageState(maxIdState)).not.toThrow()

    let longIdState = createUsageState()
    longIdState = apply(longIdState, toolCall({ sessionId: `${maxSessionId}s` }))
    expectCode(() => encodeUsageState(longIdState), 'limit-exceeded')

    let reasonState = createUsageState()
    reasonState = recordUsageCoverage(reasonState, 'session-r', {
      status: 'partial',
      reason: 'r'.repeat(257),
    })
    const reasonDocument = rawDocument(reasonState)
    expect(reasonDocument.coverage[0].reasons[0]).toHaveLength(256)
    reasonDocument.coverage[0].reasons[0] = 'r'.repeat(257)
    expectCode(() => decodeUsageState(reasonDocument), 'limit-exceeded')

    let errorState = createUsageState({
      maxEvents: 8,
      maxCalls: 4,
      maxCoverageReasons: 2,
      maxErrorCodeLength: 8,
    })
    errorState = apply(errorState, toolCall())
    errorState = apply(errorState, toolResult({ outcome: 'error', errorCode: 'E1234567' }))
    expect(() => encodeUsageState(errorState)).not.toThrow()
    const errorDocument = rawDocument(errorState)
    errorDocument.aggregates[0].errors[0].code = 'E12345678'
    expectCode(() => decodeUsageState(errorDocument), 'limit-exceeded')
  })

  it('enforces the coverage-session budget option', () => {
    let state = createUsageState()
    state = recordUsageCoverage(state, 'session-1', { status: 'unknown' })
    state = recordUsageCoverage(state, 'session-2', { status: 'unknown' })
    state = recordUsageCoverage(state, 'session-3', { status: 'unknown' })

    expect(() => encodeUsageState(state, { maxCoverageSessions: 3 })).not.toThrow()
    expectCode(() => encodeUsageState(state, { maxCoverageSessions: 2 }), 'limit-exceeded')

    const document = rawDocument(state)
    expectCode(() => decodeUsageState(document, { maxCoverageSessions: 2 }), 'limit-exceeded')
  })

  it('enforces the serialized byte budget at the exact boundary', () => {
    const state = richState()
    const document = encodeUsageState(state)
    const bytes = new TextEncoder().encode(JSON.stringify(document)).byteLength
    expect(bytes).toBeGreaterThan(0)

    expect(() => encodeUsageState(state, { maxDocumentBytes: bytes })).not.toThrow()
    expectCode(() => encodeUsageState(state, { maxDocumentBytes: bytes - 1 }), 'limit-exceeded')
    expect(() => decodeUsageState(document, { maxDocumentBytes: bytes })).not.toThrow()

    const json = encodeUsageStateJson(state)
    expectCode(() => decodeUsageStateJson(json, { maxDocumentBytes: bytes - 1 }), 'limit-exceeded')
  })

  it('preserves coverage truncation markers', () => {
    let state = createUsageState({
      maxEvents: 8,
      maxCalls: 4,
      maxCoverageReasons: 1,
      maxErrorCodeLength: 8,
    })
    state = recordUsageCoverage(state, 'session-r', { status: 'partial', reason: 'one' })
    state = recordUsageCoverage(state, 'session-r', { status: 'partial', reason: 'two' })

    const decoded = decodeUsageStateJson(encodeUsageStateJson(state))
    expect(decoded.coverage.get('session-r')).toMatchObject({
      reasons: ['one'],
      reasonsTruncated: true,
    })
  })

  it('rejects invalid or oversized JSON text', () => {
    expectCode(() => decodeUsageStateJson('{'), 'invalid-json')
    expectCode(
      () => decodeUsageStateJson('x'.repeat(256), { maxDocumentBytes: 128 }),
      'limit-exceeded',
    )
  })

  it('refuses to encode a corrupted in-memory state', () => {
    const state = richState()
    const [key, aggregate] = [...state.aggregates.entries()][0]
    state.aggregates.delete(key)
    state.aggregates.set('corrupt-aggregate-key', aggregate)
    expectCode(() => encodeUsageState(state), 'inconsistent-state')
  })
})
