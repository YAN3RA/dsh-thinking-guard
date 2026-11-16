// @vitest-environment jsdom
/**
 * TG-18 / TG-11 (20 pages): the mounted 调用明细 container must re-fill its
 * appended pages after a data-generation change, and a failed page must never
 * splice the previous generation's rows into the table.
 *
 * Why a mounted case (react-dom + jsdom) and not a helper assertion: the pure
 * helpers (`mergeRefreshedPage`, `callIndexAppendedAfterRefresh`) already have
 * their own cases. What had NO mounted coverage is the container wiring — the
 * `appendedPages` / `lastSnapshotId` refs, the 2s status-only poll that fires
 * exactly ONE full re-read when a scan finishes, and the auto-fill effect that
 * rebuilds the depth afterwards. A helper-only test cannot fail when that
 * wiring breaks, so every assertion below reads the rendered DOM (the tool
 * table under `[data-call-index-table="tools"]`), never a helper's return value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  MAX_AUTO_PAGES,
  CallIndexDetailPanel,
  type CallIndexPanelApi,
  type CallIndexPanelResult,
} from '../src/client/call-index.tsx'
import {
  type CallIndexCallPageView,
  type CallIndexCallRow,
  type CallIndexOverviewView,
  type CallIndexSessionPageView,
  type CallIndexStatusView,
} from '../src/client/call-index-adapter.ts'

// React only batches under `act` when told it is in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEMANTIC = { source: 'verified', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' } as const

const ZERO_SUMMARY = { total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 }

function statusView(overrides: Partial<CallIndexStatusView> = {}): CallIndexStatusView {
  return {
    scope: { status: 'ready', mode: 'host-visible', includesOtherProfiles: true, epoch: 3 },
    generation: 7,
    censusGeneration: 4,
    phase: 'idle',
    coverage: 'complete',
    eventCoverage: 'complete',
    enumerationCoverage: 'complete',
    semanticCoverage: SEMANTIC,
    sessions: { listed: 6, visible: 5, completed: 5, pending: 0, failed: 0, pendingLive: 0 },
    estimatedBytes: 4096,
    reasons: [],
    totals: { calls: 0, succeeded: 0, failed: 0, unresolved: 0, unknown: 0, cancelled: 0, running: 0, inherited: 0 },
    corpus: 'persisted-plus-observed-live',
    ...overrides,
  }
}

/**
 * One call row whose TOOL NAME carries the generation prefix and its global
 * index, so the painted DOM alone says which page and which snapshot a row came
 * from (`a-tool-0007` vs `b-tool-1049`).
 */
function row(prefix: string, index: number): CallIndexCallRow {
  return {
    sessionId: 'sess-' + prefix,
    callSeq: index,
    callId: prefix + '-call-' + index,
    toolName: prefix + '-tool-' + String(index).padStart(4, '0'),
    startedAt: Date.UTC(2026, 10, 10, 2, 0) + index * 1000,
    endedAt: Date.UTC(2026, 10, 10, 2, 0) + index * 1000 + 800,
    durationMs: 800,
    outcome: 'success',
    inherited: false,
    sourceKind: 'native',
    layer: 'built-in',
    turn: 1,
    step: index,
    resultSeq: index,
  }
}

function pageView(overrides: Partial<CallIndexCallPageView> = {}): CallIndexCallPageView {
  return {
    snapshotId: 'snap-1',
    generation: 7,
    coverage: 'complete',
    corpus: 'persisted-plus-observed-live',
    totalExact: true,
    semanticCoverage: SEMANTIC,
    summary: ZERO_SUMMARY,
    total: 0,
    items: [],
    droppedItems: 0,
    ...overrides,
  }
}

function sessionPage(): CallIndexSessionPageView {
  return {
    snapshotId: 'snap-1',
    generation: 7,
    coverage: 'complete',
    corpus: 'persisted-plus-observed-live',
    totalExact: true,
    summary: ZERO_SUMMARY,
    total: 0,
    items: [],
    droppedItems: 0,
  }
}

function overviewView(): CallIndexOverviewView {
  return {
    snapshotId: 'snap-1',
    generation: 7,
    coverage: 'complete',
    corpus: 'persisted-plus-observed-live',
    totalExact: true,
    semanticCoverage: SEMANTIC,
    summary: ZERO_SUMMARY,
    total: 0,
  }
}

function ok<T>(value: T): CallIndexPanelResult<T> {
  return { ok: true, value }
}

/** A non-cursor-stale business failure: it must be shown, not swallowed. */
function failedRead(): CallIndexPanelResult<CallIndexCallPageView> {
  return { ok: false, code: 'internal-error', messageKey: 'callIndex.error.internal', retryable: true, disconnected: false }
}

// ---------------------------------------------------------------------------
// A two-generation corpus with real cursors
// ---------------------------------------------------------------------------

interface Generation {
  readonly snapshotId: string
  /** `pages[0]` is the first page; page i is addressed by cursor `p<i>`. */
  readonly pages: readonly (readonly CallIndexCallRow[])[]
}

function generation(prefix: string, snapshotId: string, pageCount: number, pageSize = 50): Generation {
  const pages: (readonly CallIndexCallRow[])[] = []
  let index = 0
  for (let page = 0; page < pageCount; page += 1) {
    const chunk: CallIndexCallRow[] = []
    for (let item = 0; item < pageSize; item += 1) {
      index += 1
      chunk.push(row(prefix, index))
    }
    pages.push(chunk)
  }
  return { snapshotId, pages }
}

function cursorFor(pageIndex: number): string | undefined {
  return pageIndex === 0 ? undefined : 'p' + pageIndex
}

function pageIndexFor(cursor: string | undefined): number {
  return cursor === undefined ? 0 : Number(cursor.slice(1))
}

/**
 * The fake Host. It resolves the CURRENT generation synchronously at call time
 * (like a real Host answering a filtered read) and remembers every read so a
 * test can assert which snapshot and which cursor each page came from.
 */
class Scenario {
  active: Generation
  alternate: Generation
  status: CallIndexStatusView
  /** Read failures, addressed by snapshot + cursor (`undefined` = first page). */
  readonly failures = new Set<string>()
  readonly reads: { snapshotId: string; cursor: string | undefined }[] = []
  /** Called before answering, so a test can defer or rewrite a reply. */
  onRead?: (snapshotId: string, cursor: string | undefined) => CallIndexPanelResult<CallIndexCallPageView> | undefined

  constructor(active: Generation, alternate: Generation, status: CallIndexStatusView) {
    this.active = active
    this.alternate = alternate
    this.status = status
  }

  failureKey(snapshotId: string, cursor: string | undefined): string {
    return snapshotId + '|' + (cursor ?? 'first')
  }

  fail(snapshotId: string, cursor: string | undefined): void {
    this.failures.add(this.failureKey(snapshotId, cursor))
  }

  page(snapshotId: string, cursor: string | undefined): CallIndexPanelResult<CallIndexCallPageView> {
    const target = snapshotId === this.alternate.snapshotId ? this.alternate : this.active
    const pageIndex = pageIndexFor(cursor)
    const items = target.pages[pageIndex]
    if (items === undefined) return failedRead()
    const total = target.pages.reduce((sum, page) => sum + page.length, 0)
    const nextCursor = pageIndex + 1 < target.pages.length ? cursorFor(pageIndex + 1) : undefined
    return ok(pageView({
      snapshotId: target.snapshotId,
      summary: { ...ZERO_SUMMARY, total, success: total },
      total,
      items: [...items],
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }))
  }

  api(overrides: Partial<CallIndexPanelApi> = {}): CallIndexPanelApi {
    return {
      getStatus: async () => ok(this.status),
      getOverview: async () => ok(overviewView()),
      listCalls: async (_query, cursor) => {
        const snapshotId = this.active.snapshotId
        this.reads.push({ snapshotId, cursor })
        const custom = this.onRead?.(snapshotId, cursor)
        if (custom !== undefined) return custom
        if (this.failures.has(this.failureKey(snapshotId, cursor))) return failedRead()
        return this.page(snapshotId, cursor)
      },
      listSessions: async () => ok(sessionPage()),
      getDetail: async () => ({ ok: false, code: 'internal-error', messageKey: 'callIndex.error.internal', retryable: true, disconnected: false }),
      ...overrides,
    }
  }
}

// ---------------------------------------------------------------------------
// Mount + bounded flush
// ---------------------------------------------------------------------------

let root: Root | undefined
let host: HTMLDivElement | undefined

/**
 * Test epoch. Bumped in `afterEach`, which is what keeps a test that ran out of
 * its time budget from reaching into the NEXT test.
 *
 * When a case times out, its `flushUntil` loop and its in-flight read promises
 * are still alive: they keep resolving on microtasks. Two loops calling React's
 * `act` at the same time are not safe — the stale one can flush the fresh test's
 * render and leave it painting zero rows, which is exactly how a timeout in one
 * case showed up as a bogus failure in the next. Every loop below captures the
 * epoch it started in and stands down the moment it changes.
 */
let epoch = 0

/**
 * Serialised `act`.
 *
 * React 18 does not support overlapping `act()` calls: when one is still in
 * flight, the next one does not flush the work queue, so the component that was
 * just rendered never commits and the tree stays EMPTY. That is the actual
 * pollution behind "the case after a timeout painted 0 rows" — the abandoned
 * case was still inside `act` when the next case mounted.
 *
 * Every `act` in this file therefore goes through this queue, so a late call
 * from an abandoned case is simply ordered BEFORE the next case's mount instead
 * of overlapping it. `afterEach` drains the queue, so the next case starts clean.
 */
let actQueue: Promise<unknown> = Promise.resolve()

function serialAct(scope: () => Promise<void>): Promise<void> {
  const run = actQueue.then(() => act(scope))
  // Keep the chain alive whichever way this link settled.
  actQueue = run.then(() => undefined, () => undefined)
  return run as Promise<void>
}

/**
 * Microtask flush that STOPS as soon as `until` holds. Bounded `maxTicks` so a
 * regression fails the assertion instead of hanging or busy-waiting, and abandoned
 * as soon as the test epoch moves on.
 */
async function flushUntil(until: () => boolean, maxTicks = 600): Promise<void> {
  const startedIn = epoch
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (epoch !== startedIn) return
    if (until()) return
    await serialAct(async () => { await Promise.resolve() })
  }
}

async function advance(ms: number): Promise<void> {
  const startedIn = epoch
  await serialAct(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    // Let everything the timers kicked off reach a steady state INSIDE this
    // act(): otherwise those updates land during the next test's render.
    for (let tick = 0; tick < 32; tick += 1) await Promise.resolve()
  })
  if (epoch !== startedIn) return
}

async function mount(api: CallIndexPanelApi, extra: Record<string, unknown> = {}): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await serialAct(async () => {
    root!.render(createElement(CallIndexDetailPanel, { api, initialQuery: { scope: 'all' }, ...extra } as never))
  })
  return host
}

/** Tool names currently painted in the table, in DOM order. */
function paintedTools(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('[data-call-index-table="tools"] tbody tr'))
    .map(node => node.getAttribute('data-call-index-tool') ?? '')
}

function failureNotes(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('[data-call-index-note="more-failure"]')).map(node => node.textContent ?? '')
}

afterEach(async () => {
  // 1. Stand down every loop belonging to the case that just finished, so a
  //    timed-out case cannot flush the next case's render.
  epoch += 1
  // 2. Drop pending timers while the fake clock is still installed, then go back
  //    to the real clock; leaving either half-done leaks a tick into the next case.
  vi.clearAllTimers()
  vi.useRealTimers()
  // 3. Unmount inside try/finally: a case that already tore down must not leave
  //    the shared root/host variables (or the document) behind for the next one.
  const current = root
  root = undefined
  try {
    if (current !== undefined) await serialAct(async () => { current.unmount() })
  } finally {
    // 4. Drain whatever the finished case still had in flight. It now resolves
    //    against an unmounted root, which is a no-op — the state it wanted to
    //    paint is discarded instead of landing in the next case's tree.
    await serialAct(async () => {
      for (let tick = 0; tick < 32; tick += 1) await Promise.resolve()
    })
    host?.remove()
    host = undefined
    document.body.innerHTML = ''
    // 5. Let the queue settle so the NEXT case's first serialAct starts on an
    //    idle chain, not behind work that can no longer paint anything.
    await actQueue
  }
})

// ---------------------------------------------------------------------------
// 1. Small sample first: two pages of one snapshot, reference row far down
// ---------------------------------------------------------------------------

describe('20-page paging (mounted): sample', () => {
  it('paints page 1 and its cursor page, including a row from the bottom of the table', async () => {
    const scenario = new Scenario(
      generation('a', 'snap-A', 2),
      generation('b', 'snap-B', 1),
      statusView({ phase: 'running', auto: { state: 'running', round: 1 } }),
    )
    const el = await mount(scenario.api())
    await flushUntil(() => paintedTools(el).length === 100)
    const painted = paintedTools(el)
    expect(painted).toHaveLength(100)
    expect(painted[0]).toBe('a-tool-0001')
    // The cursor page really landed at the BOTTOM: first paint is page one, and
    // the reference row is only reachable after the append.
    expect(painted).toContain('a-tool-0100')
  })
})

// ---------------------------------------------------------------------------
// 2. The 20-page contract: 1050 calls / 21 pages, rebuilt on a new generation
// ---------------------------------------------------------------------------

describe('TG-18 (mounted): 20 appended pages, rebuilt after a generation change', () => {
  // Heavy case: 21 pages x 2 generations of real React renders. Under a
  // parallel full-suite run this legitimately needs more than the 5s default,
  // so the budget is raised HERE, on this case only — never globally.
  it('fills 21 pages (1050 calls), then re-fills all 21 pages from the NEW snapshot', { timeout: 20_000 }, async () => {
    vi.useFakeTimers()
    const scenario = new Scenario(
      generation('a', 'snap-A', MAX_AUTO_PAGES + 1),
      generation('b', 'snap-B', MAX_AUTO_PAGES + 1),
      statusView({ phase: 'running', auto: { state: 'running', round: 1 } }),
    )
    const el = await mount(scenario.api())

    // --- generation A: first page + 20 appended pages -----------------------
    await flushUntil(() => paintedTools(el).length === 1050)
    expect(paintedTools(el)).toHaveLength(1050)
    expect(paintedTools(el).every(name => name.startsWith('a-tool-'))).toBe(true)
    // 1 first-page read + 20 cursor reads, all pinned to A.
    expect(scenario.reads).toHaveLength(21)
    expect(scenario.reads.every(read => read.snapshotId === 'snap-A')).toBe(true)
    expect(scenario.reads.filter(read => read.cursor !== undefined).map(read => read.cursor))
      .toEqual(Array.from({ length: 20 }, (_unused, index) => 'p' + (index + 1)))

    // --- the scan finishes; the 2s status poll crosses the edge ------------
    scenario.active = generation('b', 'snap-B', MAX_AUTO_PAGES + 1)
    scenario.status = statusView({ phase: 'complete', auto: { state: 'stopped', round: 1 } })
    scenario.reads.length = 0
    await advance(2000)

    // The ONE full re-read must land the rebuilt depth by itself — no click.
    await flushUntil(() => paintedTools(el).length === 1050)
    const rebuilt = paintedTools(el)
    expect(rebuilt).toHaveLength(MAX_AUTO_PAGES * 50 + 50)
    // Every painted row is from B, and nothing from A survived the merge.
    expect(rebuilt.every(name => name.startsWith('b-tool-'))).toBe(true)
    // Both ends are B: page one's head and page 21's tail.
    expect(rebuilt[0]).toBe('b-tool-0001')
    expect(rebuilt).toContain('b-tool-0051')
    expect(rebuilt).toContain('b-tool-1050')

    // The cursors used for the re-fill are B's, in order: the refill really
    // re-paged instead of keeping maxed-out A counters.
    const refillCursors = scenario.reads.filter(read => read.cursor !== undefined)
    expect(scenario.reads.every(read => read.snapshotId === 'snap-B')).toBe(true)
    expect(refillCursors).toHaveLength(MAX_AUTO_PAGES)
    expect(refillCursors.map(read => read.cursor))
      .toEqual(Array.from({ length: MAX_AUTO_PAGES }, (_unused, index) => 'p' + (index + 1)))

    // No page ever reported a paging failure, and the honest footer is quiet.
    expect(failureNotes(el)).toHaveLength(0)
    expect(el.querySelector('[data-call-index-note="loading-more"]')).toBeNull()
  })

  // Heavy case: fills 1050 calls before the failing refresh.
  it('keeps the previous generation visible when the new first page FAILS, and never splices A with B', { timeout: 20_000 }, async () => {
    vi.useFakeTimers()
    const scenario = new Scenario(
      generation('a', 'snap-A', MAX_AUTO_PAGES + 1),
      generation('b', 'snap-B', MAX_AUTO_PAGES + 1),
      statusView({ phase: 'running', auto: { state: 'running', round: 1 } }),
    )
    const el = await mount(scenario.api())
    await flushUntil(() => paintedTools(el).length === 1050)
    expect(paintedTools(el)).toHaveLength(1050)

    // New snapshot, but its first page is refused.
    scenario.active = generation('b', 'snap-B', MAX_AUTO_PAGES + 1)
    scenario.fail('snap-B', undefined)
    scenario.status = statusView({ phase: 'complete', auto: { state: 'stopped', round: 1 } })
    scenario.reads.length = 0
    await advance(2000)
    await flushUntil(() => false, 24)

    const after = paintedTools(el)
    // Not a single B row was painted (B delivered none) and no A row was
    // duplicated or partially replaced.
    expect(after).toHaveLength(1050)
    expect(after.every(name => name.startsWith('a-tool-'))).toBe(true)
    expect(new Set(after).size).toBe(1050)
    // The failure is stated instead of being silently swallowed.
    expect(el.querySelector('[data-call-index-state="failure"]')).not.toBeNull()
    // Paging did not march on into the refill: the failed read leaves no cursor
    // to chase, and no page read for B's cursor was attempted.
    expect(scenario.reads.filter(read => read.cursor !== undefined)).toHaveLength(0)
  })

  it('does NOT keep paging the old snapshot after the new first page fails', async () => {
    vi.useFakeTimers()
    // A is only PARTLY paged: page 1 landed, its cursor page failed once. The
    // resulting moreFailure is what stopped auto-fill, so A still carries a live
    // nextCursor when the new generation's first page is refused.
    const scenario = new Scenario(
      generation('a', 'snap-A', 5),
      generation('b', 'snap-B', 5),
      statusView({ phase: 'running', auto: { state: 'running', round: 1 } }),
    )
    scenario.fail('snap-A', 'p1')
    const el = await mount(scenario.api())
    await flushUntil(() => failureNotes(el).length > 0)
    // A page 1 only; the failed append is stated.
    expect(paintedTools(el)).toHaveLength(50)
    expect(paintedTools(el).every(name => name.startsWith('a-tool-'))).toBe(true)

    // The scan finishes, the new snapshot's FIRST page is refused, and the old
    // failure is cleared by the refresh. Read counts from here on are the probe.
    scenario.active = generation('b', 'snap-B', 5)
    scenario.fail('snap-B', undefined)
    scenario.status = statusView({ phase: 'complete', auto: { state: 'stopped', round: 1 } })
    scenario.reads.length = 0
    await advance(2000)
    await flushUntil(() => false, 32)

    // A failure is on screen; the rows that were read stay, and nothing is spliced.
    expect(el.querySelector('[data-call-index-state="failure"]')).not.toBeNull()
    const after = paintedTools(el)
    expect(after).toHaveLength(50)
    expect(after.every(name => name.startsWith('a-tool-'))).toBe(true)
    // The real contract: a failed read is not an invitation to keep walking the
    // PREVIOUS generation's cursors. Auto-fill must stand down while the page is
    // in a failure state, so no cursor read is issued at all.
    expect(scenario.reads.filter(read => read.cursor !== undefined)).toHaveLength(0)
  })

  // Heavy case: fills 1050 calls before the partial-refill failure.
  it('does not splice A into B when a LATER page of the new snapshot fails', { timeout: 20_000 }, async () => {
    vi.useFakeTimers()
    // B has 3 pages so a failure can land on an appended page (2 of 3 delivered).
    const scenario = new Scenario(
      generation('a', 'snap-A', MAX_AUTO_PAGES + 1),
      generation('b', 'snap-B', 3),
      statusView({ phase: 'running', auto: { state: 'running', round: 1 } }),
    )
    const el = await mount(scenario.api())
    await flushUntil(() => paintedTools(el).length === 1050)
    expect(paintedTools(el)).toHaveLength(1050)

    scenario.active = scenario.alternate
    scenario.fail('snap-B', 'p2')
    scenario.status = statusView({ phase: 'complete', auto: { state: 'stopped', round: 1 } })
    await advance(2000)
    await flushUntil(() => failureNotes(el).length > 0)

    const after = paintedTools(el)
    // 21 pages of A were replaced by exactly the B pages that really arrived.
    expect(after).toHaveLength(100)
    expect(after.every(name => name.startsWith('b-tool-'))).toBe(true)
    expect(after).not.toContain('a-tool-0001')
    // The append failed, so the old generation is not mixed in and the failure
    // is said out loud (a silent no-op reads like a broken table).
    expect(el.textContent).not.toContain('a-tool-')
    expect(failureNotes(el)[0]).toContain('加载失败')
  })
})

// ---------------------------------------------------------------------------
// 3. Query switches and late replies
// ---------------------------------------------------------------------------

describe('TG-11 (mounted): query switch safety', () => {
  function pill(el: HTMLElement): HTMLButtonElement {
    const found = Array.from(el.querySelectorAll('.mc-tab-group button'))
      .find(button => (button.textContent ?? '').includes('按会话'))
    expect(found).toBeTruthy()
    return found as HTMLButtonElement
  }

  const catalog = { current: { id: 'sess-bbb', name: 'B' }, items: [{ id: 'sess-bbb', name: 'B' }] }

  it('drops the old query rows before the new read answers, then paints only the new query', async () => {
    let releaseNew: (() => void) | undefined
    const gate = new Promise<void>(resolve => { releaseNew = resolve })
    const scenario = new Scenario(
      generation('a', 'snap-A', 2),
      generation('b', 'snap-B', 1),
      statusView(),
    )
    const api = scenario.api({
      listCalls: async (query, cursor) => {
        if (query.scope !== 'session') return scenario.page('snap-A', cursor)
        // The narrowed read is in flight: nothing about it is known yet.
        await gate
        return scenario.page('snap-B', cursor)
      },
    })
    const el = await mount(api, { resolveScopeTarget: () => ({ sessionId: 'sess-bbb' }), resolveSessionCatalog: () => catalog })
    await flushUntil(() => paintedTools(el).length === 100)
    expect(paintedTools(el).every(name => name.startsWith('a-tool-'))).toBe(true)

    await serialAct(async () => { pill(el).click() })
    await flushUntil(() => false, 12)
    // Still unanswered: A's rows must already be gone (a stale read must not be
    // able to "explain" a switch that has not produced data yet).
    expect(paintedTools(el)).toHaveLength(0)
    expect(el.textContent).not.toContain('a-tool-')

    await serialAct(async () => { releaseNew?.() })
    await flushUntil(() => paintedTools(el).length === 50)
    const after = paintedTools(el)
    expect(after).toHaveLength(50)
    expect(after.every(name => name.startsWith('b-tool-'))).toBe(true)
    expect(el.textContent).not.toContain('a-tool-')
  })

  it('ignores a page read that resolves AFTER the query switched', async () => {
    vi.useFakeTimers()
    let releaseStale: (() => void) | undefined
    const stale = new Promise<void>(resolve => { releaseStale = resolve })
    // Signalled when A's cursor page really starts: the assert below is only
    // meaningful if that read was IN FLIGHT when the query switched.
    let markStarted: (() => void) | undefined
    const staleStarted = new Promise<void>(resolve => { markStarted = resolve })
    let firstCall = true
    const scenario = new Scenario(
      generation('a', 'snap-A', 2),
      generation('b', 'snap-B', 1),
      statusView(),
    )
    const api = scenario.api({
      listCalls: async (query, cursor) => {
        if (query.scope === 'session') return scenario.page('snap-B', cursor)
        // A's cursor page hangs in flight across the switch.
        if (firstCall && cursor === 'p1') {
          firstCall = false
          markStarted?.()
          await stale
          return scenario.page('snap-A', cursor)
        }
        return scenario.page('snap-A', cursor)
      },
    })
    const el = await mount(api, { resolveScopeTarget: () => ({ sessionId: 'sess-bbb' }), resolveSessionCatalog: () => catalog })
    // Page 1 painted while its cursor page is provably already in flight.
    let started = false
    void staleStarted.then(() => { started = true })
    await flushUntil(() => started && paintedTools(el).length === 50)
    expect(started).toBe(true)
    expect(paintedTools(el)).toHaveLength(50)
    expect(releaseStale).toBeTypeOf('function')

    await serialAct(async () => { pill(el).click() })
    await flushUntil(() => paintedTools(el).length === 50 && paintedTools(el)[0]?.startsWith('b-tool-'))
    // Switch over: B's page is up. Now A's late page finally arrives.
    await serialAct(async () => { releaseStale!() })
    await flushUntil(() => false, 24)
    const after = paintedTools(el)
    // The late A page must not be appended on top of the B rows.
    expect(after).toHaveLength(50)
    expect(after.every(name => name.startsWith('b-tool-'))).toBe(true)
    expect(el.textContent).not.toContain('a-tool-')
  })
})
