/**
 * Bounded Session history backfill tests.
 *
 * Every test uses a fake `sessionPersistence` service and a fake handle: no
 * filesystem, no real Session store and no Host process is involved. The fake
 * rejects out-of-bounds requests and can return a shorter contiguous prefix to
 * exercise the public read contract.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_USAGE_BACKFILL_LIMITS,
  runUsageBackfill,
  type UsageBackfillCursor,
  type UsageBackfillOptions,
} from '../src/usage/usage-backfill.ts'
import { createUsageCollectorState } from '../src/usage/usage-collector.ts'
import type { UsageSourceClassifier } from '../src/usage/usage-event-projector.ts'
import { resolveUsageProfile } from '../src/usage/usage-profile.ts'

const classify: UsageSourceClassifier = (toolName) => ({
  source: { kind: 'native' },
  capabilityId: toolName,
})

let eventTime = 1_700_000_000_000

function time(): number {
  eventTime += 1
  return eventTime
}

function toolCall(seq: number, callId: string, name = 'search'): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: time(),
    data: { callId, name },
  } as unknown as SessionEvent
}

function toolResult(seq: number, callId: string, error = false): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time: time(),
    data: { message: { toolCallId: callId, isError: error } },
  } as unknown as SessionEvent
}

function observedEvent(seq: number): SessionEvent {
  return { type: 'turn/start', seq, time: time(), data: {} } as unknown as SessionEvent
}

interface FakeSession {
  readonly revision: string
  readonly events: readonly SessionEvent[]
  /** When true, the snapshot omits `eventCount` and the Session is unverifiable. */
  readonly unknownEventCount?: boolean
  readonly inheritedEventCount?: number
}

interface ReadCall {
  readonly sessionId: string
  readonly offset: number
  readonly length: number
  readonly signal: AbortSignal | undefined
}

interface OpenCall {
  readonly sessionId: string
  readonly access: string
  readonly signal: AbortSignal | undefined
}

interface HarnessOptions {
  readonly listError?: Error
  readonly openError?: (sessionId: string) => Error | undefined
  readonly readError?: (call: ReadCall, index: number) => Error | undefined
  readonly closeError?: (sessionId: string) => Error | undefined
  readonly onRead?: (call: ReadCall, index: number) => void
  readonly shortReadLength?: number
}

function createHarness(sessions: Record<string, FakeSession>, options: HarnessOptions = {}) {
  const reads: ReadCall[] = []
  const opens: OpenCall[] = []
  const closes: string[] = []
  const listCalls: unknown[][] = []

  const snapshots = Object.entries(sessions).map(([sessionId, session]) => ({
    header: { id: sessionId, version: 1, cwd: '/tmp', isSeeded: false },
    revision: session.revision,
    ...(session.unknownEventCount === true ? {} : { eventCount: session.events.length }),
  }))

  const service = {
    async list(...args: unknown[]) {
      listCalls.push(args)
      if (options.listError !== undefined) throw options.listError
      return snapshots
    },
    async open(sessionId: string, access: string, openOptions?: { signal?: AbortSignal }) {
      opens.push({ sessionId, access, signal: openOptions?.signal })
      const error = options.openError?.(sessionId)
      if (error !== undefined) throw error
      const session = sessions[sessionId]!
      return {
        id: sessionId,
        header: { id: sessionId, version: 1, cwd: '/tmp', isSeeded: false },
        inheritedEventCount: session.inheritedEventCount ?? 0,
        access,
        async read(offset = 0, length = session.events.length, readOptions?: { signal?: AbortSignal }) {
          const call: ReadCall = {
            sessionId,
            offset,
            length,
            signal: readOptions?.signal,
          }
          const index = reads.length
          reads.push(call)
          options.onRead?.(call, index)
          const error = options.readError?.(call, index)
          if (error !== undefined) throw error
          // Reject out-of-bounds requests; an optional test limit below models
          // a legal contiguous short page.
          if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
            throw new Error(`invalid read bounds ${offset}/${length}`)
          }
          if (offset + length > session.events.length) {
            throw new Error(`read beyond log: ${offset}+${length} > ${session.events.length}`)
          }
          return {
            eventState: 'owned',
            events: session.events.slice(offset, offset + Math.min(length, options.shortReadLength ?? length)),
          }
        },
        async append() {
          throw new Error('backfill must never append')
        },
        async flush() {
          throw new Error('backfill must never flush')
        },
        async close() {
          closes.push(sessionId)
          const error = options.closeError?.(sessionId)
          if (error !== undefined) throw error
        },
      }
    },
  }

  return {
    service,
    reads,
    opens,
    closes,
    listCalls,
  }
}

function contextFor(service: unknown, profileName: string | null = 'desktop') {
  return {
    get(name: string) {
      if (name === 'profileContext') {
        return profileName === null ? undefined : { name: profileName }
      }
      if (name === 'sessionPersistence') return service
      return undefined
    },
  }
}

function profileHash(context: unknown): string {
  const profile = resolveUsageProfile(context)
  if (profile.status !== 'available') throw new Error('test profile must resolve')
  return profile.hash
}

function options(
  context: unknown,
  overrides: Partial<UsageBackfillOptions> = {},
): UsageBackfillOptions {
  return {
    context,
    classify,
    workspaces: new Map([['s1', 'ws-1']]),
    ...overrides,
  }
}

function cursorFor(context: unknown, entries: UsageBackfillCursor['entries']): UsageBackfillCursor {
  return { profileHash: profileHash(context), entries }
}

describe('runUsageBackfill', () => {
  it('reads exact contiguous pages and completes verified Sessions', async () => {
    const harness = createHarness({
      s2: {
        revision: 'r2',
        events: [toolCall(0, 'a'), toolResult(1, 'a')],
      },
      s1: {
        revision: 'r1',
        events: [toolCall(0, 'a'), toolResult(1, 'a'), toolCall(2, 'b')],
      },
    })
    const context = contextFor(harness.service)
    const classified: string[] = []
    const trackingClassifier: UsageSourceClassifier = (toolName) => {
      classified.push(toolName)
      return { source: { kind: 'native' }, capabilityId: toolName }
    }

    const result = await runUsageBackfill(options(context, {
      classify: trackingClassifier,
      limits: { pageSize: 2 },
    }))

    expect(classified).toEqual(['search', 'search', 'search'])

    expect(result.coverageStatus).toBe('complete')
    expect(result.stats.completedSessions).toBe(2)
    expect(result.stats.attemptedSessions).toBe(2)
    expect(result.stats.eventsRead).toBe(5)
    expect(result.stats.pagesRead).toBe(3)
    expect(result.stats.truncated).toBe(false)
    expect(harness.opens.map(({ sessionId, access }) => ({ sessionId, access }))).toEqual([
      { sessionId: 's1', access: 'read' },
      { sessionId: 's2', access: 'read' },
    ])
    expect(harness.reads.map(call => [call.sessionId, call.offset, call.length])).toEqual([
      ['s1', 0, 2],
      ['s1', 2, 1],
      ['s2', 0, 2],
    ])
    expect(harness.closes).toEqual(['s1', 's2'])
    expect(result.report.calls).toBe(3)
    expect(result.report.succeeded).toBe(2)
    expect(result.report.unresolved).toBe(1)
    expect(result.report.coverage.s1?.status).toBe('complete')
    expect(result.report.coverage.s2?.status).toBe('complete')
    expect(result.report.aggregates.find(row => row.sessionId === 's1')?.workspaceAttribution)
      .toBe('current-mapping')
    expect(result.report.aggregates.find(row => row.sessionId === 's2')?.workspaceAttribution)
      .toBe('unknown')
    expect(result.cursor).toEqual({
      profileHash: profileHash(context),
      entries: [
        { sessionId: 's1', nextOffset: 3, revision: 'r1' },
        { sessionId: 's2', nextOffset: 2, revision: 'r2' },
      ],
    })
    // The cursor is metadata only: no event type, payload or tool name leaks.
    const serialized = JSON.stringify(result.cursor)
    expect(serialized).not.toContain('tool/call')
    expect(serialized).not.toContain('tool/result')
    expect(serialized).not.toContain('callId')
    expect(serialized).not.toContain('search')
    expect(Object.keys(result.cursor ?? {})).toEqual(['profileHash', 'entries'])
    expect(Object.keys(result.cursor?.entries[0] ?? {})).toEqual(['sessionId', 'nextOffset', 'revision'])
  })

  it('passes the cancellation signal to the persistence open call', async () => {
    const harness = createHarness({ s1: { revision: 'r1', events: [observedEvent(0)] } })
    const context = contextFor(harness.service)
    const controller = new AbortController()

    await runUsageBackfill(options(context, { signal: controller.signal }))

    expect(harness.opens[0]?.signal).toBe(controller.signal)
  })

  it('excludes fork-inherited parent events from child-session totals and marks the prefix gap', async () => {
    const harness = createHarness({
      child: {
        revision: 'child-r1',
        events: [toolCall(0, 'parent-call'), toolResult(1, 'parent-call'), toolCall(2, 'child-call'), toolResult(3, 'child-call')],
        inheritedEventCount: 2,
      },
    })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context))

    expect(harness.reads.map(call => [call.offset, call.length])).toEqual([[2, 2]])
    expect(result.report.calls).toBe(1)
    expect(result.report.succeeded).toBe(1)
    expect(result.report.coverage.child).toMatchObject({
      status: 'partial',
      skippedSessions: 1,
      skippedEvents: 2,
      reasons: ['workspace-attribution-unknown', 'fork-inherited-prefix'],
    })
  })

  it('accepts a contiguous short page but leaves coverage partial', async () => {
    const harness = createHarness(
      { s1: { revision: 'r1', events: [toolCall(0, 'a'), toolResult(1, 'a')] } },
      { shortReadLength: 1 },
    )
    const context = contextFor(harness.service)
    const result = await runUsageBackfill(options(context, { limits: { pageSize: 2 } }))

    expect(result.coverageStatus).toBe('partial')
    expect(result.stats.eventsRead).toBe(1)
    expect(result.stats.readFailures).toBe(0)
    expect(result.stats.reasons['backfill-short-page']).toBe(1)
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 1, revision: 'r1' }])
  })

  it('does not open or read a Session whose eventCount is unknown', async () => {
    const harness = createHarness({
      s1: { revision: 'r1', events: [observedEvent(0)], unknownEventCount: true },
    })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context))

    expect(result.coverageStatus).toBe('partial')
    expect(result.stats.unverifiableSessions).toBe(1)
    expect(result.stats.attemptedSessions).toBe(0)
    expect(harness.opens).toEqual([])
    expect(harness.reads).toEqual([])
    expect(result.cursor).toEqual({ profileHash: profileHash(context), entries: [] })
  })

  it('treats an empty stored Session as complete without opening it', async () => {
    const harness = createHarness({ s1: { revision: 'r1', events: [] } })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context))

    expect(result.coverageStatus).toBe('complete')
    expect(result.stats.completedSessions).toBe(1)
    expect(harness.opens).toEqual([])
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 0, revision: 'r1' }])
  })

  it('applies maxSessions to the sorted list and reports the truncation', async () => {
    const harness = createHarness({
      's-c': { revision: 'rc', events: [observedEvent(0)] },
      's-a': { revision: 'ra', events: [observedEvent(0)] },
      's-b': { revision: 'rb', events: [observedEvent(0)] },
    })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context, { limits: { maxSessions: 2 } }))

    expect(harness.opens.map(call => call.sessionId)).toEqual(['s-a', 's-b'])
    expect(result.stats.truncated).toBe(true)
    expect(result.stats.attemptedSessions).toBe(2)
    expect(result.coverageStatus).toBe('partial')
    expect(result.report.coverage['s-c']).toMatchObject({
      status: 'partial',
      skippedSessions: 1,
      reasons: ['backfill-budget-truncated'],
    })
    expect(result.cursor?.entries.map(entry => entry.sessionId)).toEqual(['s-a', 's-b'])
  })

  it('checkpoints a per-Session budget and resumes from it', async () => {
    const harness = createHarness({
      s1: {
        revision: 'r1',
        events: [
          toolCall(0, 'a'),
          toolResult(1, 'a'),
          toolCall(2, 'b'),
          toolResult(3, 'b'),
          observedEvent(4),
        ],
      },
    })
    const context = contextFor(harness.service)
    const limits = {
      pageSize: 2,
      maxEventsPerSession: 3,
      maxTotalEvents: 10,
    }

    const first = await runUsageBackfill(options(context, { limits }))

    expect(first.coverageStatus).toBe('partial')
    expect(first.stats.truncated).toBe(true)
    expect(harness.reads.map(call => [call.offset, call.length])).toEqual([
      [0, 2],
      [2, 1],
    ])
    expect(first.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 3, revision: 'r1' }])
    expect(first.report.coverage.s1?.status).toBe('partial')

    const second = await runUsageBackfill(options(context, {
      limits,
      state: first.state,
      cursor: first.cursor,
    }))

    expect(second.coverageStatus).toBe('complete')
    expect(harness.reads.map(call => [call.offset, call.length])).toEqual([
      [0, 2],
      [2, 1],
      [3, 2],
    ])
    expect(second.stats.completedSessions).toBe(1)
    expect(second.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 5, revision: 'r1' }])
    expect(second.report.coverage.s1?.status).toBe('complete')
  })

  it('ignores a cursor whose revision no longer matches and restarts at seq 0', async () => {
    const harness = createHarness({
      s1: { revision: 'r2', events: [observedEvent(0), observedEvent(1), observedEvent(2), observedEvent(3)] },
    })
    const context = contextFor(harness.service)
    const cursor = cursorFor(context, [{ sessionId: 's1', nextOffset: 3, revision: 'old' }])

    const result = await runUsageBackfill(options(context, {
      cursor,
      limits: { pageSize: 10 },
    }))

    expect(harness.reads.map(call => [call.offset, call.length])).toEqual([[0, 4]])
    expect(result.coverageStatus).toBe('complete')
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 4, revision: 'r2' }])
  })

  it('ignores a cursor for another profile', async () => {
    const harness = createHarness({ s1: { revision: 'r1', events: [observedEvent(0), observedEvent(1)] } })
    const context = contextFor(harness.service)
    const cursor: UsageBackfillCursor = {
      profileHash: 'f'.repeat(64),
      entries: [{ sessionId: 's1', nextOffset: 2, revision: 'r1' }],
    }

    const result = await runUsageBackfill(options(context, { cursor }))

    expect(harness.opens.map(call => call.sessionId)).toEqual(['s1'])
    expect(harness.reads.map(call => [call.offset, call.length])).toEqual([[0, 2]])
    expect(result.cursor?.profileHash).toBe(profileHash(context))
  })

  it('skips a Session fully covered by a matching cursor', async () => {
    const harness = createHarness({ s1: { revision: 'r1', events: [observedEvent(0), observedEvent(1)] } })
    const context = contextFor(harness.service)
    const cursor = cursorFor(context, [{ sessionId: 's1', nextOffset: 2, revision: 'r1' }])

    const result = await runUsageBackfill(options(context, { cursor }))

    expect(harness.opens).toEqual([])
    expect(harness.reads).toEqual([])
    expect(result.coverageStatus).toBe('complete')
    expect(result.stats.alreadyCompleteSessions).toBe(1)
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 2, revision: 'r1' }])
  })

  it('stops after the page in which cancellation is observed, then closes', async () => {
    const controller = new AbortController()
    const harness = createHarness(
      { s1: { revision: 'r1', events: [observedEvent(0), observedEvent(1), observedEvent(2), observedEvent(3)] } },
      {
        onRead: (_call, index) => {
          if (index === 0) controller.abort()
        },
      },
    )
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context, {
      signal: controller.signal,
      limits: { pageSize: 2 },
    }))

    expect(harness.reads.map(call => [call.offset, call.length])).toEqual([[0, 2]])
    expect(harness.reads[0]?.signal).toBe(controller.signal)
    expect(harness.closes).toEqual(['s1'])
    expect(result.stats.cancelled).toBe(true)
    expect(result.stats.completedSessions).toBe(0)
    expect(result.stats.eventsRead).toBe(0)
    expect(result.coverageStatus).toBe('partial')
    expect(result.report.coverage.s1).toBeUndefined()
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 0, revision: 'r1' }])
  })

  it('records a failed page read, closes the handle, and keeps the verified prefix', async () => {
    const harness = createHarness(
      { s1: { revision: 'r1', events: [observedEvent(0), observedEvent(1), observedEvent(2), observedEvent(3)] } },
      {
        readError: (_call, index) => index === 1 ? new Error('disk read failed') : undefined,
      },
    )
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context, {
      limits: { pageSize: 2 },
    }))

    expect(harness.closes).toEqual(['s1'])
    expect(result.stats.readFailures).toBe(1)
    expect(result.stats.failedSessions).toBe(1)
    expect(result.stats.completedSessions).toBe(0)
    expect(result.coverageStatus).toBe('partial')
    expect(result.report.coverage.s1?.status).toBe('partial')
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 2, revision: 'r1' }])
  })

  it('continues with the next Session after an open failure', async () => {
    const harness = createHarness(
      {
        s1: { revision: 'r1', events: [observedEvent(0)] },
        s2: { revision: 'r2', events: [observedEvent(0)] },
      },
      { openError: sessionId => sessionId === 's1' ? new Error('open failed') : undefined },
    )
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context))

    expect(harness.closes).toEqual(['s2'])
    expect(result.stats.openFailures).toBe(1)
    expect(result.stats.failedSessions).toBe(1)
    expect(result.stats.completedSessions).toBe(1)
    expect(result.coverageStatus).toBe('partial')
    expect(result.cursor?.entries).toEqual([
      { sessionId: 's1', nextOffset: 0, revision: 'r1' },
      { sessionId: 's2', nextOffset: 1, revision: 'r2' },
    ])
  })

  it('does not mark complete when close fails and checkpoints before the last event', async () => {
    const harness = createHarness(
      { s1: { revision: 'r1', events: [observedEvent(0), observedEvent(1)] } },
      { closeError: () => new Error('close failed') },
    )
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context))

    expect(harness.closes).toEqual(['s1'])
    expect(result.stats.closeFailures).toBe(1)
    expect(result.stats.failedSessions).toBe(1)
    expect(result.stats.completedSessions).toBe(0)
    expect(result.coverageStatus).toBe('partial')
    expect(result.report.coverage.s1?.status).toBe('partial')
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 1, revision: 'r1' }])
  })

  it('does not claim complete when an event is rejected by the aggregator', async () => {
    const badTime = {
      type: 'tool/call',
      seq: 0,
      time: 'not-a-time',
      data: { callId: 'a', name: 'search' },
    } as unknown as SessionEvent
    const harness = createHarness({ s1: { revision: 'r1', events: [badTime] } })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context))

    expect(result.stats.rejectedEvents).toBe(1)
    expect(result.stats.failedSessions).toBe(1)
    expect(result.stats.completedSessions).toBe(0)
    expect(result.coverageStatus).toBe('partial')
    expect(result.report.coverage.s1?.status).toBe('partial')
    expect(result.cursor?.entries).toEqual([{ sessionId: 's1', nextOffset: 0, revision: 'r1' }])
  })

  it('keeps projection data-quality gaps beside a complete coverage status', async () => {
    const malformedResult = {
      type: 'tool/result',
      seq: 0,
      time: time(),
      data: { message: {} },
    } as unknown as SessionEvent
    const harness = createHarness({ s1: { revision: 'r1', events: [malformedResult] } })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context))

    expect(result.coverageStatus).toBe('complete')
    expect(result.stats.completedSessions).toBe(1)
    expect(result.report.coverage.s1?.status).toBe('complete')
    expect(result.report.coverage.s1?.reasons ?? []).toContain('malformed-tool-result')
  })

  it('enforces the total event budget across Sessions', async () => {
    const harness = createHarness({
      s1: { revision: 'r1', events: [observedEvent(0), observedEvent(1), observedEvent(2)] },
      s2: { revision: 'r2', events: [observedEvent(0), observedEvent(1), observedEvent(2)] },
    })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill(options(context, {
      limits: { pageSize: 2, maxTotalEvents: 4 },
    }))

    expect(harness.reads.map(call => [call.sessionId, call.offset, call.length])).toEqual([
      ['s1', 0, 2],
      ['s1', 2, 1],
      ['s2', 0, 1],
    ])
    expect(result.stats.eventsRead).toBe(4)
    expect(result.stats.truncated).toBe(true)
    expect(result.coverageStatus).toBe('partial')
    expect(result.cursor?.entries).toEqual([
      { sessionId: 's1', nextOffset: 3, revision: 'r1' },
      { sessionId: 's2', nextOffset: 1, revision: 'r2' },
    ])
  })

  it('stops before reading when the wall-clock budget is exhausted', async () => {
    const harness = createHarness({ s1: { revision: 'r1', events: [observedEvent(0)] } })
    const context = contextFor(harness.service)
    const times = [0, 0, 2_000]
    let index = 0

    const result = await runUsageBackfill(options(context, {
      limits: { maxRuntimeMs: 1_000 },
      now: () => times[Math.min(index++, times.length - 1)]!,
    }))

    expect(harness.reads).toEqual([])
    expect(result.stats.timedOut).toBe(true)
    expect(result.coverageStatus).toBe('partial')
    expect(result.stats.listedSessions).toBe(1)
  })

  it('records a list failure without touching collector state', async () => {
    const harness = createHarness(
      { s1: { revision: 'r1', events: [observedEvent(0)] } },
      { listError: new Error('list failed') },
    )
    const context = contextFor(harness.service)
    const state = createUsageCollectorState()

    const result = await runUsageBackfill(options(context, { state }))

    expect(harness.opens).toEqual([])
    expect(harness.listCalls).toHaveLength(1)
    expect(result.state).toBe(state)
    expect(result.stats.listFailures).toBe(1)
    expect(result.coverageStatus).toBe('unknown')
    expect(result.cursor).toBeUndefined()
  })

  it('is fully disabled without a resolvable profile and never probes persistence', async () => {
    const harness = createHarness(
      { s1: { revision: 'r1', events: [observedEvent(0)] } },
      { listError: new Error('must not be called') },
    )
    const context = contextFor(harness.service, null)

    const result = await runUsageBackfill(options(context))

    expect(harness.listCalls).toEqual([])
    expect(harness.opens).toEqual([])
    expect(result.stats.disabled).toBe('profile-unknown')
    expect(result.coverageStatus).toBe('unknown')
    expect(result.cursor).toBeUndefined()
    expect(result.stats.listedSessions).toBe(0)
  })

  it('is fully disabled when the optional persistence service is absent', async () => {
    const context = contextFor(undefined)

    const result = await runUsageBackfill({
      context,
      classify,
    })

    expect(result.stats.disabled).toBe('session-persistence-unavailable')
    expect(result.coverageStatus).toBe('unknown')
    expect(result.cursor).toBeUndefined()
    expect(result.report.calls).toBe(0)
  })

  it('is disabled without a caller-supplied classifier', async () => {
    const harness = createHarness({ s1: { revision: 'r1', events: [observedEvent(0)] } })
    const context = contextFor(harness.service)

    const result = await runUsageBackfill({
      context,
      classify: undefined as unknown as UsageSourceClassifier,
    })

    expect(harness.listCalls).toEqual([])
    expect(result.stats.disabled).toBe('classifier-unavailable')
    expect(result.coverageStatus).toBe('unknown')
  })

  it('keeps an existing collector state on disabled runs', async () => {
    const state = createUsageCollectorState()
    const result = await runUsageBackfill({ context: contextFor(undefined), classify, state })
    expect(result.state).toBe(state)
  })
})

describe('usage backfill · default budget', () => {
  // The page can only reach `complete` once every pending Session fits in one
  // window. The shipped defaults used to be 64 sessions, which truncated this
  // machine's 84 sessions on every run and pinned the page at `partial`.
  const SESSIONS_ON_THIS_MACHINE = 84

  it('covers a real profile without truncating', () => {
    expect(DEFAULT_USAGE_BACKFILL_LIMITS.maxSessions).toBeGreaterThan(SESSIONS_ON_THIS_MACHINE)
  })

  it('stays bounded rather than unbounded', () => {
    // Raising the ceiling must never mean removing it.
    for (const value of [
      DEFAULT_USAGE_BACKFILL_LIMITS.maxSessions,
      DEFAULT_USAGE_BACKFILL_LIMITS.maxEventsPerSession,
      DEFAULT_USAGE_BACKFILL_LIMITS.maxTotalEvents,
      DEFAULT_USAGE_BACKFILL_LIMITS.pageSize,
      DEFAULT_USAGE_BACKFILL_LIMITS.maxRuntimeMs,
    ]) {
      expect(Number.isSafeInteger(value)).toBe(true)
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('does not let the total event budget undercut the Session window', () => {
    // `maxTotalEvents` must not become the next bottleneck: a window that can
    // hold `maxSessions` Sessions is useless if the event cap stops it first.
    expect(DEFAULT_USAGE_BACKFILL_LIMITS.maxTotalEvents)
      .toBeGreaterThanOrEqual(DEFAULT_USAGE_BACKFILL_LIMITS.maxSessions * 1_000)
  })
})
