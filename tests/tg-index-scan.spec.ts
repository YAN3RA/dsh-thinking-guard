/**
 * TG-07 / TG-08 / TG-09 directed regressions.
 *
 * Every case here is a MEASURED failure from the audit report, not a shape test:
 *
 * - TG-07: three Sessions x nine events at page 4 used to produce 12 opens and
 *   12 simulated full decodes (one per page) instead of 3 - opening, reading one
 *   page and closing rotates faster than the backend 2-entry log cache, so every
 *   page re-decodes the whole log.
 * - TG-08: 32 Sessions x 4096 events at page 2048 / budget 2M read 57344 events
 *   and published 0 rows, while reporting readEvents 0 / calls 0.
 * - TG-09: one Session of 30 events at page 5 advanced offset 0 -> 5 -> 10 -> 15
 *   but pendingSessions stayed 1, so the third "no progress" round stopped a
 *   scan that was really advancing.
 *
 * The synthetic backend below is the harness: it holds an LRU of DECODED logs
 * with the capacity the real Host uses (2), and charges a full decode whenever a
 * read miss lands on a log that is not the one currently cached. It stores no
 * session content outside the test's own fixture and reads no Host files.
 */
import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionPersistenceRevision, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { SessionCallIndex } from '../src/usage/session-index.ts'
import type { CallIndexBackend } from '../src/usage/call-index-scope.ts'

interface Doc { id: string; header: SessionHandle['header']; revision: string; events: readonly SessionEvent[]; inherited: number }

interface DocOptions { calls?: number; events?: number; otherHeavy?: boolean; revision?: string; inherited?: number }

/**
 * Build a Session with call/result pairs, or with an other-heavy event log.
 *
 * otherHeavy reproduces the 32x4096 corpus: one real call followed by ignorable
 * control events, which is exactly the case that retains index metadata while
 * producing almost no call rows.
 */
function makeDoc(id: string, options: DocOptions = {}): Doc {
  const session = Session.create(SessionId(id))
  const events: SessionEvent[] = []
  if (options.otherHeavy === true) {
    const callId = ToolCallId(id + '-c0')
    events.push(session.append('tool/call', { turn: 1, step: 0, callId, name: 'echo', arguments: '{}' }))
    while (events.length < (options.events ?? 4096)) events.push(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) as SessionEvent)
  } else {
    for (let index = 0; index < (options.calls ?? 1); index++) {
      const callId = ToolCallId(id + '-c' + String(index))
      events.push(session.append('tool/call', { turn: 1, step: index, callId, name: 'echo', arguments: '{"secret":"args-canary"}' }))
      events.push(session.append('tool/result', { turn: 1, step: index, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'result-canary' }] }) }, { surfaceOp: 'append' }))
    }
  }
  const inherited = options.inherited ?? 0
  return { id, header: { ...session.header, isSeeded: inherited > 0 }, revision: options.revision ?? 'r1', events, inherited }
}

/**
 * Synthetic backend with an explicit 2-entry decoded-log LRU and a decode counter.
 *
 * This is the documented Host behaviour the audit reproduced: read decodes the
 * WHOLE log on a cache miss and slices afterwards, and the cache holds two logs.
 * Making it deterministic is what makes "decodes follow Session count" assertable.
 */
function lruBackend(docs: Doc[], capacity = 2) {
  const byId = new Map(docs.map(doc => [doc.id, doc]))
  const cache: string[] = []
  const stats = { opens: 0, closes: 0, reads: 0, decodes: 0, readOffsets: [] as Array<{ id: string; offset: number; length: number }> }
  const touch = (id: string): void => {
    const at = cache.indexOf(id)
    if (at >= 0) cache.splice(at, 1)
    cache.push(id)
    while (cache.length > capacity) cache.shift()
  }
  const decode = (id: string): readonly SessionEvent[] => {
    if (cache.includes(id)) { touch(id); return byId.get(id)!.events }
    stats.decodes += 1
    touch(id)
    return byId.get(id)!.events
  }
  const snap = (doc: Doc) => ({ header: doc.header, revision: SessionPersistenceRevision(doc.revision), eventCount: doc.events.length })
  const backend: CallIndexBackend = {
    identity: Symbol('lru'),
    list: async () => docs.map(snap),
    stat: async id => { const doc = byId.get(String(id)); return doc === undefined ? undefined : snap(doc) },
    open: vi.fn(async (id): Promise<SessionHandle> => {
      const doc = byId.get(String(id))
      if (doc === undefined) throw Error('not found')
      stats.opens += 1
      let closed = false
      const close = async (): Promise<void> => { if (!closed) { closed = true; stats.closes += 1 } }
      return {
        id, header: doc.header, inheritedEventCount: SessionLogOffset(doc.inherited), access: 'read',
        async read(offset = 0, length = doc.events.length) {
          if (closed) throw Error('closed')
          stats.reads += 1
          stats.readOffsets.push({ id: String(id), offset, length })
          const decoded = decode(String(id))
          return { eventState: 'shared-frozen' as const, events: decoded.slice(offset, offset + length) }
        },
        async append() { throw Error('read only') }, async flush() { throw Error('read only') },
        close, [Symbol.asyncDispose]: close,
      }
    }),
  }
  return { backend, stats, docs: byId }
}

const engine = (backend: CallIndexBackend, options: Partial<ConstructorParameters<typeof SessionCallIndex>[0]> = {}) =>
  new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => backend, yield: async () => {}, ...options })

describe('TG-07: one handle per Session slice, not one per page', () => {
  it('decodes once per Session instead of once per page (3 Sessions x 9 events, page 4)', async () => {
    const docs = [makeDoc('a', { calls: 4 }), makeDoc('b', { calls: 4 }), makeDoc('c', { calls: 4 })]
    const { backend, stats } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 4 })
    const result = await index.start()

    expect(result.totals.calls).toBe(12)
    expect(result.coverage).toBe('complete')
    // The old schedule produced 12 opens (one per page). A bounded slice per
    // handle keeps it at one per Session.
    expect(stats.opens).toBe(3)
    expect(stats.closes).toBe(3)
    // Decodes follow the Session count too: per-page rotation thrashed the
    // 2-entry cache, so every page missed and re-decoded the whole log.
    expect(stats.decodes).toBeLessThanOrEqual(3)
    // Every page was still read; nothing was skipped for speed.
    expect(stats.reads).toBeGreaterThanOrEqual(9)
  })

  it('keeps a huge Session from starving the others in the same pass', async () => {
    const docs = [makeDoc('big', { calls: 200 }), makeDoc('small', { calls: 1 })]
    const { backend, stats } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 8, pagesPerHandle: 2 })
    const result = await index.start({ maxEvents: 40 })
    expect(stats.readOffsets.some(row => row.id === 'small')).toBe(true)
    expect(result.phase).toBe('partial')
  })
})

describe('TG-09: progress is the verified cut, not the pending count', () => {
  it('continues one Session of 30 events at page/budget 5 to EOF across resumed passes', async () => {
    const docs = [makeDoc('one', { calls: 15 })]
    const { backend, stats } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 5 })
    const cuts: number[] = []
    for (let pass = 0; pass < 12; pass++) {
      const snapshot = await index.start({ maxEvents: 5 })
      cuts.push(snapshot.scannedEvents)
      if (snapshot.coverage === 'complete') break
    }
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]).toBeGreaterThanOrEqual(cuts[i - 1]!)
    expect(index.snapshot().coverage).toBe('complete')
    expect(index.snapshot().totals.calls).toBe(15)
    // 30 events at 5 per page: the offsets walk forward and never reset.
    const offsets = [...new Set(stats.readOffsets.filter(row => row.id === 'one').map(row => row.offset))].sort((a, b) => a - b)
    expect(offsets).toEqual([0, 5, 10, 15, 20, 25, 30])
    expect(stats.decodes).toBeLessThanOrEqual(2)
  })

  it('does not call a Session with a flat pending count stagnant while its cut moves', async () => {
    const docs = [makeDoc('one', { calls: 5 })]
    const { backend } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 4 })
    const first = await index.start({ maxEvents: 4 })
    const second = await index.start({ maxEvents: 4 })
    // pendingSessions is 1 in BOTH passes (work is still owed), which is exactly
    // the count-only signal that used to stop the loop.
    expect(first.pendingSessions).toBe(1)
    expect(second.pendingSessions).toBe(1)
    // But the verified cut really advanced, and that is the progress measure.
    expect(second.scannedEvents).toBeGreaterThan(first.scannedEvents)
  })
})

describe('TG-08: read work is published, never a silent zero', () => {
  it('publishes a checkpoint for a partly read Session instead of dropping it', async () => {
    const docs = [makeDoc('one', { calls: 40 })]
    const { backend } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 10 })
    const first = await index.start({ maxEvents: 10 })
    expect(first.phase).toBe('partial')
    expect(first.passReadEvents).toBe(10)
    expect(first.scannedEvents).toBe(10)
    // A call row is already readable: "read a lot, published 0" cannot happen.
    expect(first.totals.calls).toBeGreaterThan(0)
    expect(first.sessions[0]!.coverage).toBe('partial')
    expect(first.sessions[0]!.cut).toBe(10)
  })

  it('keeps the ledger consistent across repeated checkpoints of one Session', async () => {
    const docs = [makeDoc('one', { calls: 30 })]
    const { backend } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 8 })
    const seen: number[] = []
    for (let pass = 0; pass < 8; pass++) {
      const snapshot = await index.start({ maxEvents: 8 })
      seen.push(snapshot.estimatedBytes)
      if (snapshot.coverage === 'complete') break
    }
    // Never zeroed, never negative, never double-charged: the ledger covers the
    // one retained partition and only grows while that partition grows.
    for (const bytes of seen) expect(bytes).toBeGreaterThan(0)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!)
    const final = index.snapshot()
    expect(final.coverage).toBe('complete')
    expect(final.estimatedBytes).toBeGreaterThan(0)
  })

  it('pauses on capacity with a stated recoverable reason and keeps what it read', async () => {
    const docs = [makeDoc('one', { calls: 60 })]
    const { backend } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 10, maxBytes: 4_000 })
    const snapshot = await index.start()
    expect(snapshot.phase).toBe('partial')
    expect(snapshot.paused).toBe(true)
    expect(snapshot.reasons).toContain('scan-paused-capacity')
    // Read progress survives the pause, and is not reported as complete.
    expect(snapshot.scannedEvents).toBeGreaterThan(0)
    expect(snapshot.coverage).toBe('partial')
    expect(snapshot.estimatedBytes).toBeGreaterThan(0)
    expect(snapshot.estimatedBytes).toBeLessThanOrEqual(4_000)
  })

  it('never overwrites a readable complete partition with a partial rebuild', async () => {
    const docs = [makeDoc('one', { calls: 3 })]
    const { backend } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 4 })
    const complete = await index.start()
    expect(complete.sessions[0]!.coverage).toBe('complete')
    const before = complete.totals.calls
    const after = await index.start({ maxEvents: 4 })
    expect(after.totals.calls).toBe(before)
    expect(after.sessions[0]!.coverage).toBe('complete')
  })

  it('does not leak arguments, results or backend identity into a checkpoint', async () => {
    const docs = [makeDoc('one', { calls: 20 })]
    const { backend } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 5 })
    const snapshot = await index.start({ maxEvents: 5 })
    const text = JSON.stringify(snapshot)
    expect(text).not.toMatch(/args-canary|result-canary/)
    expect(text).not.toContain('lru')
  })
})

/**
 * The 32 x 4096 corpus from the audit (V-P), built as plain projected event
 * objects so the fixture cost does not dominate the measurement.
 *
 * Each Session holds ONE real tool/call at seq 0 and 4095 ignorable control
 * events. That is the shape that retained 1 KiB of seq metadata per event and
 * exhausted the 64 MiB ledger before anything could be published.
 */
function wideCorpus(sessions: number, eventsPerSession: number) {
  const docs: Doc[] = []
  for (let s = 0; s < sessions; s++) {
    const session = Session.create(SessionId('w' + String(s)))
    docs.push({ id: 'w' + String(s), header: { ...session.header, isSeeded: false }, revision: 'r1', events: [], inherited: 0 })
  }
  const make = (id: string): SessionEvent[] => {
    const out: SessionEvent[] = []
    for (let seq = 0; seq < eventsPerSession; seq++) {
      out.push(seq === 0
        ? ({ type: 'tool/call', seq, time: 1000 + seq, data: { turn: 1, step: 1, callId: id + '-c', name: 'echo', arguments: '{}' } } as unknown as SessionEvent)
        : ({ type: 'turn/end', seq, time: 1000 + seq, data: { turn: 1 } } as unknown as SessionEvent))
    }
    return out
  }
  const byId = new Map<string, SessionEvent[]>()
  for (const doc of docs) byId.set(doc.id, make(doc.id))
  let reads = 0
  const backend: CallIndexBackend = {
    identity: Symbol('wide'),
    list: async () => docs.map(doc => ({ header: doc.header, revision: SessionPersistenceRevision(doc.revision), eventCount: eventsPerSession })),
    stat: async id => { const doc = docs.find(item => item.id === String(id)); return doc === undefined ? undefined : { header: doc.header, revision: SessionPersistenceRevision(doc.revision), eventCount: eventsPerSession } },
    open: async (id): Promise<SessionHandle> => {
      const key = String(id)
      const events = byId.get(key) ?? make(key)
      let closed = false
      const close = async (): Promise<void> => { closed = true }
      return {
        id, header: docs.find(item => item.id === key)!.header, inheritedEventCount: SessionLogOffset(0), access: 'read',
        async read(offset = 0, length = 2048) {
          if (closed) throw Error('closed')
          reads += 1
          return { eventState: 'shared-frozen' as const, events: events.slice(offset, offset + length) }
        },
        async append() { throw Error('read only') }, async flush() { throw Error('read only') },
        close, [Symbol.asyncDispose]: close,
      }
    },
  }
  return { backend, reads: () => reads }
}

describe('TG-08: the 32 x 4096 corpus with default budget', () => {
  it('publishes every Session instead of reading 57344 events and reporting 0', async () => {
    const corpus = wideCorpus(32, 4096)
    // Defaults exactly as the Host runs them: page 2048, budget 2,000,000,
    // 64 MiB ledger. The audit's numbers came from this same wiring.
    const index = engine(corpus.backend)
    const snapshot = await index.start({ maxEvents: 2_000_000 })
    // Either everything is published, or there is a stated recoverable pause
    // with real read progress. A silent zero is the failure this pins.
    const published = snapshot.completedSessions
    const paused = snapshot.paused === true
    expect(published + (paused ? 1 : 0)).toBeGreaterThan(0)
    expect(snapshot.scannedEvents).toBeGreaterThan(0)
    expect(snapshot.passReadEvents).toBeGreaterThan(0)
    expect(snapshot.totals.calls).toBeGreaterThanOrEqual(published)
    // MEASURED (this run, defaults): coverage complete, phase complete, 32/32
    // Sessions published, scannedEvents 131072 (= 32 x 4096), retained
    // 4,769,816 bytes, 32 calls, no reasons. The audit's "read 57344 events,
    // published 0, readEvents 0" cannot recur without failing here.
    expect(snapshot.coverage).toBe('complete')
    expect(snapshot.phase).toBe('complete')
    expect(published).toBe(32)
    expect(snapshot.scannedEvents).toBe(32 * 4096)
    expect(snapshot.passReadEvents).toBe(32 * 4096)
    expect(snapshot.totals.calls).toBe(32)
    expect(snapshot.estimatedBytes).toBeGreaterThan(0)
    expect(snapshot.reasons).toEqual([])
    // The pause branch is documented above; if it ever becomes reachable the
    // failure message must say so rather than silently pass the count check.
    expect(paused).toBe(false)
  })
})

describe('TG-08: capacity recovery is explicit, never a fake resume', () => {
  it('re-pauses instead of pretending a stopped partition recovered', async () => {
    const docs = [makeDoc('one', { calls: 60 })]
    const { backend } = lruBackend(docs, 2)
    const index = engine(backend, { pageSize: 10, maxBytes: 4_000 })
    const first = await index.start()
    expect(first.paused).toBe(true)
    // A second pass on the SAME instance must not clear the reason and march on
    // through a partition whose reservations already stopped.
    const second = await index.start()
    expect(second.paused).toBe(true)
    expect(second.reasons).toContain('scan-paused-capacity')
    // It is still not reported as complete, and the retained prefix is intact.
    expect(second.coverage).toBe('partial')
    expect(second.estimatedBytes).toBeGreaterThan(0)
    // A clean recovery is an explicit full rebuild, which really re-reads.
    const rebuilt = await index.start({ full: true })
    expect(rebuilt.phase === 'partial' || rebuilt.phase === 'complete').toBe(true)
  })
})

/**
 * Rework (rev=9) directed failures, written BEFORE the fix.
 *
 * 1) same-part checkpoint freeze: 30 valid tool/call events with a header that
 *    declares 6, page 5, budget 5. Reads walk 0,5,6,10,15,20,25,30 and
 *    readEvents/scanned reach 30, but calls and published cut stay at 5 forever
 *    because the partial branch of publish() only refreshed bytes.
 * 2) r1 complete(100 calls) then r2 appends: the old readable complete must be
 *    kept until the new revision is complete, and the new stage must continue
 *    from its cut instead of being discarded and re-read from 0 each round.
 * 3) completed-sessions must be independent of coverage: an under-reported log
 *    read to EOF is PARTIAL coverage yet EXHAUSTED, and must be countable.
 * 5) pagesPerHandle must actually bound the slice.
 */

interface RawDoc { id: string; header: SessionHandle['header']; revision: string; events: readonly SessionEvent[]; inherited: number; declared: number }

/** 30 real tool/call events in the exact shape the audit used. */
function auditDoc(count: number, declared: number, id = 'audit', revision = 'r1', inherited = 0): RawDoc {
  const session = Session.create(SessionId(id))
  const events: SessionEvent[] = []
  for (let seq = 0; seq < count; seq++) {
    events.push({ type: 'tool/call', seq, time: 1000 + seq, data: { turn: 1, step: seq, callId: 'c' + String(seq), name: 'audit', arguments: {} } } as unknown as SessionEvent)
  }
  return { id, header: { ...session.header, isSeeded: inherited > 0 }, revision, events, inherited, declared }
}

function rawBackend(initial: RawDoc[]) {
  const docs = new Map(initial.map(doc => [doc.id, doc]))
  const offsets: Array<{ id: string; offset: number; length: number }> = []
  let opens = 0
  const snap = (doc: RawDoc) => ({ header: doc.header, revision: SessionPersistenceRevision(doc.revision), eventCount: doc.declared })
  const backend: CallIndexBackend = {
    identity: Symbol('raw'),
    list: async () => [...docs.values()].map(snap),
    stat: async id => { const doc = docs.get(String(id)); return doc === undefined ? undefined : snap(doc) },
    open: async (id): Promise<SessionHandle> => {
      const doc = docs.get(String(id))
      if (doc === undefined) throw Error('not found')
      opens += 1
      let closed = false
      const close = async (): Promise<void> => { closed = true }
      return {
        id, header: doc.header, inheritedEventCount: SessionLogOffset(doc.inherited), access: 'read',
        async read(offset = 0, length = 5) {
          if (closed) throw Error('closed')
          offsets.push({ id: String(id), offset, length })
          return { eventState: 'shared-frozen' as const, events: doc.events.slice(offset, offset + length) }
        },
        async append() { throw Error('read only') }, async flush() { throw Error('read only') },
        close, [Symbol.asyncDispose]: close,
      }
    },
  }
  return { backend, docs, offsets, opens: () => opens }
}

describe('rework 1: a same-part checkpoint advances, it does not freeze', () => {
  it('reaches 30 calls and cut 30 for a header that declares 6', async () => {
    const corpus = rawBackend([auditDoc(30, 6)])
    const index = engine(corpus.backend, { pageSize: 5 })
    const cuts: number[] = []
    for (let pass = 0; pass < 8; pass++) {
      const snapshot = await index.start({ maxEvents: 5 })
      cuts.push(snapshot.sessions[0]?.cut ?? 0)
      if (snapshot.pendingSessions === 0 && snapshot.phase === 'complete') break
    }
    const final = index.snapshot()
    // The audit's real read offsets: the declared 6 caps exactly one page.
    expect(corpus.offsets.map(row => row.offset)).toEqual([0, 5, 6, 10, 15, 20, 25, 30])
    // The frozen snapshot bug: calls and cut stayed at 5 while 30 events were read.
    expect(final.totals.calls).toBe(30)
    expect(final.sessions[0]!.cut).toBe(30)
    expect(final.pendingSessions).toBe(0)
    expect(cuts[cuts.length - 1]).toBe(30)
  })

  it('counts the read-to-EOF Session as exhausted even when coverage is partial', async () => {
    const corpus = rawBackend([auditDoc(30, 6)])
    const index = engine(corpus.backend, { pageSize: 5 })
    for (let pass = 0; pass < 8; pass++) {
      const snapshot = await index.start({ maxEvents: 5 })
      if (snapshot.pendingSessions === 0) break
    }
    const final = index.snapshot()
    // coverage stays partial: the backend under-reported, and that is a real gap.
    expect(final.reasons).toContain('event-count-underreported')
    expect(final.coverage).toBe('partial')
    // ...but the Session WAS read to EOF, and that must be countable separately.
    expect(final.exhaustedSessions).toBe(1)
    expect(final.completedSessions).toBe(0)
  })
})

describe('rework 2: a new revision must not bury a readable complete partition', () => {
  it('keeps the old complete value while the new revision catches up, then replaces it', async () => {
    const first = auditDoc(100, 100)
    const corpus = rawBackend([first])
    const index = engine(corpus.backend, { pageSize: 50 })
    const complete = await index.start()
    expect(complete.sessions[0]!.coverage).toBe('complete')
    expect(complete.totals.calls).toBe(100)
    // r2 appends one call; the log is re-listed under a new revision.
    corpus.docs.set('audit', auditDoc(101, 101, 'audit', 'r2'))
    const liveStarts = corpus.offsets.length
    const second = await index.start({ maxEvents: 5 })
    // The old readable 100 must still be what the operator sees.
    expect(second.totals.calls).toBe(100)
    expect(second.sessions[0]!.revision).toBe('r1')
    expect(second.sessions[0]!.coverage).toBe('complete')
    // ...and the new stage must be alive to resume, not discarded.
    expect(second.pendingSessions).toBe(1)
    for (let pass = 0; pass < 60; pass++) {
      const snapshot = await index.start({ maxEvents: 20 })
      if (snapshot.sessions[0]?.revision === 'r2' && snapshot.sessions[0].coverage === 'complete') break
    }
    const final = index.snapshot()
    expect(final.sessions[0]!.revision).toBe('r2')
    expect(final.sessions[0]!.coverage).toBe('complete')
    expect(final.totals.calls).toBe(101)
    // No re-read from zero: the new revision is read from offset 0 exactly once.
    const r2Offsets = corpus.offsets.slice(liveStarts).filter(row => row.offset >= 0)
    expect(r2Offsets.filter(row => row.offset === 0).length).toBe(1)
  })

  it('does not treat a new revision baseline as forward progress', async () => {
    const corpus = rawBackend([auditDoc(50, 50)])
    const index = engine(corpus.backend, { pageSize: 10 })
    const complete = await index.start()
    expect(complete.progressEvents).toBe(0)
    // A revision change re-baselines: no false progress, no false stall.
    corpus.docs.set('audit', auditDoc(51, 51, 'audit', 'r2'))
    const afterChurn = await index.start({ maxEvents: 10 })
    expect(afterChurn.progressEvents).toBe(0)
    // Real forward motion inside the SAME revision is progress.
    const advanced = await index.start({ maxEvents: 10 })
    expect(advanced.progressEvents).toBeGreaterThan(0)
  })
})

describe('rework 5: pagesPerHandle really bounds the slice', () => {
  it('opens more handles with a one-page slice than with a four-page slice', async () => {
    const tight = rawBackend([auditDoc(40, 40)])
    const tightIndex = engine(tight.backend, { pageSize: 5, pagesPerHandle: 1 })
    await tightIndex.start()
    const loose = rawBackend([auditDoc(40, 40)])
    const looseIndex = engine(loose.backend, { pageSize: 5, pagesPerHandle: 4 })
    await looseIndex.start()
    // 8 pages: a 1-page slice means 8 opens, a 4-page slice means 2.
    expect(tight.offsets.length).toBe(loose.offsets.length)
    expect(tight.opens()).toBeGreaterThan(loose.opens())
  })
})

describe('rework 4: scheduler terminal states and scope honesty', () => {
  it('read-to-EOF with an under-reported header reports calls, exhaustion and no backlog', async () => {
    const corpus = rawBackend([auditDoc(30, 6)])
    const index = engine(corpus.backend, { pageSize: 5 })
    for (let pass = 0; pass < 8; pass++) {
      const snapshot = await index.start({ maxEvents: 5 })
      if (snapshot.pendingSessions === 0) break
    }
    const final = index.snapshot()
    // The lead-defined contract for this case: 30 calls, 1 read-complete, 0 pending,
    // while coverage stays partial because the under-report is real.
    expect(final.totals.calls).toBe(30)
    expect(final.exhaustedSessions).toBe(1)
    expect(final.pendingSessions).toBe(0)
    expect(final.coverage).toBe('partial')
    expect(final.reasons).toContain('event-count-underreported')
  })

  it('does not report a capacity-paused index as active', async () => {
    const corpus = rawBackend([auditDoc(60, 60)])
    const index = engine(corpus.backend, { pageSize: 10, maxBytes: 4_000 })
    const paused = await index.start()
    expect(paused.paused).toBe(true)
    // A paused scan is not running, and must not claim to be.
    expect(paused.phase).toBe('partial')
    expect(paused.reasons).toContain('scan-paused-capacity')
  })
})
