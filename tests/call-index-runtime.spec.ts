import { describe, expect, it, vi } from 'vitest'
import { Context as CordisContext, type Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionPersistenceRevision, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { installCallIndexRuntime, CallIndexConfig, type CallIndexRuntimeConfig } from '../src/usage/call-index-runtime.ts'
import type { CallIndexBackend } from '../src/usage/call-index-scope.ts'
import type { CallIndexReply } from '../src/usage/call-index-wire.ts'
import * as hostPlugin from '../src/usage/call-index-host.ts'

function host() {
  const services = new Map<string, unknown>()
  const listeners = new Set<(session: Session, event: SessionEvent) => void>()
  const effects: Array<() => unknown> = []
  const timers = new Set<() => void>()
  const plugin = vi.fn()
  const ctx = {
    get: (key: string) => services.get(key),
    provide: (key: string, value: unknown) => { services.set(key, value) },
    on: (_event: string, callback: (session: Session, event: SessionEvent) => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
    effect: (factory: () => () => unknown) => { effects.push(factory()) }, plugin,
  } as unknown as Context
  return {
    ctx, services, listeners, timers, plugin,
    options: { now: () => 1000, schedule(callback: () => void) { timers.add(callback); return () => { timers.delete(callback) } } },
    fire() { const ready = [...timers]; timers.clear(); for (const callback of ready) callback() },
    emit(session: Session, event: SessionEvent) { for (const listener of [...listeners]) listener(session, event) },
    async dispose() { for (const effect of effects.splice(0)) await effect() },
  }
}
function data(reply: CallIndexReply): Record<string, unknown> {
  expect(reply.ok).toBe(true)
  if (typeof reply.data !== 'object' || reply.data === null) throw Error('expected data')
  return reply.data as Record<string, unknown>
}
function taskId(reply: CallIndexReply): string {
  const value = data(reply).taskId
  if (typeof value !== 'string') throw Error('expected task id')
  return value
}
function fixture() {
  const session = Session.create(SessionId('a'))
  const events: SessionEvent[] = []
  const add = () => {
    const id = ToolCallId(`c${events.length}`)
    events.push(session.append('tool/call', { turn: 1, step: 1, callId: id, name: 'echo', arguments: 'PRIVATE_ARGS' }))
    events.push(session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: id, isError: false, content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }] }) }, { surfaceOp: 'append' }))
    return events.slice(-2)
  }
  add()
  const close = vi.fn()
  let beforeRead: ((signal?: AbortSignal) => Promise<void>) | undefined
  const snapshot = () => ({ header: session.header, revision: SessionPersistenceRevision(`r${events.length}`), eventCount: events.length })
  const backend: CallIndexBackend = {
    identity: Symbol('backend'), list: vi.fn(async () => [snapshot()]),
    stat: vi.fn(async id => id === session.id ? snapshot() : undefined),
    open: vi.fn(async id => {
      if (id !== session.id) throw Error('not found')
      const end = events.length
      const finish = async () => { close() }
      const handle: SessionHandle = {
        id, header: session.header, inheritedEventCount: SessionLogOffset(0), access: 'read',
        async read(offset = 0, length = end, options) {
          await beforeRead?.(options?.signal)
          options?.signal?.throwIfAborted()
          return { eventState: 'shared-frozen', events: events.slice(offset, Math.min(end, offset + length)) }
        },
        close: finish, [Symbol.asyncDispose]: finish,
        async append() { throw Error('must remain read-only') }, async flush() { throw Error('must remain read-only') },
      }
      return handle
    }),
  }
  return { backend, session, events, add, close, setBeforeRead(callback: typeof beforeRead) { beforeRead = callback } }
}

describe('formal call-index Host runtime', () => {
  it('honours an explicit disabled scope: reachable, but no subscription and no history', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    // D-029 flipped the DEFAULT to host-visible; `disabled` remains the escape
    // hatch and must still fail closed on every entry point.
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'disabled' }, h.options)
    expect(data(runtime.getIndexStatus())).toMatchObject({ scope: { status: 'disabled' }, coverage: 'unknown' })
    expect(runtime.startIndex()).toMatchObject({ ok: false, reason: 'scope-disabled' })
    expect(runtime.listCalls()).toMatchObject({ ok: false, reason: 'scope-disabled' })
    expect(h.listeners.size).toBe(0)
    expect(f.backend.list).not.toHaveBeenCalled()
    await h.dispose()
  })

  it('defaults to host-visible (D-029): no config means indexing is on, but still lazy', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const runtime = installCallIndexRuntime(h.ctx, {}, h.options)
    const status = data(runtime.getIndexStatus())
    expect(status.scope).toMatchObject({ status: 'ready', mode: 'host-visible', scope: 'host-visible' })
    // Ready does NOT mean "scanned": enumeration stays explicit.
    expect(f.backend.list).not.toHaveBeenCalled()
    expect(h.listeners.size).toBe(1)
    // And the schema default must agree with the runtime default.
    expect(CallIndexConfig({}).scope).toBe('host-visible')
    await h.dispose()
  })

  // D-031: the manual 全量索引 / 增量更新 buttons are gone, so indexing must
  // start by itself. These pin the default and the opt-out, and prove the
  // automatic pass really enumerates history rather than only going ready.
  it('auto-indexes on mount by default (D-031): the scan runs without a trigger', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const runtime = installCallIndexRuntime(h.ctx, {}, h.options)
    expect(CallIndexConfig({}).autoIndex).toBe(true)
    expect(CallIndexConfig({}).autoIndexMode).toBe('incremental')
    // The mount schedules the pass; nothing has been enumerated before it fires.
    await vi.waitFor(() => expect(f.backend.list).toHaveBeenCalled(), { timeout: 4000 })
    await runtime.whenIdle()
    expect(f.backend.list).toHaveBeenCalled()
    await h.dispose()
  })

  // A real corpus is bigger than one run's event budget. Before this fix the
  // automatic pass ran ONCE, so a `partial` scan stayed partial forever and the
  // page kept saying "scanning" with a frozen pending count.
  it('keeps scanning until the backlog is drained when one run hits maxEventsPerRun', async () => {
    const h = host(), f = fixture()
    f.add()
    f.add()
    h.services.set('sessionPersistence', f.backend)
    installCallIndexRuntime(h.ctx, { maxEventsPerRun: 2 }, h.options)
    // Each follow-up pass opens the Session again; one pass would call it once.
    await vi.waitFor(() => {
      expect((f.backend.open as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(2)
    }, { timeout: 8000 })
    await h.dispose()
  })
  it('leaves history alone when autoIndex is turned off', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    installCallIndexRuntime(h.ctx, { autoIndex: false }, h.options)
    await new Promise(resolve => setTimeout(resolve, 2000))
    // Opting out must mean nothing is read, not merely "slower to start".
    expect(f.backend.list).not.toHaveBeenCalled()
    await h.dispose()
  })

  it('publishes and unregisters one live listener and timer without scanning history', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    expect(h.listeners.size).toBe(1)
    for (const event of f.events) h.emit(f.session, event)
    expect(h.timers.size).toBe(1)
    h.fire()
    expect(data(runtime.getIndexStatus())).toMatchObject({ totals: { calls: 1 }, pendingLive: 0, coverage: 'partial' })
    expect(data(runtime.listCalls())).toMatchObject({ total: 1 })
    expect(f.backend.list).not.toHaveBeenCalled()
    expect(f.backend.open).not.toHaveBeenCalled()
    await h.dispose()
    expect(h.listeners.size).toBe(0)
    expect(h.timers.size).toBe(0)
    h.fire()
    expect(runtime.getIndexStatus().ok).toBe(false)
  })

  it('starts one asynchronous task, preserves query generation, and rejects wrong cancel IDs', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    const first = runtime.startIndex({ mode: 'full' })
    const id = taskId(first)
    expect(taskId(runtime.startIndex())).toBe(id)
    expect(runtime.cancelIndex({ taskId: 'someone-else' }).ok).toBe(false)
    await runtime.whenIdle()
    expect(data(runtime.getIndexStatus())).toMatchObject({ totals: { calls: 1 }, task: { taskId: id, phase: 'complete' } })
    const calls = data(runtime.listCalls({ limit: 1 }))
    const summary = data(runtime.getSummary({ snapshotId: calls.snapshotId }))
    expect(summary.generation).toBe(calls.generation)
    expect(summary.summary).toEqual(calls.summary)
    expect(JSON.stringify([calls, summary])).not.toMatch(/PRIVATE_ARGS|PRIVATE_OUTPUT|backend|token/)
    await h.dispose()
  })

  it('cancels and closes active reads when the plugin is unloaded', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    f.setBeforeRead(signal => new Promise<void>((_resolve, reject) => {
      entered()
      signal?.addEventListener('abort', () => reject(Error('PRIVATE_ABORT_REASON')), { once: true })
    }))
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    runtime.startIndex()
    await started
    await h.dispose()
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(h.listeners.size).toBe(0)
    expect(runtime.startIndex().ok).toBe(false)
    expect(JSON.stringify(runtime.getIndexStatus())).not.toContain('PRIVATE_ABORT_REASON')
  })

  it('notices scope/backend changes before serving a previously captured view', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const config: CallIndexRuntimeConfig = { scope: 'host-visible' }
    const runtime = installCallIndexRuntime(h.ctx, config, h.options)
    runtime.startIndex(); await runtime.whenIdle()
    const page = data(runtime.listCalls())
    const replacement = fixture()
    h.services.set('sessionPersistence', replacement.backend)
    expect(runtime.listCalls({ snapshotId: page.snapshotId }).ok).toBe(false)
    config.scope = 'disabled'
    expect(data(runtime.getIndexStatus())).toMatchObject({ scope: { status: 'disabled' }, totals: { calls: 0 } })
    expect(h.listeners.size).toBe(0)
    await h.dispose()
  })

  it('rejects invalid control inputs and guards arbitrary detail session IDs', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    expect(runtime.startIndex({ mode: 'anything' }).ok).toBe(false)
    expect(runtime.startIndex({ enabled: true }).ok).toBe(false)
    expect(runtime.cancelIndex({ taskId: 'x', arguments: 'secret' }).ok).toBe(false)
    runtime.startIndex(); await runtime.whenIdle()
    expect((await runtime.getCallDetail({ sessionId: 'unindexed', callSeq: 0 })).ok).toBe(false)
    expect(f.backend.stat).not.toHaveBeenCalledWith('unindexed')
    await h.dispose()
  })

  it('withdraws the runtime service and invalidates retained references when a real Cordis fiber unloads', async () => {
    const ctx = new CordisContext()
    const fiber = ctx.plugin(hostPlugin, { scope: 'disabled' })
    await fiber
    const runtime = ctx.get('callIndexRuntime')
    expect(runtime).toBeDefined()
    expect(data(runtime!.getIndexStatus())).toMatchObject({ scope: { status: 'disabled' } })
    fiber.dispose()
    await runtime!.whenIdle()
    expect(ctx.get('callIndexRuntime')).toBeUndefined()
    expect(runtime!.getIndexStatus()).toMatchObject({ ok: false, reason: 'runtime-unavailable' })
  })

  it('root Host installs once and exposes its gateway even when optional history is absent', async () => {
    const h = host()
    hostPlugin.apply(h.ctx)
    hostPlugin.apply(h.ctx)
    expect(h.services.has('callIndexRuntime')).toBe(true)
    expect(h.plugin).toHaveBeenCalledTimes(1)
    // D-029: the default is host-visible, so one live listener is expected. What
    // must NOT happen is a second install adding another one.
    expect(h.listeners.size).toBe(1)
    await h.dispose()
  })

  it('installs exactly one listener under the default scope, and none when disabled', async () => {
    const live = host()
    hostPlugin.apply(live.ctx)
    expect(live.listeners.size).toBe(1)
    await live.dispose()

    const off = host()
    hostPlugin.apply(off.ctx, { scope: 'disabled' })
    expect(off.listeners.size).toBe(0)
    await off.dispose()
  })

  it('reports source provenance as unknown when the Host has no capability service', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    runtime.startIndex({ mode: 'full' }); await runtime.whenIdle()

    const status = data(runtime.getIndexStatus())
    expect((status.semanticCoverage as Record<string, unknown>).source).toBe('unknown')
    const page = data(runtime.listCalls())
    const items = page.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0].sourceKind).toBe('unknown')
    // A missing catalog must not silently promote itself to "verified".
    expect(page.totalExact).toBe(true)
    const filtered = data(runtime.listCalls({ query: { sourceKind: 'unknown' } }))
    expect((filtered.items as unknown[]).length).toBe(1)
    await h.dispose()
  })

  it('marks source provenance verified and attributes calls from the catalog', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    h.services.set('capability', {
      get: (id: string, kind?: string) => {
        if (kind !== 'tool') return undefined
        if (id === 'echo') return { origin: { provider: 'built-in', serverName: 'built-in' } }
        if (id === 'ops_bash') return { origin: { provider: 'github', serverName: 'github' } }
        return undefined
      },
    })
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    runtime.startIndex({ mode: 'full' }); await runtime.whenIdle()

    const status = data(runtime.getIndexStatus())
    expect((status.semanticCoverage as Record<string, unknown>).source).toBe('verified')
    const items = data(runtime.listCalls()).items as Array<Record<string, unknown>>
    // `built-in` is the reserved pseudo-server for harness-native tools.
    expect(items.map(item => item.sourceKind)).toEqual(['native'])

    const nativeOnly = data(runtime.getSummary({ query: { sourceKind: 'native' } }))
    expect(nativeOnly.total).toBe(1)
    const mcpOnly = data(runtime.getSummary({ query: { sourceKind: 'mcp' } }))
    expect(mcpOnly.total).toBe(0)
    // A concrete-source filter is a LOWER BOUND: the predicate means "really is
    // mcp" while the label only means "resolved to mcp", so a call from a
    // since-removed plugin sits in `unknown` though it really was MCP.
    expect(nativeOnly.totalExact).toBe(false)
    // `unknown` is different: the predicate IS the label, and every row carries
    // exactly one label, so this count is exact by definition. Do not "fix" it
    // to false — that would throw away the only truly exact provenance bucket.
    expect(data(runtime.getSummary({ query: { sourceKind: 'unknown' } })).totalExact).toBe(true)
    // Unfiltered totals are exact once coverage is complete.
    expect(data(runtime.getSummary({})).totalExact).toBe(true)
    await h.dispose()
  })

  it('keeps an unprovable tool at unknown provenance even with a catalog present', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    h.services.set('capability', {
      get: (id: string) => {
        if (id === 'echo') throw new Error('catalog exploded')
        return { origin: { serverName: '' } }
      },
    })
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    runtime.startIndex({ mode: 'full' }); await runtime.whenIdle()

    const items = data(runtime.listCalls()).items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0].sourceKind).toBe('unknown')
    await h.dispose()
  })

  it('exposes overview aggregates next to the summary from one snapshot', async () => {
    const h = host(), f = fixture()
    h.services.set('sessionPersistence', f.backend)
    const runtime = installCallIndexRuntime(h.ctx, { scope: 'host-visible' }, h.options)
    runtime.startIndex({ mode: 'full' }); await runtime.whenIdle()

    const summary = data(runtime.getSummary({ dayOffsetMinutes: 480 }))
    const aggregates = summary.aggregates as Record<string, unknown>
    expect(aggregates.distinctTools).toBe(1)
    expect(aggregates.dayOffsetMinutes).toBe(480)
    expect(aggregates.bySource).toEqual({ mcp: 0, 'plugin-tool': 0, native: 0, skill: 0, unknown: 1 })
    expect((aggregates.byDay as unknown[]).length).toBe(1)
    // Aggregates belong to the same frozen generation as the summary.
    expect(summary.snapshotId).toBeDefined()
    await h.dispose()
  })
})
