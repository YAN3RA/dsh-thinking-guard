import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId, SessionLogOffset, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { SessionPersistenceRevision, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { SessionCallIndex } from '../src/usage/session-index.ts'
import type { CallIndexBackend } from '../src/usage/call-index-scope.ts'

interface Doc { header: SessionHeader; revision: string; events: readonly SessionEvent[]; inherited: number }
function doc(id = 'a', calls = 1, revision = 'r1', inherited = 0): Doc {
  const session = Session.create(SessionId(id))
  const events: SessionEvent[] = []
  for (let i = 0; i < calls; i++) {
    const callId = ToolCallId(`${revision}-${id}-${i}`)
    events.push(session.append('tool/call', { turn: 1, step: i, callId, name: 'echo', arguments: '{"private":"argument-canary"}' }))
    events.push(session.append('tool/result', { turn: 1, step: i, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'output-canary' }] }) }, { surfaceOp: 'append' }))
  }
  return { header: { ...session.header, isSeeded: inherited > 0 }, revision, events, inherited }
}
function fixture(initial: Doc[], knownCount = true) {
  const docs = new Map(initial.map(value => [value.header.id, value]))
  const reads: Array<{ id: string; offset: number; length: number }> = []
  const close = vi.fn()
  let beforeRead: ((id: string, offset: number, signal?: AbortSignal) => Promise<void>) | undefined
  let readFailure = false
  const snapshot = (value: Doc) => ({ header: value.header, revision: SessionPersistenceRevision(value.revision), ...(knownCount ? { eventCount: value.events.length } : {}) })
  const service: CallIndexBackend = {
    identity: Symbol('backend'),
    list: vi.fn(async () => [...docs.values()].map(snapshot)),
    stat: vi.fn(async id => { const value = docs.get(id); return value ? snapshot(value) : undefined }),
    open: vi.fn(async id => {
      const value = docs.get(id)
      if (!value) throw Error('not found')
      let closed = false
      const closeHandle = async () => { if (!closed) close(id); closed = true }
      const handle: SessionHandle = {
        id, header: value.header, inheritedEventCount: SessionLogOffset(value.inherited), access: 'read',
        async read(offset = 0, length = value.events.length, options) {
          if (closed) throw Error('closed')
          reads.push({ id, offset, length })
          await beforeRead?.(id, offset, options?.signal)
          options?.signal?.throwIfAborted()
          if (readFailure) throw Error('private read error must not leave the host')
          return { eventState: 'shared-frozen', events: value.events.slice(offset, offset + length) }
        },
        async append() { throw Error('read only') }, async flush() { throw Error('read only') },
        close: closeHandle, [Symbol.asyncDispose]: closeHandle,
      }
      return handle
    }),
  }
  return { service, docs, reads, close, beforeRead(fn: typeof beforeRead) { beforeRead = fn }, failReads(value: boolean) { readFailure = value } }
}
function engine(f: ReturnType<typeof fixture>, options: Partial<ConstructorParameters<typeof SessionCallIndex>[0]> = {}) {
  return new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => f.service, yield: async () => {}, ...options })
}
function barrier() {
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  return { started, release, hold: async () => { entered(); await held } }
}

describe('new session call-index scanner', () => {
  it('does not list history until explicitly enabled; unavailable is not an empty complete result', async () => {
    const f = fixture([doc()])
    // D-029 flipped the DEFAULT to host-visible, so "not enabled" is now an
    // explicit `disabled`, not an absent mode. `undefined` would mean
    // host-visible and this case would silently stop testing the gate.
    const index = engine(f, { getMode: () => 'disabled' })
    expect((await index.start()).scope.status).toBe('disabled')
    expect(f.service.list).not.toHaveBeenCalled()
    expect(index.snapshot().coverage).toBe('unknown')
    const absent = engine(f, { getBackend: () => undefined })
    expect((await absent.start()).scope.reason).toBe('persistence-unavailable')
    expect(f.service.open).not.toHaveBeenCalled()
  })

  it('reads unknown-length logs through a normal short tail and explicit empty EOF', async () => {
    const f = fixture([doc('a', 4)], false)
    const result = await engine(f, { pageSize: 3 }).start()
    expect(result.coverage).toBe('complete')
    expect(result.totals.calls).toBe(4)
    expect(f.reads.map(row => row.offset)).toEqual([0, 3, 6, 8])
    // TG-07: ONE handle per Session slice, not one open/close per page. Rotating
    // open/close per page is the documented root cause — it evicts the Host's
    // two-entry log cache between multi-page logs and re-decodes the whole log
    // (3x9 at page 4 measured 12 decodes instead of 3). The four page reads
    // above are unchanged; only the handle count is.
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toMatch(/argument-canary|output-canary/)
  })

  it('uses one task for concurrent requests and reuses only unchanged complete revisions', async () => {
    const f = fixture([doc()])
    const gate = barrier()
    f.beforeRead(gate.hold)
    const index = engine(f)
    const a = index.start(), b = index.start()
    expect(a).toBe(b)
    await gate.started
    gate.release()
    expect((await a).totals.calls).toBe(1)
    const opens = vi.mocked(f.service.open).mock.calls.length
    await index.start()
    expect(vi.mocked(f.service.open).mock.calls.length).toBe(opens)
    expect(index.snapshot().totals.calls).toBe(1)
  })

  it('retains a metadata cursor across a bounded run without double-counting', async () => {
    const f = fixture([doc('a', 3)])
    const index = engine(f, { pageSize: 2 })
    const partial = await index.start({ maxEvents: 2 })
    expect(partial.coverage).toBe('partial')
    expect(partial.pendingSessions).toBe(1)
    const complete = await index.start()
    expect(complete.coverage).toBe('complete')
    expect(complete.totals.calls).toBe(3)
    // Since D-030 the declared `eventCount` no longer proves EOF, so the scan
    // reads one extra page at offset 6 (the 4-event log ends at 4) purely to
    // observe an empty page. That probe is the only trustworthy end signal.
    expect(f.reads.map(row => row.offset)).toEqual([0, 2, 4, 6])
  })

  it('does not starve the tail of a corpus larger than the old 200-session limit', async () => {
    const f = fixture(Array.from({ length: 203 }, (_, i) => doc(`s${i}`)))
    const index = engine(f)
    for (let i = 0; i < 21; i++) await index.start({ maxEvents: 20 })
    const result = index.snapshot()
    expect(result.completedSessions).toBe(203)
    expect(result.totals.calls).toBe(203)
    expect(result.coverage).toBe('complete')
    expect(new Set(f.reads.map(row => row.id)).size).toBe(203)
  })

  it('keeps the old readable partition on a failed rebuild and atomically replaces it on retry', async () => {
    const f = fixture([doc()])
    const index = engine(f)
    expect((await index.start()).totals.calls).toBe(1)
    f.docs.set(SessionId('a'), doc('a', 2, 'r2'))
    f.failReads(true)
    const failed = await index.start()
    expect(failed.totals.calls).toBe(1)
    expect(failed.sessions[0]!.stale).toBe(true)
    expect(failed.coverage).toBe('partial')
    expect(JSON.stringify(failed)).not.toContain('private read error')
    f.failReads(false)
    const fresh = await index.start()
    expect(fresh.coverage).toBe('complete')
    expect(fresh.rows).toHaveLength(2)
    expect(fresh.rows.every(row => row.callId.startsWith('r2-'))).toBe(true)
  })

  it('re-resolves the actual backend after an await and drops the entire old epoch', async () => {
    const old = fixture([doc('old')])
    const replacement = fixture([doc('new')])
    let current = old.service
    const gate = barrier()
    old.beforeRead(gate.hold)
    const index = engine(old, { getBackend: () => current })
    const task = index.start()
    await gate.started
    current = replacement.service
    gate.release()
    expect((await task).rows).toHaveLength(0)
    expect(old.close).toHaveBeenCalledTimes(1)
    const fresh = await index.start()
    expect(fresh.rows.map(row => row.sessionId)).toEqual(['new'])
    expect(fresh.coverage).toBe('complete')
  })

  it('honors disabling during a pending read and never revives after disposal', async () => {
    const f = fixture([doc()])
    let mode: unknown = 'host-visible'
    const gate = barrier()
    f.beforeRead(gate.hold)
    const index = engine(f, { getMode: () => mode })
    const task = index.start()
    await gate.started
    mode = 'disabled'
    gate.release()
    expect((await task).rows).toHaveLength(0)
    expect(index.snapshot().scope.status).toBe('disabled')
    index.dispose()
    mode = 'host-visible'
    const calls = vi.mocked(f.service.list).mock.calls.length
    expect((await index.start()).scope.status).toBe('disabled')
    expect(vi.mocked(f.service.list).mock.calls.length).toBe(calls)
  })

  it('cancels in-flight work, closes handles, and resumes the same context later', async () => {
    const f = fixture([doc('a', 2)])
    const gate = barrier()
    f.beforeRead(gate.hold)
    const index = engine(f, { pageSize: 2 })
    const task = index.start()
    await gate.started
    index.cancel()
    gate.release()
    expect((await task).phase).toBe('cancelled')
    expect(f.close).toHaveBeenCalledTimes(1)
    f.beforeRead(undefined)
    const result = await index.start()
    expect(result.coverage).toBe('complete')
    expect(result.totals.calls).toBe(2)
  })

  it('projects overlapping live events immediately and merges without duplicate calls', async () => {
    const value = doc()
    const f = fixture([value])
    const gate = barrier()
    f.beforeRead(gate.hold)
    const index = engine(f)
    const task = index.start()
    await gate.started
    expect(index.observeLive('a', value.events[0], 0)).toBe(true)
    expect(index.observeLive('a', value.events[1], 0)).toBe(true)
    gate.release()
    const result = await task
    expect(result.coverage).toBe('complete')
    expect(result.totals.calls).toBe(1)
    expect(result.pendingLive).toBe(0)
  })

  it('keeps a live tail watermark until history really catches up, even after the queue is consumed', async () => {
    const f = fixture([doc()])
    const index = engine(f)
    expect((await index.start()).coverage).toBe('complete')
    const extended = doc('a', 2)
    index.observeLive('a', extended.events[3], 0)
    expect((await index.start()).coverage).toBe('partial')
    expect((await index.start()).coverage).toBe('partial')
    f.docs.set(SessionId('a'), { ...extended, revision: 'r2' })
    const complete = await index.start()
    expect(complete.coverage).toBe('complete')
    expect(complete.totals.calls).toBe(2)
  })

  // D-039: a Session whose partition stays partial was left permanently pending.
  // `publish()` returned early on the partial branch and skipped the bookkeeping
  // at the bottom, so `pending` never shrank: the UI reported 「待处理 65 个」
  // forever and the scan never converged.
  it('settles pending for a Session whose partition stays partial', async () => {
    const f = fixture([doc()])
    const index = engine(f)
    expect((await index.start()).coverage).toBe('complete')
    // A live event past the persisted cut makes the next pass see a partial
    // partition for that Session.
    const extended = doc('a', 2)
    index.observeLive('a', extended.events[3], 0)
    const after = await index.start()
    expect(after.coverage).toBe('partial')
    // The Session was READ in that pass, so it must not remain queued. Before the
    // fix this stayed at 1 and every later scan re-read the same Session.
    expect(after.pendingSessions).toBe(0)
  })

  it('can explicitly rebuild the same revision without counting it twice', async () => {
    const f = fixture([doc()])
    const index = engine(f)
    await index.start()
    const before = f.reads.length
    const rebuilt = await index.start({ full: true })
    expect(f.reads.length).toBeGreaterThan(before)
    expect(rebuilt.totals.calls).toBe(1)
    expect(rebuilt.coverage).toBe('complete')
  })

  it('does not erase live-overflow evidence on the next census', async () => {
    const value = doc()
    const f = fixture([value])
    const index = engine(f, { maxLiveQueue: 1 })
    expect(index.observeLive('a', value.events[0], 0)).toBe(true)
    expect(index.observeLive('a', value.events[1], 0)).toBe(false)
    const result = await index.start()
    expect(result.reasons).toContain('live-queue-overflow')
    expect(result.coverage).toBe('partial')
  })

  it('bounds estimated retained metadata without calling capacity a complete empty history', async () => {
    const f = fixture([doc()])
    const index = engine(f, { maxBytes: 64 })
    const result = await index.start()
    expect(result.coverage).toBe('partial')
    expect(result.reasons).toContain('index-capacity')
    expect(result.estimatedBytes).toBeLessThanOrEqual(64)
    expect(result.totals.calls).toBe(0)
  })

  it('keeps cancelled outcomes separate so totals reconcile without guessing denied counts', async () => {
    const value = doc()
    const original = value.events[1]!
    if (original.type !== 'tool/result') throw Error('fixture expected a result')
    const cancelled: SessionEvent = { ...original, data: { ...original.data, message: createToolResultMessage({ callId: original.data.message.toolCallId, isError: true, content: [] }), error: { name: 'Abort', code: TOOL_ABORTED } } }
    const f = fixture([{ ...value, events: [value.events[0]!, cancelled] }])
    const result = await engine(f).start()
    expect(result.totals.cancelled).toBe(1)
    expect(result.totals.failed).toBe(0)
    expect(result.totals.calls).toBe(result.totals.succeeded + result.totals.failed + result.totals.cancelled + result.totals.unresolved + result.totals.unknown + result.totals.running)
    expect(result.semanticCoverage.denied).toBe('unavailable')
  })

  it('publishes live-only metadata without listing or opening history', () => {
    const value = doc()
    const f = fixture([])
    const index = engine(f)
    index.observeLive('a', value.events[0], 0)
    index.observeLive('a', value.events[1], 0)
    const status = index.flushLive()
    expect(status.visibleSessions).toBe(1)
    expect(status.listedSessions).toBe(0)
    expect(status.totals.calls).toBe(1)
    expect(status.coverage).toBe('partial')
    expect(index.snapshot().rows[0]!.outcome).toBe('success')
    expect(f.service.list).not.toHaveBeenCalled()
    expect(f.service.open).not.toHaveBeenCalled()
  })

  it('appends live metadata to a retained partition without rescanning or undercounting retained bytes', async () => {
    const value = doc()
    const f = fixture([value])
    const index = engine(f)
    const before = await index.start()
    const extended = doc('a', 2)
    const lists = vi.mocked(f.service.list).mock.calls.length
    const opens = vi.mocked(f.service.open).mock.calls.length
    index.observeLive('a', extended.events[2], 0)
    index.observeLive('a', extended.events[3], 0)
    const live = index.flushLive()
    expect(live.totals.calls).toBe(2)
    expect(live.estimatedBytes).toBeGreaterThan(before.estimatedBytes)
    expect(live.coverage).toBe('partial')
    expect(f.service.list).toHaveBeenCalledTimes(lists)
    expect(f.service.open).toHaveBeenCalledTimes(opens)
    f.docs.set(SessionId('a'), { ...extended, revision: 'r2' })
    expect((await index.start()).totals.calls).toBe(2)
    expect(index.snapshot().coverage).toBe('complete')
  })

  it('does not list history when disabled or disposed live flush is requested', () => {
    const f = fixture([doc()])
    const index = engine(f, { getMode: () => 'disabled' })
    expect(index.flushLive().scope.status).toBe('disabled')
    index.dispose()
    expect(index.flushLive().rows).toEqual([])
    expect(f.service.list).not.toHaveBeenCalled()
  })

  it('makes host observation failures visible to future query snapshots', async () => {
    const f = fixture([doc()])
    const index = engine(f)
    const before = await index.start()
    index.markGap('live-projection-failed')
    const after = index.snapshot()
    expect(after.coverage).toBe('partial')
    expect(after.reasons).toContain('live-projection-failed')
    expect(after.generation).toBeGreaterThan(before.generation)
  })

  it('retains a verified observed live-only Session during a persisted census, and evicts it only after membership ends', async () => {
    const value = doc()
    const f = fixture([])
    let live = true
    const index = engine(f, { isLiveSession: id => live && id === 'a' })
    for (const event of value.events) index.observeLive('a', event, 0)
    index.flushLive()
    const retained = await index.start()
    expect(retained.totals.calls).toBe(1)
    expect(retained.coverage).toBe('partial')
    expect(retained.reasons).toContain('observed-live-only')
    live = false
    expect((await index.start()).totals.calls).toBe(0)
  })

  it('reconciles an observed Session after it becomes persisted without duplicate calls', async () => {
    const value = doc()
    const f = fixture([])
    const index = engine(f, { isLiveSession: () => true })
    for (const event of value.events) index.observeLive('a', event, 0)
    index.flushLive()
    await index.start()
    f.docs.set(SessionId('a'), value)
    const result = await index.start()
    expect(result.coverage).toBe('complete')
    expect(result.totals.calls).toBe(1)
  })

  it('excludes fork-inherited calls from global new-call totals', async () => {
    const f = fixture([doc('parent'), doc('child', 2, 'r1', 2)])
    const result = await engine(f).start()
    expect(result.rows).toHaveLength(3)
    expect(result.totals.calls).toBe(2)
    expect(result.totals.inherited).toBe(1)
  })
})

describe('a lying eventCount cannot starve the scan (D-030)', () => {
  /**
   * Backend that reports `declared` events but actually serves `actual`.
   *
   * This is the real failure: the jsonl backend counts the header record of a
   * multi-frame zstd artifact, so a 4009-event log declares `eventCount: 1`.
   * Treating that as authoritative stopped the scan before its first read.
   */
  function lyingFixture(declared: number, actual: number) {
    const session = Session.create(SessionId('a'))
    const events: SessionEvent[] = []
    for (let i = 0; i < actual; i++) {
      const callId = ToolCallId(`c${i}`)
      events.push(session.append('tool/call', { turn: 1, step: 1, callId, name: 'echo', arguments: '{}' }))
      events.push(session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'ok' }] }) }, { surfaceOp: 'append' }))
    }
    const close = vi.fn()
    const backend: CallIndexBackend = {
      identity: Symbol('lying'),
      list: async () => [{ header: session.header, revision: SessionPersistenceRevision('r1'), eventCount: declared }],
      stat: async id => id === session.id ? { header: session.header, revision: SessionPersistenceRevision('r1'), eventCount: declared } : undefined,
      open: async id => {
        if (id !== session.id) throw Error('not found')
        const handle: SessionHandle = {
          id, header: session.header, inheritedEventCount: SessionLogOffset(0), access: 'read',
          read: async (offset = 0, length = events.length) => {
            const start = Math.min(offset, events.length)
            const end = Math.min(start + length, events.length)
            return { eventState: 'detached', events: events.slice(start, end) }
          },
          append: async () => undefined,
          flush: async () => undefined,
          close: async () => { close() },
          [Symbol.asyncDispose]: async () => { close() },
        } as SessionHandle
        return handle
      },
    }
    return { backend, events, close }
  }

  it('reads past a declared count of 1 and indexes every call', async () => {
    // `actual` is a CALL count; each call emits a tool/call + tool/result pair,
    // so 4 calls = 8 events while the backend declares eventCount: 1.
    const f = lyingFixture(1, 4)
    const index = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => f.backend })
    const result = await index.start()
    expect(f.events).toHaveLength(8)
    expect(result.totals.calls).toBe(4)
    // And the under-report is stated, not swallowed.
    expect([...result.reasons]).toContain('event-count-underreported')
  })

  it('still finishes cleanly when the declaration happens to be exact', async () => {
    const f = lyingFixture(8, 4)
    const index = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => f.backend })
    const result = await index.start()
    expect(result.totals.calls).toBe(4)
    expect([...result.reasons]).not.toContain('event-count-underreported')
  })

  it('reports a declared count of zero without skipping the probe', async () => {
    const f = lyingFixture(0, 2)
    const index = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => f.backend })
    const result = await index.start()
    // A zero declaration must not mean "nothing to read".
    expect(result.totals.calls).toBe(2)
  })

  it('proves emptiness with an empty page for a genuinely empty log', async () => {
    const f = lyingFixture(0, 0)
    const index = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => f.backend })
    const result = await index.start()
    expect(result.totals.calls).toBe(0)
    // An empty log is not a defect: no under-report code should appear.
    expect([...result.reasons]).not.toContain('event-count-underreported')
  })
})

describe('read failures are classified, not flattened', () => {  /** Start a scan whose open() throws the given error shape. */
  async function reasonFor(error: unknown): Promise<string[]> {
    const backend = {
      identity: Symbol('failing'),
      list: async () => [{ header: { id: SessionId('a'), version: 4, createdAt: 1, isSeeded: false }, revision: SessionPersistenceRevision('r1'), eventCount: 4 }],
      stat: async () => undefined,
      open: async () => { throw error },
    }
    const index = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => backend })
    const result = await index.start()
    return [...result.reasons]
  }

  it('names a decode failure so a compressed artifact is not mistaken for absence', async () => {
    const reasons = await reasonFor(Object.assign(new Error('boom'), { name: 'ZstdDecodeError' }))
    expect(reasons).toContain('session-decode-failed')
    // The flat code must NOT also appear: that would defeat the classification.
    expect(reasons).not.toContain('session-read-failed')
  })

  it('names a missing artifact and a permission problem distinctly', async () => {
    expect(await reasonFor(Object.assign(new Error('x'), { code: 'ENOENT' }))).toContain('session-missing')
    expect(await reasonFor(Object.assign(new Error('x'), { code: 'EACCES' }))).toContain('session-unreadable')
  })

  it('falls back to the flat code for an unrecognized error shape', async () => {
    expect(await reasonFor(new Error('whatever'))).toContain('session-read-failed')
    // A non-Error throw must not crash the scan either.
    expect(await reasonFor('a string')).toContain('session-read-failed')
  })

  it('never copies the error message into the reason code', async () => {
    const reasons = await reasonFor(Object.assign(new Error('SECRET-PAYLOAD-CANARY'), { code: 'ENOENT' }))
    expect(reasons.join(' ')).not.toContain('SECRET-PAYLOAD-CANARY')
  })
})
