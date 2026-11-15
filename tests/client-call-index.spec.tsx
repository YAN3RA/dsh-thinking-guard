/**
 * Contract tests for 调用明细 (N24-c) and 总览 (N24-d).
 *
 * Same constraint as `client-plugin-section.spec.tsx`: this package has no DOM
 * harness, so the hook-free `*View` functions are called directly and the
 * returned element tree is walked. Nothing here mounts a component, reads a
 * clock, or needs jsdom.
 *
 * What is asserted is the honesty contract, not layout:
 * - `unknown` reads 来源未解析 and never 未知来源 / 未使用 (R-009: the Host
 *   cannot prove a plugin owner, so the count is a superset of the unresolved);
 * - `totalExact !== true` renders `≥N` (D-028: a partial corpus only proves a
 *   lower bound);
 * - a zero for `plugin-tool` / `skill` carries a placeholder, never "unused";
 * - the corpus and the coverage status are always on screen;
 * - an absent `aggregates` is an explicit missing block, never a zero trend.
 */
import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { RemoteError, type RemoteErrorCode, type RemoteFailure, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

import {
  CALL_INDEX_ERROR_TEXT,
  CALL_INDEX_OUTCOME_LABELS,
  CALL_INDEX_SOURCE_LABELS,
  CALL_INDEX_ZERO_SOURCE_NOTES,
  CallIndexDetailPanelView,
  CallIndexOverviewPanelView,
  callIndexCorpusLabel,
  callIndexDetailState,
  callIndexExactnessNote,
  callIndexFailureText,
  callIndexHasUnexplainedSources,
  callIndexOutcomeMix,
  callIndexOverviewMetrics,
  callIndexRangeLabel,
  callIndexRangeWindow,
  CallIndexDiagnostics,
  callIndexSourceData,
  mergeRefreshedPage,
  callIndexToolRows,
  detailAfterRefresh,
  showsCoverageNotice,
  callIndexTrend,
  buildCallIndexListRequest,
  buildCallIndexQueryFilter,
  buildCallIndexSummaryRequest,
  createCallIndexPanelApi,
  type CallIndexRemoteFace,
  formatCallIndexCount,
  formatCallIndexDuration,
  formatCallIndexTime,
  formatCallIndexTurnStep,
  hasCallIndexFilters,
  normalizeCallIndexQuery,
  shortCallIndexSessionId,
  CALL_INDEX_OVERVIEW_RANGE,
  CALL_INDEX_PAGE_LIMIT,
  CALL_INDEX_RANGES,
  CALL_INDEX_SCOPES,
  CALL_INDEX_SCOPE_LABELS,
  callIndexScanProgress,
  callIndexSessionName,
  scopeQuery,
  scopeHint,
} from '../src/client/call-index.tsx'
import {
  CALL_INDEX_ERROR_MESSAGE_KEYS,
  type CallIndexAggregates,
  type CallIndexCallPageView,
  type CallIndexCallRow,
  type CallIndexOverviewView,
  type CallIndexSessionPageView,
  type CallIndexStatusView,
} from '../src/client/call-index-adapter.ts'
import type { CallIndexStatusView as StatusView } from '../src/client/call-index-adapter.ts'
import { CALL_INDEX_ERROR_REASONS, type CallIndexReply } from '../src/usage/call-index-wire.ts'

interface TreeNode {
  readonly type: unknown
  readonly props: Record<string, unknown>
}

function isElement(value: unknown): value is ReactElement {
  return isValidElement(value)
}

/**
 * Depth-first walk over the element tree, *expanding* nested function
 * components as it goes.
 *
 * The pages compose many small pure views (`CallIndexCallTable`,
 * `CallIndexTrendChart`, `CallIndexDiagnostics`, …). Those are hook-free by
 * design, so calling them here renders the real tree a browser would get. The
 * same technique `client-plugin-section.spec.tsx` uses for `SegmentedTabs`,
 * generalised — otherwise every nested block would be an opaque element and the
 * assertions would pass while proving nothing.
 */
function walk(node: ReactNode, visit: (element: TreeNode) => void): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isElement(node)) return
  const element = node as unknown as TreeNode
  visit(element)
  // Recurse into a hook-free function component's own output.
  if (typeof element.type === 'function' && !(element.type as { __skipExpand?: boolean }).__skipExpand) {
    const rendered = (element.type as (props: unknown) => ReactNode)(element.props)
    walk(rendered, visit)
  }
  walk(element.props.children as ReactNode, visit)
}

/** Inline `<style>` copy is not reader-facing text; it must not pollute matches. */
function isStyleNode(element: TreeNode): boolean {
  return element.type === 'style'
}

/** Every reader-facing string leaf in the tree. */
function texts(node: ReactNode): string[] {
  const out: string[] = []
  walk(node, (element) => {
    if (isStyleNode(element)) return
    const children = element.props.children
    if (typeof children === 'string') out.push(children)
    if (typeof children === 'number') out.push(String(children))
  })
  return out
}

function nodesWith(node: ReactNode, predicate: (element: TreeNode) => boolean): TreeNode[] {
  const out: TreeNode[] = []
  walk(node, (element) => { if (predicate(element)) out.push(element) })
  return out
}

/** Concatenated visible text; convenient for "must contain / must not contain". */
function visible(node: ReactNode): string {
  return texts(node).join('\n')
}

// ---------------------------------------------------------------------------
// Fixtures: shaped like real Host replies, built through the wire contract.
// ---------------------------------------------------------------------------

const TOTALS = { calls: 5, succeeded: 3, failed: 1, unresolved: 1, unknown: 0, cancelled: 0, running: 0, inherited: 1 }

const SEMANTIC = { source: 'verified', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' } as const

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
    totals: TOTALS,
    corpus: 'persisted-plus-observed-live',
    ...overrides,
  }
}

const ROW: CallIndexCallRow = {
  sessionId: 'sess-abcdefghijklmnop',
  callSeq: 4,
  callId: 'call-4',
  toolName: 'bash',
  startedAt: Date.UTC(2026, 10, 10, 2, 30),
  endedAt: Date.UTC(2026, 10, 10, 2, 30, 1, 200),
  durationMs: 1200,
  outcome: 'success',
  inherited: false,
  sourceKind: 'native',
  layer: 'built-in',
  turn: 2,
  step: 3,
  resultSeq: 9,
}

const UNKNOWN_ROW: CallIndexCallRow = {
  ...ROW,
  sessionId: 'sess-2',
  callSeq: 1,
  callId: 'call-5',
  toolName: 'mystery',
  outcome: 'unknown',
  sourceKind: 'unknown',
  layer: 'unknown',
}

function callPage(overrides: Partial<CallIndexCallPageView> = {}): CallIndexCallPageView {
  return {
    snapshotId: 'snap-1',
    generation: 7,
    coverage: 'complete',
    corpus: 'persisted-plus-observed-live',
    totalExact: true,
    semanticCoverage: SEMANTIC,
    summary: { total: 5, success: 3, error: 1, cancelled: 0, unresolved: 1, unknown: 0, running: 0, inherited: 1 },
    total: 5,
    items: [ROW],
    droppedItems: 0,
    ...overrides,
  }
}

function sessionPage(overrides: Partial<CallIndexSessionPageView> = {}): CallIndexSessionPageView {
  return {
    snapshotId: 'snap-1',
    generation: 7,
    coverage: 'complete',
    corpus: 'persisted-plus-observed-live',
    totalExact: true,
    summary: { total: 5, success: 3, error: 1, cancelled: 0, unresolved: 1, unknown: 0, running: 0, inherited: 1 },
    total: 1,
    items: [{ sessionId: 'sess-abcdefghijklmnop', revision: 'r1', cut: 12, coverage: 'complete', stale: false, reasons: [], cwd: 'C:/work/a' }],
    droppedItems: 0,
    ...overrides,
  }
}

const AGGREGATES: CallIndexAggregates = {
  distinctTools: 3,
  bySource: { mcp: 2, 'plugin-tool': 0, native: 3, skill: 0, unknown: 1 },
  byDay: [
    { day: '2026-11-09', calls: 2, success: 2, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0 },
    { day: '2026-11-10', calls: 3, success: 1, error: 1, cancelled: 0, unresolved: 1, unknown: 0, running: 0 },
  ],
  dayOffsetMinutes: 480,
}

function overviewView(overrides: Partial<CallIndexOverviewView> = {}): CallIndexOverviewView {
  return {
    snapshotId: 'snap-1',
    generation: 7,
    coverage: 'complete',
    corpus: 'persisted-plus-observed-live',
    totalExact: true,
    semanticCoverage: SEMANTIC,
    summary: { total: 5, success: 3, error: 1, cancelled: 0, unresolved: 1, unknown: 0, running: 0, inherited: 1 },
    total: 5,
    aggregates: AGGREGATES,
    ...overrides,
  }
}


// ---------------------------------------------------------------------------
// 1. Source labels — the R-009 wording contract
// ---------------------------------------------------------------------------

describe('source wording', () => {
  it('labels unknown as 来源未解析', () => {
    expect(CALL_INDEX_SOURCE_LABELS.unknown).toBe('来源未解析')
  })

  it('never labels a source as unused or as an unknown origin', () => {
    // The forbidden phrasings are the *claims*: "未使用" (asserting absence of
    // use) and "未知来源" (asserting an unknown origin). The placeholder notes
    // may legitimately say "不等于未使用" — that is the negation, not the claim —
    // so only the labels themselves must be free of it.
    const labels = Object.values(CALL_INDEX_SOURCE_LABELS).join('\n')
    expect(labels).not.toContain('未知来源')
    expect(labels).not.toContain('未使用')
    // The notes must affirmatively deny the "unused" reading, not merely omit it.
    expect(CALL_INDEX_ZERO_SOURCE_NOTES['plugin-tool']).toContain('不等于未使用')
    expect(CALL_INDEX_ZERO_SOURCE_NOTES.skill).toContain('不等于未使用')
  })

  it('covers every source kind exactly once', () => {
    expect(Object.keys(CALL_INDEX_SOURCE_LABELS).sort())
      .toEqual(['mcp', 'native', 'plugin-tool', 'skill', 'unknown'])
  })

  it('labels every outcome, with unknown as 结果未解析', () => {
    expect(Object.keys(CALL_INDEX_OUTCOME_LABELS).sort())
      .toEqual(['cancelled', 'error', 'running', 'success', 'unknown', 'unresolved'])
    expect(CALL_INDEX_OUTCOME_LABELS.unknown).toBe('结果未解析')
  })

  it('renders 来源未解析 in the table for an unknown-source row', () => {
    const view = CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage({ items: [UNKNOWN_ROW] }) })
    expect(visible(view)).toContain('来源未解析')
    expect(visible(view)).not.toContain('未知来源')
  })
})

// ---------------------------------------------------------------------------
// 2. totalExact — the D-028 lower-bound contract
// ---------------------------------------------------------------------------

describe('exactness / lower bound', () => {
  it('renders a bare number only when totalExact is true', () => {
    expect(formatCallIndexCount(5, true)).toBe('5')
  })

  it('renders ≥N when totalExact is false', () => {
    expect(formatCallIndexCount(5, false)).toBe('≥5')
  })

  it('treats an absent flag as a lower bound rather than claiming precision', () => {
    expect(formatCallIndexCount(5, undefined)).toBe('≥5')
  })

  it('keeps an unknown count visibly unknown', () => {
    expect(formatCallIndexCount(undefined, true)).toBe('—')
    expect(formatCallIndexCount(-1, true)).toBe('—')
  })

  it('explains the ≥N form and stays silent for an exact count', () => {
    expect(callIndexExactnessNote(true)).toBeUndefined()
    expect(callIndexExactnessNote(false)).toContain('下界')
    expect(callIndexExactnessNote(undefined)).toContain('下界')
  })

  it('marks a lower-bound total with ≥ on the detail page', () => {
    // The coverage block that used to spell this out is gone (D-037), so the
    // lower-bound marker now lives on the metric itself.
    const text = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage({ totalExact: false }) }))
    expect(text).toContain('≥5')
  })

  it('shows a bare number in the detail page when the count is exact', () => {
    const text = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage() }))
    expect(text).toContain('本页合计')
    expect(text).not.toContain('≥5')
  })

  it('marks a lower-bound summary with ≥ on the overview', () => {
    const text = visible(CallIndexOverviewPanelView({
      status: statusView(),
      overview: overviewView({ totalExact: false }),
    }))
    expect(text).toContain('≥5')
  })

  it('never prints a precise total for an unstated flag', () => {
    const text = visible(CallIndexOverviewPanelView({
      status: statusView(),
      overview: overviewView({ totalExact: undefined }),
    }))
    expect(text).toContain('≥5')
  })
})

// ---------------------------------------------------------------------------
// 3. Zero counts — never "unused"
// ---------------------------------------------------------------------------

describe('zero source counts', () => {
  it('gives plugin-tool and skill a placeholder instead of dropping them', () => {
    const data = callIndexSourceData(AGGREGATES.bySource)
    const pluginTool = data.find(item => item.kind === 'plugin-tool')
    const skill = data.find(item => item.kind === 'skill')
    expect(pluginTool?.zeroNote).toBeDefined()
    expect(skill?.zeroNote).toBeDefined()
    expect(pluginTool?.zeroNote).toContain('不等于未使用')
    expect(skill?.zeroNote).toContain('不等于未使用')
  })

  it('always returns all five kinds in a stable order', () => {
    expect(callIndexSourceData(AGGREGATES.bySource).map(item => item.kind))
      .toEqual(['mcp', 'native', 'plugin-tool', 'skill', 'unknown'])
  })

  it('computes shares against the reported total', () => {
    const data = callIndexSourceData(AGGREGATES.bySource)
    const native = data.find(item => item.kind === 'native')
    expect(native?.share).toBeCloseTo(3 / 6, 6)
  })

  it('does not divide by zero on an all-zero distribution', () => {
    const data = callIndexSourceData({ mcp: 0, 'plugin-tool': 0, native: 0, skill: 0, unknown: 0 })
    expect(data.every(item => item.share === 0)).toBe(true)
    expect(data.every(item => item.zeroNote !== undefined)).toBe(true)
  })

  it('flags a distribution where both provenance sources are unresolved', () => {
    expect(callIndexHasUnexplainedSources(AGGREGATES)).toBe(true)
    expect(callIndexHasUnexplainedSources(undefined)).toBe(false)
    expect(callIndexHasUnexplainedSources({ ...AGGREGATES, bySource: { ...AGGREGATES.bySource, skill: 2 } }))
      .toBe(false)
  })

  it('renders the placeholder text in the overview, not a bare 0', () => {
    const text = visible(CallIndexOverviewPanelView({
      status: statusView(),
      overview: overviewView(),
    }))
    expect(text).toContain('未解析出')
    // The page may *deny* the "unused" reading ("不等于未使用" / "不能说明「未使用」")
    // — that is the point of the placeholder — but must never *assert* it. Strip
    // the known negations, then require that no bare claim survives.
    const stripped = text
      .replaceAll('不等于未使用', '')
      .replaceAll('不表示「未使用」', '')
      .replaceAll('不表示未使用', '')
      .replaceAll('不能说明「未使用」', '')
      .replaceAll('不能说明未使用', '')
    expect(stripped).not.toContain('未使用')
  })
})

// ---------------------------------------------------------------------------
// 4. Corpus + coverage are always stated
// ---------------------------------------------------------------------------

describe('corpus and coverage disclosure', () => {
  it('states the persisted-plus-observed-live corpus', () => {
    expect(callIndexCorpusLabel('persisted-plus-observed-live')).toContain('已持久化的历史记录')
    expect(callIndexCorpusLabel('persisted-plus-observed-live')).toContain('挂载后实时观测')
  })

  it('refuses to claim completeness when the corpus is unstated', () => {
    expect(callIndexCorpusLabel(undefined)).toContain('无法确认')
  })

  // D-037: the ten-line coverage/scan block was removed at the operator's
  // request — it explained the index's own bookkeeping above the numbers and
  // read as noise. Problems now surface in the shared red diagnostic box, which
  // is the ONLY place a failure is reported.
  it('no longer prints the coverage block on the detail page', () => {
    const text = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), status: statusView(), page: callPage() }))
    expect(text).not.toContain('已持久化的历史记录')
    expect(text).not.toContain('覆盖：完整')
    expect(text).not.toContain('语义未验证')
  })

  it('no longer prints the coverage block on the overview page', () => {
    const text = visible(CallIndexOverviewPanelView({ status: statusView(), overview: overviewView() }))
    expect(text).not.toContain('已持久化的历史记录')
    expect(text).not.toContain('覆盖：完整')
  })

  it('renders the red diagnostic box only when something is wrong', () => {
    // Healthy: nothing at all, so a real warning is never trained away.
    const healthy = visible(CallIndexDiagnostics({ status: statusView(), page: callPage() }))
    expect(healthy.trim()).toBe('')

    // A failed read must be loud and must carry the machine code.
    const broken = visible(CallIndexDiagnostics({
      failure: { ok: false, code: 'internal-error', messageKey: 'callIndex.error.internal', retryable: true, disconnected: false },
    }))
    expect(broken).toContain('读取失败')
    expect(broken).toContain('internal-error')
  })

  it('reports failed Sessions but never a running scan in the diagnostic box', () => {
    // A scan in progress is not a fault: it is reported by the progress bar.
    // A Session that could not be READ is a fault, so that line stays.
    const status = statusView({ phase: 'running', sessions: { listed: 119, visible: 119, pending: 65, pendingLive: 0, completed: 0, failed: 3 } })
    const text = visible(CallIndexDiagnostics({ status }))
    expect(text).not.toContain('索引扫描进行中')
    expect(text).toContain('有 Session 读取失败')
    expect(text).toContain('3')
  })
})

// ---------------------------------------------------------------------------
// 5. The eight states
// ---------------------------------------------------------------------------

describe('detail page states', () => {
  const base = { query: normalizeCallIndexQuery(), loading: false }

  it('starts at 初始 (initial)', () => {
    const state = callIndexDetailState({ ...base })
    expect(state.kind).toBe('initial')
    expect(state.canRetry).toBe(true)
  })

  it('reports 扫描中 (scanning) while the index runs', () => {
    const state = callIndexDetailState({
      ...base,
      status: statusView({ phase: 'running', sessions: { listed: 2, visible: 2, completed: 1, pending: 1, failed: 0, pendingLive: 3 } }),
      page: callPage(),
    })
    expect(state.kind).toBe('scanning')
    expect(state.keepsRows).toBe(true)
  })

  it('reports 无数据 (no-data) only when coverage is complete and the total is 0', () => {
    const state = callIndexDetailState({
      ...base,
      page: callPage({
        items: [],
        total: 0,
        summary: { total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 },
      }),
    })
    expect(state.kind).toBe('no-data')
    expect(state.detail).toContain('确实没有调用')
  })

  it('reports 筛选空 (filter-empty) and names the unfiltered total', () => {
    const state = callIndexDetailState({
      ...base,
      query: { range: 7, sourceKind: 'mcp' },
      page: callPage({ items: [], total: 12 }),
    })
    expect(state.kind).toBe('filter-empty')
    expect(state.detail).toContain('12')
  })

  it('reports partial instead of "no data" when coverage is not complete', () => {
    const state = callIndexDetailState({
      ...base,
      page: callPage({
        items: [],
        total: 0,
        coverage: 'partial',
        summary: { total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 },
      }),
    })
    expect(state.kind).toBe('partial')
    expect(state.detail).toContain('不能据此判定')
  })

  it('reports 失败 (failure) for a business error and keeps rows', () => {
    const state = callIndexDetailState({
      ...base,
      page: callPage(),
      failure: { ok: false, code: 'reply-too-large', messageKey: 'callIndex.error.replyTooLarge', retryable: true, disconnected: false },
    })
    expect(state.kind).toBe('failure')
    expect(state.keepsRows).toBe(true)
    expect(state.detail).toContain('结果过大')
  })

  it('reports 范围不明 (scope-unavailable) and says 0 is not "unused"', () => {
    const state = callIndexDetailState({
      ...base,
      status: statusView({ scope: { status: 'disabled', mode: 'disabled', reason: 'not-enabled' } }),
    })
    expect(state.kind).toBe('scope-unavailable')
    expect(state.detail).toContain('不代表未使用')
    expect(state.keepsRows).toBe(false)
  })

  it('reports 断连 (disconnected) with the host code when the envelope fails', () => {
    const state = callIndexDetailState({
      ...base,
      page: callPage(),
      failure: {
        ok: false,
        code: 'runtime-unavailable',
        messageKey: 'callIndex.error.runtimeUnavailable',
        retryable: true,
        disconnected: true,
        hostCode: 'gateway/timeout',
      },
    })
    expect(state.kind).toBe('disconnected')
    expect(state.detail).toContain('gateway/timeout')
    expect(state.keepsRows).toBe(true)
  })

  it('reaches ready with rows and complete coverage', () => {
    expect(callIndexDetailState({ ...base, status: statusView(), page: callPage() }).kind).toBe('ready')
  })

  // F1 regression. The live scan of 116 Sessions reported 「running」 while the
  // page said 「没有可显示的明细，且覆盖不完整」 and hid 扫描状态 / 扫描提示 /
  // 事件读取 — so a working scan was indistinguishable from a broken one. Both
  // halves are pinned here: the state must say "scanning", and the notice that
  // carries the counters must still render when there are no rows yet.
  it('reports scanning, not 覆盖不完整, while a scan runs with no rows yet', () => {
    const state = callIndexDetailState({
      ...base,
      status: statusView({ phase: 'running', sessions: { listed: 116, visible: 116, pending: 116, pendingLive: 0, completed: 0, failed: 0 } }),
      page: callPage({ items: [], total: 0 }),
    })
    expect(state.kind).toBe('scanning')
    expect(state.title).not.toContain('覆盖不完整')
    expect(state.detail).toContain('不代表没有调用')
  })

  it('shows a scanning notice while a scan runs with no rows', () => {
    // The ten-line coverage block is gone; the state notice plus the red box are
    // what tell the operator the scan is still working.
    const view = CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      status: statusView({
        phase: 'running',
        sessions: { listed: 116, visible: 116, pending: 116, pendingLive: 0, completed: 0, failed: 0 },
      }),
      page: callPage({ items: [], total: 0 }),
    })
    expect(visible(view)).toContain('索引扫描进行中')
  })

  it('still hides the coverage notice when the scope is unavailable', () => {
    // The other half of the contract: a state that replaces the surface must not
    // print counters it cannot vouch for.
    expect(showsCoverageNotice(callIndexDetailState({
      ...base,
      status: statusView({ scope: { status: 'disabled', mode: 'disabled', reason: 'not-enabled' } }),
    }))).toBe(false)
    expect(showsCoverageNotice(callIndexDetailState({ ...base, page: undefined, loading: true }))).toBe(false)
  })

  it('renders the state notice with a machine-readable marker', () => {
    const view = CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      page: callPage({ items: [], total: 0 }),
    })
    const notices = nodesWith(view, element => element.props['data-call-index-state'] !== undefined)
    expect(notices.map(node => node.props['data-call-index-state'])).toContain('no-data')
  })
})

// ---------------------------------------------------------------------------
// 6. Aggregates absence and the trend
// ---------------------------------------------------------------------------

describe('aggregates and trend', () => {
  it('renders an explicit missing block when the Host omits aggregates', () => {
    const view = CallIndexOverviewPanelView({
      status: statusView(),
      overview: overviewView({ aggregates: undefined }),
    })
    const missing = nodesWith(view, element => element.props['data-call-index-missing'] !== undefined)
    // The trend and the distribution both say "the Host did not send this"
    // rather than drawing an empty axis or a 0-width bar set.
    expect(missing.map(node => node.props['data-call-index-missing'])).toEqual(
      expect.arrayContaining(['aggregates', 'by-source']),
    )
    expect(visible(view)).toContain('不是「没有调用」')
  })

  it('says the day trend is empty when aggregates exist but byDay does not', () => {
    const view = CallIndexOverviewPanelView({
      status: statusView(),
      overview: overviewView({ aggregates: { ...AGGREGATES, byDay: undefined } }),
    })
    const missing = nodesWith(view, element => element.props['data-call-index-missing'] !== undefined)
    expect(missing.map(node => node.props['data-call-index-missing'])).toContain('by-day')
    // bySource is still present in this case, so only the trend is unavailable.
    expect(missing.map(node => node.props['data-call-index-missing'])).not.toContain('by-source')
  })

  it('says the trend is unavailable, not zero, when byDay is absent', () => {
    const chart = callIndexTrend(undefined)
    expect(chart.available).toBe(false)
    expect(chart.bars).toEqual([])
    expect(chart.totalCalls).toBe(0)
  })

  it('distinguishes "no buckets" from "no aggregates"', () => {
    expect(callIndexTrend([]).available).toBe(true)
    expect(callIndexTrend([]).bars).toEqual([])
  })

  it('scales bars against the peak and keeps a visible stub for a zero day', () => {
    const chart = callIndexTrend([
      { day: '2026-11-08', calls: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0 },
      { day: '2026-11-09', calls: 4, success: 4, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0 },
      { day: '2026-11-10', calls: 2, success: 2, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0 },
    ])
    expect(chart.maxCalls).toBe(4)
    expect(chart.totalCalls).toBe(6)
    expect(chart.bars[1]?.ratio).toBe(1)
    expect(chart.bars[2]?.ratio).toBeCloseTo(0.5, 6)
    expect(chart.bars[0]?.height).toBe(1)
    expect(chart.bars[0]?.ratio).toBe(0)
  })

  it('draws the v3 line + area + failure bars inside a 720×212 viewBox', () => {
    // v3 replaces the old one-rect-per-day bar chart with a line+area chart
    // (calls) plus a failure底柱 for each nonzero-error day, a dashed recent-week
    // band and a peak label. The old assertion pinned the removed bar-per-day, so
    // it now pins the new structure — same intent (a real, bounded trend drawing).
    const view = CallIndexOverviewPanelView({ status: statusView(), overview: overviewView() })
    const svg = nodesWith(view, element => element.props['data-call-index-svg'] === 'trend')
    expect(svg).toHaveLength(1)
    expect(svg[0]?.props.viewBox).toBe('0 0 720 212')
    const lines = nodesWith(view, element => element.props.className === 'v3-line')
    expect(lines).toHaveLength(1)
    expect(String(lines[0]?.props.points).split(' ')).toHaveLength(AGGREGATES.byDay?.length ?? 0)
    const errBars = nodesWith(view, element => element.props.className === 'v3-bar-er')
    expect(errBars).toHaveLength((AGGREGATES.byDay ?? []).filter(day => day.error > 0).length)
    expect(nodesWith(view, element => element.props.className === 'v3-hlbox')).toHaveLength(1)
  })

  it('no longer prints the day-boundary line', () => {
    // Removed at the operator's request: it is an implementation detail of how
    // buckets are cut, and the axis already labels every day.
    const view = CallIndexOverviewPanelView({ status: statusView(), overview: overviewView() })
    const text = visible(view)
    expect(text).not.toContain('日界')
    expect(text).not.toContain('UTC+08:00')
  })

  it('draws no SVG when aggregates are missing', () => {
    const view = CallIndexOverviewPanelView({ status: statusView(), overview: overviewView({ aggregates: undefined }) })
    expect(nodesWith(view, element => element.props['data-call-index-svg'] !== undefined)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 7. Overview metrics
// ---------------------------------------------------------------------------

describe('overview metrics', () => {
  it('reports the four headline metrics', () => {
    const metrics = callIndexOverviewMetrics(overviewView(), statusView())
    expect(metrics.calls).toBe(5)
    expect(metrics.distinctTools).toBe(3)
    expect(metrics.sessionsVisible).toBe(5)
    expect(metrics.sessionsListed).toBe(6)
    expect(metrics.failed).toBe(1)
  })

  it('derives unfinished as unresolved + running', () => {
    const mix = callIndexOutcomeMix({ total: 9, success: 5, error: 1, cancelled: 1, unresolved: 2, unknown: 0, running: 0, inherited: 0 })
    expect(mix?.unfinished).toBe(2)
    expect(mix?.total).toBe(9)
  })

  it('leaves metrics undefined rather than zero when nothing was read', () => {
    const metrics = callIndexOverviewMetrics(undefined, undefined)
    expect(metrics.calls).toBeUndefined()
    expect(metrics.distinctTools).toBeUndefined()
    expect(metrics.sessionsVisible).toBeUndefined()
    expect(metrics.failed).toBeUndefined()
    expect(metrics.unfinished).toBeUndefined()
  })

  it('renders em dashes for unread metrics, not zeros', () => {
    // v3 re-laid the metric strip as `.v3-stats` / `.v3-stat-v`. The honesty
    // contract is unchanged — with nothing read, every big number is an em dash,
    // never a fabricated 0 — so only the class selector was retargeted.
    const view = CallIndexOverviewPanelView({})
    const values = nodesWith(view, element => element.props.className === 'v3-stat-v v3-num')
    expect(values).toHaveLength(4)
    for (const node of values) expect(node.props.children).toBe('—')
  })

  it('reads the same corpus as 调用明细: no time window at all', () => {
    // The old assertion was `expect(text).toContain(callIndexRangeLabel(CALL_INDEX_OVERVIEW_RANGE))`
    // — both sides referenced the SAME constant, so it passed no matter what
    // the constant became. It could not catch the bug that mattered.
    //
    // The bug: 总览 used a 30-day window while 调用明细 used 7 days, so one
    // snapshot read 「745 次调用」 on one tab and 「确实没有调用」 on the other.
    // Both pages must now ask for 'all', and the header must say so literally.
    expect(CALL_INDEX_OVERVIEW_RANGE).toBe('all')
    const text = visible(CallIndexOverviewPanelView({ status: statusView(), overview: overviewView() }))
    expect(text).toContain('范围：全部已索引会话')
    expect(text).not.toContain('最近 30 天')
    // And the request it actually sends carries no lower bound.
    const request = buildCallIndexSummaryRequest({ range: CALL_INDEX_OVERVIEW_RANGE }, Date.UTC(2026, 10, 10, 12))
    expect(Object.keys(request.query as Record<string, unknown>)).not.toContain('fromMs')
  })

  it('shows the last scan when the Host reports one', () => {
    const view = CallIndexOverviewPanelView({
      status: statusView({
        task: { taskId: 't1', mode: 'full', phase: 'complete', startedAt: Date.UTC(2026, 10, 10, 1), cancelRequested: false },
      }),
      overview: overviewView(),
    })
    expect(visible(view)).toContain('最近一次扫描')
  })
})

// ---------------------------------------------------------------------------
// 8. Table and detail rendering
// ---------------------------------------------------------------------------

describe('table and detail', () => {
  it('renders one row per tool with the six requested columns', () => {
    // v3 demotes the table to an appendix and adopts the design's columns
    // (tool / calls / failures / success-rate / latency / last-call). Session and
    // turn/step were already gone; 来源 is folded into a small marker in the tool
    // cell, so the header set changes while "one row per tool" is preserved.
    const view = CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage() })
    const headers = nodesWith(view, element => element.type === 'th')
    expect(headers.map(node => node.props.children))
      .toEqual(['工具', '调用', '失败', '成功率', '平均耗时', '最近调用'])
  })

  it('formats turn and step compactly', () => {
    expect(formatCallIndexTurnStep(ROW)).toBe('T2 · S3')
    expect(formatCallIndexTurnStep({ ...ROW, turn: undefined })).toBe('S3')
    expect(formatCallIndexTurnStep({ ...ROW, step: undefined })).toBe('T2')
    expect(formatCallIndexTurnStep({ ...ROW, turn: undefined, step: undefined })).toBe('—')
  })

  it('drops the Session column entirely', () => {
    const view = CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage() })
    expect(nodesWith(view, element => element.props.title === ROW.sessionId)).toHaveLength(0)
    // The helper itself is still used by the wire projection, so keep it honest.
    expect(shortCallIndexSessionId(ROW.sessionId).length).toBeLessThan(ROW.sessionId.length)
  })

  it('formats durations and never fabricates one', () => {
    expect(formatCallIndexDuration(undefined)).toBe('—')
    expect(formatCallIndexDuration(12)).toBe('12ms')
    expect(formatCallIndexDuration(1200)).toBe('1.2s')
  })

  // The per-call detail pane and the clickable rows it opened are gone (the
  // table aggregates by tool, so "this row's single call" no longer exists).
  // These replace the four tests that pinned that removed surface, and pin the
  // aggregation the operator asked for instead.
  it('aggregates calls per tool instead of repeating one row per call', () => {
    const page = callPage({
      items: [
        ROW,
        { ...ROW, callSeq: 5, callId: 'call-5', startedAt: ROW.startedAt + 1000 },
        { ...ROW, callSeq: 6, callId: 'call-6', toolName: 'grep', outcome: 'error' },
      ],
    })
    const rows = callIndexToolRows(page)
    expect(rows).toHaveLength(2)
    const bash = rows.find(row => row.toolName === 'bash')
    expect(bash?.calls).toBe(2)
    expect(bash?.success).toBe(2)
    expect(bash?.error).toBe(0)
    const grep = rows.find(row => row.toolName === 'grep')
    expect(grep?.error).toBe(1)
  })

  it('leaves unresolved calls out of both success and failure', () => {
    const page = callPage({ items: [{ ...ROW, outcome: 'unresolved' }, { ...ROW, callSeq: 9, outcome: 'error' }] })
    const rows = callIndexToolRows(page)
    expect(rows[0]?.success).toBe(0)
    expect(rows[0]?.error).toBe(1)
    expect((rows[0]?.success ?? 0) + (rows[0]?.error ?? 0)).toBeLessThanOrEqual(rows[0]?.calls ?? 0)
  })

  it('renders no detail pane at all, so nothing can flash open', () => {
    const view = CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      page: callPage(),
      detailTarget: { sessionId: ROW.sessionId, callSeq: ROW.callSeq },
    } as never)
    expect(nodesWith(view, element => element.props['data-call-index-aside'] !== undefined)).toHaveLength(0)
    expect(visible(view)).not.toContain('调用详情')
  })

  it('says why 加载更多 failed instead of doing nothing', () => {
    // Reported as "clicking 加载更多 does nothing". The failure was stored but
    // never rendered, so a rejected page looked like a dead button.
    const text = visible(CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      page: callPage({ nextCursor: 'c1' }),
      moreFailure: {
        ok: false,
        code: 'invalid-request',
        messageKey: 'callIndex.error.invalidRequest',
        retryable: false,
        disconnected: false,
      },
    }))
    expect(text).toContain('加载更多失败')
  })

  it('has no 加载更多 button: the table fills itself and scrolls', () => {
    // The operator asked to see every tool row at once and scroll, not to page a
    // table that fits. A cursor now drives a background fill (see MAX_AUTO_PAGES),
    // so no button may reappear — including while that fill is in flight.
    const idle = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage() }))
    expect(idle).not.toContain('加载更多')
    const withCursor = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage({ nextCursor: 'c1' }) }))
    expect(withCursor).not.toContain('加载更多')
    // A silent fill is still not allowed to be silent: while the next page is
    // in flight the page says so.
    const filling = visible(CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      page: callPage({ nextCursor: 'c1' }),
      loadingMore: true,
    }))
    expect(filling).toContain('正在加载其余工具')
  })

  it('discloses rows dropped by the allowlist projection', () => {
    const text = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage({ droppedItems: 3 }) }))
    expect(text).toContain('3 行')
  })

  it('does not tell the user to press a refresh button that no longer exists', () => {
    const text = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage({ hasUpdates: true }) }))
    expect(text).not.toContain('点「刷新」')
  })
})

// ---------------------------------------------------------------------------
// 9. Filters, ranges and request building
// ---------------------------------------------------------------------------

describe('filters and requests', () => {
  it('offers 7/15/30/全部', () => {
    expect(CALL_INDEX_RANGES).toEqual([7, 15, 30, 'all'])
    expect(CALL_INDEX_RANGES.map(callIndexRangeLabel)).toEqual(['7 天', '15 天', '30 天', '全部'])
  })

  it('normalizes junk input into a usable query', () => {
    const query = normalizeCallIndexQuery({ range: 'bogus' as never, sourceKind: 'nope' as never, sessionId: '' })
    // The page no longer offers a day window, so the default must be the widest
    // honest answer: a default of 7 silently hid everything older than a week and
    // made the table claim 「确实没有调用」. See CALL_INDEX_SCOPES.
    expect(query.range).toBe('all')
    expect(query.scope).toBe('all')
    expect(query.sourceKind).toBeUndefined()
    expect(query.sessionId).toBeUndefined()
  })

  it('detects whether any non-range dimension is set', () => {
    expect(hasCallIndexFilters({ range: 'all' })).toBe(false)
    expect(hasCallIndexFilters({ range: 'all', outcome: 'error' })).toBe(true)
    // A narrowed scope is a filter too: the empty-state copy must not claim
    // 「确实没有调用」 while a scope is hiding rows.
    expect(hasCallIndexFilters({ range: 'all', scope: 'session' })).toBe(true)
    expect(hasCallIndexFilters({ range: 'all', scope: 'all' })).toBe(false)
  })

  it('builds a half-open local-day window for 7 days', () => {
    const now = Date.UTC(2026, 10, 10, 12)
    const window = callIndexRangeWindow(7, now, 480)
    // Local midnight of 2026-11-10 in UTC+08:00 is 2026-11-09T16:00Z; six more
    // local days back is 2026-11-03T16:00Z. Expressing the bound in the caller's
    // zone is the point: a UTC-day window would start eight hours later.
    expect(window.fromMs).toBe(Date.UTC(2026, 10, 3, 16))
    expect(window.toMs).toBeUndefined()
    // The 7-day window spans exactly 6 days before today's local midnight.
    expect(now - window.fromMs!).toBe(6 * 86_400_000 + (now - Date.UTC(2026, 10, 9, 16)))
  })

  it('shifts the window with the day offset rather than assuming UTC', () => {
    const now = Date.UTC(2026, 10, 10, 12)
    const utc = callIndexRangeWindow(7, now, 0).fromMs
    const east = callIndexRangeWindow(7, now, 480).fromMs
    const west = callIndexRangeWindow(7, now, -300).fromMs
    expect(east).toBe(utc! - 8 * 3_600_000)
    expect(west).toBe(utc! + 5 * 3_600_000)
  })

  it('carries no lower bound for 全部', () => {
    expect(callIndexRangeWindow('all', Date.UTC(2026, 10, 10), 480)).toEqual({})
  })

  it('binds each scope to the live target and refuses to filter on nothing', () => {
    // 按会话 / 按工作区 must carry the id they were bound to...
    expect(scopeQuery('session', { range: 'all', sessionId: 's1' })).toMatchObject({ scope: 'session', sessionId: 's1' })
    expect(scopeQuery('workspace', { range: 'all', cwd: 'C:/w' })).toMatchObject({ scope: 'workspace', cwd: 'C:/w' })
    // ...and must NOT filter when the target is unknown. Filtering on
    // `undefined` would produce an empty table with a confident
    // 「确实没有调用」, which is the exact false zero this page must never show.
    const unknownSession = scopeQuery('session', { range: 'all' })
    expect(unknownSession.sessionId).toBeUndefined()
    // Assert on the EMITTED WIRE FILTER, not on the query object: `scope` alone
    // already makes hasCallIndexFilters true, so that check passed even when the
    // function wrongly emitted `sessionId: undefined` (verified by mutation).
    const wire = buildCallIndexQueryFilter(normalizeCallIndexQuery(unknownSession))
    expect(Object.keys(wire)).not.toContain('sessionId')
    expect(Object.keys(wire)).not.toContain('cwd')
    expect(scopeHint(normalizeCallIndexQuery(unknownSession))).toContain('未识别当前会话')
    // Switching back to 全部 clears both narrowings.
    expect(scopeQuery('all', { range: 'all', sessionId: 's1', cwd: 'C:/w' })).toEqual({
      scope: 'all', range: 'all', sessionId: undefined, cwd: undefined,
    })
    expect(CALL_INDEX_SCOPES.map(scope => CALL_INDEX_SCOPE_LABELS[scope])).toEqual(['按会话', '按工作区', '全部'])
  })

  it('shows the session NAME, never a bare id, and lets the operator switch sessions', () => {
    const catalog = {
      current: { id: 'session-aaa', name: '修复索引扫描' },
      items: [
        { id: 'session-aaa', name: '修复索引扫描' },
        { id: 'session-bbb', name: '重构调用明细' },
      ],
    }
    // The hint must name the conversation. 「会话 session-aaa」 is the exact
    // complaint: a truncated id does not say WHICH conversation is on screen.
    const hint = scopeHint({ range: 'all', scope: 'session', sessionId: 'session-bbb' }, catalog)
    expect(hint).toBe('会话 重构调用明细')
    expect(hint).not.toContain('session-')
    // Without a catalog the id is the only honest answer, and it must still show.
    expect(scopeHint({ range: 'all', scope: 'session', sessionId: 'session-bbb' })).toContain('session-bbb')
    expect(callIndexSessionName('session-zzz', catalog)).toBe('session-zzz')

    // Switching sessions: the picker lists every catalogued Session and is
    // present only while 按会话 is the active scope.
    const bound = CallIndexDetailPanelView({
      query: { range: 'all', scope: 'session', sessionId: 'session-aaa' },
      page: callPage(),
      catalog,
    })
    // The attribute is the string 'true' (JSX/React renders data-* attributes as
    // strings), so comparing with the boolean `true` would silently match
    // nothing — verified the hard way while writing this test.
    const select = nodesWith(bound, el => el.props['data-call-index-session-select'] === 'true')
    expect(select).toHaveLength(1)
    const options = nodesWith(bound, el => el.type === 'option')
    expect(options.map(o => o.props.children)).toEqual(['修复索引扫描', '重构调用明细'])
    // Not shown on the other scopes: there is nothing to pick.
    const allScope = CallIndexDetailPanelView({ query: { range: 'all', scope: 'all' }, page: callPage(), catalog })
    expect(nodesWith(allScope, el => el.props['data-call-index-session-select'] === 'true')).toHaveLength(0)
  })

  it('never sends a day window, so nothing is hidden behind an invisible filter', () => {
    // The wire still understands fromMs; this page must not emit one, or the
    // table would silently drop rows the operator can no longer see a control for.
    const request = buildCallIndexListRequest(normalizeCallIndexQuery(), { now: Date.UTC(2026, 10, 10, 12) })
    expect(Object.keys(request.query as Record<string, unknown>)).not.toContain('fromMs')
  })

  it('emits only fields the strict request schema declares', () => {
    const request = buildCallIndexListRequest(
      { range: 7, sourceKind: 'mcp' },
      { now: Date.UTC(2026, 10, 10, 12), limit: 20 },
    )
    expect(Object.keys(request).sort()).toEqual(['limit', 'query'])
    expect(Object.keys(request.query as Record<string, unknown>).sort()).toEqual(['fromMs', 'sourceKind'])
  })

  it('clamps the page size into the wire range', () => {
    expect(buildCallIndexListRequest({ range: 7 }, { limit: 9999 }).limit).toBe(200)
    expect(buildCallIndexListRequest({ range: 7 }, { limit: 0 }).limit).toBe(1)
    expect(CALL_INDEX_PAGE_LIMIT).toBeLessThanOrEqual(200)
  })

  it('sends the local day offset with the summary request', () => {
    const request = buildCallIndexSummaryRequest({ range: 30 }, Date.UTC(2026, 10, 10, 12))
    expect(typeof request.dayOffsetMinutes).toBe('number')
    expect(Math.abs(request.dayOffsetMinutes as number)).toBeLessThanOrEqual(840)
  })

  it('renders one pill per scope with the active one pressed', () => {
    const view = CallIndexDetailPanelView({ query: { range: 'all', scope: 'workspace' }, page: callPage() })
    // Count the rendered `<button>`s only: the walk also expands the `Pill`
    // component itself, so the wrapper carries the same prop.
    const pills = nodesWith(view, element => element.type === 'button' && element.props['aria-pressed'] !== undefined)
    // Three scopes replaced the four day pills: 按会话 / 按工作区 / 全部.
    expect(pills).toHaveLength(3)
    expect(pills.filter(node => node.props['aria-pressed'] === true)).toHaveLength(1)
    expect(pills[1]?.props.children).toBe('按工作区')
    expect(pills[1]?.props['aria-pressed']).toBe(true)
  })

  it('offers scope, not day ranges, and never the removed selects', () => {
    // 工作区 / 会话 / 来源 / 状态, 清除筛选 and the 成功 / 失败 / 建议 views were all
    // removed at the operator's request; the SCOPES now carry 会话/工作区, so the
    // filter is one row of three pills and nothing else.
    const view = CallIndexDetailPanelView({ query: { range: 'all', scope: 'all' }, page: callPage(), sessions: sessionPage() })
    for (const label of ['工作区', '会话', '来源', '状态']) {
      expect(nodesWith(view, element => element.props['data-call-index-filter'] === label)).toHaveLength(0)
    }
    expect(visible(view)).not.toContain('清除筛选')
    for (const label of ['按会话', '按工作区', '全部']) expect(visible(view)).toContain(label)
    // The time axis is gone from the UI entirely.
    for (const label of ['7 天', '15 天', '30 天']) expect(visible(view)).not.toContain(label)
  })
})

// ---------------------------------------------------------------------------
// 10. Error copy and the API bridge
// ---------------------------------------------------------------------------

describe('error copy', () => {
  it('has copy for all ten wire reasons', () => {
    for (const reason of CALL_INDEX_ERROR_REASONS) {
      const key = CALL_INDEX_ERROR_MESSAGE_KEYS[reason]
      expect(CALL_INDEX_ERROR_TEXT[key], `missing copy for ${reason}`).toBeTruthy()
    }
    expect(Object.keys(CALL_INDEX_ERROR_TEXT)).toHaveLength(CALL_INDEX_ERROR_REASONS.length)
  })

  it('resolves a failure to its sentence', () => {
    expect(callIndexFailureText({
      ok: false,
      code: 'cursor-stale',
      messageKey: 'callIndex.error.cursorStale',
      retryable: true,
      disconnected: false,
    })).toContain('游标已过期')
  })
})

describe('panel api bridge', () => {
  const okReply = (kind: string, data: Record<string, unknown>): RemoteResult<CallIndexReply> => ({
    ok: true,
    value: { schemaVersion: 1, ok: true, kind, data } as CallIndexReply,
  })
  // `RemoteResult.error` is a real `RemoteError` instance, not a plain object;
  // the bridge must read `code` off it structurally rather than assuming a shape.
  // `RemoteFailure` is a mapped union over every code, so a generic
  // `RemoteError<Code>` does not narrow to it — the cast is the fixture's, not
  // the production code's, which never constructs a failure.
  const failEnvelope = (code: RemoteErrorCode, message: string): RemoteResult<CallIndexReply> => ({
    ok: false,
    error: new RemoteError(code, message, {} as never) as unknown as RemoteFailure,
  })

  it('reports 断连 when no face is mounted', async () => {
    const api = createCallIndexPanelApi(undefined)
    const result = await api.getStatus()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.disconnected).toBe(true)
  })

  it('reports 断连 when the method is missing', async () => {
    const api = createCallIndexPanelApi({})
    const result = await api.listCalls({ range: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.disconnected).toBe(true)
  })

  it('reports 断连 when the call throws', async () => {
    const api = createCallIndexPanelApi({
      listCalls: async () => { throw new Error('boom') },
    })
    const result = await api.listCalls({ range: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.disconnected).toBe(true)
  })

  it('reports 断连 and keeps the host code when the envelope fails', async () => {
    const api = createCallIndexPanelApi({
      listCalls: async () => failEnvelope('gateway/internal', 'carrier lost'),
    })
    const result = await api.listCalls({ range: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.disconnected).toBe(true)
      expect(result.hostCode).toBe('gateway/internal')
    }
  })

  it('reports 断连 for a cancelled call', async () => {
    const api = createCallIndexPanelApi({
      listCalls: async () => failEnvelope('gateway/cancelled', 'aborted'),
    })
    const result = await api.listCalls({ range: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.disconnected).toBe(true)
      expect(result.hostCode).toBe('gateway/cancelled')
    }
  })

  it('maps a Host business error reply without calling it a disconnect', async () => {
    // The wire's failure channel is a *successful* transport carrying
    // `{ ok: false, kind: 'error', reason }` — not a failed Typert envelope.
    const api = createCallIndexPanelApi({
      listCalls: async () => ({
        ok: true,
        value: { schemaVersion: 1, ok: false, kind: 'error', reason: 'reply-too-large' } as CallIndexReply,
      }),
    })
    const result = await api.listCalls({ range: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.disconnected).toBe(false)
      expect(result.code).toBe('reply-too-large')
      expect(result.messageKey).toBe('callIndex.error.replyTooLarge')
    }
  })

  it('projects a good reply through the adapter', async () => {
    const api = createCallIndexPanelApi({
      listCalls: async () => okReply('calls', {
        snapshotId: 'snap-1',
        generation: 7,
        coverage: 'complete',
        totalExact: false,
        summary: { total: 5, success: 3, error: 1, cancelled: 0, unresolved: 1, unknown: 0, running: 0, inherited: 1 },
        total: 5,
        items: [{
          sessionId: ROW.sessionId,
          callSeq: ROW.callSeq,
          callId: ROW.callId,
          toolName: ROW.toolName,
          startedAt: ROW.startedAt,
          outcome: 'success',
          inherited: false,
          sourceKind: 'native',
          layer: 'built-in',
          args: { secret: true },
        }],
      }),
    })
    const result = await api.listCalls({ range: 7 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.totalExact).toBe(false)
      expect(result.value.items).toHaveLength(1)
      expect('args' in result.value.items[0]!).toBe(false)
    }
  })

  it('rejects a reply of the wrong kind', async () => {
    const api = createCallIndexPanelApi({
      getSummary: async () => okReply('calls', { snapshotId: 's', generation: 1, coverage: 'complete', summary: { total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 } }),
    })
    const result = await api.getOverview({ range: 30 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('internal-error')
  })

  it('re-resolves a lazily mounted face', async () => {
    let mounted: CallIndexRemoteFace | undefined
    const api = createCallIndexPanelApi(() => mounted)
    expect((await api.getStatus()).ok).toBe(false)
    mounted = {
      getIndexStatus: async () => okReply('status', {
        scope: { status: 'ready', mode: 'host-visible', epoch: 1 },
        generation: 1,
        censusGeneration: 1,
        phase: 'idle',
        coverage: 'complete',
        eventCoverage: 'complete',
        enumerationCoverage: 'complete',
        semanticCoverage: { source: 'verified', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
        listedSessions: 0,
        visibleSessions: 0,
        completedSessions: 0,
        pendingSessions: 0,
        failedSessions: 0,
        pendingLive: 0,
        estimatedBytes: 0,
        reasons: [],
        totals: TOTALS,
      }),
    }
    const result = await api.getStatus()
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 11. Small formatters
// ---------------------------------------------------------------------------

describe('formatters', () => {
  it('renders an em dash for a missing time', () => {
    expect(formatCallIndexTime(undefined)).toBe('—')
    expect(formatCallIndexTime(Number.NaN)).toBe('—')
    expect(formatCallIndexTime(Date.UTC(2026, 10, 10, 2, 30))).toMatch(/^2026-11-10 \d{2}:\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// 12. v3 structure — V3-a 总览 + V3-d 调用明细
// ---------------------------------------------------------------------------
//
// These pin the v3 redesign itself: four-cell stat strips with sparklines, a
// one-segment source donut, a bounded tool ranking, an honest per-tool empty
// state, and the detail page's two chart columns + `.v3-ts` appendix table.
// They are additive — no original behaviour assertion was removed to earn them.

describe('v3 structure', () => {
  const withTool = (name: string, outcome: CallIndexCallRow['outcome'], seq: number): CallIndexCallRow =>
    ({ ...ROW, callSeq: seq, callId: 'c' + seq, toolName: name, outcome })

  it('lays the overview out as four .v3-stats cells with sparklines', () => {
    const tools = callIndexToolRows(callPage({ items: [ROW] }))
    const view = CallIndexOverviewPanelView({ status: statusView(), overview: overviewView(), tools })
    expect(nodesWith(view, element => element.props.className === 'v3-stats').length).toBeGreaterThanOrEqual(1)
    expect(nodesWith(view, element => element.props.className === 'v3-stat')).toHaveLength(4)
    // Every stat cell keeps the data-call-index-metric marker.
    expect(nodesWith(view, element => element.props['data-call-index-metric'] !== undefined)).toHaveLength(4)
    expect(nodesWith(view, element => element.props['data-call-index-metrics'] === 'overview')).toHaveLength(1)
    // A sparkline for each daily series we actually have (calls / success / error).
    expect(nodesWith(view, element => element.props['data-call-index-spark'] !== undefined).length).toBeGreaterThanOrEqual(3)
  })

  it('draws the source donut as exactly one segment and lists all five kinds', () => {
    // Real data has unknown = 100%. The donut must draw ONE segment and never
    // fabricate a coloured slice for a zero source (D-028).
    const allUnknown: CallIndexAggregates = {
      distinctTools: 1,
      bySource: { mcp: 0, native: 0, 'plugin-tool': 0, skill: 0, unknown: 745 },
      byDay: AGGREGATES.byDay,
      dayOffsetMinutes: 480,
    }
    const view = CallIndexOverviewPanelView({ status: statusView(), overview: overviewView({ aggregates: allUnknown }) })
    expect(nodesWith(view, element => element.props.className === 'v3-seg')).toHaveLength(1)
    expect(visible(view)).toContain('100%')
    expect(visible(view)).toContain('未解析')
    expect(nodesWith(view, element => element.props['data-source-row'] !== undefined).map(r => r.props['data-source-row']))
      .toEqual(['mcp', 'native', 'plugin-tool', 'skill', 'unknown'])
  })

  it('caps the tool ranking at 12 rows', () => {
    const many = Array.from({ length: 20 }, (_, i) => withTool('tool-' + i, 'success', 100 + i))
    const tools = callIndexToolRows(callPage({ items: many }))
    expect(tools).toHaveLength(20)
    const view = CallIndexOverviewPanelView({ status: statusView(), overview: overviewView(), tools })
    // No failures here, so the only rank rows are the ranking panel's — capped at 12.
    expect(nodesWith(view, element => element.props.className === 'v3-rank-row')).toHaveLength(12)
  })

  it('shows an honest empty state, not zeros, when per-tool data was not read', () => {
    const view = CallIndexOverviewPanelView({ status: statusView(), overview: overviewView() }) // tools undefined
    expect(visible(view)).toContain('尚未读取逐工具明细')
  })

  it('renders the detail page as two chart columns plus a .v3-ts table', () => {
    const view = CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage(), status: statusView() })
    expect(nodesWith(view, element => element.props.className === 'v3-board').length).toBeGreaterThanOrEqual(1)
    expect(visible(view)).toMatch(/个工具 · .*次调用/)
    expect(nodesWith(view, element => element.props.className === 'v3-stat')).toHaveLength(4)
    expect(nodesWith(view, element => element.props['data-call-index-summary'] === 'rates')).toHaveLength(1)
    expect(nodesWith(view, element => element.props['data-call-index-table'] === 'tools')).toHaveLength(1)
    expect(nodesWith(view, element => typeof element.props.className === 'string' && element.props.className.includes('v3-ts')).length)
      .toBeGreaterThanOrEqual(1)
  })

  it('keeps the scan-progress marker on the detail page', () => {
    const view = CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      page: callPage(),
      status: statusView({ phase: 'running', sessions: { listed: 4, visible: 4, completed: 2, pending: 2, failed: 0, pendingLive: 0 } }),
    })
    expect(nodesWith(view, element => element.props['data-call-index-progress'] !== undefined).length).toBeGreaterThanOrEqual(1)
  })

  it('filters the detail tool rows by the client-side search term', () => {
    const page = callPage({ items: [withTool('bash', 'success', 1), withTool('grep', 'success', 2)] })
    const all = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page, status: statusView() }))
    expect(all).toContain('bash')
    expect(all).toContain('grep')
    const filtered = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page, status: statusView(), search: 'grep' }))
    expect(filtered).toContain('grep')
    expect(filtered).not.toContain('bash')
    expect(nodesWith(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page }), el => el.props['data-call-index-search'] === 'true'))
      .toHaveLength(1)
  })

  it('keeps "占该工具 %" (detail) and "占全部失败 %" (overview) as distinct denominators', () => {
    const items = [withTool('bash', 'success', 1), withTool('grep', 'error', 2)]
    const page = callPage({ items })
    const detail = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page, status: statusView() }))
    expect(detail).toContain('占该工具')
    const overview = visible(CallIndexOverviewPanelView({ status: statusView(), overview: overviewView(), tools: callIndexToolRows(page) }))
    expect(overview).toContain('占全部失败')
  })
})

describe('automatic indexing (D-031)', () => {
  // The operator removed 全量索引 / 增量更新 on 2026-11-12: the Host now runs one
  // scan on mount. These tests pin that contract so the buttons cannot come
  // back, and so a blocked index still explains itself.
  function buttonLabels(props: Record<string, unknown> = {}): string[] {
    const view = CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      loading: false,
      loadingMore: false,
      loadingDetail: false,
      ...props,
    } as never) as React.ReactElement
    const labels: string[] = []
    const walk = (node: unknown): void => {
      if (node === null || node === undefined) return
      if (Array.isArray(node)) { for (const child of node) walk(child); return }
      if (typeof node !== 'object') return
      const element = node as { type?: unknown; props?: Record<string, unknown> }
      if ((element.type as { name?: string })?.name === 'Button') labels.push(String(element.props?.children ?? ''))
      walk(element.props?.children)
    }
    walk(view)
    return labels
  }

  it('offers no manual scan trigger any more', () => {
    const labels = buttonLabels({ status: { scope: { status: 'ready', mode: 'host-visible' } } })
    expect(labels).not.toContain('全量索引')
    expect(labels).not.toContain('增量更新')
    // 刷新 is gone too: the panel re-reads itself while a scan runs.
    expect(labels).not.toContain('刷新')
  })

  it('reports a missing status through the shared diagnostic box', () => {
    // The inline 「自动索引不可用」 line moved into the red box under the tab bar
    // (D-037), so it is visible on every tab rather than only on this one.
    const text = visible(CallIndexDiagnostics({
      failure: { ok: false, code: 'internal-error', messageKey: 'callIndex.error.internal', retryable: true, disconnected: false },
    }))
    expect(text).toContain('读取失败')
    expect(text).toContain('无效的响应结构')
  })
})

describe('detail pane does not flash closed (D-032)', () => {
  // The reported bug: clicking a tool row opened 调用详情, then ~1s later it
  // reverted to 「尚未选择调用」. Cause: every refresh (the automatic scan
  // finishing) cleared detailTarget unconditionally.
  const target = { sessionId: ROW.sessionId, callSeq: ROW.callSeq }

  it('keeps the pane when the refreshed page still contains the row', () => {
    // Assert on the ABSENCE of a clear instruction, not on an empty object:
    // an empty-object comparison also passes for a function that always
    // returns {} for the wrong reason, so it could not catch a regression.
    const patch = detailAfterRefresh({ detailTarget: target }, callPage())
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('closes the pane only when the row really disappeared', () => {
    const cleared = detailAfterRefresh({ detailTarget: target }, callPage({ items: [] }))
    expect(cleared.detailTarget).toBeUndefined()
    expect(cleared.detail).toBeUndefined()
  })

  it('keeps the pane when the page could not be read', () => {
    // A failed read is not evidence the row vanished.
    const patch = detailAfterRefresh({ detailTarget: target }, undefined)
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('does nothing when no row is selected', () => {
    expect(Object.keys(detailAfterRefresh({}, callPage()))).toHaveLength(0)
  })

  it('keeps the selection across a refresh that still contains it', () => {
    // The state helper is what the container uses; the pane itself is gone, so
    // the meaningful contract is that the selection survives a refresh rather
    // than being cleared unconditionally.
    expect(Object.keys(detailAfterRefresh({ detailTarget: target }, callPage()))).toHaveLength(0)
  })

  it('has no 刷新 button left to re-trigger the reset', () => {
    const view = CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page: callPage() })
    expect(visible(view)).not.toContain('刷新')
  })
})

describe('background refresh keeps appended pages (D-038)', () => {
  // Reported: 点「加载更多」后，表格自动收回到第一页，只显示「快照代 55」。
  // The auto-refresh (which runs while a scan is in progress) re-reads page one
  // and assigned it wholesale, discarding every appended page.
  const row = (seq: number): CallIndexCallRow => ({ ...ROW, callSeq: seq, callId: 'c' + seq })

  it('keeps appended rows when the snapshot id is unchanged', () => {
    const previous = callPage({ items: [row(1), row(2)], total: 2 })
    const fresh = callPage({ items: [row(1)], total: 2, generation: 56 })
    const merged = mergeRefreshedPage(previous, fresh, 1)
    expect(merged.items).toHaveLength(2)
    // Metadata still comes from the fresh read.
    expect(merged.generation).toBe(56)
  })

  it('resets to the fresh page when the snapshot changed', () => {
    const previous = callPage({ items: [row(1), row(2)], snapshotId: 'old' })
    const fresh = callPage({ items: [row(9)], snapshotId: 'new' })
    expect(mergeRefreshedPage(previous, fresh, 1).items).toHaveLength(1)
  })

  it('uses the fresh page when nothing was appended', () => {
    const previous = callPage({ items: [row(1), row(2)] })
    const fresh = callPage({ items: [row(1)] })
    expect(mergeRefreshedPage(previous, fresh, 0).items).toHaveLength(1)
  })
})

describe('empty corpus explains itself', () => {
  // The old CallIndexCoverageNotice was removed (D-037): the ten-line block was
  // replaced by the shared red diagnostic box. These keep the original intent —
  // an empty index must never be a silent zero — on the surviving surface.
  const statusWith = (reasons: string[], failed = 0): StatusView => ({
    scope: { status: 'ready', mode: 'host-visible', epoch: 1 },
    corpus: 'persisted-plus-observed-live',
    generation: 1, censusGeneration: 1,
    phase: 'idle',
    coverage: 'partial', eventCoverage: 'partial', enumerationCoverage: 'complete',
    semanticCoverage: { source: 'verified', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
    reasons,
    sessions: { listed: 116, visible: 116, pending: 116, pendingLive: 0, completed: 0, failed },
    estimatedBytes: 0,
    totals: { calls: 0, succeeded: 0, failed: 0, unresolved: 0, unknown: 0, cancelled: 0, running: 0, inherited: 0 },
  })

  it('reports failed Sessions instead of a silent empty list', () => {
    // The symptom this page must never reproduce: 116 Sessions exist, every read
    // fails, and the operator sees only "no records" with no explanation.
    const text = visible(CallIndexDiagnostics({ status: statusWith(['session-read-failed'], 116) }))
    expect(text).toContain('有 Session 读取失败')
    expect(text).toContain('116')
    expect(text).toContain('session-read-failed')
  })

  it('stays quiet when nothing is wrong', () => {
    // Fully indexed: no pending, no failures, no reasons.
    const healthy: StatusView = {
      ...statusWith([]),
      phase: 'complete',
      sessions: { listed: 116, visible: 116, pending: 0, pendingLive: 0, completed: 116, failed: 0 },
    }
    expect(visible(CallIndexDiagnostics({ status: healthy })).trim()).toBe('')
  })

  it('never reports an unfinished scan as a diagnostic at all', () => {
    // Both 「索引扫描进行中」 and 「索引未覆盖全部 Session」 were REMOVED from the red
    // box at the operator's request: a scan that has not walked every Session is
    // ordinary incremental indexing, not a fault, and `pending` is also non-zero
    // for live Sessions that have not been re-read. Progress now belongs to the
    // scan bar (see callIndexScanProgress), so this box must stay silent.
    const finished = visible(CallIndexDiagnostics({ status: { ...statusWith([]), phase: 'complete' } }))
    expect(finished).not.toContain('索引未覆盖全部 Session')
    expect(finished).not.toContain('索引扫描进行中')
    expect(finished.trim()).toBe('')
    const running = visible(CallIndexDiagnostics({ status: { ...statusWith([]), phase: 'running' } }))
    expect(running).not.toContain('索引扫描进行中')
    expect(running.trim()).toBe('')
  })

  it('reports scan progress on the bar instead of the red box', () => {
    const status = { ...statusWith([]), phase: 'running' } as StatusView
    expect(callIndexScanProgress(status).percent).toBe(0)
    expect(callIndexScanProgress(status).detail).toContain('已完成 0 / 116')
    const half = { ...status, sessions: { ...status.sessions, completed: 58, pending: 58 } } as StatusView
    expect(callIndexScanProgress(half).percent).toBe(50)
    const done = { ...status, phase: 'complete', sessions: { ...status.sessions, completed: 116, pending: 0 } } as StatusView
    expect(callIndexScanProgress(done).percent).toBe(100)
    // A missing census must not crash the diagnostic path.
    const noCensus = { ...status, sessions: undefined } as unknown as StatusView
    expect(callIndexScanProgress(noCensus).percent).toBeUndefined()
    expect(callIndexScanProgress(undefined).percent).toBeUndefined()
  })
})

describe('a rejected scan trigger is never silent', () => {
  function lines(props: Record<string, unknown>): string {
    const view = CallIndexDetailPanelView({
      query: normalizeCallIndexQuery(),
      loading: false,
      loadingMore: false,
      loadingDetail: false,
      ...props,
    } as never) as React.ReactElement
    const out: string[] = []
    const walk = (node: unknown): void => {
      if (node === null || node === undefined || typeof node === 'boolean') return
      if (Array.isArray(node)) { for (const child of node) walk(child); return }
      if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return }
      if (typeof node !== 'object') return
      walk((node as { props?: { children?: unknown } }).props?.children)
    }
    walk(view)
    return out.join('\n')
  }

  it('renders the failure when startIndex is rejected', () => {
    const text = lines({
      startFailure: {
        ok: false,
        messageKey: 'callIndex.error.scopeDisabled',
        retryable: false,
        disconnected: false,
      },
    })
    expect(text).toContain('自动索引失败')
  })

  it('renders the created task id and phase on success', () => {
    const text = lines({
      startTask: { taskId: 'abcdef1234567890', mode: 'full', phase: 'running', startedAt: 1, cancelRequested: false },
    })
    expect(text).toContain('abcdef12')
    expect(text).toContain('running')
    expect(text).toContain('（全量）')
  })
})

describe('scope errors are answers, not failures', () => {  it('classifies a disabled scope as scope-unavailable instead of 读取失败', () => {
    const state = callIndexDetailState({
      status: undefined,
      page: undefined,
      query: normalizeCallIndexQuery(),
      loading: false,
      failure: {
        ok: false,
        messageKey: 'callIndex.error.scopeDisabled',
        retryable: false,
        disconnected: false,
      } as never,
    })
    expect(state.kind).toBe('scope-unavailable')
    expect(state.title).not.toContain('读取失败')
    // It must say the index is not enabled rather than implying a broken read.
    expect(state.detail).toContain('callIndex.scope')
  })

  it('still reports a genuine read failure as a failure', () => {
    const state = callIndexDetailState({
      status: undefined,
      page: undefined,
      query: normalizeCallIndexQuery(),
      loading: false,
      failure: {
        ok: false,
        messageKey: 'callIndex.error.internal',
        retryable: true,
        disconnected: false,
      } as never,
    })
    expect(state.kind).toBe('failure')
    expect(state.title).toBe('读取失败')
  })

  it('does not show zero Sessions when the scope never scanned anything', () => {
    const metrics = callIndexOverviewMetrics(
      { summary: { total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 } } as never,
      {
        scope: { status: 'disabled', mode: 'disabled', reason: 'not-enabled' },
        sessions: { listed: 0, visible: 0, pending: 0, pendingLive: 0, completed: 0, failed: 0 },
      } as never,
    )
    // A disabled scope means "never scanned", not "no Sessions exist".
    expect(metrics.sessionsVisible).toBeUndefined()
    expect(metrics.sessionsListed).toBeUndefined()
  })
})
// ---------------------------------------------------------------------------
// Read-coverage honesty: the tool rows come from a bounded number of appended
// pages, so on a large corpus they can be shorter than the headline total.
// Every "share of calls" figure must then say so instead of implying全量.
// ---------------------------------------------------------------------------
describe('read coverage of the tool rows', () => {
  const BIG_SUMMARY = { total: 500, success: 400, error: 5, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 }

  it('tells the detail page how much of the total the rows cover', () => {
    const page = callPage({ total: 500, summary: BIG_SUMMARY })
    const text = visible(CallIndexDetailPanelView({ query: normalizeCallIndexQuery(), page }))
    expect(text).toContain('已读取')
    expect(text).toContain('全部 500 次')
  })

  it('does not claim full coverage on the overview when only part was read', () => {
    const overview = overviewView({ total: 500, summary: BIG_SUMMARY })
    const tools = [{ toolName: 'read', sourceKind: 'native' as const, lastAt: 1, success: 4, error: 0, calls: 5 }]
    const text = visible(CallIndexOverviewPanelView({ overview, tools }))
    expect(text).toContain('已读取')
    expect(text).toContain('共 500 次')
  })
})
