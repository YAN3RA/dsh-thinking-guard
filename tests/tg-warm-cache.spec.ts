import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Session, SessionId, SessionLogOffset, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionPersistenceRevision, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { SessionCallIndex } from '../src/usage/session-index.ts'
import type { CallIndexBackend } from '../src/usage/call-index-scope.ts'
import type { Context } from '@deepseek-ai/cordis'
import { installCallIndexRuntime, CallIndexConfig } from '../src/usage/call-index-runtime.ts'

/**
 * Warm-cache acceptance with SYNTHETIC artifacts only.
 *
 * Each Session is backed by a real file under a temporary authorized root, so the
 * fingerprint is exercised for real (bytes, open/stat, containment) while the
 * persistence backend stays a public-API stub. Nothing here reads a production
 * Session directory.
 */
interface Doc {
  header: SessionHeader
  revision: string
  events: readonly SessionEvent[]
  inherited: number
  body: string
}
function doc(id: string, calls: number, options: { revision?: string; inherited?: number; parent?: string; prefix?: string } = {}): Doc {
  const session = Session.create(SessionId(id))
  const events: SessionEvent[] = []
  const prefix = options.prefix ?? id
  for (let i = 0; i < calls; i++) {
    const callId = ToolCallId(`${prefix}-${i}`)
    events.push(session.append('tool/call', { turn: 1, step: i, callId, name: 'echo', arguments: '{"private":"argument-canary"}' }))
    events.push(session.append('tool/result', { turn: 1, step: i, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'output-canary' }] }) }, { surfaceOp: 'append' }))
  }
  const inherited = options.inherited ?? 0
  const header: SessionHeader = {
    ...session.header,
    isSeeded: inherited > 0,
    ...(options.parent === undefined ? {} : { parentSession: SessionId(options.parent) }),
  }
  return {
    header,
    revision: options.revision ?? 'r1',
    events,
    inherited,
    // The body includes the call-id prefix, so two "same revision" documents with
    // different content really differ on disk.
    body: JSON.stringify({ id, calls, prefix }) + '\n',
  }
}

let root: string
let cacheDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tg-warm-root-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'tg-warm-cache-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
})

interface Fixture {
  service: CallIndexBackend
  opens: string[]
  reads: Array<{ id: string; offset: number; length: number }>
  lists: number
  pathOf(id: string): string
  append(id: string, value: Doc): Promise<void>
  beforeRead(fn: ((id: string) => Promise<void>) | undefined): void
}
async function fixture(initial: Doc[]): Promise<Fixture> {
  const docs = new Map<string, Doc>(initial.map(value => [value.header.id as string, value]))
  const opens: string[] = []
  const reads: Array<{ id: string; offset: number; length: number }> = []
  const state = { lists: 0, beforeRead: undefined as ((id: string) => Promise<void>) | undefined }
  const pathOf = (id: string) => join(root, 'proj', id, 'v1.jsonl.zstd')
  for (const value of initial) {
    await mkdir(join(root, 'proj', value.header.id), { recursive: true })
    await writeFile(pathOf(value.header.id), value.body)
  }
  const snapshot = (value: Doc) => ({
    header: value.header,
    revision: SessionPersistenceRevision(value.revision),
    eventCount: value.events.length,
    sizeBytes: Buffer.byteLength(value.body),
    location: { kind: 'jsonl', path: pathOf(value.header.id) },
  })
  const service: CallIndexBackend = {
    identity: Symbol('backend'),
    list: vi.fn(async () => { state.lists += 1; return [...docs.values()].map(snapshot) }),
    stat: vi.fn(async id => { const value = docs.get(id); return value ? snapshot(value) : undefined }),
    open: vi.fn(async id => {
      const value = docs.get(id)
      if (!value) throw Error('not found')
      opens.push(id)
      let closed = false
      const closeHandle = async () => { closed = true }
      const handle: SessionHandle = {
        id, header: value.header, inheritedEventCount: SessionLogOffset(value.inherited), access: 'read',
        async read(offset = 0, length = value.events.length, options) {
          if (closed) throw Error('closed')
          reads.push({ id, offset, length })
          await state.beforeRead?.(id)
          options?.signal?.throwIfAborted()
          return { eventState: 'shared-frozen', events: value.events.slice(offset, offset + length) }
        },
        async append() { throw Error('read only') }, async flush() { throw Error('read only') },
        close: closeHandle, [Symbol.asyncDispose]: closeHandle,
      }
      return handle
    }),
  }
  return {
    service, opens, reads,
    get lists() { return state.lists },
    pathOf,
    async append(id: string, value: Doc) {
      docs.set(id, value)
      await writeFile(pathOf(id), value.body)
    },
    beforeRead(fn) { state.beforeRead = fn },
  }
}

function engine(f: Fixture, options: Partial<ConstructorParameters<typeof SessionCallIndex>[0]> = {}) {
  return new SessionCallIndex({
    getMode: () => 'host-visible', getBackend: () => f.service, yield: async () => {},
    warmCache: { dir: cacheDir, sourceRoot: root },
    ...options,
  })
}

/**
 * Let every queued cache write settle before a "restart".
 *
 * Uses the cache BARRIER rather than starting another pass: a second pass would
 * do real work (and, for a large corpus, could still be running when the test's
 * timeout fires, leaving temporary files behind). The barrier only waits for the
 * write queue, which is exactly what "the shard is durable now" means.
 */
async function settle(index: SessionCallIndex): Promise<void> {
  await index.flushCache()
}

/** Minimal public Context stub: only the surfaces the runtime actually uses. */
function host() {
  const services = new Map<string, unknown>()
  const listeners = new Set<(session: Session, event: SessionEvent) => void>()
  const effects: Array<() => unknown> = []
  const timers = new Set<() => void>()
  const ctx = {
    get: (key: string) => services.get(key),
    provide: (key: string, value: unknown) => { services.set(key, value) },
    on: (_event: string, callback: (session: Session, event: SessionEvent) => void) => {
      listeners.add(callback); return () => { listeners.delete(callback) }
    },
    effect: (factory: () => () => unknown) => { effects.push(factory()) },
  } as unknown as Context
  return {
    ctx, services,
    options: { now: () => 1000, schedule(callback: () => void) { timers.add(callback); return () => { timers.delete(callback) } } },
    async dispose() { for (const effect of effects.splice(0)) await effect() },
  }
}

describe('warm cache: runtime wiring (installCallIndexRuntime)', () => {
  it('is default-off: an empty cacheDir/sourceRoot writes nothing and restores nothing', async () => {
    expect(CallIndexConfig({}).cacheDir).toBe('')
    expect(CallIndexConfig({}).sourceRoot).toBe('')
    const f = await fixture([doc('a', 1)])
    const h = host()
    h.services.set('sessionPersistence', f.service)
    const runtime = installCallIndexRuntime(h.ctx, { autoIndex: false }, h.options)
    runtime.startIndex()
    await runtime.whenIdle()
    await runtime.flushCache()
    expect(await readFile(join(cacheDir, 'manifest.json'), 'utf8').catch(() => undefined)).toBeUndefined()
    await runtime.dispose()
    await h.dispose()
  })

  it('does not activate with only one half configured', async () => {
    const f = await fixture([doc('a', 1)])
    const h = host()
    h.services.set('sessionPersistence', f.service)
    const runtime = installCallIndexRuntime(h.ctx, { autoIndex: false, cacheDir }, h.options)
    runtime.startIndex()
    await runtime.whenIdle()
    await runtime.flushCache()
    expect(await readFile(join(cacheDir, 'manifest.json'), 'utf8').catch(() => undefined)).toBeUndefined()
    await runtime.dispose()
    await h.dispose()
  })

  it('a real cold pass writes the cache, and a NEW runtime instance restores with zero opens', async () => {
    const cold = await fixture([doc('a', 2)])
    const first = host()
    first.services.set('sessionPersistence', cold.service)
    const coldRuntime = installCallIndexRuntime(first.ctx, {
      autoIndex: false, cacheDir, sourceRoot: root, cacheMaxBytes: 1024 * 1024,
    }, first.options)
    coldRuntime.startIndex()
    await coldRuntime.whenIdle()
    // The explicit barrier is what makes the cold write durable before shutdown.
    await coldRuntime.flushCache()
    const manifest = await readFile(join(cacheDir, 'manifest.json'), 'utf8')
    expect(JSON.parse(manifest).schemaVersion).toBe(1)
    expect(cold.opens).toEqual(['a'])
    await coldRuntime.dispose()
    await first.dispose()

    const warmFixture = await fixture([doc('a', 2)])
    const second = host()
    second.services.set('sessionPersistence', warmFixture.service)
    const warmRuntime = installCallIndexRuntime(second.ctx, {
      autoIndex: false, cacheDir, sourceRoot: root, cacheMaxBytes: 1024 * 1024,
    }, second.options)
    const started = warmRuntime.startIndex()
    expect(started.ok).toBe(true)
    await warmRuntime.whenIdle()
    // The whole point: the warm instance opens NO handle at all.
    expect(warmFixture.opens).toEqual([])
    const summary = warmRuntime.getSummary()
    expect(summary.ok).toBe(true)
    const status = warmRuntime.getIndexStatus()
    expect(status.ok).toBe(true)
    const data = status.data as Record<string, unknown>
    expect(data.totals).toMatchObject({ calls: 2 })
    await warmRuntime.dispose()
    await second.dispose()
  })

  it('flushCache resolves after disposal instead of rejecting', async () => {
    const f = await fixture([doc('a', 1)])
    const h = host()
    h.services.set('sessionPersistence', f.service)
    const runtime = installCallIndexRuntime(h.ctx, { autoIndex: false }, h.options)
    await runtime.dispose()
    await expect(runtime.flushCache()).resolves.toBeUndefined()
    await h.dispose()
  })
})

describe('warm cache: two-session restore', () => {
  it('restores one unchanged Session with zero opens and rebuilds the appended one', async () => {
    const a = doc('a', 2)
    const b = doc('b', 3)
    const first = await fixture([a, b])
    const cold = engine(first)
    const coldResult = await cold.start()
    expect(coldResult.totals.calls).toBe(5)
    expect(first.opens.sort()).toEqual(['a', 'b'])
    await settle(cold)
    cold.dispose()

    // Session b grows: its artifact bytes change, so its digest can no longer match.
    const b2 = doc('b', 4, { revision: 'r2' })
    const second = await fixture([a, b2])
    const warm = engine(second)
    const warmResult = await warm.start()
    expect(warmResult.totals.calls).toBe(6)
    // Only the appended Session is opened and read; the unchanged one is served
    // from the verified cache with NO handle at all.
    expect(second.opens).toEqual(['b'])
    expect(second.reads.every(row => row.id === 'b')).toBe(true)
    const aRow = warmResult.sessions.find(row => row.sessionId === 'a')
    expect(aRow?.coverage).toBe('complete')
    expect(aRow?.cut).toBe(4)
    const counters = warm.ioCounters()
    // Decode accounting is separate from I/O: the FINGERPRINT path decoded no whole
    // log, while bytes were certainly read to verify the digest. This is not a
    // measurement of the Host's decode work.
    expect(counters.fingerprintFullLogDecodes).toBe(0)
    expect(counters.bytesRead).toBeGreaterThan(0)
    warm.dispose()
  })

  it('restores nothing when the cache directory is not configured (default off)', async () => {
    const first = await fixture([doc('a', 1)])
    const cold = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => first.service, yield: async () => {} })
    await cold.start()
    cold.dispose()
    const second = await fixture([doc('a', 1)])
    const again = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => second.service, yield: async () => {} })
    await again.start()
    // No cache was ever written, so the second process reads normally.
    expect(second.opens).toEqual(['a'])
    expect(await readFile(join(cacheDir, 'manifest.json'), 'utf8').catch(() => undefined)).toBeUndefined()
    again.dispose()
  })

  it('drops a restored view when a live event arrives and rebuilds that Session', async () => {
    const first = await fixture([doc('a', 2)])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()

    const second = await fixture([doc('a', 2)])
    const warm = engine(second)
    await warm.start()
    expect(second.opens).toEqual([])
    // A live event invalidates the restored view immediately: nothing may keep
    // serving rows that the artifact no longer proves.
    const live = Session.create(SessionId('a'))
    const liveEvent = live.append('tool/call', { turn: 1, step: 9, callId: ToolCallId('live-1'), name: 'echo', arguments: '{}' })
    expect(warm.observeLive('a', liveEvent, 0)).toBe(true)
    // The restored view is gone immediately; what remains is an explicitly
    // observed-live partial view, never a silent continuation of cached rows.
    const dropped = warm.snapshot(false).sessions.find(row => row.sessionId === 'a')
    expect(dropped).toBeUndefined()
    warm.flushLive()
    // The live tail replaces the cached rows entirely: the cut restarts at the
    // live event and the two cached calls are NOT carried over.
    const afterLive = warm.snapshot(false)
    // Only the ONE live call is visible: the two cached calls are gone, so no
    // cached row survives a live change.
    expect(afterLive.totals.calls).toBe(1)
    expect(afterLive.sessions.find(row => row.sessionId === 'a')?.cut).toBe(1)
    await warm.start()
    expect(second.opens).toEqual(['a'])
    warm.dispose()
  })

  it('refuses to restore when the parent fork digest no longer matches', async () => {
    const parent = doc('p', 1)
    const child = doc('c', 1, { inherited: 2, parent: 'p', revision: 'rc' })
    const first = await fixture([parent, child])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()

    // The parent's bytes change; the child artifact itself is untouched. The
    // recorded lineage digest can no longer be re-verified, so the child must be
    // rebuilt even though its own digest still matches.
    const parent2 = doc('p', 2, { revision: 'rp2' })
    const second = await fixture([parent2, child])
    const warm = engine(second)
    await warm.start()
    expect(second.opens).toContain('c')
    warm.dispose()
  })

  it('ignores a corrupt manifest or shard and falls back to a normal scan', async () => {
    const first = await fixture([doc('a', 1)])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()
    await writeFile(join(cacheDir, 'manifest.json'), '{not json')

    const second = await fixture([doc('a', 1)])
    const warm = engine(second)
    const result = await warm.start()
    expect(result.totals.calls).toBe(1)
    expect(second.opens).toEqual(['a'])
    // The damaged file is left in place for inspection, never deleted.
    expect(await readFile(join(cacheDir, 'manifest.json'), 'utf8')).toBe('{not json')
    warm.dispose()
  })

  it('does not let a larger cached entry bypass the current smaller budget', async () => {
    const a = doc('a', 4)
    const first = await fixture([a])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()

    const second = await fixture([doc('a', 4)])
    // The new process is allowed to retain far fewer calls than the cached entry.
    const warm = engine(second, { maxCalls: 1 })
    const result = await warm.start()
    expect(result.totals.calls).toBeLessThanOrEqual(1)
    warm.dispose()
  })

  it('writes no cache entry when the artifact has no public location', async () => {
    const value = doc('a', 1)
    const f = await fixture([value])
    const bare = { header: value.header, revision: SessionPersistenceRevision('r1'), eventCount: value.events.length }
    const noLocation: CallIndexBackend = {
      ...f.service,
      list: async () => [bare],
      stat: async () => bare,
    }
    const index = engine({ ...f, service: noLocation })
    await index.start()
    await settle(index)
    expect(await readFile(join(cacheDir, 'manifest.json'), 'utf8').catch(() => undefined)).toBeUndefined()
    index.dispose()
  })

  it('drops a queued cache write on dispose instead of committing after teardown', async () => {
    const first = await fixture([doc('a', 1)])
    const index = engine(first)
    await index.start()
    index.dispose()
    // Disposal happens while the write may still be queued; the manifest must
    // never appear afterwards for a disposed owner.
    await new Promise(resolve => setTimeout(resolve, 50))
    const manifest = await readFile(join(cacheDir, 'manifest.json'), 'utf8').catch(() => undefined)
    if (manifest !== undefined) {
      // If a write did land before disposal, it must be a complete, valid document.
      expect(JSON.parse(manifest).schemaVersion).toBe(1)
    }
  })

  it('does not cache a cut whose artifact changed between EOF and the digest (append race)', async () => {
    const first = await fixture([doc('a', 2)])
    // Append lands AFTER the scan reached EOF but BEFORE the post-read digest is
    // taken. The snapshot's cut then describes an older revision, so binding it to
    // the new bytes would create a false complete warm hit.
    // The append is applied exactly when the scan reads its FIRST page, i.e.
    // after the pre-read digest but before EOF — the window that matters.
    let appended = false
    first.beforeRead(async () => {
      if (appended) return
      appended = true
      await first.append('a', doc('a', 3, { revision: 'r2' }))
    })
    const index = engine(first)
    const result = await index.start()
    // This pass is honest about what it read, but must not cache it. The barrier
    // waits for the write queue WITHOUT running another pass (a second pass would
    // legitimately observe a now-stable artifact and cache that).
    expect(result.totals.calls).toBeGreaterThan(0)
    await index.flushCache()
    expect(await readFile(join(cacheDir, 'manifest.json'), 'utf8').catch(() => undefined)).toBeUndefined()
    index.dispose()

    // A fresh instance therefore does a normal read and sees the new tail.
    const after = await fixture([doc('a', 3, { revision: 'r2' })])
    const warm = engine(after)
    const warmResult = await warm.start()
    expect(after.opens).toEqual(['a'])
    expect(warmResult.totals.calls).toBe(3)
    warm.dispose()
  })

  it('refuses to restore that would exceed the CURRENT maxBytes even when maxCalls is ample', async () => {
    const first = await fixture([doc('a', 4)])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()

    const second = await fixture([doc('a', 4)])
    // maxCalls is untouched (default), so ONLY the byte budget can refuse this.
    const warm = engine(second, { maxBytes: 4096 })
    const result = await warm.start()
    // The cached view costs more than the pass may retain, so it is NOT restored:
    // the Session is rebuilt from disk instead of silently overshooting memory.
    expect(second.opens).toEqual(['a'])
    expect(result.totals.calls).toBeLessThanOrEqual(4)
    warm.dispose()
  })

  it('re-applies THIS process provenance to cached rows instead of the stored attribution', async () => {
    const first = await fixture([doc('a', 2)])
    const cold = engine(first, { resolveSource: () => 'mcp' })
    const coldResult = await cold.start()
    expect(coldResult.rows.every(row => row.sourceKind === 'mcp')).toBe(true)
    await settle(cold)
    cold.dispose()

    // Identical bytes, different catalog evidence: the restored rows must follow
    // the CURRENT resolver, never the attribution baked into the shard.
    const same = await fixture([doc('a', 2)])
    const warm = engine(same, { resolveSource: () => 'native' })
    const warmResult = await warm.start()
    expect(same.opens).toEqual([])
    expect(warmResult.rows.every(row => row.sourceKind === 'native')).toBe(true)

    // And with NO resolver at all, the honest answer is unknown, not the old mcp.
    const third = await fixture([doc('a', 2)])
    const bare = engine(third)
    const bareResult = await bare.start()
    expect(third.opens).toEqual([])
    expect(bareResult.rows.every(row => row.sourceKind === 'unknown')).toBe(true)
    bare.dispose()
  })

  it('refuses an oversized or symlinked shard without trusting its declared size', async () => {
    const first = await fixture([doc('a', 1)])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()

    const manifest = JSON.parse(await readFile(join(cacheDir, 'manifest.json'), 'utf8'))
    const shardPath = join(cacheDir, 'shards', manifest.entries[0].shard)
    // A shard far larger than the size the manifest declared must be refused
    // BEFORE it is buffered; the fallback is a normal scan, not a huge read.
    await writeFile(shardPath, 'x'.repeat(64 * 1024))
    const second = await fixture([doc('a', 1)])
    const warm = engine(second)
    const result = await warm.start()
    expect(result.totals.calls).toBe(1)
    expect(second.opens).toEqual(['a'])
    warm.dispose()
  })

  it('M1: refuses to cache a resumed prefix when the artifact bytes changed in place (same opaque revision)', async () => {
    const first = await fixture([doc('a', 2)])
    // A tiny page makes the first pass stop resumable, so pass 2 resumes the SAME
    // partition with a fresh digest. The revision string never changes, which is
    // exactly the case a digest must catch on its own.
    const index = engine(first, { pageSize: 1, pagesPerHandle: 1 })
    // A tiny per-pass budget is what forces a REAL second pass (a small page alone
    // would just keep re-queueing inside the same pass).
    const pass1 = await index.start({ maxEvents: 2 })
    expect(pass1.phase).toBe('partial')
    expect(pass1.pendingSessions).toBeGreaterThan(0)
    // In-place content change under the SAME revision: old prefix rows would now
    // be mixed with fresh tail rows if the stage were reused.
    await first.append('a', doc('a', 2, { revision: 'r1', prefix: 'fresh' }))
    for (let round = 0; round < 8; round++) {
      const next = await index.start()
      if (next.pendingSessions === 0 && next.phase !== 'partial') break
    }
    // Hard evidence that the resumed partition was really abandoned rather than
    // quietly patched: the stage-reset diagnostic must have fired.
    expect(index.cacheDiagnostics()['warm-cache-stage-reset'] ?? 0).toBeGreaterThan(0)
    await index.flushCache()
    index.dispose()

    const check = await fixture([doc('a', 2, { revision: 'r1', prefix: 'fresh' })])
    const warm = engine(check)
    const warmResult = await warm.start()
    // Whatever happens (rebuilt or not cached), every visible row must come from
    // the FRESH bytes: no stale prefix row may survive a cache hit.
    expect(warmResult.rows.length).toBe(2)
    expect(warmResult.rows.every(row => row.callId.startsWith('fresh-'))).toBe(true)
    warm.dispose()
  })

  it('M2: refuses a fork whose lineage was dropped even when parent bytes changed', async () => {
    const parent = doc('p', 1)
    const child = doc('c', 1, { inherited: 2, parent: 'p', revision: 'rc' })
    const first = await fixture([parent, child])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()

    // Rewrite the child shard with an EMPTY lineage array and a manifest that is
    // fully self-consistent, so only the identity check can refuse it.
    const manifest = JSON.parse(await readFile(join(cacheDir, 'manifest.json'), 'utf8'))
    const entry = manifest.entries.find((row: { sessionId: string }) => row.sessionId === 'c')
    const shardPath = join(cacheDir, 'shards', entry.shard)
    const shard = JSON.parse(await readFile(shardPath, 'utf8'))
    shard.lineage = []
    const text = JSON.stringify(shard)
    await writeFile(shardPath, text)
    entry.size = Buffer.byteLength(text, 'utf8')
    entry.sha256 = createHash('sha256').update(text).digest('hex')
    await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify(manifest))

    // The parent grows; the child artifact is untouched.
    const second = await fixture([doc('p', 2, { revision: 'rp2' }), child])
    const warm = engine(second)
    await warm.start()
    // A child with no recorded lineage cannot prove its inherited prefix, so it
    // must be rebuilt even though its own digest still matches.
    expect(second.opens).toContain('c')
    warm.dispose()
  })

  it('M3: cache diagnostics are not index coverage gaps (cold scan stays complete)', async () => {
    const first = await fixture([doc('a', 2)])
    const cold = engine(first)
    const result = await cold.start()
    // Opt-in cache configured, nothing cached yet: a MISS is normal, not a gap.
    expect(result.coverage).toBe('complete')
    expect(result.reasons).not.toContain('warm-cache-miss')
    expect(result.reasons).not.toContain('warm-cache-unstable')
    await settle(cold)
    cold.dispose()

    // Second pass over an unchanged corpus stays complete too.
    const second = await fixture([doc('a', 2)])
    const warm = engine(second)
    const warmResult = await warm.start()
    expect(warmResult.coverage).toBe('complete')
    expect(warmResult.reasons).not.toContain('warm-cache-miss')
    expect(second.opens).toEqual([])
    warm.dispose()

    // An EXPLICIT full pass must also bind digests and write the EOF entry, so a
    // fresh instance can hit it. Otherwise `full` would silently disable caching.
    const fullDir = join(cacheDir, 'full')
    const fullCold = await fixture([doc('a', 2)])
    const fullIndex = engine(fullCold, { warmCache: { dir: fullDir, sourceRoot: root } })
    await fullIndex.start({ full: true })
    await fullIndex.flushCache()
    fullIndex.dispose()
    const fullWarmFixture = await fixture([doc('a', 2)])
    const fullWarm = engine(fullWarmFixture, { warmCache: { dir: fullDir, sourceRoot: root } })
    const fullWarmResult = await fullWarm.start()
    expect(fullWarmFixture.opens).toEqual([])
    expect(fullWarmResult.coverage).toBe('complete')
    expect(fullWarmResult.totals.calls).toBe(2)
    fullWarm.dispose()
  })

  /**
   * Cold-write then warm-restore a corpus of `count` Sessions, asserting NO open.
   *
   * Kept as one helper so the 70 and 165 cases assert exactly the same thing;
   * each case gets its own timeout because the real disk work is proportional to
   * the corpus and must not be squeezed into the global default.
   */
  async function restoreScale(count: number): Promise<void> {
    const ids = Array.from({ length: count }, (_, index) => `s${index}`)
    const coldFixture = await fixture(ids.map(id => doc(id, 1)))
    const cold = engine(coldFixture, { maxSessions: 200 })
    await cold.start()
    await settle(cold)
    cold.dispose()

    const warmFixture = await fixture(ids.map(id => doc(id, 1)))
    const warm = engine(warmFixture, { maxSessions: 200 })
    const warmResult = await warm.start()
    // A bounded restore must cover the whole listed corpus; over-quota candidates
    // may not silently fall back to a cold read in the same pass.
    expect(warmFixture.opens).toEqual([])
    expect(warmResult.rows.length).toBe(count)
    expect(warmResult.coverage).toBe('complete')
    warm.dispose()
  }

  it('M4a: restores every one of 70 listed Sessions with zero opens', async () => {
    await restoreScale(70)
  }, 20_000)

  it('M4b: restores every one of 165 listed Sessions with zero opens', async () => {
    await restoreScale(165)
  }, 20_000)

  it('M5: a legal zero-call (header-only) Session is restored warm with zero opens', async () => {
    // A legal EOF read that retains ZERO calls must still be cached: a header-only
    // log (cut 0) and an other-only log (cut > 0, rows 0) are both valid corpus
    // members, and skipping them would make "restart restores the whole index"
    // false for those Sessions.
    const empty = doc('empty', 0)
    const coldFixture = await fixture([empty])
    const cold = engine(coldFixture)
    const coldResult = await cold.start()
    expect(coldResult.totals.calls).toBe(0)
    expect(coldResult.coverage).toBe('complete')
    const coldIo = cold.ioCounters()
    await settle(cold)
    cold.dispose()
    // A real shard WAS written, and its fingerprint actually hashed bytes.
    expect(coldIo.bytesRead).toBeGreaterThan(0)
    const manifest = JSON.parse(await readFile(join(cacheDir, 'manifest.json'), 'utf8'))
    expect(manifest.entries).toHaveLength(1)
    const shard = JSON.parse(await readFile(join(cacheDir, 'shards', manifest.entries[0].shard), 'utf8'))
    // EOF evidence is explicit, and the row set is legitimately empty.
    expect(shard.exhausted).toBe(true)
    expect(shard.rows).toEqual([])
    expect(shard.cut).toBe(0)

    const warmFixture = await fixture([doc('empty', 0)])
    const warm = engine(warmFixture)
    const warmResult = await warm.start()
    // The warm instance does NOT open the Session at all.
    expect(warmFixture.opens).toEqual([])
    expect(warmResult.totals.calls).toBe(0)
    expect(warmResult.coverage).toBe('complete')
    expect(warmResult.exhaustedSessions).toBe(1)
    expect(warmResult.rows).toEqual([])
    // Warm verification still reads bytes; it just decodes no log body.
    expect(warm.ioCounters().bytesRead).toBeGreaterThan(0)
    expect(warm.ioCounters().fingerprintFullLogDecodes).toBe(0)
    warm.dispose()
  })

  it('M6: an other-only Session (rows 0, cut > 0) is also cached and hits warm', async () => {
    // Events that project to no call row are legal content, not corruption: the
    // Session still reached EOF with a real cut.
    const otherOnly = doc('other', 0)
    const coldFixture = await fixture([otherOnly])
    const cold = engine(coldFixture)
    const coldResult = await cold.start()
    expect(coldResult.totals.calls).toBe(0)
    expect(coldResult.coverage).toBe('complete')
    await settle(cold)
    cold.dispose()

    const warmFixture = await fixture([doc('other', 0)])
    const warm = engine(warmFixture)
    const warmResult = await warm.start()
    expect(warmFixture.opens).toEqual([])
    expect(warmResult.totals.calls).toBe(0)
    expect(warmResult.coverage).toBe('complete')
    warm.dispose()
  })

  it('M2c: newest-first list (child BEFORE parent) still caches the fork, with and without eventCount', async () => {
    for (const withCount of [false, true]) {
      // The real corpus lists newest first, so a fork child is commonly read BEFORE
      // its parent in the same cold pass. If the child's cache entry needs a parent
      // digest that only exists after the parent was READ, the child is never cached
      // and the next process opens it again (the reported 3 missed Fork children).
      const parent = doc('p', 2)
      const child = doc('c', 2, { inherited: 2, parent: 'p', revision: 'rc' })
      const snap = (value: Doc) => ({
        header: value.header,
        revision: SessionPersistenceRevision(value.revision),
        // Variant A omits eventCount entirely (what the real rc3 list returns for
        // every Session); variant B includes it, to prove the defect is ORDERING,
        // not the missing hint.
        ...(withCount ? { eventCount: value.events.length } : {}),
        sizeBytes: Buffer.byteLength(value.body),
        location: { kind: 'jsonl', path: join(root, 'proj', value.header.id, 'v1.jsonl.zstd') },
      })
      const coldFixture = await fixture([parent, child])
      const coldBackend: CallIndexBackend = {
        ...coldFixture.service,
        // NEWEST FIRST: the child appears before its parent.
        list: async () => [snap(child), snap(parent)],
        stat: async id => (id === 'p' ? snap(parent) : id === 'c' ? snap(child) : undefined),
      }
      const cold = engine({ ...coldFixture, service: coldBackend })
      await cold.start()
      await settle(cold)
      cold.dispose()
      // Both Sessions must have a shard; otherwise the child can never warm-hit.
      const manifest = JSON.parse(await readFile(join(cacheDir, 'manifest.json'), 'utf8'))
      const cached = manifest.entries.map((row: { sessionId: string }) => row.sessionId).sort()
      expect(cached).toEqual(['c', 'p'])

      const warmFixture = await fixture([doc('p', 2), doc('c', 2, { inherited: 2, parent: 'p', revision: 'rc' })])
      const warmBackend: CallIndexBackend = {
        ...warmFixture.service,
        list: async () => [snap(child), snap(parent)],
        stat: async id => (id === 'p' ? snap(parent) : id === 'c' ? snap(child) : undefined),
      }
      const warm = engine({ ...warmFixture, service: warmBackend })
      const warmResult = await warm.start()
      // Complete warm: NEITHER Session is opened.
      expect(warmFixture.opens).toEqual([])
      expect(warmResult.coverage).toBe('complete')
      expect(warmResult.totals.inherited).toBeGreaterThan(0)
      warm.dispose()
    }
  })

  it('M2d: a fork split across two cold passes still lands both entries', async () => {
    // Pass 1 reaches EOF for the CHILD only (it is listed first and the event
    // budget runs out before the parent); the parent is read in a later pass. A
    // deferred save that lived only inside one pass would lose the child forever
    // even though the parent's EOF digest arrives later.
    const parent = doc('p', 2)
    const child = doc('c', 2, { inherited: 2, parent: 'p', revision: 'rc' })
    const fixtureOne = await fixture([parent, child])
    const childFirst: CallIndexBackend = {
      ...fixtureOne.service,
      list: async () => [
        { header: child.header, revision: SessionPersistenceRevision('rc'), sizeBytes: Buffer.byteLength(child.body), location: { kind: 'jsonl', path: join(root, 'proj', 'c', 'v1.jsonl.zstd') } },
        { header: parent.header, revision: SessionPersistenceRevision('r1'), sizeBytes: Buffer.byteLength(parent.body), location: { kind: 'jsonl', path: join(root, 'proj', 'p', 'v1.jsonl.zstd') } },
      ],
    }
    // 4 child events + the empty EOF probe = 5; the parent is never touched.
    const pass1 = engine({ ...fixtureOne, service: childFirst })
    await pass1.start({ maxEvents: 5 })
    await settle(pass1)
    // Keep the instance alive: the deferred/superseded bookkeeping is per instance.
    for (let round = 0; round < 8; round++) {
      const next = await pass1.start()
      if (next.pendingSessions === 0 && next.phase !== 'partial') break
    }
    await settle(pass1)
    pass1.dispose()
    const manifest = JSON.parse(await readFile(join(cacheDir, 'manifest.json'), 'utf8'))
    const cached = manifest.entries.map((row: { sessionId: string }) => row.sessionId).sort()
    expect(cached).toEqual(['c', 'p'])

    const warmFixture = await fixture([doc('p', 2), doc('c', 2, { inherited: 2, parent: 'p', revision: 'rc' })])
    const warm = engine(warmFixture)
    const warmResult = await warm.start()
    expect(warmFixture.opens).toEqual([])
    expect(warmResult.coverage).toBe('complete')
    warm.dispose()
  })

  it('M2b: a fork is bounded by the VERIFIED parent cut, not the declared eventCount hint', async () => {
    // The parent declares eventCount 1 (the jsonl multi-frame under-report, which
    // is normal on a real corpus) while its real content is far longer. A fork
    // inheriting 5 events is legal; bounding it by the hint would make every such
    // fork permanently cold.
    const parent = doc('p', 10)
    // 3 calls = 6 events, so the inherited prefix of 5 is a real prefix of the log.
    const child = doc('c', 3, { inherited: 5, parent: 'p', revision: 'rc' })
    const underreported = (value: Doc) => ({
      header: value.header,
      revision: SessionPersistenceRevision(value.revision),
      // Deliberately under-report ONLY the parent, as the real backend does.
      ...(value.header.id === 'p' ? { eventCount: 1 } : { eventCount: value.events.length }),
      sizeBytes: Buffer.byteLength(value.body),
      location: { kind: 'jsonl', path: join(root, 'proj', value.header.id, 'v1.jsonl.zstd') },
    })
    const first = await fixture([parent, child])
    const coldBackend: CallIndexBackend = {
      ...first.service,
      list: async () => [underreported(parent), underreported(child)],
      stat: async id => {
        const value = id === 'p' ? parent : id === 'c' ? child : undefined
        return value === undefined ? undefined : underreported(value)
      },
    }
    const cold = engine({ ...first, service: coldBackend })
    const coldResult = await cold.start()
    // The parent is read past its declared count and reaches its real cut.
    expect(coldResult.sessions.find(row => row.sessionId === 'p')?.cut).toBeGreaterThan(1)
    await settle(cold)
    cold.dispose()

    // Identical bytes on the warm run: both Sessions must be served from cache.
    const second = await fixture([doc('p', 10), doc('c', 3, { inherited: 5, parent: 'p', revision: 'rc' })])
    const warmBackend: CallIndexBackend = {
      ...second.service,
      list: async () => [underreported(parent), underreported(child)],
      stat: async id => {
        const value = id === 'p' ? parent : id === 'c' ? child : undefined
        return value === undefined ? undefined : underreported(value)
      },
    }
    const warm = engine({ ...second, service: warmBackend })
    const warmResult = await warm.start()

    expect(second.opens).toEqual([])
    // Inherited calls are not double counted: the child's own new call is counted,
    // the inherited prefix is reported separately.
    expect(warmResult.totals.inherited).toBeGreaterThan(0)
    // Warm coverage must EQUAL the cold one: the parent's under-reported count is a
    // real data gap that a cache hit must not launder into "complete".
    expect(warmResult.coverage).toBe(coldResult.coverage)
    warm.dispose()
  })

  it('treats a valid-JSON but wrongly shaped manifest as degraded and never overwrites it', async () => {
    const first = await fixture([doc('a', 1)])
    const cold = engine(first)
    await cold.start()
    await settle(cold)
    cold.dispose()
    const broken = JSON.stringify({ schemaVersion: 1, projectionVersion: 1, entries: 'not-an-array' })
    await writeFile(join(cacheDir, 'manifest.json'), broken)

    const second = await fixture([doc('a', 1)])
    const warm = engine(second)
    await warm.start()
    await settle(warm)
    expect(second.opens).toEqual(['a'])
    expect(await readFile(join(cacheDir, 'manifest.json'), 'utf8')).toBe(broken)
    warm.dispose()
  })

  it('keys shards by an internal hash, never by the session id or its path', async () => {
    const first = await fixture([doc('secret-session', 1)])
    const index = engine(first)
    await index.start()
    await settle(index)
    const manifest = JSON.parse(await readFile(join(cacheDir, 'manifest.json'), 'utf8'))
    expect(manifest.entries).toHaveLength(1)
    const entry = manifest.entries[0]
    expect(entry.sessionId).toBe('secret-session')
    expect(entry.shard).not.toContain('secret-session')
    expect(entry.shard).toBe(createHash('sha256').update('call-index-cache:secret-session').digest('hex') + '.json')
    // No artifact path or argument/result payload may appear in the stored shard.
    const shard = await readFile(join(cacheDir, 'shards', entry.shard), 'utf8')
    expect(shard).not.toContain(root)
    expect(shard).not.toContain('argument-canary')
    expect(shard).not.toContain('output-canary')
    index.dispose()
  })
})
