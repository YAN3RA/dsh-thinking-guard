import { describe, expect, it } from 'vitest'
import {
  CallIndexQueries,
  type CallIndexQuerySnapshot,
  type CallIndexQuerySource,
} from '../src/usage/call-index-query.ts'
import { callIndexReply } from '../src/usage/call-index-wire.ts'

type Dict = Record<string, unknown>

function callRow(init: Dict = {}): Dict {
  return {
    sessionId: 's1',
    callSeq: 1,
    callId: 'c1',
    toolName: 'echo',
    turn: 1,
    step: 0,
    startedAt: 1000,
    outcome: 'success',
    inherited: false,
    sourceKind: 'unknown',
    layer: 'unknown',
    ...init,
  }
}

function sessionRow(init: Dict = {}): Dict {
  return { sessionId: 's1', revision: 'r1', cut: 10, coverage: 'complete', stale: false, reasons: [], ...init }
}

function distinctSessions(rows: readonly Dict[]): Dict[] {
  return [...new Set(rows.map(row => String(row.sessionId)))].map(id => sessionRow({ sessionId: id }))
}

interface SnapshotOptions {
  generation?: number
  asOf?: number
  coverage?: 'complete' | 'partial' | 'unknown'
  scopeStatus?: 'ready' | 'disabled' | 'unavailable'
  rows?: Dict[]
  sessions?: Dict[]
}

function snapshot(options: SnapshotOptions = {}): CallIndexQuerySnapshot {
  const rows = options.rows ?? []
  const sessions = options.sessions ?? distinctSessions(rows)
  const scope = options.scopeStatus === undefined || options.scopeStatus === 'ready'
    ? { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 }
    : options.scopeStatus === 'disabled'
      ? { status: 'disabled', mode: 'disabled', reason: 'not-enabled' }
      : { status: 'unavailable', mode: 'host-visible', reason: 'persistence-unavailable' }
  return {
    scope,
    generation: options.generation ?? 1,
    censusGeneration: 1,
    asOf: options.asOf,
    phase: 'idle',
    coverage: options.coverage ?? 'complete',
    eventCoverage: options.coverage ?? 'complete',
    enumerationCoverage: 'complete',
    semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
    listedSessions: sessions.length,
    visibleSessions: sessions.length,
    completedSessions: sessions.length,
    pendingSessions: 0,
    failedSessions: 0,
    pendingLive: 0,
    estimatedBytes: 0,
    reasons: [],
    sessions,
    rows,
    totals: { calls: rows.length, succeeded: 0, failed: 0, unresolved: 0, unknown: 0, cancelled: 0, running: 0, inherited: 0 },
  } as unknown as CallIndexQuerySnapshot
}

function readGeneration(value: CallIndexQuerySnapshot): number {
  return (value as unknown as { generation: number }).generation
}

interface SourceHandle {
  source: CallIndexQuerySource
  setSnapshot: (value: CallIndexQuerySnapshot) => void
  setStamp: (value: string) => void
  setGeneration: (value: number) => void
  setOnVisible: (hook: (() => Promise<void>) | undefined) => void
  visible: Set<string>
  snapshotCalls: () => number
}

function makeSource(initial: CallIndexQuerySnapshot, options: { stamp?: string; withGeneration?: boolean } = {}): SourceHandle {
  let current = initial
  let stamp = options.stamp ?? 'stamp-1'
  let generation = options.withGeneration ? readGeneration(initial) : undefined
  let onVisible: (() => Promise<void>) | undefined
  let snapshotCalls = 0
  const visible = new Set<string>()
  const source: CallIndexQuerySource = {
    snapshot: () => {
      snapshotCalls += 1
      return current
    },
    stamp: () => stamp,
    isSessionVisible: async (id: string) => {
      if (onVisible !== undefined) await onVisible()
      return visible.has(id)
    },
    ...(options.withGeneration ? { generation: () => generation as number } : {}),
  }
  return {
    source,
    setSnapshot: (value) => {
      current = value
      if (options.withGeneration) generation = readGeneration(value)
    },
    setStamp: (value) => { stamp = value },
    setGeneration: (value) => { generation = value },
    setOnVisible: (hook) => { onVisible = hook },
    visible,
    snapshotCalls: () => snapshotCalls,
  }
}

function bytesOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

describe('callIndex query views', () => {
  it('shares one generation between summary and calls, and reports full totals not page totals', () => {
    const rows = Array.from({ length: 5 }, (_, i) => callRow({ callSeq: i + 1, startedAt: 5000 - i * 100 }))
    const { source } = makeSource(snapshot({ rows }))
    const queries = new CallIndexQueries(source)

    const summary = queries.getSummary({})
    expect(summary.ok).toBe(true)
    expect(summary.kind).toBe('summary')
    const summaryData = summary.data as Dict
    expect(summaryData.total).toBe(5)
    expect((summaryData.summary as Dict).total).toBe(5)

    const snapshotId = summaryData.snapshotId as string
    const page = queries.listCalls({ snapshotId, limit: 2 })
    expect(page.kind).toBe('calls')
    const pageData = page.data as Dict
    expect(pageData.snapshotId).toBe(snapshotId)
    expect(pageData.generation).toBe(summaryData.generation)
    expect(pageData.total).toBe(5)
    expect((pageData.summary as Dict).total).toBe(5)
    expect((pageData.items as Dict[]).length).toBe(2)

    // Query output must be schema-compatible with the wire projector.
    const projected = callIndexReply(page)
    expect(projected.ok).toBe(true)
    expect(projected.kind).toBe('calls')
    expect(((projected.data as Dict).items as Dict[]).length).toBe(2)
  })

  it('captures the snapshot once and repeats the same cursor page without re-capturing', () => {
    const rows = Array.from({ length: 5 }, (_, i) => callRow({ callSeq: i + 1, startedAt: 5000 - i * 100 }))
    const handle = makeSource(snapshot({ rows }))
    const queries = new CallIndexQueries(handle.source)

    const first = queries.listCalls({ limit: 2 })
    expect(handle.snapshotCalls()).toBe(1)
    const snapshotId = (first.data as Dict).snapshotId as string
    const cursor = (first.data as Dict).nextCursor as string
    expect(typeof cursor).toBe('string')

    const a = queries.listCalls({ snapshotId, cursor, limit: 2 })
    const b = queries.listCalls({ snapshotId, cursor, limit: 2 })
    expect(handle.snapshotCalls()).toBe(1)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect((a.data as Dict).items).toEqual((b.data as Dict).items)
    expect(((a.data as Dict).items as Dict[]).map(row => row.callSeq)).toEqual([3, 4])
  })

  it('keeps a frozen view on live additions and flags hasUpdates without re-reading the snapshot', () => {
    const handle = makeSource(
      snapshot({ generation: 1, rows: [callRow({ callSeq: 1, startedAt: 2000 }), callRow({ callSeq: 2, startedAt: 1000 })] }),
      { withGeneration: true },
    )
    const queries = new CallIndexQueries(handle.source)
    const first = queries.listCalls({ limit: 1 })
    const snapshotId = (first.data as Dict).snapshotId as string
    expect((first.data as Dict).hasUpdates).toBe(false)

    handle.setGeneration(2) // live addition: generation moves, stamp does not
    const next = queries.listCalls({ snapshotId, limit: 1 })
    expect(next.data!.generation).toBe(1) // still the frozen generation
    expect(next.data!.snapshotId).toBe(snapshotId)
    expect(next.data!.hasUpdates).toBe(true)
    expect(handle.snapshotCalls()).toBe(1)
  })

  it('marks cursors stale after an explicit rescan (stamp change)', () => {
    const handle = makeSource(snapshot({ rows: [callRow({})] }))
    const queries = new CallIndexQueries(handle.source)
    const first = queries.listCalls({})
    const snapshotId = (first.data as Dict).snapshotId as string
    handle.setStamp('stamp-2')
    const stale = queries.listCalls({ snapshotId })
    expect(stale.ok).toBe(false)
    expect(stale.reason).toBe('cursor-stale')
  })

  it('expires views after the injected TTL', () => {
    let clock = 1000
    const handle = makeSource(snapshot({ rows: [callRow({ callSeq: 1 }), callRow({ callSeq: 2 })] }))
    const queries = new CallIndexQueries(handle.source, { now: () => clock, ttlMs: 100 })
    const first = queries.listCalls({ limit: 1 })
    const cursor = (first.data as Dict).nextCursor as string
    clock += 101
    const expired = queries.listCalls({ cursor })
    expect(expired.reason).toBe('cursor-stale')
  })

  it('rejects a calls cursor in sessions and a filter that conflicts with the cursor', () => {
    const rows = Array.from({ length: 4 }, (_, i) => callRow({ callSeq: i + 1, startedAt: 4000 - i }))
    const handle = makeSource(snapshot({ rows }))
    const queries = new CallIndexQueries(handle.source)

    const first = queries.listCalls({ limit: 1 })
    const cursor = (first.data as Dict).nextCursor as string
    expect(queries.listSessions({ cursor }).reason).toBe('cursor-stale')

    const filtered = queries.listCalls({ query: { outcome: 'success' }, limit: 1 })
    const filteredCursor = (filtered.data as Dict).nextCursor as string
    const conflict = queries.listCalls({ cursor: filteredCursor, query: { outcome: 'error' } })
    expect(conflict.reason).toBe('invalid-request')
  })

  it('shrinks a page to the byte budget without dropping rows or lying about total', () => {
    const rows = Array.from({ length: 10 }, (_, i) => callRow({ callSeq: i + 1, startedAt: 10000 - i, toolName: `t${'x'.repeat(300)}` }))
    const handle = makeSource(snapshot({ rows }))
    const queries = new CallIndexQueries(handle.source, { maxReplyBytes: 2000 })

    const seen: number[] = []
    let cursor: string | undefined
    let snapshotId: string | undefined
    let guard = 0
    do {
      const page = cursor === undefined ? queries.listCalls({ limit: 50 }) : queries.listCalls({ cursor, limit: 50 })
      expect(page.ok).toBe(true)
      const data = page.data as Dict
      if (snapshotId === undefined) snapshotId = data.snapshotId as string
      expect(data.snapshotId).toBe(snapshotId)
      expect(data.total).toBe(10)
      expect(bytesOf(page)).toBeLessThanOrEqual(2000)
      const items = data.items as Dict[]
      expect(items.length).toBeGreaterThan(0)
      seen.push(...items.map(row => row.callSeq as number))
      cursor = data.nextCursor as string | undefined
      guard += 1
    } while (cursor !== undefined && guard < 50)

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(new Set(seen).size).toBe(10)
  })

  it('evicts the oldest view once maxViews is exceeded', () => {
    const handle = makeSource(snapshot({ rows: [callRow({})] }))
    const queries = new CallIndexQueries(handle.source, { maxViews: 2 })
    const first = queries.getSummary({ query: { outcome: 'success' } })
    const firstSnapshot = (first.data as Dict).snapshotId as string
    queries.getSummary({ query: { outcome: 'error' } })
    queries.getSummary({ query: { outcome: 'cancelled' } })

    const stale = queries.getSummary({ snapshotId: firstSnapshot })
    expect(stale.reason).toBe('cursor-stale')
    expect(handle.snapshotCalls()).toBe(3)
  })

  it('refuses to hold a view larger than maxBytes', () => {
    const rows = Array.from({ length: 20 }, (_, i) => callRow({ callSeq: i + 1, startedAt: 1000 - i, toolName: 'z'.repeat(500) }))
    const handle = makeSource(snapshot({ rows }))
    const queries = new CallIndexQueries(handle.source, { maxBytes: 1000 })
    const result = queries.getSummary({})
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('query-capacity')
  })

  it('never reads tool arguments or result content (hostile getters stay untouched)', () => {
    const base = callRow({ callSeq: 1 })
    const canary = { ...base }
    Object.defineProperty(canary, 'arguments', { get() { throw new Error('args-canary') } })
    Object.defineProperty(canary, 'content', { get() { throw new Error('content-canary') } })
    Object.defineProperty(canary, 'rawError', { get() { throw new Error('error-canary') } })

    const handle = makeSource(snapshot({ rows: [canary], sessions: [sessionRow({ sessionId: 's1' })] }))
    const queries = new CallIndexQueries(handle.source)
    let result: ReturnType<CallIndexQueries['listCalls']> | undefined
    expect(() => { result = queries.listCalls({}) }).not.toThrow()
    expect(result!.ok).toBe(true)
    const text = JSON.stringify(result)
    expect(text).not.toContain('canary')
    const item = (result!.data as Dict).items as Dict[]
    expect(item[0]).not.toHaveProperty('arguments')
    expect(item[0]).not.toHaveProperty('content')
  })
})

describe('callIndex scope and request validation', () => {
  it('reports a disabled scope instead of an empty complete result', () => {
    const handle = makeSource(snapshot({ scopeStatus: 'disabled', rows: [callRow({})] }))
    const queries = new CallIndexQueries(handle.source)
    expect(queries.getSummary({}).reason).toBe('scope-disabled')
    expect(handle.snapshotCalls()).toBe(1)
  })

  it('reports persistence-unavailable for an unavailable host', () => {
    const handle = makeSource(snapshot({ scopeStatus: 'unavailable', rows: [callRow({})] }))
    const queries = new CallIndexQueries(handle.source)
    expect(queries.listCalls({}).reason).toBe('persistence-unavailable')
  })

  it('rejects malformed or unknown request fields', () => {
    const handle = makeSource(snapshot({ rows: [callRow({})] }))
    const queries = new CallIndexQueries(handle.source)
    expect(queries.listCalls({ limit: 0 }).reason).toBe('invalid-request')
    expect(queries.listCalls({ limit: -1 }).reason).toBe('invalid-request')
    expect(queries.listCalls({ limit: 201 }).reason).toBe('invalid-request')
    expect(queries.listCalls({ limit: '10' }).reason).toBe('invalid-request')
    expect(queries.listCalls({ bogus: true }).reason).toBe('invalid-request')
    expect(queries.getSummary({ query: { fromMs: Number.NaN } }).reason).toBe('invalid-request')
    expect(queries.getSummary({ query: { outcome: 'nope' } }).reason).toBe('invalid-request')
  })

  it('validates getCallDetail requests strictly and asynchronously rejects unknown ids', () => {
    return (async () => {
      const handle = makeSource(snapshot({ rows: [callRow({ callSeq: 5 })], sessions: [sessionRow({ sessionId: 's1' })] }))
      const queries = new CallIndexQueries(handle.source)
      const snapshotId = (queries.listCalls({}).data as Dict).snapshotId as string

      expect((await queries.getCallDetail({ sessionId: 's1' })).reason).toBe('invalid-request')
      expect((await queries.getCallDetail({ sessionId: 's1', callSeq: 999, snapshotId })).reason).toBe('not-visible')

      handle.visible.delete('s1')
      expect((await queries.getCallDetail({ sessionId: 's1', callSeq: 5, snapshotId })).reason).toBe('not-visible')

      handle.visible.add('s1')
      const ok = await queries.getCallDetail({ sessionId: 's1', callSeq: 5, snapshotId })
      expect(ok.ok).toBe(true)
      expect(ok.kind).toBe('detail')
      expect(((ok.data as Dict).detail as Dict).callSeq).toBe(5)
    })()
  })

  it('re-checks the authorization stamp after the async visibility lookup', () => {
    return (async () => {
      const handle = makeSource(snapshot({ rows: [callRow({ callSeq: 5 })], sessions: [sessionRow({ sessionId: 's1' })] }))
      handle.visible.add('s1')
      const queries = new CallIndexQueries(handle.source)
      const snapshotId = (queries.listCalls({}).data as Dict).snapshotId as string
      handle.setOnVisible(async () => { handle.setStamp('stamp-2') })
      const result = await queries.getCallDetail({ sessionId: 's1', callSeq: 5, snapshotId })
      expect(result.reason).toBe('cursor-stale')
    })()
  })
})

describe('callIndex filtering semantics', () => {
  it('excludes inherited calls by default and includes them on request', () => {
    const rows = [callRow({ callSeq: 1, inherited: false }), callRow({ callSeq: 2, inherited: true })]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow({ sessionId: 's1' })] }))
    const queries = new CallIndexQueries(handle.source)
    expect((queries.listCalls({}).data as Dict).total).toBe(1)
    expect((queries.listCalls({ query: { includeInherited: true } }).data as Dict).total).toBe(2)
  })

  it('uses half-open time bounds and case-insensitive literal substring for toolName', () => {
    const rows = [
      callRow({ callSeq: 1, startedAt: 1000, toolName: 'Read_file' }),
      callRow({ callSeq: 2, startedAt: 2000, toolName: 'read_File' }),
      callRow({ callSeq: 3, startedAt: 3000, toolName: 'write' }),
    ]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow({ sessionId: 's1' })] }))
    const queries = new CallIndexQueries(handle.source)
    expect((queries.listCalls({ query: { toolName: 'READ_FILE' } }).data as Dict).total).toBe(2)
    expect((queries.listCalls({ query: { fromMs: 1000, toMs: 3000 } }).data as Dict).total).toBe(2)
    // A regex-style pattern is treated literally, so no match.
    expect((queries.getSummary({ query: { toolName: 'r.ad' } }).data as Dict).total).toBe(0)
  })

  it('lists zero-call Sessions when unfiltered', () => {
    const sessions = [sessionRow({ sessionId: 'a' }), sessionRow({ sessionId: 'b', cwd: '/w' })]
    const handle = makeSource(snapshot({ rows: [], sessions }))
    const queries = new CallIndexQueries(handle.source)
    const result = queries.listSessions({})
    expect(result.ok).toBe(true)
    expect((result.data as Dict).total).toBe(2)
    expect(((result.data as Dict).items as Dict[]).map(item => item.sessionId)).toEqual(['a', 'b'])
  })
})

describe('callIndex summary aggregates (A0-1)', () => {
  function aggregatesOf(reply: { data?: unknown }): Dict {
    return (reply.data as Dict).aggregates as Dict
  }

  it('counts distinct tool names over rows, not over the current page', () => {
    const rows = [
      callRow({ callSeq: 1, toolName: 'read_file', startedAt: 1000 }),
      callRow({ callSeq: 2, toolName: 'read_file', startedAt: 2000 }),
      callRow({ callSeq: 3, toolName: 'ops_bash', startedAt: 3000 }),
    ]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    const aggregates = aggregatesOf(queries.getSummary({}))
    expect(aggregates.distinctTools).toBe(2)
    // Same aggregate regardless of the page size asked for elsewhere.
    expect(aggregatesOf(queries.getSummary({ query: { toolName: 'read_file' } })).distinctTools).toBe(1)
  })

  it('always reports all five source kinds, including zeros', () => {
    const rows = [
      callRow({ callSeq: 1, sourceKind: 'native', startedAt: 1000 }),
      callRow({ callSeq: 2, sourceKind: 'mcp', startedAt: 2000 }),
      callRow({ callSeq: 3, sourceKind: 'native', startedAt: 3000 }),
    ]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    expect(aggregatesOf(queries.getSummary({})).bySource).toEqual({
      mcp: 1,
      'plugin-tool': 0,
      native: 2,
      skill: 0,
      unknown: 0,
    })
  })

  it('keeps a zero source bucket distinguishable from a missing one', () => {
    const handle = makeSource(snapshot({ rows: [callRow()], sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    const bySource = aggregatesOf(queries.getSummary({})).bySource as Dict
    // The key exists with value 0 — a UI must render "not provable", not "unused".
    expect(Object.keys(bySource).sort()).toEqual(['mcp', 'native', 'plugin-tool', 'skill', 'unknown'])
    expect(bySource['plugin-tool']).toBe(0)
  })

  it('treats an unknown source filter as exact but a concrete one as a lower bound', () => {
    // Why this matters: `totalExact` must not lull a UI into printing
    // "6 unknown-source calls (exact)" for calls that were all MCP before a
    // plugin was removed. The asymmetry is deliberate:
    //
    // - `sourceKind: 'unknown'` matches the STORED LABEL, and every row carries
    //   exactly one label (`buildRow` always writes it, `projectRow` rejects an
    //   invalid one), so the count is exact by definition.
    // - `sourceKind: 'mcp'` means "really is mcp", which the label cannot
    //   guarantee for tools that have since left the catalog -> lower bound.
    const rows = [
      callRow({ callSeq: 1, sourceKind: 'mcp', startedAt: 1000 }),
      callRow({ callSeq: 2, sourceKind: 'unknown', startedAt: 2000 }),
    ]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)

    const unknownReply = queries.getSummary({ query: { sourceKind: 'unknown' } })
    expect((unknownReply.data as Dict).total).toBe(1)
    expect((unknownReply.data as Dict).totalExact).toBe(true)

    const mcpReply = queries.getSummary({ query: { sourceKind: 'mcp' } })
    expect((mcpReply.data as Dict).total).toBe(1)
    expect((mcpReply.data as Dict).totalExact).toBe(false)

    // A partial snapshot can never be exact, whatever the filter.
    const partial = makeSource(snapshot({ rows, sessions: [sessionRow()], coverage: 'partial' }))
    expect(((new CallIndexQueries(partial.source).getSummary({ query: { sourceKind: 'unknown' } }).data as Dict).totalExact)).toBe(false)
  })

  it('buckets calls by the caller-supplied local day offset, not UTC', () => {
    // 2026-11-09T23:30Z is 2026-11-10T08:30 at UTC+9 and still 11-09 at UTC+0.
    const instant = Date.parse('2026-11-09T23:30:00.000Z')
    const rows = [callRow({ callSeq: 1, startedAt: instant })]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)

    const utc = aggregatesOf(queries.getSummary({}))
    expect(utc.dayOffsetMinutes).toBe(0)
    expect((utc.byDay as Dict[]).map(bucket => bucket.day)).toEqual(['2026-11-09'])

    const tokyo = aggregatesOf(queries.getSummary({ dayOffsetMinutes: 540 }))
    expect(tokyo.dayOffsetMinutes).toBe(540)
    expect((tokyo.byDay as Dict[]).map(bucket => bucket.day)).toEqual(['2026-11-10'])
  })

  it('orders day buckets oldest-first and splits outcomes per bucket', () => {
    const rows = [
      callRow({ callSeq: 1, startedAt: Date.parse('2026-11-10T01:00:00.000Z'), outcome: 'success' }),
      callRow({ callSeq: 2, startedAt: Date.parse('2026-11-09T01:00:00.000Z'), outcome: 'error' }),
      callRow({ callSeq: 3, startedAt: Date.parse('2026-11-10T02:00:00.000Z'), outcome: 'unresolved' }),
    ]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    const byDay = aggregatesOf(queries.getSummary({})).byDay as Dict[]
    expect(byDay.map(bucket => bucket.day)).toEqual(['2026-11-09', '2026-11-10'])
    expect(byDay[0]).toMatchObject({ calls: 1, error: 1, success: 0 })
    expect(byDay[1]).toMatchObject({ calls: 2, success: 1, unresolved: 1, error: 0 })
  })

  it('omits byDay for an empty filtered set instead of inventing buckets', () => {
    const handle = makeSource(snapshot({ rows: [], sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    const aggregates = aggregatesOf(queries.getSummary({}))
    expect(aggregates.byDay).toBeUndefined()
    expect(aggregates.distinctTools).toBe(0)
  })

  it('accepts exactly one year of day buckets and rejects one day more', () => {
    const day = 86_400_000
    const start = Date.parse('2026-01-01T12:00:00.000Z')
    const at = (count: number) => Array.from({ length: count }, (_, i) => callRow({ callSeq: i + 1, startedAt: start + i * day }))

    // 366 distinct days is the documented maximum and must still be served.
    const ok = makeSource(snapshot({ rows: at(366), sessions: [sessionRow()] }))
    const okReply = new CallIndexQueries(ok.source).getSummary({})
    expect(okReply.ok).toBe(true)
    expect(((okReply.data as Dict).aggregates as Dict).byDay as Dict[]).toHaveLength(366)

    // 367 distinct days exceeds the cap: refuse, never truncate silently.
    const over = makeSource(snapshot({ rows: at(367), sessions: [sessionRow()] }))
    const overReply = new CallIndexQueries(over.source).getSummary({})
    expect(overReply.ok).toBe(false)
    expect(overReply.reason).toBe('reply-too-large')
  })

  it('rejects a day span beyond one year rather than truncating the trend', () => {
    const rows = Array.from({ length: 367 }, (_, i) => callRow({
      callSeq: i + 1,
      startedAt: Date.parse('2026-01-01T12:00:00.000Z') + i * 86_400_000,
    }))
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    const reply = queries.getSummary({})
    expect(reply.ok).toBe(false)
    expect(reply.reason).toBe('reply-too-large')
  })

  it('rejects an out-of-range day offset as an invalid request', () => {
    const handle = makeSource(snapshot({ rows: [callRow()], sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    expect(queries.getSummary({ dayOffsetMinutes: -721 }).reason).toBe('invalid-request')
    expect(queries.getSummary({ dayOffsetMinutes: 841 }).reason).toBe('invalid-request')
    // The documented bounds themselves stay valid.
    expect(queries.getSummary({ dayOffsetMinutes: -720 }).ok).toBe(true)
    expect(queries.getSummary({ dayOffsetMinutes: 840 }).ok).toBe(true)
  })

  it('rejects an unknown field alongside a valid offset', () => {
    const handle = makeSource(snapshot({ rows: [callRow()], sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    expect(queries.getSummary({ dayOffsetMinutes: 60, timezone: 'Asia/Shanghai' }).reason).toBe('invalid-request')
  })

  it('shares one generation and one snapshot between summary and its aggregates', () => {
    const rows = [callRow({ callSeq: 1, startedAt: 1000 })]
    const handle = makeSource(snapshot({ rows, sessions: [sessionRow()] }))
    const queries = new CallIndexQueries(handle.source)
    const summary = queries.getSummary({})
    const snapshotId = (summary.data as Dict).snapshotId
    const again = queries.getSummary({ snapshotId })
    expect(again.ok).toBe(true)
    expect((again.data as Dict).snapshotId).toBe(snapshotId)
    // Both reads resolved to the same frozen view without re-reading the source.
    expect(handle.snapshotCalls()).toBe(1)
  })
})
