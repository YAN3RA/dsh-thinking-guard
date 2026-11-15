/**
 * 调用明细（N24-c）与总览（N24-d）两个页面。
 *
 * WHY THIS FILE EXISTS — task-1 delivered the pure wire→view adapter
 * (`call-index-adapter.ts`). This module is the rendering side: it owns the
 * query state, the request building, the copy, and the eight empty/degraded
 * states the call index needs. Nothing here re-reads the wire: every read goes
 * through the adapter's mappers first, so the UI never touches a raw reply.
 *
 * HONESTY RULES BAKED IN (they are contract, not style):
 * - `totalExact !== true` ⇒ the number is a LOWER BOUND and renders as `≥N`
 *   with an explicit note. A partial corpus can only prove "at least this
 *   many", so showing a bare `N` would overclaim (D-028).
 * - `unknown` source is 「来源未解析」, never 「未知来源」/「未使用」. The Host
 *   cannot prove a plugin owner, and a tool that left the catalog is labelled
 *   unknown even though it really was MCP — so the count is a superset of the
 *   truly-unresolved, not a measure of unusedness.
 * - A `plugin-tool` / `skill` count of 0 renders a placeholder explanation, not
 *   "未使用": zero matches under incomplete coverage is not evidence of absence.
 * - The corpus (`persisted-plus-observed-live`) and the coverage status are
 *   always stated. Absence of rows never becomes "no calls".
 * - Every optional field the Host may omit (`aggregates`, `task`, `asOf`, …)
 *   renders as an explicit unavailable block, never as zeros.
 *
 * The pure views are hook-free so `tests/client-call-index.spec.tsx` can walk
 * the element tree with no DOM harness — the same pattern as
 * `PluginSectionView` and `UsagePanelView`.
 *
 * @module dsh-thinking-guard/client/call-index
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { V3Styles } from './v3-ui.ts'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  CALL_INDEX_ERROR_MESSAGE_KEYS,
  localDayOffsetMinutes,
  mapCallDetail,
  mapCallPage,
  mapIndexTask,
  mapIndexStatus,
  mapOverview,
  mapSessionPage,
  type CallIndexAggregates,
  type CallIndexCallPageView,
  type CallIndexCallRow,
  type CallIndexCoverage,
  type CallIndexDayBucket,
  type CallIndexDetailView,
  type CallIndexMessageKey,
  type CallIndexOverviewView,
  type CallIndexResult,
  type CallIndexSessionPageView,
  type CallIndexSourceCounts,
  type CallIndexStatusView,
  type CallIndexSummaryCounts,
  type CallIndexTaskView,
  type CallIndexViewError,
} from './call-index-adapter.ts'
import {
  CALL_INDEX_OUTCOMES,
  type CallIndexErrorReason,
  type CallIndexOutcome,
  type CallIndexReply,
  type CallIndexSourceKind,
} from '../usage/call-index-wire.ts'

/** One UTC day in milliseconds. */
const MS_PER_DAY = 86_400_000

/** The page's contractual time filter; `'all'` means "no lower bound". */
export const CALL_INDEX_RANGES = [7, 15, 30, 'all'] as const
export type CallIndexRange = (typeof CALL_INDEX_RANGES)[number]

/**
 * The page's scope filter, which REPLACED the 7/15/30/all day buttons.
 *
 * The day pills were the wrong axis: the operator's question is "which
 * conversations am I looking at", not "how many days back". Three scopes
 * replace four pills, and because none of them imposes a lower time bound the
 * page can no longer show a confident 「确实没有调用」 for data that merely sits
 * outside a default window — the false zero that made 调用明细 look broken
 * while 总览 (a 30-day window) reported 745 calls for the same corpus.
 *
 * The time filter is still supported by the wire and by
 * {@link callIndexRangeWindow}; this page simply always asks for `'all'`.
 */
export const CALL_INDEX_SCOPES = ['session', 'workspace', 'all'] as const
export type CallIndexScope = (typeof CALL_INDEX_SCOPES)[number]

/** Default page size; the wire cap is 200 and this stays well under it. */
export const CALL_INDEX_PAGE_LIMIT = 50

/**
 * How many extra pages the table fills automatically before it stops.
 *
 * The table shows one row per TOOL, so even a large corpus produces few rows;
 * 20 pages x 50 calls covers 1000 calls, well past the point where per-tool
 * aggregation saturates. The cap exists so a hostile snapshot cannot turn the
 * panel into an unbounded request loop.
 */
export const MAX_AUTO_PAGES = 20

/**
 * The window 总览 aggregates over. Stated in the UI, never implied.
 *
 * `'all'`, not `30`: 总览 and 调用明细 must read the SAME corpus. While 总览
 * used a 30-day window and 调用明细 a 7-day one, the same snapshot produced
 * 「745 次调用」 on one tab and 「确实没有调用」 on the other — the contradiction
 * that made the feature look broken. Neither page filters by time any more.
 */
export const CALL_INDEX_OVERVIEW_RANGE: CallIndexRange = 'all'

/** Display order for source kinds: proven first, unresolved last. */
const SOURCE_DISPLAY_ORDER: readonly CallIndexSourceKind[] = ['mcp', 'native', 'plugin-tool', 'skill', 'unknown']

/**
 * Source labels. `unknown` MUST read 「来源未解析」: the Host cannot prove a
 * plugin owner (R-009) and a call whose tool left the catalog keeps the
 * `unknown` label although its real source was known. 「未知来源」/「未使用」
 * would both overclaim.
 */
export const CALL_INDEX_SOURCE_LABELS: Readonly<Record<CallIndexSourceKind, string>> = Object.freeze({
  mcp: 'MCP 工具',
  native: '原生工具',
  'plugin-tool': '第三方插件工具',
  skill: '技能',
  unknown: '来源未解析',
})

/** Outcome labels. `unknown` is 「结果未解析」, mirroring the source wording. */
export const CALL_INDEX_OUTCOME_LABELS: Readonly<Record<CallIndexOutcome, string>> = Object.freeze({
  success: '成功',
  error: '失败',
  cancelled: '已取消',
  unresolved: '未配对结果',
  unknown: '结果未解析',
  running: '进行中',
})


/** Chinese copy for the ten failure keys the adapter emits (UI owns copy). */
export const CALL_INDEX_ERROR_TEXT: Readonly<Record<CallIndexMessageKey, string>> = Object.freeze({
  'callIndex.error.invalidRequest': '请求参数不被接受：本页与 Host 的查询契约不一致，请刷新后重试。',
  'callIndex.error.scopeDisabled': '调用索引未启用：设置里没有打开 host-visible 索引范围，这里没有数据来源。',
  'callIndex.error.persistenceUnavailable': '宿主没有可读的会话持久化后端，历史会话无法索引。',
  'callIndex.error.cursorStale': '分页游标已过期：快照被替换或视图被回收，已重新读取第一页。',
  'callIndex.error.queryCapacity': '查询超出容量上限：请缩小时间范围或增加筛选条件后重试。',
  'callIndex.error.replyTooLarge': '结果过大被 Host 拒绝：请缩小时间范围或增加筛选条件。',
  'callIndex.error.notVisible': '该调用不可见：它已不在当前会话范围内，或已被移出可见集合。',
  'callIndex.error.runtimeUnavailable': '调用索引运行时不可用：Host 未安装或已卸载 callIndex 运行时。',
  'callIndex.error.taskNotFound': '扫描任务不存在：它可能已结束或被新的任务替换。',
  'callIndex.error.internal': 'Host 返回了无效的响应结构，已按错误处理以免显示错误数字。',
})

/** Coverage labels; `unknown` is not `complete`. */
const COVERAGE_LABELS: Readonly<Record<CallIndexCoverage, string>> = Object.freeze({
  complete: '完整',
  partial: '部分',
  unknown: '未知',
})

/**
 * Zero-count placeholders. Required for `plugin-tool` / `skill`; the other
 * kinds get a neutral line so no zero is ever presented as "未使用".
 */
export const CALL_INDEX_ZERO_SOURCE_NOTES: Readonly<Record<CallIndexSourceKind, string>> = Object.freeze({
  mcp: '本次索引未解析到 MCP 来源的调用；覆盖不完整时不能据此判定未使用。',
  native: '本次索引未解析到原生工具调用；覆盖不完整时不能据此判定未使用。',
  'plugin-tool': '本次索引未解析出插件工具归属（插件 owner 不可证明），0 在这里不等于未使用。',
  skill: '本次索引未解析出技能执行入口（技能执行归属尚未验证），0 在这里不等于未使用。',
  unknown: '本次结果中没有需要归入「来源未解析」的调用。',
})

/** Query state of the 调用明细 page. */
export interface CallIndexQuery {
  /**
   * Which conversations the page covers. Replaces the day-range pills; the wire
   * still receives a time window, and this page always sends `'all'`.
   */
  readonly scope?: CallIndexScope
  readonly range: CallIndexRange
  /** Session id filter; exact match. Implied by `scope: 'session'`. */
  readonly sessionId?: string
  /** Workspace filter, matched against the Session cwd. Implied by `scope: 'workspace'`. */
  readonly cwd?: string
  readonly sourceKind?: CallIndexSourceKind
  readonly outcome?: CallIndexOutcome
}

/** A failure the page can render; `disconnected` means "no Host answer at all". */
export interface CallIndexPanelFailure {
  readonly ok: false
  readonly code: CallIndexErrorReason
  readonly messageKey: CallIndexMessageKey
  readonly retryable: boolean
  /**
   * True when the Remote face is missing, the method is missing, the call threw,
   * or the Typert envelope itself failed. Distinguishes 断连 from a business
   * error reply (which is a Host answer and therefore not a disconnect).
   */
  readonly disconnected: boolean
  /** Raw Typert error code, when the failure came from the envelope. */
  readonly hostCode?: string
}

export type CallIndexPanelResult<T> =
  | { readonly ok: true; readonly value: T }
  | CallIndexPanelFailure

/**
 * Structural shape of the mounted `remote.callIndex` namespace
 * (`src/client/call-index-remote.ts`). Every method is optional so a Host that
 * exposes fewer methods degrades to 断连 instead of throwing at mount time.
 */
export interface CallIndexRemoteFace {
  readonly getIndexStatus?: () => Promise<RemoteResult<CallIndexReply>>
  readonly startIndex?: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
  readonly cancelIndex?: (request: unknown) => Promise<RemoteResult<CallIndexReply>>
  readonly getSummary?: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
  readonly listSessions?: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
  readonly listCalls?: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
  readonly getCallDetail?: (request: unknown) => Promise<RemoteResult<CallIndexReply>>
}

/**
 * Lazily resolved face: the section mounts the Remote contribution in `apply`,
 * so the namespace service may not exist yet when the container is constructed.
 */
export type CallIndexFaceProvider = () => CallIndexRemoteFace | undefined

/** Page data source the panels consume. */
export interface CallIndexPanelApi {
  getStatus(): Promise<CallIndexPanelResult<CallIndexStatusView>>
  getOverview(query: CallIndexQuery, now?: number): Promise<CallIndexPanelResult<CallIndexOverviewView>>
  /**
   * `at` pins the time window for a follow-up page. A cursor only matches the
   * filter it was issued with, so callers MUST pass the first page's `now`.
   */
  listCalls(query: CallIndexQuery, cursor?: string, at?: number): Promise<CallIndexPanelResult<CallIndexCallPageView>>
  listSessions(query: CallIndexQuery): Promise<CallIndexPanelResult<CallIndexSessionPageView>>
  getDetail(sessionId: string, callSeq: number): Promise<CallIndexPanelResult<CallIndexDetailView>>
  startIndex?(mode?: 'full' | 'incremental'): Promise<CallIndexPanelResult<CallIndexTaskView>>
}

export interface CallIndexPanelApiOptions {
  /** Clock used for the local day window; defaults to `Date.now`. */
  readonly now?: () => number
  /** Page size; clamped to the wire's `[1, 200]`. */
  readonly limit?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRange(value: unknown): value is CallIndexRange {
  return value === 7 || value === 15 || value === 30 || value === 'all'
}

/** `YYYY-MM-DD HH:mm` in the browser's zone; `—` when unknown. */
export function formatCallIndexTime(time: number | undefined): string {
  if (time === undefined || !Number.isFinite(time)) return '—'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Duration: `—`, `12ms`, or `1.2s`. Never a fabricated zero. */
export function formatCallIndexDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return '—'
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

/**
 * Format a count against its `totalExact` flag.
 *
 * Only `true` may render a bare number. `false` — and `undefined`, which means
 * an older Host never stated it — render as `≥N`, because an unproven count is
 * a lower bound and nothing more (D-028).
 */
export function formatCallIndexCount(value: number | undefined, totalExact?: boolean): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—'
  const text = Math.trunc(value).toLocaleString('en-US')
  return totalExact === true ? text : `≥${text}`
}

/** The sentence that explains a `≥N` number; `undefined` when the count is exact. */
export function callIndexExactnessNote(totalExact: boolean | undefined): string | undefined {
  if (totalExact === true) return undefined
  if (totalExact === false) {
    return '该数字是下界（≥）：覆盖不完整，或来源筛选按标签语义计数，实际调用可能更多。'
  }
  return 'Host 未声明该计数是否精确，按最保守口径显示为下界（≥）。'
}

/** Human label for the time filter. */
export function callIndexRangeLabel(range: CallIndexRange): string {
  return range === 'all' ? '全部' : `${range} 天`
}

/**
 * Local-day window for `range`, expressed as the wire's half-open
 * `[fromMs, toMs)`. `'all'` carries no lower bound.
 *
 * The boundary is computed in the same shifted-day space the Host buckets
 * `byDay` in (`dayOffsetMinutes` minutes east of UTC), so the trend's first day
 * and the filter's first instant cannot disagree.
 */
export function callIndexRangeWindow(
  range: CallIndexRange,
  now: number,
  dayOffsetMinutes: number,
): { readonly fromMs?: number; readonly toMs?: number } {
  if (range === 'all') return {}
  const safeNow = Number.isFinite(now) ? now : Date.now()
  const offsetMs = (Number.isFinite(dayOffsetMinutes) ? dayOffsetMinutes : 0) * 60_000
  const shiftedNow = safeNow + offsetMs
  // Midnight (local) of today, converted back to a UTC instant.
  const todayStart = Math.floor(shiftedNow / MS_PER_DAY) * MS_PER_DAY - offsetMs
  return { fromMs: todayStart - (range - 1) * MS_PER_DAY }
}

function isScope(value: unknown): value is CallIndexScope {
  return value === 'session' || value === 'workspace' || value === 'all'
}

/**
 * Normalize partial input into a usable query; never throws.
 *
 * The default range is `'all'`, not `7`: a day window is a filter the operator
 * can no longer choose, so defaulting it to a week could only ever HIDE rows
 * behind an invisible constraint. `scope` defaults to `'all'` for the same
 * reason — the widest honest answer first.
 */
export function normalizeCallIndexQuery(initial?: Partial<CallIndexQuery>): CallIndexQuery {
  const range = isRange(initial?.range) ? initial.range : 'all'
  const scope = isScope(initial?.scope) ? initial.scope : 'all'
  const nonEmpty = (value: string | undefined): string | undefined => (
    typeof value === 'string' && value !== '' ? value : undefined
  )
  const sessionId = nonEmpty(initial?.sessionId)
  const cwd = nonEmpty(initial?.cwd)
  const sourceKind = typeof initial?.sourceKind === 'string'
    && (SOURCE_DISPLAY_ORDER as readonly string[]).includes(initial.sourceKind)
    ? initial.sourceKind as CallIndexSourceKind
    : undefined
  const outcome = typeof initial?.outcome === 'string'
    && (CALL_INDEX_OUTCOMES as readonly string[]).includes(initial.outcome)
    ? initial.outcome
    : undefined
  return {
    scope,
    range,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(sourceKind === undefined ? {} : { sourceKind }),
    ...(outcome === undefined ? {} : { outcome }),
  }
}

/**
 * Scope labels. `session` / `workspace` narrow the set to the LIVE context, so
 * the label must say what it is bound to; the hint line does that.
 */
export const CALL_INDEX_SCOPE_LABELS: Readonly<Record<CallIndexScope, string>> = Object.freeze({
  session: '按会话',
  workspace: '按工作区',
  all: '全部',
})

/**
 * The context a `session` / `workspace` scope binds to.
 *
 * This page renders inside `settings.section`, which receives no Session
 * standard props (the slot's owner share is only `close`), so the live target
 * is supplied by the container that CAN see it. When it is missing the scope
 * falls back to `all` and says so, rather than silently filtering on
 * `undefined` and showing an empty table.
 */
export interface CallIndexScopeTarget {
  readonly sessionId?: string
  readonly cwd?: string
}

/**
 * Apply one scope to a query, binding it to the live target when required.
 *
 * Returns the query unchanged (scope only) when the target for that scope is
 * unknown: a scope that cannot be resolved must not filter, or the page would
 * claim 「确实没有调用」 for rows it simply refused to ask for.
 */
export function scopeQuery(scope: CallIndexScope, query: CallIndexQuery): Partial<CallIndexQuery> {
  const base: Partial<CallIndexQuery> = { scope, range: 'all' }
  if (scope === 'session') {
    return query.sessionId === undefined ? base : { ...base, sessionId: query.sessionId, cwd: undefined }
  }
  if (scope === 'workspace') {
    return query.cwd === undefined ? base : { ...base, cwd: query.cwd, sessionId: undefined }
  }
  return { ...base, sessionId: undefined, cwd: undefined }
}

/** One Session the operator can switch 调用明细 to. */
export interface CallIndexSessionChoice {
  readonly id: string
  /** Host-provided display name; falls back to the id when the catalog has none. */
  readonly name: string
  readonly cwd?: string
}

/** Host Session catalog: the live selection plus everything switchable. */
export interface CallIndexSessionCatalog {
  readonly current?: CallIndexSessionChoice
  readonly items: readonly CallIndexSessionChoice[]
}

/**
 * One line explaining what a narrowed scope is bound to.
 *
 * Shows the Session NAME, never the id: 「会话 session-f46f」 does not tell the
 * operator which conversation they are reading, which was the complaint. The id
 * survives only as a fallback for a Session the Host catalog cannot name, where
 * showing nothing would be worse than showing the id.
 */
export function scopeHint(
  query: CallIndexQuery,
  catalog?: CallIndexSessionCatalog,
): string | undefined {
  if (query.scope === 'session') {
    if (query.sessionId === undefined) return '未识别当前会话，已按全部范围展示。'
    return `会话 ${callIndexSessionName(query.sessionId, catalog)}`
  }
  if (query.scope === 'workspace') {
    return query.cwd === undefined ? '未识别当前工作区，已按全部范围展示。' : `工作区 ${query.cwd}`
  }
  return undefined
}

/** Display name for one Session id, from the Host catalog when it can name it. */
export function callIndexSessionName(sessionId: string, catalog?: CallIndexSessionCatalog): string {
  if (catalog !== undefined) {
    const hit = catalog.items.find(item => item.id === sessionId)
    if (hit !== undefined && hit.name !== '') return hit.name
    if (catalog.current?.id === sessionId && catalog.current.name !== '') return catalog.current.name
  }
  return shortCallIndexSessionId(sessionId)
}

/** True when any dimension narrows the set, including a non-`'all'` scope. */
export function hasCallIndexFilters(query: CallIndexQuery): boolean {
  if (query.scope !== undefined && query.scope !== 'all') return true
  return query.sessionId !== undefined || query.cwd !== undefined
    || query.sourceKind !== undefined || query.outcome !== undefined
}

/**
 * The `query` object for the wire's `.strict()` request schemas.
 *
 * Only fields the contract defines are emitted: an extra key would make the
 * Host answer `invalid-request`, so nothing is passed through from UI state
 * without being named here.
 */
export function buildCallIndexQueryFilter(
  query: CallIndexQuery,
  now: number = Date.now(),
  dayOffsetMinutes: number = localDayOffsetMinutes(now),
): Record<string, unknown> {
  const window = callIndexRangeWindow(query.range, now, dayOffsetMinutes)
  return {
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
    ...(query.cwd === undefined ? {} : { cwd: query.cwd }),
    ...(query.sourceKind === undefined ? {} : { sourceKind: query.sourceKind }),
    ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
    ...(window.fromMs === undefined ? {} : { fromMs: window.fromMs }),
    ...(window.toMs === undefined ? {} : { toMs: window.toMs }),
  }
}

/** `listCalls` / `listSessions` request. */
export function buildCallIndexListRequest(
  query: CallIndexQuery,
  options: { readonly cursor?: string; readonly limit?: number; readonly now?: number } = {},
): Record<string, unknown> {
  const now = options.now ?? Date.now()
  const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? CALL_INDEX_PAGE_LIMIT)))
  return {
    query: buildCallIndexQueryFilter(query, now),
    limit,
    ...(options.cursor === undefined || options.cursor === '' ? {} : { cursor: options.cursor }),
  }
}

/** `getSummary` request; `dayOffsetMinutes` is what makes `byDay` local. */
export function buildCallIndexSummaryRequest(
  query: CallIndexQuery,
  now: number = Date.now(),
): Record<string, unknown> {
  return {
    query: buildCallIndexQueryFilter(query, now),
    dayOffsetMinutes: localDayOffsetMinutes(now),
  }
}

function disconnectedFailure(hostCode?: string): CallIndexPanelFailure {
  return {
    ok: false,
    code: 'runtime-unavailable',
    messageKey: CALL_INDEX_ERROR_MESSAGE_KEYS['runtime-unavailable'],
    retryable: true,
    disconnected: true,
    ...(hostCode === undefined ? {} : { hostCode }),
  }
}

function fromAdapterError(error: CallIndexViewError): CallIndexPanelFailure {
  return {
    ok: false,
    code: error.code,
    messageKey: error.messageKey,
    retryable: error.retryable,
    disconnected: false,
  }
}

/** Resolve a failure to its Chinese sentence. */
export function callIndexFailureText(failure: CallIndexPanelFailure): string {
  return CALL_INDEX_ERROR_TEXT[failure.messageKey]
}

/**
 * Explain a scope error the Host answered with, or `undefined` if this failure
 * is not about scope.
 *
 * `scope-disabled` and `persistence-unavailable` are answers, not faults: the
 * Host is telling the page "there is no corpus to read". They must not be
 * rendered as 「读取失败」 — that misleads the operator into hunting a bug when
 * the fix is a config change (or is simply the safe default working as designed).
 */
export function callIndexScopeFailureReason(failure: CallIndexPanelFailure): string | undefined {
  switch (failure.messageKey) {
    case 'callIndex.error.scopeDisabled':
      return '调用索引未启用：配置项 callIndex.scope 仍是默认的 disabled。'
    case 'callIndex.error.persistenceUnavailable':
      return '宿主没有可读的会话持久化后端，历史会话无法索引。'
    default:
      return undefined
  }
}

/**
 * Build the panels' `api` on top of the real `remote.callIndex` face.
 *
 * The face is re-resolved on every call, so a namespace that mounts later (or
 * is replaced after a reload) is picked up without rebuilding the object. Every
 * thrown call and every failed Typert envelope becomes an explicit
 * `disconnected` failure, so the page can say "断连" instead of rendering
 * "0 calls".
 */
export function createCallIndexPanelApi(
  face: CallIndexRemoteFace | CallIndexFaceProvider | undefined,
  options: CallIndexPanelApiOptions = {},
): CallIndexPanelApi {
  const now = options.now ?? ((): number => Date.now())
  const resolve = (): CallIndexRemoteFace | undefined => (
    typeof face === 'function' ? face() : face
  )

  async function run<T>(
    call: (target: CallIndexRemoteFace) => Promise<RemoteResult<CallIndexReply>> | undefined,
    project: (reply: unknown) => CallIndexResult<T>,
  ): Promise<CallIndexPanelResult<T>> {
    const target = resolve()
    if (target === undefined) return disconnectedFailure()
    let envelope: RemoteResult<CallIndexReply> | undefined
    try {
      envelope = await call(target)
    } catch {
      return disconnectedFailure()
    }
    if (envelope === undefined) return disconnectedFailure()
    if (!isRecord(envelope)) return disconnectedFailure()
    if (envelope.ok !== true) {
      // A failed Typert envelope is not a Host business answer: the reply never
      // arrived, so the page treats it as 断连 and keeps the raw code for support.
      const code = isRecord(envelope.error) && typeof envelope.error.code === 'string'
        ? envelope.error.code
        : undefined
      return disconnectedFailure(code)
    }
    const mapped = project(envelope.value)
    return mapped.ok ? { ok: true, value: mapped.value } : fromAdapterError(mapped.error)
  }

  return {
    getStatus: () => run(
      target => target.getIndexStatus?.(),
      mapIndexStatus,
    ),
    getOverview: (query, at) => run(
      target => target.getSummary?.(buildCallIndexSummaryRequest(query, at ?? now())),
      mapOverview,
    ),
    // `at` pins the time window. A cursor is only valid for the exact filter it
    // was issued with, so a follow-up page MUST reuse the first page's `now`.
    listCalls: (query, cursor, at) => run(
      target => target.listCalls?.(buildCallIndexListRequest(query, {
        ...(cursor === undefined ? {} : { cursor }),
        limit: options.limit ?? CALL_INDEX_PAGE_LIMIT,
        now: at ?? now(),
      })),
      mapCallPage,
    ),
    listSessions: query => run(
      target => target.listSessions?.(buildCallIndexListRequest(query, {
        limit: options.limit ?? CALL_INDEX_PAGE_LIMIT,
        now: now(),
      })),
      mapSessionPage,
    ),
    getDetail: (sessionId, callSeq) => run(
      target => target.getCallDetail?.({ sessionId, callSeq }),
      mapCallDetail,
    ),
    startIndex: (mode?: 'full' | 'incremental') => run(
      target => target.startIndex?.(mode === undefined ? undefined : { mode }),
      mapIndexTask,
    ),
  }
}

/** How many calls each outcome contributes, for the 失败 / 未完成 metric. */
export interface CallIndexOutcomeMix {
  readonly failed: number
  readonly unresolved: number
  readonly running: number
  /** `unresolved + running`: cost spent without a confirmed result. */
  readonly unfinished: number
  readonly succeeded: number
  readonly total: number
}

export function callIndexOutcomeMix(summary: CallIndexSummaryCounts | undefined): CallIndexOutcomeMix | undefined {
  if (summary === undefined) return undefined
  const unfinished = summary.unresolved + summary.running
  return {
    failed: summary.error,
    unresolved: summary.unresolved,
    running: summary.running,
    unfinished,
    succeeded: summary.success,
    total: summary.total,
  }
}

/** One `bySource` bar. */
export interface CallIndexSourceDatum {
  readonly kind: CallIndexSourceKind
  readonly label: string
  readonly count: number
  /** `0..1` of the filtered set; 0 when the set is empty. */
  readonly share: number
  /** Present only when `count === 0`; explains the zero without claiming "unused". */
  readonly zeroNote?: string
}

/**
 * `bySource` for display. Always returns all five kinds in a fixed order, so
 * the distribution never reshuffles between reads; a zero carries its
 * placeholder instead of disappearing.
 */
export function callIndexSourceData(
  bySource: CallIndexSourceCounts | undefined,
): readonly CallIndexSourceDatum[] {
  const total = bySource === undefined
    ? 0
    : SOURCE_DISPLAY_ORDER.reduce((sum, kind) => sum + bySource[kind], 0)
  return SOURCE_DISPLAY_ORDER.map(kind => {
    const count = bySource?.[kind] ?? 0
    return {
      kind,
      label: CALL_INDEX_SOURCE_LABELS[kind],
      count,
      share: total > 0 ? count / total : 0,
      ...(count === 0 ? { zeroNote: CALL_INDEX_ZERO_SOURCE_NOTES[kind] } : {}),
    }
  })
}

/** Geometry of the self-drawn trend; computed here so it is testable. */
export interface CallIndexTrendBar {
  readonly day: string
  readonly calls: number
  readonly success: number
  readonly error: number
  /** `0..1` relative to the tallest bar. */
  readonly ratio: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CallIndexTrendChart {
  readonly width: number
  readonly height: number
  readonly bars: readonly CallIndexTrendBar[]
  readonly maxCalls: number
  /** False when the Host did not send `byDay` — the UI must say so, not draw axes. */
  readonly available: boolean
  /** Sum of the bars; the trend's own total, not the filtered total. */
  readonly totalCalls: number
}

/** Fixed chart box; the SVG scales with CSS but the geometry is deterministic. */
export const CALL_INDEX_TREND_GEOMETRY = Object.freeze({ width: 640, height: 160, paddingTop: 8, paddingBottom: 22, gap: 2 })

/**
 * Bar geometry for `byDay`. A zero-height bar is a real zero bucket (the Host
 * only emits buckets it has rows for), so it renders as a 1px stub rather than
 * vanishing.
 */
export function callIndexTrend(buckets: readonly CallIndexDayBucket[] | undefined): CallIndexTrendChart {
  const geometry = CALL_INDEX_TREND_GEOMETRY
  const plotHeight = geometry.height - geometry.paddingTop - geometry.paddingBottom
  if (buckets === undefined || buckets.length === 0) {
    return { width: geometry.width, height: geometry.height, bars: [], maxCalls: 0, available: buckets !== undefined, totalCalls: 0 }
  }
  let maxCalls = 0
  let totalCalls = 0
  for (const bucket of buckets) {
    totalCalls += bucket.calls
    if (bucket.calls > maxCalls) maxCalls = bucket.calls
  }
  const slot = geometry.width / buckets.length
  const width = Math.max(1, slot - geometry.gap)
  const bars = buckets.map((bucket, index) => {
    const ratio = maxCalls > 0 ? bucket.calls / maxCalls : 0
    const height = ratio > 0 ? Math.max(1, ratio * plotHeight) : 1
    return {
      day: bucket.day,
      calls: bucket.calls,
      success: bucket.success,
      error: bucket.error,
      ratio,
      x: index * slot + geometry.gap / 2,
      y: geometry.height - geometry.paddingBottom - height,
      width,
      height,
    }
  })
  return { width: geometry.width, height: geometry.height, bars, maxCalls, available: true, totalCalls }
}

/**
 * The eight notice states the 调用明细 page must render, plus `ready` (the
 * absence of a notice — included so the function is total and the render branch
 * has no `undefined` case).
 */
export type CallIndexDetailStateKind =
  | 'initial'
  | 'scanning'
  | 'no-data'
  | 'filter-empty'
  | 'partial'
  | 'failure'
  | 'scope-unavailable'
  | 'disconnected'
  | 'ready'

export interface CallIndexDetailState {
  readonly kind: CallIndexDetailStateKind
  readonly title: string
  readonly detail: string
  /** Rows are still observations and stay on screen under the notice. */
  readonly keepsRows: boolean
  readonly canRetry: boolean
}

export interface CallIndexDetailStateInput {
  readonly status?: CallIndexStatusView
  readonly page?: CallIndexCallPageView
  readonly query: CallIndexQuery
  readonly loading: boolean
  readonly failure?: CallIndexPanelFailure
}

/**
 * Decide which of the states the page is in.
 *
 * Precedence is deliberate: no Host answer beats any Host answer, a business
 * failure beats stale data, and an unusable scope beats "empty" — because an
 * empty list under a disabled scope is not evidence of no calls.
 */
export function callIndexDetailState(input: CallIndexDetailStateInput): CallIndexDetailState {
  const { status, page, query, loading, failure } = input
  // A scope error is NOT a read failure: the Host answered correctly, it just
  // has no corpus to read because the operator left `callIndex.scope` at its
  // safe default. Reporting that as 「读取失败」 reads like a bug, so it is
  // classified first, before the generic failure branch.
  const scopeReason = failure !== undefined && !failure.disconnected ? callIndexScopeFailureReason(failure) : undefined
  if (scopeReason !== undefined) {
    return {
      kind: 'scope-unavailable',
      title: '索引范围未启用',
      detail: `${scopeReason}这不是错误：D-026 的默认范围是 disabled，可以跨 Profile 的历史读取必须显式开启。`,
      keepsRows: false,
      canRetry: false,
    }
  }
  if (failure !== undefined) {
    if (failure.disconnected) {
      return {
        kind: 'disconnected',
        title: '与 Host 断连',
        detail: `${callIndexFailureText(failure)}${failure.hostCode === undefined ? '' : `（${failure.hostCode}）`}`,
        keepsRows: page !== undefined,
        canRetry: true,
      }
    }
    return {
      kind: 'failure',
      title: '读取失败',
      detail: callIndexFailureText(failure),
      keepsRows: page !== undefined,
      canRetry: failure.retryable,
    }
  }
  if (status !== undefined && status.scope.status !== 'ready') {
    const reason = status.scope.reason === 'persistence-unavailable'
      ? '宿主没有可读的会话持久化后端。'
      : status.scope.reason === 'unsupported-scope'
        ? '当前模式不支持 host-visible 范围。'
        : '索引范围未启用（host-visible）。'
    return {
      kind: 'scope-unavailable',
      title: '索引范围不可用',
      detail: `${reason}这里没有数据来源，显示 0 并不代表未使用。`,
      keepsRows: false,
      canRetry: false,
    }
  }
  if (page === undefined) {
    if (loading) return { kind: 'initial', title: '正在读取调用明细…', detail: '首次读取尚未返回。', keepsRows: false, canRetry: false }
    return { kind: 'initial', title: '尚未读取调用明细', detail: '点击刷新以读取调用索引。', keepsRows: false, canRetry: true }
  }
  const scanning = status !== undefined
    && (status.phase === 'running' || status.sessions.pending > 0 || status.sessions.pendingLive > 0)
  // A running scan beats "empty": while the scan is still walking the corpus,
  // zero rows is an unfinished observation, not a coverage finding. Reporting
  // 「覆盖不完整」here hides the very counters (扫描状态 / 扫描提示 / 事件读取)
  // that explain progress, which is what made a live scan look like a failure.
  if (page.items.length === 0 && scanning) {
    return {
      kind: 'scanning',
      title: '索引扫描进行中，尚未产出调用行',
      detail: '扫描还在读取会话历史，此刻的 0 不代表没有调用；下方的扫描状态与事件读取说明了进度。',
      keepsRows: false,
      canRetry: false,
    }
  }
  if (page.items.length === 0) {
    if (hasCallIndexFilters(query)) {
      return {
        kind: 'filter-empty',
        title: '当前筛选没有匹配的调用',
        detail: `筛选把结果过滤为空；放宽条件后可能仍有记录（总集合 ${formatCallIndexCount(page.total, page.totalExact)} 条）。`,
        keepsRows: false,
        canRetry: true,
      }
    }
    if (page.coverage === 'complete' && page.total === 0) {
      return {
        kind: 'no-data',
        title: '所选范围内没有调用记录',
        detail: '覆盖完整且总数为 0，这是「确实没有调用」，不是缺数据。',
        keepsRows: false,
        canRetry: true,
      }
    }
    return {
      kind: 'partial',
      title: '没有可显示的明细，且覆盖不完整',
      detail: '当前没有已解析的调用行，但覆盖状态不是 complete，不能据此判定能力未使用。',
      keepsRows: false,
      canRetry: true,
    }
  }
  if (scanning) {
    return {
      kind: 'scanning',
      title: '索引扫描进行中',
      detail: '下面显示的是已解析的部分结果；扫描完成后总数会增加。',
      keepsRows: true,
      canRetry: false,
    }
  }
  if (page.coverage !== 'complete') {
    return {
      kind: 'partial',
      title: '覆盖不完整',
      detail: `当前快照覆盖状态为「${COVERAGE_LABELS[page.coverage]}」：下面的数字是已观察到的下限，不能当作完整调用量。`,
      keepsRows: true,
      canRetry: true,
    }
  }
  return { kind: 'ready', title: '', detail: '', keepsRows: true, canRetry: false }
}

/** Metrics rendered on the 总览 page. */
export interface CallIndexOverviewMetrics {
  readonly calls: number | undefined
  readonly callsTotalExact: boolean | undefined
  readonly failed: number | undefined
  readonly unfinished: number | undefined
  readonly distinctTools: number | undefined
  readonly sessionsVisible: number | undefined
  readonly sessionsListed: number | undefined
  readonly aggregates: CallIndexAggregates | undefined
  readonly tasks?: CallIndexTaskView
}

export function callIndexOverviewMetrics(
  overview: CallIndexOverviewView | undefined,
  status: CallIndexStatusView | undefined,
): CallIndexOverviewMetrics {
  const summary = overview?.summary
  // `getIndexStatus` answers even when the scope is disabled (it is reachable
  // by design), so `sessions.visible/listed` are 0 simply because nothing was
  // ever scanned. Rendering that as `≥0` would read as "zero Sessions exist",
  // which is exactly the false-zero this page must never show.
  const scoped = status !== undefined && status.scope.status === 'ready'
  return {
    calls: summary?.total ?? overview?.total,
    callsTotalExact: overview?.totalExact,
    failed: summary?.error,
    unfinished: summary === undefined ? undefined : summary.unresolved + summary.running,
    // `aggregates` comes from the same read as `total`, so the same exactness
    // flag governs `distinctTools`: a lower bound stays a lower bound.
    distinctTools: overview?.aggregates?.distinctTools,
    sessionsVisible: scoped ? status.sessions.visible : undefined,
    sessionsListed: scoped ? status.sessions.listed : undefined,
    aggregates: overview?.aggregates,
    ...(status?.task === undefined ? {} : { tasks: status.task }),
  }
}

/** True when `plugin-tool` and `skill` both resolved to zero. */
export function callIndexHasUnexplainedSources(aggregates: CallIndexAggregates | undefined): boolean {
  if (aggregates === undefined) return false
  return aggregates.bySource['plugin-tool'] === 0 && aggregates.bySource.skill === 0
}

/**
 * Corpus wording. The wire's only value is
 * `persisted-plus-observed-live`, and the page must state it: the index covers
 * persisted history PLUS what it observed after mounting — never a live-only
 * and never a complete history claim.
 */
export function callIndexCorpusLabel(corpus: string | undefined): string {
  if (corpus === 'persisted-plus-observed-live') {
    return '数据范围：已持久化的历史记录 + 本插件挂载后实时观测到的调用（挂载前的实时流不在其中）。'
  }
  return '数据范围：Host 未声明 corpus，无法确认历史是否完整。'
}

/** One row's turn/step cell: `T2 · S3`, `T2`, `S3`, or `—`. */
export function formatCallIndexTurnStep(row: CallIndexCallRow): string {
  const parts: string[] = []
  if (row.turn !== undefined) parts.push(`T${row.turn}`)
  if (row.step !== undefined) parts.push(`S${row.step}`)
  return parts.length === 0 ? '—' : parts.join(' · ')
}

/** Short Session id for a dense table cell; the full id stays in `title`. */
export function shortCallIndexSessionId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : sessionId.slice(0, 12)
}

/** Inline stylesheet; a `<style>` element keeps this file dependency-free. */
function CallIndexStyles(): ReactElement {
  return createElement('style', { 'data-call-index-style': 'true' },
    '.mc-ci-filter{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}'
    + '.mc-ci-filter label{display:flex;gap:4px;align-items:center;font-size:12px}'
    // The table scrolls inside a bounded box instead of pushing the page down:
    // 「展示全部」 means every tool row is reachable, not that the panel grows to
    // the length of the corpus.
    + '.mc-ci-table-scroll{width:100%;overflow:auto;max-height:min(60vh,560px);overscroll-behavior:contain}'
    + '.mc-ci-table{width:100%;border-collapse:collapse;font-size:12px}'
    + '.mc-ci-table thead th{position:sticky;top:0;z-index:1;background:var(--mc-surface,Canvas);'
    + 'box-shadow:inset 0 -1px 0 color-mix(in srgb,currentColor 12%,transparent)}'
    + '.mc-ci-progress{display:flex;flex-direction:column;gap:4px;margin:8px 0}'
    + '.mc-ci-progress-track{height:6px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,currentColor 12%,transparent)}'
    + '.mc-ci-progress-fill{height:100%;border-radius:999px;background:color-mix(in srgb,currentColor 55%,transparent);transition:width .3s ease}'
    + '.mc-ci-progress-fill.is-indeterminate{animation:mc-ci-indeterminate 1.1s ease-in-out infinite}'
    + '@keyframes mc-ci-indeterminate{0%{transform:translateX(-60%)}100%{transform:translateX(340%)}}'
    + '@media (prefers-reduced-motion:reduce){.mc-ci-progress-fill{transition:none}'
    + '.mc-ci-progress-fill.is-indeterminate{animation:none;width:100%!important;opacity:.4}}'
    + '.mc-ci-session-picker{display:inline-flex;align-items:center;gap:6px;font-size:12px}'
    + '.mc-ci-session-picker-label{opacity:.7}'
    + '.mc-ci-session-select{max-width:280px;padding:3px 6px;border-radius:6px;font-size:12px;'
    + 'border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit}'
    + '.mc-ci-session-select:disabled{opacity:.5}'
    + '.mc-ci-progress-meta{display:flex;gap:8px;align-items:baseline;font-size:12px}'
    + '.mc-ci-progress-value{font-variant-numeric:tabular-nums;font-weight:600}'
    + '.mc-ci-progress-detail{opacity:.72}'
    + '.mc-ci-table th,.mc-ci-table td{padding:4px 6px;text-align:left;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);white-space:nowrap}'
    + '.mc-ci-table tbody tr{cursor:pointer}'
    + '.mc-ci-table tbody tr[aria-selected="true"]{background:color-mix(in srgb,currentColor 8%,transparent)}'
    + '.mc-ci-table td:nth-child(2),.mc-ci-table td:nth-child(4){max-width:220px;overflow:hidden;text-overflow:ellipsis}'
    + '.mc-ci-table th:nth-child(2),.mc-ci-table th:nth-child(4){max-width:220px}'
    + '.mc-ci-num{font-variant-numeric:tabular-nums}'
    + '.mc-ci-bar{display:flex;height:8px;gap:1px;margin:4px 0}'
    + '.mc-ci-bar > span{display:block;height:100%;min-width:2px}'
    + '.mc-ci-aside{border-left:1px solid color-mix(in srgb,currentColor 15%,transparent);padding-left:12px;min-width:240px;font-size:12px}'
    + '.mc-ci-metric{display:inline-flex;flex-direction:column;margin-right:18px;min-width:110px;vertical-align:top}'
    + '.mc-ci-metric-label{font-size:11px;opacity:.7}'
    + '.mc-ci-metric-value{font-size:18px;font-variant-numeric:tabular-nums}'
    + '.mc-ci-metric-hint{font-size:11px;opacity:.75}'
    + '.mc-ci-trend svg{width:100%;max-width:640px;height:auto}'
    // ---- v3 page-specific classes (container/breakpoints live in V3Styles) ----
    + '.v3-status-pills{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px}'
    + '.v3-statusline.v3-status-dash{border-style:dashed;color:var(--v3-t4)}'
    + '.v3-filtercard{padding:11px 14px 13px}'
    + '.v3-filter-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:9px}'
    + '.v3-search{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border:1px solid var(--v3-line);border-radius:var(--v3-r-sm);background:var(--v3-panel-2);min-width:150px;flex:1 1 150px}'
    + '.v3-search input{border:0;background:transparent;color:var(--v3-t1);font:inherit;font-size:12px;width:100%;outline:0;min-width:0}'
    + '.v3-search input::placeholder{color:var(--v3-t4)}'
    + '.v3-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}'
    + '.v3-kv-l{font-size:11px;color:var(--v3-t4)}'
    + '.v3-kv-v{font-size:12px;color:var(--v3-t2);margin-top:2px;overflow-wrap:anywhere}'
    + '.v3-ts.v3-ts--h330{max-height:330px}'
    + '.v3-src i[data-zero="true"]{background:var(--v3-panel-2)}',
  )
}

/** One v3 `.v3-stat` cell: label, big value, optional hint line, optional sparkline. */
function V3Stat(props: {
  readonly label: string
  readonly value: ReactNode
  readonly hint?: ReactNode
  readonly spark?: ReactNode
}): ReactElement {
  return createElement('div', { className: 'v3-stat', 'data-call-index-metric': props.label },
    createElement('div', { className: 'v3-stat-l' }, props.label),
    createElement('div', { className: 'v3-stat-v v3-num' }, props.value),
    props.hint === undefined ? null : createElement('div', { className: 'v3-stat-d' }, props.hint),
    props.spark ?? null,
  )
}

/** Values → `x,y` points inside a 100×22 viewBox, baselined at 0. */
function sparkPoints(values: readonly number[]): { readonly line: string; readonly area: string } {
  const W = 100, H = 22
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  const scale = max > 0 ? max : 1
  const xAt = (i: number): number => (values.length <= 1 ? W / 2 : (i * W) / (values.length - 1))
  const yAt = (v: number): number => H - 2 - (v / scale) * (H - 4)
  const pts = values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
  return { line: pts.join(' '), area: `0,${H} ${pts.join(' ')} ${W},${H}` }
}

/** 22px trend sparkline: a line plus a translucent area fill, coloured by tone. */
function Sparkline(props: {
  readonly values: readonly number[]
  readonly tone: 'info' | 'ok' | 'bad'
}): ReactElement | null {
  if (props.values.length < 2) return null
  const points = sparkPoints(props.values)
  const colour = props.tone === 'ok' ? 'var(--v3-ok)' : props.tone === 'bad' ? 'var(--v3-bad)' : 'var(--v3-info)'
  return createElement('svg', {
    className: 'v3-spark', viewBox: '0 0 100 22', preserveAspectRatio: 'none', 'aria-hidden': 'true',
    'data-call-index-spark': props.tone,
  },
  createElement('polygon', { className: 'v3-spark-fl', points: points.area, fill: colour }),
  createElement('polyline', { className: 'v3-spark-ln', points: points.line, stroke: colour }),
  )
}

/** `server · tool` for an `mcp__` name, otherwise the bare tool name. */
function toolDisplayLabel(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    return parts.length >= 3 ? `${parts[1]} · ${parts.slice(2).join('__')}` : toolName
  }
  return toolName
}

/**
 * The v3 overview trend: a 720×212 line + area (calls), failure底柱 (error), a
 * dashed "recent week" band and a peak label. Drawn from `callIndexTrend`'s bars
 * so its numbers are the same ones the caption quotes — no second data path.
 */
function OverviewTrendSvg(props: { readonly chart: CallIndexTrendChart }): ReactElement {
  const { chart } = props
  const W = 720, H = 212, padL = 34, padR = 10, padT = 12, padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const bars = chart.bars
  const n = bars.length
  const maxV = chart.maxCalls > 0 ? Math.ceil(chart.maxCalls / 10) * 10 : 1
  const xAt = (i: number): number => padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))
  const yAt = (v: number): number => padT + plotH - (v / maxV) * plotH
  const points = bars.map((bar, i) => `${xAt(i).toFixed(1)},${yAt(bar.calls).toFixed(1)}`)
  let peak = 0
  for (let i = 1; i < n; i++) if (bars[i]!.calls > bars[peak]!.calls) peak = i
  const children: ReactNode[] = []
  if (n > 0) {
    const start = Math.max(0, n - 7)
    const slot = n > 1 ? plotW / (n - 1) : plotW
    const left = Math.max(padL, xAt(start) - slot / 2)
    const right = Math.min(W - padR, xAt(n - 1) + slot / 2)
    children.push(createElement('rect', {
      key: 'hl', className: 'v3-hlbox', x: left.toFixed(1), y: padT,
      width: Math.max(0, right - left).toFixed(1), height: plotH.toFixed(1), rx: 4,
    }))
  }
  for (let g = 0; g <= 4; g++) {
    const value = (maxV * g) / 4
    const y = yAt(value)
    children.push(createElement('line', { key: `grid-${g}`, className: 'v3-grid', x1: padL, y1: y.toFixed(1), x2: W - padR, y2: y.toFixed(1) }))
    children.push(createElement('text', { key: `tick-${g}`, className: 'v3-axis', x: padL - 7, y: (y + 3.5).toFixed(1), 'text-anchor': 'end' }, String(Math.round(value))))
  }
  const barWidth = Math.max(4, plotW / Math.max(1, n) - 8)
  bars.forEach((bar, i) => {
    if (bar.error <= 0) return
    const errH = Math.max(2.5, (bar.error / maxV) * plotH)
    children.push(createElement('rect', {
      key: `err-${bar.day}`, className: 'v3-bar-er', x: (xAt(i) - barWidth / 2).toFixed(1),
      y: (padT + plotH - errH).toFixed(1), width: barWidth.toFixed(1), height: errH.toFixed(1), rx: 1.5,
    }, createElement('title', null, `${bar.day}：失败 ${bar.error} 次`)))
  })
  children.push(createElement('polygon', { key: 'area', className: 'v3-area', points: `${padL},${padT + plotH} ${points.join(' ')} ${W - padR},${padT + plotH}` }))
  children.push(createElement('polyline', { key: 'line', className: 'v3-line', points: points.join(' ') }))
  bars.forEach((bar, i) => {
    if (i % 4 !== 0 && i !== n - 1 && i !== peak) return
    children.push(createElement('circle', {
      key: `pt-${bar.day}`, className: 'v3-pt', cx: xAt(i).toFixed(1), cy: yAt(bar.calls).toFixed(1), r: 2.6,
    }, createElement('title', null, `${bar.day}：${bar.calls} 次调用，失败 ${bar.error} 次`)))
  })
  if (n > 0) {
    children.push(createElement('text', { key: 'peak', className: 'v3-lbl-b', x: (xAt(peak) - 8).toFixed(1), y: (yAt(bars[peak]!.calls) - 9).toFixed(1), 'text-anchor': 'end' }, `峰值 ${bars[peak]!.calls}`))
    for (let m = 0; m < n; m += 5) children.push(createElement('text', { key: `xl-${m}`, className: 'v3-axis', x: xAt(m).toFixed(1), y: H - 8, 'text-anchor': 'middle' }, bars[m]!.day.slice(5)))
    children.push(createElement('text', { key: 'xl-last', className: 'v3-axis', x: W - padR, y: H - 8, 'text-anchor': 'end' }, bars[n - 1]!.day.slice(5)))
  }
  return createElement('svg', {
    className: 'v3-chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img',
    'aria-label': `每日调用与失败数：${n} 天，峰值 ${chart.maxCalls} 次`, 'data-call-index-svg': 'trend',
  }, ...children)
}

/** 来源构成: a one-segment donut (未解析) + five-source list + an honesty note. */
function OverviewSourcePanel(props: {
  readonly bySource?: CallIndexSourceCounts
  readonly totalExact?: boolean
}): ReactElement {
  if (props.bySource === undefined) {
    return createElement('div', { className: 'v3-panel' },
      createElement('div', { className: 'v3-ph' }, createElement('span', { className: 'v3-pt' }, '来源构成')),
      createElement('p', { className: 'v3-hint', 'data-call-index-missing': 'by-source' }, 'Host 未返回来源分布（bySource）；这不是「全部为 0」。'),
    )
  }
  const data = callIndexSourceData(props.bySource)
  const total = data.reduce((sum, item) => sum + item.count, 0)
  const unknownCount = data.find(item => item.kind === 'unknown')?.count ?? 0
  const share = total > 0 ? unknownCount / total : 0
  const percent = Math.round(share * 100)
  const radius = 43
  const circumference = 2 * Math.PI * radius
  const segment = share * circumference
  const allUnresolved = total > 0 && unknownCount === total
  return createElement('div', { className: 'v3-panel' },
    createElement('div', { className: 'v3-ph' },
      createElement('span', { className: 'v3-pt' }, '来源构成'),
      createElement('span', { className: 'v3-pn' }, `${formatCallIndexCount(total, props.totalExact)} 次`),
    ),
    createElement('div', { className: 'v3-donut-wrap' },
      createElement('div', { className: 'v3-donut' },
        createElement('svg', { viewBox: '0 0 104 104', 'aria-hidden': 'true' },
          createElement('circle', { className: 'v3-trk', cx: 52, cy: 52, r: radius }),
          createElement('circle', {
            className: 'v3-seg', cx: 52, cy: 52, r: radius, 'data-seg': 'unknown',
            strokeDasharray: `${segment.toFixed(1)} ${(circumference - segment).toFixed(1)}`, strokeDashoffset: 0,
          }),
        ),
        createElement('div', { className: 'v3-mid' },
          createElement('b', { className: 'v3-num' }, `${percent}%`),
          createElement('span', null, '未解析'),
        ),
      ),
      createElement('div', { className: 'v3-src-list' },
        ...data.map(item => createElement('div', { key: item.kind, className: 'v3-src', 'data-source-row': item.kind },
          createElement('i', item.count === 0 ? { 'data-zero': 'true' } : {}),
          createElement('span', { className: 'v3-nm' }, item.label),
          createElement('b', null, formatCallIndexCount(item.count, props.totalExact)),
          createElement('em', null, total > 0 ? `${Math.round(item.share * 100)}%` : '0%'),
        )),
      ),
    ),
    createElement('p', { className: 'v3-src-note' },
      allUnresolved
        ? `Host 无法证明插件 owner，非 mcp__ 前缀的调用也不带归属证据，所以 ${formatCallIndexCount(total, props.totalExact)} 次调用全部落在「来源未解析」——这是当前唯一真实的分布形态，不是抽样。`
        : 'Host 无法证明插件 owner，非 mcp__ 前缀的调用也不带归属证据；未解析出归属的调用单列为「来源未解析」，其余按 Host 能证明的 kind 归类。',
      createElement('b', { style: { color: 'var(--v3-t3)' } }, ' 0 在这里不等于未使用'),
    ),
  )
}

/** Corpus + coverage + scope + exactness notice. Always rendered by both pages. */
/**
 * The one place this plugin reports a problem, on every tab.
 *
 * Requested after several rounds of "it fails and I cannot tell why": errors used
 * to be scattered across small grey lines that were easy to miss, and some
 * failures were never rendered at all. This box is deliberately loud — red,
 * bordered, with the machine code and the concrete field/counter at fault — so a
 * failure can be pasted back verbatim instead of described.
 *
 * It renders NOTHING when there is no problem: a permanent warning box trains
 * people to ignore warnings.
 */
export interface CallIndexDiagnosticItem {
  readonly label: string
  readonly detail: string
  /** Machine code (`internal-error`, `cursor-stale`, …) for searching/pasting. */
  readonly code?: string
}

export function callIndexDiagnostics(input: {
  readonly status?: CallIndexStatusView
  readonly page?: CallIndexCallPageView
  readonly failure?: CallIndexPanelFailure
  readonly startFailure?: CallIndexPanelFailure
  readonly moreFailure?: CallIndexPanelFailure
}): readonly CallIndexDiagnosticItem[] {
  const items: CallIndexDiagnosticItem[] = []
  const push = (label: string, failure: CallIndexPanelFailure | undefined): void => {
    if (failure === undefined) return
    items.push({
      label,
      detail: callIndexFailureText(failure),
      ...(failure.code === undefined ? {} : { code: failure.hostCode ?? failure.code }),
    })
  }
  push('读取失败', input.failure)
  push('自动索引失败', input.startFailure)
  push('加载更多失败', input.moreFailure)
  // A Host that answers with an unfinished scan is worth one line, not a block.
  // A diagnostic renderer must never be the thing that crashes: it runs on the
  // failure path, where the data is by definition suspect. Every field is
  // optional here, and a missing counter is simply not reported.
  const status = input.status
  const sessions = status?.sessions
  // Only an ACTUALLY running scan says "进行中". `phase: 'complete'` with a
  // non-zero `pending` is a finished pass that left Sessions unread, which is a
  // different (and truthful) statement — reporting it as "still scanning" made a
  // completed index look permanently stuck.
  // A running scan is progress, not a fault: it is reported by the progress bar
  // on 调用明细, never by this red box. Removed at the operator's request — the
  // box read as an error ("索引未覆盖全部 Session") for what is ordinary
  // incremental indexing, and `pending` is also non-zero for live Sessions that
  // have not been re-read yet, so the wording overclaimed a defect.
  if (sessions !== undefined && sessions.failed > 0) {
    items.push({
      label: '有 Session 读取失败',
      detail: `${sessions.failed} 个 Session 未能读取，索引因此不完整。`,
      ...(status === undefined || status.reasons.length === 0 ? {} : { code: status.reasons.join(',') }),
    })
  }
  return items
}

/** The loud red box. Renders nothing when the list is empty. */
export function CallIndexDiagnostics(props: {
  readonly status?: CallIndexStatusView
  readonly page?: CallIndexCallPageView
  readonly failure?: CallIndexPanelFailure
  readonly startFailure?: CallIndexPanelFailure
  readonly moreFailure?: CallIndexPanelFailure
}): ReactElement | null {
  const items = callIndexDiagnostics(props)
  if (items.length === 0) return null
  return createElement('div', {
    role: 'alert',
    'data-call-index-diagnostics': String(items.length),
    style: {
      border: '1px solid #d93025',
      borderLeft: '4px solid #d93025',
      background: 'color-mix(in srgb, #d93025 8%, transparent)',
      borderRadius: 4,
      padding: '8px 10px',
      margin: '8px 0',
      fontSize: 12,
      lineHeight: 1.5,
    },
  },
  ...items.map(item => createElement('div', { key: item.label + item.detail, style: { marginBottom: 4 } },
    createElement('strong', { style: { color: '#d93025' } }, item.label),
    item.code === undefined ? null : createElement('code', {
      style: { marginLeft: 6, padding: '0 4px', borderRadius: 3, background: 'color-mix(in srgb, currentColor 12%, transparent)' },
    }, item.code),
    createElement('div', { style: { marginTop: 2 } }, item.detail),
  )))
}


/**
 * Whether the coverage notice (扫描状态 / 扫描提示 / 事件读取) should render.
 *
 * Those three lines are the page's only evidence for "why is this empty". They
 * used to be gated on `keepsRows`, which is `false` for every empty state — so
 * the diagnostics disappeared in precisely the situation they exist to explain,
 * and a live scan of 116 Sessions looked identical to a broken page. Only the
 * states that replace the surface with their own explanation hide the notice:
 * `scope-unavailable` (no corpus at all), `initial` (nothing read yet) and
 * `filter-empty` (the filter, not the index, is the reason).
 */
export function showsCoverageNotice(state: CallIndexDetailState): boolean {
  return state.kind !== 'scope-unavailable' && state.kind !== 'initial' && state.kind !== 'filter-empty'
}

/** One notice line for the current state. */
function StateNotice({ state, failure }: { readonly state: CallIndexDetailState; readonly failure?: CallIndexPanelFailure }): ReactElement | null {
  if (state.kind === 'ready') return null
  return createElement('div', {
    className: `mc-notice mc-ci-state mc-ci-state--${state.kind}`,
    role: state.kind === 'disconnected' || state.kind === 'failure' ? 'alert' : 'status',
    'data-call-index-state': state.kind,
  },
  createElement('strong', null, state.title),
  state.detail === '' ? null : createElement('p', { className: 'mc-desc' }, state.detail),
  failure?.retryable === true && state.canRetry
    ? createElement('p', { className: 'mc-desc' }, '这是一个可重试的错误；重试会重新读取，不会重放旧游标。')
    : null,
  )
}

/** Source distribution bars (bySource). */
export function CallIndexSourceBars(props: {
  readonly bySource: CallIndexSourceCounts | undefined
  readonly totalExact?: boolean
}): ReactElement {
  const data = callIndexSourceData(props.bySource)
  const present = data.filter(item => item.count > 0)
  return createElement('div', { className: 'mc-ci-sources', 'data-call-index-block': 'by-source' },
    createElement('h4', { className: 'mc-heading', style: { fontSize: 13 } }, '来源分布'),
    props.bySource === undefined
      ? createElement('p', { className: 'mc-empty', 'data-call-index-missing': 'by-source' },
          'Host 未返回来源分布（bySource）；这不是「全部为 0」。')
      : createElement('div', { className: 'mc-ci-bar', role: 'img', 'aria-label': '来源分布条' },
          ...present.map(item => createElement('span', {
            key: item.kind,
            'data-source-kind': item.kind,
            title: `${item.label}：${formatCallIndexCount(item.count, props.totalExact)}`,
            style: { flexGrow: item.count, background: `var(--mc-source-${item.kind}, currentColor)`, opacity: 0.65 },
          }))),
    ...data.map(item => createElement('div', { className: 'mc-ci-source-row', key: item.kind, 'data-source-row': item.kind },
      createElement('span', { className: 'mc-source' }, item.label),
      createElement('span', { className: 'mc-ci-num' }, formatCallIndexCount(item.count, props.totalExact)),
      item.zeroNote === undefined
        ? null
        : createElement('span', { className: 'mc-desc', 'data-call-index-zero': item.kind }, item.zeroNote),
    )),
  )
}

/** Self-drawn SVG trend: no chart library, deterministic geometry. */
export function CallIndexTrendChart(props: {
  readonly aggregates: CallIndexAggregates | undefined
}): ReactElement {
  const chart = callIndexTrend(props.aggregates?.byDay)
  const geometry = CALL_INDEX_TREND_GEOMETRY
  if (props.aggregates === undefined) {
    return createElement('div', { className: 'mc-ci-trend', 'data-call-index-block': 'trend' },
      createElement('h4', { className: 'mc-heading', style: { fontSize: 13 } }, '按日趋势'),
      createElement('p', { className: 'mc-empty', 'data-call-index-missing': 'aggregates' },
        'Host 未返回按日聚合（aggregates）；这不是「没有调用」，趋势不可用。'),
    )
  }
  if (!chart.available) {
    return createElement('div', { className: 'mc-ci-trend', 'data-call-index-block': 'trend' },
      createElement('h4', { className: 'mc-heading', style: { fontSize: 13 } }, '按日趋势'),
      createElement('p', { className: 'mc-empty', 'data-call-index-missing': 'by-day' },
        '该筛选在所选范围内没有任何按日桶，趋势为空；单个日粒度为 0 不参与绘制。'),
    )
  }
  return createElement('div', { className: 'mc-ci-trend', 'data-call-index-block': 'trend' },
    createElement('h4', { className: 'mc-heading', style: { fontSize: 13 } }, '按日趋势'),
    createElement('svg', {
      viewBox: `0 0 ${geometry.width} ${geometry.height}`,
      role: 'img',
      'aria-label': `按日调用趋势（已索引部分）：${chart.bars.length} 天，峰值 ${chart.maxCalls} 次`,
      'data-call-index-svg': 'trend',
    },
    ...chart.bars.map(bar => createElement('rect', {
      key: bar.day,
      x: bar.x,
      y: bar.y,
      width: bar.width,
      height: bar.height,
      'data-day': bar.day,
      'data-calls': bar.calls,
      fill: bar.error > 0 ? 'var(--mc-trend-error, currentColor)' : 'currentColor',
      opacity: bar.error > 0 ? 0.85 : 0.55,
    })),
    ...chart.bars.map(bar => createElement('text', {
      key: `label-${bar.day}`,
      x: bar.x + bar.width / 2,
      y: geometry.height - 6,
      'font-size': 9,
      'text-anchor': 'middle',
      fill: 'currentColor',
      opacity: 0.7,
    }, bar.day.slice(5))),
    ),
    createElement('p', { className: 'mc-desc' },
      `图上 ${chart.bars.length} 天、${chart.totalCalls} 次调用；峰值 ${chart.maxCalls} 次/天。柱高按峰值归一。趋势只统计已索引部分，覆盖不完整时右侧天数与总数都可能偏少。`),
  )
}

/** Filter bar shared by the detail page. */
/** What a scan has actually done so far, as one honest 0–100 number. */
export interface CallIndexScanProgress {
  /** 0..100, or `undefined` when the Host has not reported enough to compute it. */
  readonly percent?: number
  /** Human sentence naming the counters the percentage came from. */
  readonly detail: string
  /** True while the Host reports an unfinished pass. */
  readonly running: boolean
}

/**
 * Turn the index census into a progress percentage.
 *
 * The percentage is `completed / (completed + pending)` over SESSIONS, not over
 * events: the Host's `readEvents` jumps in large steps and the total event count
 * is only known per Session, so an event-based bar would sit at 0 and then jump
 * to 100. Sessions are the unit the scan actually walks, and both counters are
 * present on every status reply.
 *
 * Deliberately returns `undefined` instead of 0 when no Session is known yet:
 * a bar pinned at 0% is indistinguishable from a stalled scan.
 */
export function callIndexScanProgress(status: CallIndexStatusView | undefined): CallIndexScanProgress {
  if (status === undefined) return { detail: '尚未收到索引状态。', running: false }
  const sessions = status.sessions
  const running = status.phase === 'running'
  // An older Host may omit the census entirely; a missing counter is not a
  // reason to crash the page (this is a diagnostic, it runs on the failure path).
  if (sessions === undefined) return { detail: running ? '正在扫描…' : '没有可索引的会话。', running }
  const total = sessions.completed + sessions.pending
  if (total <= 0) {
    return {
      detail: running ? '正在枚举会话…' : '没有可索引的会话。',
      running,
    }
  }
  const percent = Math.max(0, Math.min(100, Math.round((sessions.completed / total) * 100)))
  return {
    percent,
    running,
    detail: `已完成 ${sessions.completed} / ${total} 个会话`
      + (sessions.failed > 0 ? `，失败 ${sessions.failed} 个` : ''),
  }
}

/**
 * The scan's progress bar.
 *
 * Replaces the red 「索引未覆盖全部 Session」 box, which reported ordinary
 * incremental indexing as a defect. Progress belongs here: it is state, not an
 * error, and it is the one thing that makes "why is the table still empty"
 * answerable without waiting for the scan to finish.
 */
function CallIndexScanBar({ status }: { readonly status?: CallIndexStatusView }): ReactElement | null {
  const progress = callIndexScanProgress(status)
  // Nothing scanned and nothing scanning: say nothing rather than paint 0%.
  if (progress.percent === undefined && progress.running !== true) return null
  const percent = progress.percent
  return createElement('div', {
    className: 'mc-ci-progress',
    'data-call-index-progress': percent === undefined ? 'indeterminate' : String(percent),
    role: 'progressbar',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    ...(percent === undefined ? {} : { 'aria-valuenow': percent }),
    'aria-label': '索引扫描进度',
  },
  createElement('div', { className: 'mc-ci-progress-track' },
    createElement('div', {
      className: percent === undefined ? 'mc-ci-progress-fill is-indeterminate' : 'mc-ci-progress-fill',
      style: { width: percent === undefined ? '30%' : `${percent}%` },
    })),
  createElement('div', { className: 'mc-ci-progress-meta' },
    createElement('span', { className: 'mc-ci-progress-value' }, percent === undefined ? '扫描中…' : `${percent}%`),
    createElement('span', { className: 'mc-ci-progress-detail' }, progress.detail),
  ))
}

function CallIndexFilters(props: {
  readonly query: CallIndexQuery
  readonly onChange?: (query: CallIndexQuery) => void
  /** Resolves the live selection when 按会话 / 按工作区 is chosen. */
  readonly onResolveScope?: (() => CallIndexScopeTarget) | undefined
  readonly catalog?: CallIndexSessionCatalog | undefined
}): ReactElement {
  const { query, onChange, onResolveScope, catalog } = props
  const canChange = onChange !== undefined
  const change = (patch: Partial<CallIndexQuery>): void => {
    if (onChange !== undefined) onChange({ ...query, ...patch })
  }

  // Three scopes, not four day pills. The old 7/15/30/全部 buttons were the
  // wrong axis and took four clicks to reach the widest view; they also made a
  // default 7-day window invisible, which is how 调用明细 came to claim
  // 「确实没有调用」 for a corpus that 总览 reported as 745 calls.
  const scopes = CALL_INDEX_SCOPES.map(scope => {
    const activeScope = (query.scope ?? 'all') === scope
    return createElement(Pill, {
      key: scope,
      active: activeScope,
      'aria-pressed': activeScope,
      disabled: !canChange,
      // The narrowing scopes need the live selection, so the CLICK resolves it
      // and then applies both the scope and the id it bound to in one change.
      onClick: () => {
        const target = scope === 'all' ? {} : (onResolveScope?.() ?? {})
        change(scopeQuery(scope, { ...query, ...target }))
      },
    }, CALL_INDEX_SCOPE_LABELS[scope])
  })
  // The session picker only exists while 按会话 is active: it is the control
  // that turns 「只看当前会话」 into 「看任意会话」. A native <select> is used
  // deliberately — it is keyboard- and screen-reader-complete for free, and the
  // list can be long enough that a pill row would not scale.
  const sessionPicker = query.scope === 'session' && catalog !== undefined && catalog.items.length > 0
    ? createElement('label', { className: 'mc-ci-session-picker' },
        createElement('span', { className: 'mc-ci-session-picker-label' }, '会话'),
        createElement('select', {
          className: 'mc-ci-session-select',
          'data-call-index-session-select': 'true',
          'aria-label': '选择会话',
          disabled: !canChange,
          value: query.sessionId ?? '',
          onChange: (event: { target: { value: string } }) => {
            const next = event.target.value
            if (next === '') return
            change({ scope: 'session', range: 'all', sessionId: next, cwd: undefined })
          },
        },
        // An unbound selection is a real state (the Host had no current Session
        // when the scope was chosen), so it gets a real option instead of
        // silently displaying the first Session's name.
        ...(query.sessionId === undefined || catalog.items.some(item => item.id === query.sessionId)
          ? []
          : [createElement('option', { key: '__stale', value: query.sessionId }, query.sessionId)]),
        ...catalog.items.map(item => createElement('option', {
          key: item.id,
          value: item.id,
        }, item.name)),
        ),
      )
    : null

  return createElement('div', { className: 'mc-ci-filter', role: 'group', 'aria-label': '调用明细筛选' },
    createElement('div', { className: 'mc-tab-group', role: 'group', 'aria-label': '统计范围' }, scopes),
    sessionPicker,
    // 工作区 / 会话 are no longer separate selects: each scope binds one of them
    // to the live context and reports it in the hint below, so nothing narrows
    // the set without saying so.
    scopeHint(query, catalog) === undefined
      ? null
      : createElement('span', {
          className: 'mc-desc',
          'data-call-index-note': 'scope-hint',
        }, scopeHint(query, catalog)),
  )
}

/** The dense call table. Rows keep the wire's own metadata only. */
/** One row per TOOL, aggregated over the current page's calls. */
export interface CallIndexToolRow {
  readonly toolName: string
  readonly sourceKind: CallIndexSourceKind
  readonly lastAt: number
  readonly success: number
  readonly error: number
  /** Mean duration over calls that reported one; `undefined` when none did. */
  readonly averageDurationMs?: number
  readonly calls: number
}

/**
 * Aggregate per-call rows into per-tool rows.
 *
 * The table used to print one line per call (time / Session / turn-step / tool /
 * source / outcome / duration). That is a call log, not an answer to "which tools
 * am I using and are they working": the operator asked for one line per TOOL with
 * its success count, failure count, latency and source, so the same tool no longer
 * repeats down the page. Session and turn/step are dropped with the same intent —
 * neither identifies a tool's health.
 */
export function callIndexToolRows(page: CallIndexCallPageView | undefined): CallIndexToolRow[] {
  if (page === undefined) return []
  const byTool = new Map<string, {
    toolName: string; sourceKind: CallIndexSourceKind; lastAt: number
    success: number; error: number; calls: number; durationSum: number; durationCount: number
  }>()
  for (const row of page.items) {
    // Composite key as plain concatenation: a literal separator character here
    // would embed a control byte in the source file.
    const key = row.toolName + '::' + row.sourceKind
    let entry = byTool.get(key)
    if (entry === undefined) {
      entry = { toolName: row.toolName, sourceKind: row.sourceKind, lastAt: row.startedAt, success: 0, error: 0, calls: 0, durationSum: 0, durationCount: 0 }
      byTool.set(key, entry)
    }
    entry.calls += 1
    if (row.startedAt > entry.lastAt) entry.lastAt = row.startedAt
    // Only a confirmed outcome counts as success/failure; unresolved stays out
    // of both so the two columns never sum past the call count.
    if (row.outcome === 'success') entry.success += 1
    else if (row.outcome === 'error') entry.error += 1
    if (row.durationMs !== undefined && Number.isFinite(row.durationMs)) {
      entry.durationSum += row.durationMs
      entry.durationCount += 1
    }
  }
  return [...byTool.values()]
    .map(entry => ({
      toolName: entry.toolName,
      sourceKind: entry.sourceKind,
      lastAt: entry.lastAt,
      success: entry.success,
      error: entry.error,
      calls: entry.calls,
      ...(entry.durationCount === 0 ? {} : { averageDurationMs: entry.durationSum / entry.durationCount }),
    }))
    .sort((a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName))
}

/** Short source marker for the tool cell: MCP / 技能 / 插件 / 来源未解析. */
function sourceNoteForKind(kind: CallIndexSourceKind): string | undefined {
  switch (kind) {
    case 'mcp': return 'MCP'
    case 'skill': return '技能'
    case 'plugin-tool': return '插件'
    case 'unknown': return '来源未解析'
    default: return undefined
  }
}

/**
 * The v3 "完整工具表": one sticky-header row per TOOL, inside a bounded
 * `.v3-ts` scroller (330px here — the two charts above it already tell the big
 * picture). Takes pre-computed rows so the same filtered set feeds the charts.
 */
function CallIndexToolTable(props: {
  readonly rows: readonly CallIndexToolRow[]
}): ReactElement {
  const header: ReadonlyArray<{ readonly label: string; readonly right: boolean }> = [
    { label: '工具', right: false },
    { label: '调用', right: true },
    { label: '失败', right: true },
    { label: '成功率', right: true },
    { label: '平均耗时', right: true },
    { label: '最近调用', right: true },
  ]
  return createElement('div', { className: 'v3-ts v3-ts--h330' },
    createElement('table', { className: 'v3-table', 'data-call-index-table': 'tools' },
      createElement('thead', null, createElement('tr', null,
        ...header.map(col => createElement('th', { key: col.label, scope: 'col', ...(col.right ? { className: 'v3-r' } : {}) }, col.label)),
      )),
      createElement('tbody', null,
        ...props.rows.map(row => {
          const known = row.success + row.error
          const rate = known > 0 ? row.success / known : undefined
          const bad = row.error > 0 && row.error / row.calls >= 0.2
          const note = sourceNoteForKind(row.sourceKind)
          const server = row.toolName.startsWith('mcp__') ? row.toolName.split('__')[1] : undefined
          const shortName = row.sourceKind === 'mcp' && row.toolName.startsWith('mcp__')
            ? row.toolName.split('__').slice(2).join('__')
            : row.toolName
          return createElement('tr', { key: row.toolName + '::' + row.sourceKind, 'data-call-index-tool': row.toolName },
            createElement('td', null, createElement('div', { className: 'v3-c-tool' },
              note === undefined ? null : createElement('span', { className: 'v3-srcnote' }, note),
              createElement('span', { className: 'v3-nm', title: row.toolName }, shortName),
              server === undefined ? null : createElement('span', { className: 'v3-srv' }, server),
            )),
            createElement('td', { className: 'v3-r' }, String(row.calls)),
            createElement('td', { className: 'v3-r' }, String(row.error)),
            createElement('td', { className: 'v3-r' }, createElement('span', { className: 'v3-rt' },
              createElement('span', { className: 'v3-tk' }, createElement('span', { className: 'v3-fl', ...(bad ? { 'data-bad': 'true' } : {}), style: { width: `${Math.round((rate ?? 0) * 100)}%` } })),
              createElement('b', null, formatCallIndexRate(rate)),
            )),
            createElement('td', { className: 'v3-r' }, formatCallIndexDuration(row.averageDurationMs)),
            createElement('td', { className: 'v3-r' }, formatCallIndexTime(row.lastAt)),
          )
        }),
      ),
    ),
  )
}

/**
 * Success / failure share of the observed calls.
 *
 * The denominator is the number of calls with a KNOWN outcome. `unresolved`
 * (no result captured) and `running` are excluded rather than counted as
 * failures: an unfinished pair is not evidence the tool failed, and folding it
 * into the failure rate would overstate it. When nothing has a known outcome the
 * rate is `undefined` and the page prints `—` instead of a misleading 0%.
 */
export interface CallIndexRate {
  readonly rate: number
  readonly numerator: number
  readonly denominator: number
}

export function callIndexRates(summary: {
  readonly success: number
  readonly error: number
  readonly unresolved?: number
  readonly running?: number
} | undefined): { readonly success?: CallIndexRate; readonly failure?: CallIndexRate } {
  if (summary === undefined) return {}
  const denominator = summary.success + summary.error
  if (denominator <= 0) return {}
  return {
    success: { rate: summary.success / denominator, numerator: summary.success, denominator },
    failure: { rate: summary.error / denominator, numerator: summary.error, denominator },
  }
}

/** Percent with one decimal only when it adds information. */
export function formatCallIndexRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const pct = value * 100
  return `${pct >= 99.95 || pct === 0 ? String(Math.round(pct)) : pct.toFixed(1)}%`
}

export interface CallIndexDetailPanelViewProps {
  readonly query: CallIndexQuery
  readonly status?: CallIndexStatusView
  readonly page?: CallIndexCallPageView
  readonly sessions?: CallIndexSessionPageView
  readonly detail?: CallIndexDetailView
  readonly detailTarget?: { readonly sessionId: string; readonly callSeq: number }
  readonly detailFailure?: CallIndexPanelFailure
  readonly loading?: boolean
  readonly loadingDetail?: boolean
  readonly loadingMore?: boolean
  readonly failure?: CallIndexPanelFailure
  readonly narrow?: boolean
  readonly onQueryChange?: (query: CallIndexQuery) => void
  /** Resolves the live selection when a narrowed scope is chosen. */
  readonly onResolveScope?: (() => CallIndexScopeTarget) | undefined
  /** Session names + the switchable list for 按会话. */
  readonly catalog?: CallIndexSessionCatalog | undefined
  /**
   * Tool-name search inside the detail card. A local client-side filter over the
   * already-fetched per-tool rows — NOT a wire field, so it never narrows the
   * query the Host sees.
   */
  readonly search?: string
  readonly onSearchChange?: (value: string) => void
  /** Deprecated: the panel refreshes itself while scanning (D-031). */
  readonly onRefresh?: () => void
  /** Deprecated: indexing is automatic (D-031). */
  /** Deprecated: indexing is automatic since D-031. Kept so an older caller still typechecks. */
  readonly onStartIndex?: (mode: 'full' | 'incremental') => void
  /** Why the last scan trigger failed; rendered so a rejected start is not silent. */
  readonly startFailure?: CallIndexPanelFailure
  /** The task the last successful trigger created. */
  readonly startTask?: CallIndexTaskView
  /**
   * A failed page read. Still rendered: the table now fills itself, so a page
   * that never arrives is exactly the silent stall this must not become.
   */
  readonly moreFailure?: CallIndexPanelFailure
  readonly onSelect?: (row: CallIndexCallRow) => void
  readonly onCloseDetail?: () => void
}

/**
 * Pure view for 调用明细. No hooks: the test suite walks this element tree.
 *
 * `narrow` swaps the detail surface from an inline aside to the primitives'
 * Modal; the container decides it from a media query, so this stays pure.
 */
export function CallIndexDetailPanelView(props: CallIndexDetailPanelViewProps): ReactElement {
  const {
    query, status, page,
    loading, loadingMore, failure, onQueryChange, onResolveScope, catalog,
    moreFailure,
    startFailure, startTask,
    search, onSearchChange,
  } = props
  const state = callIndexDetailState({
    status,
    page,
    query,
    loading: loading === true,
    ...(failure === undefined ? {} : { failure }),
  })

  const totalText = page === undefined
    ? undefined
    : formatCallIndexCount(page.total ?? page.summary.total, page.totalExact)
  const coverageLabel = page === undefined ? undefined : COVERAGE_LABELS[page.coverage]
  const scanning = status !== undefined
    && (status.phase === 'running' || (status.sessions?.pending ?? 0) > 0 || (status.sessions?.pendingLive ?? 0) > 0)
  // The status pill states the snapshot + coverage + how rows are folded — the
  // three facts the table's own numbers depend on. It replaces the old title row.
  const statusText = page === undefined
    ? (loading === true ? '正在读取调用明细…' : '尚未读取调用明细')
    : `快照代 ${page.generation} · 覆盖 ${coverageLabel ?? '未知'} · 按工具聚合`

  // Rates come from the page's own summary, so they describe exactly what the
  // table below shows. `page.summary` is the wire's outcome breakdown.
  const rates = callIndexRates(page?.summary)
  const successStats = rates.success
  const failureStats = rates.failure
  const rateText = (value: number | undefined): string => formatCallIndexRate(value)
  const rateHint = (stats: CallIndexRate | undefined): string => stats === undefined
    ? '没有已知结果的调用，无法计算比例'
    : `${stats.numerator} / ${stats.denominator} 次已知结果`
  // 需要关注 = what deserves a second look: unresolved pairs and errors.
  const suggestionCount = page === undefined
    ? undefined
    : (page.summary.unresolved ?? 0) + page.summary.error
  const suggestionHint = (): string => page === undefined
    ? '尚未读取'
    : `失败 ${page.summary.error} + 未配对 ${page.summary.unresolved ?? 0}；未配对表示没有捕获到结果，不等于失败`

  // One row per TOOL: the same filtered set feeds the two charts and the table.
  const allRows = page === undefined ? [] : callIndexToolRows(page)
  const term = (search ?? '').trim().toLowerCase()
  const rows = term === '' ? allRows : allRows.filter(row => row.toolName.toLowerCase().includes(term))

  // 平均耗时: mean over calls that reported a duration; never a fabricated zero.
  const durations = page === undefined
    ? []
    : page.items.map(item => item.durationMs).filter((ms): ms is number => ms !== undefined && Number.isFinite(ms))
  const averageDuration = durations.length > 0 ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : undefined

  // How many calls the tool rows actually cover. The page appends up to
  // MAX_AUTO_PAGES pages, so on a large corpus it can be short of the total;
  // every "share of calls" claim below is stated against this read count.
  const readCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  const totalCalls = page === undefined ? undefined : (page.total ?? page.summary.total)
  const readIsPartial = totalCalls !== undefined && readCalls < totalCalls

  const rankRows = rows.slice(0, 12)
  const rankMax = rankRows.length > 0 ? rankRows[0]!.calls : 1
  const failingRows = rows.filter(row => row.error > 0).slice().sort((a, b) => b.error - a.error)
  const failMax = failingRows.length > 0 ? failingRows[0]!.error : 1

  const searchInput = createElement('label', { className: 'v3-search' },
    createElement('svg', { width: 12, height: 12, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true', style: { color: 'var(--v3-t4)', flex: 'none' } },
      createElement('circle', { cx: 6.2, cy: 6.2, r: 4.4, stroke: 'currentColor', 'stroke-width': 1.3 }),
      createElement('path', { d: 'm9.6 9.6 3 3', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
    ),
    createElement('input', onSearchChange === undefined
      ? { type: 'search', placeholder: '筛选工具名…', 'aria-label': '筛选工具名', defaultValue: search ?? '', 'data-call-index-search': 'true' }
      : {
          type: 'search', placeholder: '筛选工具名…', 'aria-label': '筛选工具名', value: search ?? '', 'data-call-index-search': 'true',
          onChange: (event: { target: { value: string } }) => onSearchChange(event.target.value),
        }),
  )

  const indexBlockedReason = status === undefined
    ? '尚未收到索引状态，无法判断索引进度（Host 未应答或回复被拒绝）'
    : status.scope.status !== 'ready'
      ? '索引范围未启用，插件不会自动索引历史会话'
      : undefined

  return createElement('section', { className: 'v3-root mc-section', 'aria-label': '调用明细', 'aria-busy': loading === true },
    CallIndexStyles(),
    V3Styles(),
    // status pills: snapshot/coverage/aggregation + the "N tools · M calls" figure
    createElement('div', { className: 'v3-status-pills' },
      createElement('span', { className: 'v3-statusline', ...(state.kind === 'failure' || state.kind === 'disconnected' ? { 'data-tone': 'bad' } : {}) },
        createElement('span', {
          className: 'v3-dot',
          'data-tone': state.kind === 'failure' || state.kind === 'disconnected' ? 'bad' : scanning ? 'run' : 'ok',
          'aria-hidden': 'true',
        }),
        statusText),
      createElement('span', { className: 'v3-statusline v3-status-dash' },
        `${rows.length} 个工具 · ${formatCallIndexCount(readCalls, page?.totalExact)} 次调用${readIsPartial ? `（全部 ${formatCallIndexCount(totalCalls, page?.totalExact)} 次）` : ''}`),
    ),
    // filter card: three scopes + search + bind hint + scan progress
    createElement('div', { className: 'v3-panel v3-filtercard' },
      createElement('div', { className: 'v3-filter-row' },
        CallIndexFilters({
          query,
          ...(onQueryChange === undefined ? {} : { onChange: onQueryChange }),
          ...(onResolveScope === undefined ? {} : { onResolveScope }),
          ...(catalog === undefined ? {} : { catalog }),
        }),
        searchInput,
      ),
      CallIndexScanBar({ ...(status === undefined ? {} : { status }) }),
    ),
    createElement(StateNotice, { state, ...(failure === undefined ? {} : { failure }) }),
    // Indexing is automatic, so the operator no longer presses a button whose
    // failure could go unseen. What still must be visible is whether that
    // automatic pass ran and what it did — otherwise a refused or failed scan
    // looks exactly like an empty corpus.
    startFailure === undefined ? null : createElement('p', {
      className: 'v3-hint',
      'data-call-index-note': 'start-failure',
      role: 'status',
    }, `自动索引失败：${callIndexFailureText(startFailure)}`),
    startTask === undefined ? null : createElement('p', {
      className: 'v3-hint',
      'data-call-index-note': 'start-task',
    }, `自动索引：${startTask.phase}${startTask.mode === 'full' ? '（全量）' : '（增量）'} · 任务 ${startTask.taskId.slice(0, 8)}`),
    indexBlockedReason === undefined ? null : createElement('p', {
      className: 'v3-hint',
      'data-call-index-note': 'index-blocked',
      role: 'status',
    }, `自动索引不可用：${indexBlockedReason}`),
    CallIndexDiagnostics({
      ...(status === undefined ? {} : { status }),
      ...(page === undefined ? {} : { page }),
      ...(failure === undefined ? {} : { failure }),
      ...(startFailure === undefined ? {} : { startFailure }),
      ...(moreFailure === undefined ? {} : { moreFailure }),
    }),
    // Four stats (v3 adds 平均耗时 as the fourth). Counts sit under the rates so a
    // percentage never floats without its denominator.
    createElement('div', { className: 'v3-stats', 'data-call-index-summary': 'rates' },
      V3Stat({
        label: '成功率',
        value: rateText(successStats?.rate),
        hint: totalText === undefined ? rateHint(successStats) : `${rateHint(successStats)} · 本页合计 ${totalText}`,
      }),
      V3Stat({ label: '失败率', value: rateText(failureStats?.rate), hint: rateHint(failureStats) }),
      V3Stat({ label: '需要关注', value: suggestionCount === undefined ? '—' : String(suggestionCount), hint: suggestionHint() }),
      V3Stat({ label: '平均耗时', value: formatCallIndexDuration(averageDuration), hint: '按有耗时的调用平均' }),
    ),
    page !== undefined && page.droppedItems > 0
      ? createElement('p', { className: 'v3-hint', 'data-call-index-note': 'dropped', style: { marginTop: 8 } },
          `本页有 ${page.droppedItems} 行未通过白名单投影（字段不合法），已丢弃，未计入合计。`)
      : null,
    // two-column charts: volume distribution (left) vs failure concentration (right)
    createElement('div', { className: 'v3-board', style: { marginTop: 12 } },
      createElement('div', { className: 'v3-panel' },
        createElement('div', { className: 'v3-ph' },
          createElement('span', { className: 'v3-pt' }, '调用量分布（本范围工具）'),
          createElement('span', { className: 'v3-pn' }, term === '' ? '前 12 名' : '筛选结果'),
        ),
        rankRows.length === 0
          ? createElement('p', { className: 'v3-hint' }, term === '' ? '当前范围没有工具调用。' : '没有匹配的工具。')
          : createElement('div', { className: 'v3-rank' },
              ...rankRows.map(row => {
                const bad = row.error > 0 && row.error / row.calls >= 0.2
                return createElement('div', { key: row.toolName + '::' + row.sourceKind, className: 'v3-rank-row', title: row.toolName },
                  createElement('span', { className: 'v3-nm' }, toolDisplayLabel(row.toolName)),
                  createElement('span', { className: 'v3-bar' }, createElement('span', {
                    ...(bad ? { 'data-bad': 'true' } : {}),
                    style: { width: `${Math.max(3, Math.round((row.calls / rankMax) * 100))}%` },
                  })),
                  createElement('span', { className: 'v3-n' }, String(row.calls)),
                )
              })),
        createElement('p', { className: 'v3-hint', style: { marginTop: 9 } },
          `条长 = 调用量，按最大值归一；失败率 ≥ 20% 的条变红。${readIsPartial ? `本页已读取 ${formatCallIndexCount(readCalls, page?.totalExact)} 次调用，全部共 ${formatCallIndexCount(totalCalls, page?.totalExact)} 次，未读取部分不参与排行。` : ''}`),
      ),
      createElement('div', { className: 'v3-panel' },
        createElement('div', { className: 'v3-ph' },
          createElement('span', { className: 'v3-pt' }, '失败与耗时'),
          createElement('span', { className: 'v3-pn' }, '按失败数排序'),
        ),
        failingRows.length === 0
          ? createElement('p', { className: 'v3-hint' }, '当前范围没有失败调用。')
          : createElement('div', { className: 'v3-rank' },
              ...failingRows.slice(0, 8).map(row => {
                const perTool = Math.round((row.error / row.calls) * 100)
                return createElement('div', { key: 'fail-' + row.toolName + '::' + row.sourceKind, className: 'v3-rank-row', title: row.toolName },
                  createElement('span', { className: 'v3-nm' }, toolDisplayLabel(row.toolName)),
                  createElement('span', { className: 'v3-bar' }, createElement('span', {
                    'data-bad': 'true',
                    style: { width: `${Math.max(4, Math.round((row.error / failMax) * 100))}%` },
                  })),
                  createElement('span', { className: 'v3-n', style: { color: 'var(--v3-bad)', fontWeight: 600 } }, `${row.error} 次`),
                  createElement('span', { className: 'v3-e', 'data-bad': 'true' }, `占该工具 ${perTool}%`),
                )
              })),
        createElement('p', { className: 'v3-hint', style: { marginTop: 9 } },
          `条长 = 失败次数（不是失败率）。共 ${failingRows.length} 个工具出现过失败。`),
      ),
    ),
    // full tool table, demoted to an appendix: bounded 330px scroller, sticky head
    createElement('div', { className: 'v3-panel', style: { marginTop: 12 } },
      createElement('div', { className: 'v3-ph' },
        createElement('span', { className: 'v3-pt' }, '完整工具表'),
        createElement('span', { className: 'v3-pn' }, `${rows.length} 行 · 表内滚动`),
      ),
      createElement(CallIndexToolTable, { rows }),
      createElement('div', { className: 'v3-tfoot' },
        createElement('span', null, `${rows.length} 个工具 · 表内滚动`),
        page === undefined ? null : createElement('span', { style: { marginLeft: 'auto' } },
          `快照代 ${page.generation} · 覆盖 ${coverageLabel ?? '未知'}`),
      ),
    ),
    // Every tool row is on the page; the box above scrolls instead of the page
    // growing. A cursor still feeds it in the background — no button to find.
    page?.nextCursor !== undefined && loadingMore === true
      ? createElement('p', { className: 'v3-hint', 'data-call-index-note': 'loading-more', style: { marginTop: 8 } },
          '正在加载其余工具…')
      : null,
    moreFailure === undefined ? null : createElement('p', {
      className: 'v3-hint',
      'data-call-index-note': 'more-failure',
      role: 'status',
      style: { marginTop: 8 },
    }, `加载失败：${callIndexFailureText(moreFailure)}`),
  )
}

export interface CallIndexOverviewPanelViewProps {
  readonly status?: CallIndexStatusView
  readonly overview?: CallIndexOverviewView
  readonly loading?: boolean
  readonly failure?: CallIndexPanelFailure
  readonly onRefresh?: () => void
  /**
   * Per-tool rows. The overview reply (getSummary) carries only summary +
   * aggregates — no per-tool counts — so the ranking and fault panels need a
   * `listCalls` read the container performs. `undefined` means "not read yet":
   * an honest empty state is rendered, never zeros.
   */
  readonly tools?: readonly CallIndexToolRow[]
  readonly toolsLoading?: boolean
  readonly toolsFailure?: CallIndexPanelFailure
}

/** Pure view for 总览 (v3 看板). */
export function CallIndexOverviewPanelView(props: CallIndexOverviewPanelViewProps): ReactElement {
  const { status, overview, loading, failure, onRefresh, tools, toolsLoading, toolsFailure } = props
  const metrics = callIndexOverviewMetrics(overview, status)
  const rangeLabel = callIndexRangeLabel(CALL_INDEX_OVERVIEW_RANGE)
  const exact = metrics.callsTotalExact
  const mix = callIndexOutcomeMix(overview?.summary)
  const aggregates = metrics.aggregates

  const notice = failure === undefined
    ? undefined
    : failure.disconnected
      ? `与 Host 断连：${callIndexFailureText(failure)}${failure.hostCode === undefined ? '' : `（${failure.hostCode}）`}`
      : callIndexFailureText(failure)

  const coverageLabel = status === undefined ? '未知' : COVERAGE_LABELS[status.coverage]
  const scanning = status !== undefined
    && (status.phase === 'running' || (status.sessions?.pending ?? 0) > 0 || (status.sessions?.pendingLive ?? 0) > 0)
  const sessionsText = metrics.sessionsListed === undefined
    ? 'Session 未读取'
    : `${metrics.sessionsListed} 列出 / ${metrics.sessionsVisible ?? '—'} 可见`
  const coverageHint = exact === true
    ? createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
        createElement('span', { className: 'v3-dot', 'data-tone': 'ok', 'aria-hidden': 'true' }), '覆盖完整，计数精确')
    : createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
        createElement('span', { className: 'v3-dot', 'data-tone': 'warn', 'aria-hidden': 'true' }), '覆盖部分，实际更多')
  const failHint = createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
    createElement('span', { className: 'v3-dot', 'data-tone': 'bad', 'aria-hidden': 'true' }),
    `另有 ${formatCallIndexCount(mix?.unresolved, exact)} 次未配对`)

  const rates = callIndexRates(overview?.summary)
  const rateHint = (stats: CallIndexRate | undefined): string => stats === undefined
    ? '没有已知结果的调用'
    : `${stats.numerator} / ${stats.denominator} 次已知结果`

  const trend = callIndexTrend(aggregates?.byDay)
  const callSpark = aggregates?.byDay === undefined ? undefined : aggregates.byDay.map(bucket => bucket.calls)
  const successSpark = aggregates?.byDay === undefined ? undefined : aggregates.byDay.map(bucket => bucket.calls > 0 ? bucket.success / bucket.calls : 0)
  const errorSpark = aggregates?.byDay === undefined ? undefined : aggregates.byDay.map(bucket => bucket.error)

  // Per-tool panels (from the listCalls read the container supplies).
  const totalToolCalls = tools === undefined ? 0 : tools.reduce((sum, row) => sum + row.calls, 0)
  const topRows = tools === undefined ? undefined : tools.slice(0, 12)
  const rankMax = topRows !== undefined && topRows.length > 0 ? topRows[0]!.calls : 1
  const topCoverage = topRows === undefined || totalToolCalls === 0
    ? undefined
    : Math.round(topRows.reduce((sum, row) => sum + row.calls, 0) / totalToolCalls * 100)
  const failingRows = tools === undefined ? undefined : tools.filter(row => row.error > 0).slice().sort((a, b) => b.error - a.error)
  const failingTop = failingRows === undefined ? [] : failingRows.slice(0, 3)
  const failingRest = failingRows === undefined ? [] : failingRows.slice(3)
  const failingRestErrors = failingRest.reduce((sum, row) => sum + row.error, 0)
  const failingReadErrors = failingRows === undefined ? 0 : failingRows.reduce((sum, row) => sum + row.error, 0)
  const failDenominator = metrics.failed !== undefined && metrics.failed > 0 ? metrics.failed : failingReadErrors
  const readCalls = tools === undefined ? 0 : totalToolCalls
  const readIsPartial = metrics.calls !== undefined && readCalls < metrics.calls
  const worstRateTool = failingRows === undefined || failingRows.length === 0
    ? undefined
    : failingRows.slice().sort((a, b) => (b.error / b.calls) - (a.error / a.calls))[0]

  const toolsNotice = tools === undefined
    ? createElement('p', { className: 'v3-hint', 'data-call-index-note': 'tools' },
        toolsFailure !== undefined
          ? `逐工具明细读取失败：${callIndexFailureText(toolsFailure)}`
          : toolsLoading === true ? '正在读取逐工具明细…' : '尚未读取逐工具明细；上方调用总量与趋势来自总览快照，排行需要逐工具数据。')
    : tools.length === 0
      ? createElement('p', { className: 'v3-hint', 'data-call-index-note': 'tools' }, '该范围没有逐工具调用记录。')
      : null

  const sessionInfo = status?.sessions
  const taskNote = metrics.tasks === undefined
    ? null
    : createElement('p', { className: 'v3-hint', 'data-call-index-note': 'task', style: { marginTop: 9 } },
        `最近一次扫描：${metrics.tasks.mode} / ${metrics.tasks.phase}（开始 ${formatCallIndexTime(metrics.tasks.startedAt)}）`)

  return createElement('section', { className: 'v3-root mc-section', 'aria-label': '调用统计总览', 'aria-busy': loading === true },
    CallIndexStyles(),
    V3Styles(),
    createElement('header', { className: 'mc-heading-row' },
      createElement('div', { className: 'mc-heading-meta' },
        createElement('h2', { className: 'mc-heading' }, '总览'),
        createElement('span', { className: 'mc-version' }, loading === true
          ? '正在读取…'
          // 总览 no longer filters by time, so "最近 N 天" would describe a window
          // that does not exist. It states the scope it actually covers instead.
          : (rangeLabel === '全部' ? '范围：全部已索引会话' : `范围：最近 ${rangeLabel}`)),
      ),
      createElement('div', { className: 'mc-heading-actions' },
        createElement(Button, {
          size: 'sm',
          variant: 'outline',
          disabled: loading === true || onRefresh === undefined,
          onClick: () => onRefresh?.(),
        }, '刷新'),
      ),
    ),
    createElement('p', { className: 'mc-desc' },
      '调用索引的总览：调用次数、Session 覆盖、来源构成与按日趋势。所有统计口径以覆盖状态为准，未知一律如实标注。'),
    notice === undefined
      ? null
      : createElement('div', {
          className: 'mc-notice',
          role: failure?.disconnected === true ? 'alert' : 'status',
          'data-call-index-state': failure?.disconnected === true ? 'disconnected' : 'failure',
        }, notice),
    // three status pills: coverage / scan / corpus — quiet, never competing with
    // the numbers below.
    createElement('div', { className: 'v3-status-pills' },
      createElement('span', { className: 'v3-statusline' },
        createElement('span', { className: 'v3-dot', 'data-tone': coverageLabel === '完整' ? 'ok' : 'warn', 'aria-hidden': 'true' }),
        createElement('span', null,
          '覆盖 ', createElement('b', null, coverageLabel),
          `　·　${sessionsText}${exact === true ? '' : '　·　所有总量为下界'}`),
      ),
      createElement('span', { className: 'v3-statusline' },
        createElement('span', { className: 'v3-dot', 'data-tone': scanning ? 'run' : 'ok', 'aria-hidden': 'true' }),
        scanning ? '正在扫描' : '扫描已结束',
        `　·　${formatCallIndexCount(sessionInfo?.pending, true)} 个待处理`),
      createElement('span', { className: 'v3-statusline v3-status-dash' },
        `口径：${overview?.corpus === 'persisted-plus-observed-live' ? '已持久化 + 挂载后实时观测' : 'Host 未声明 corpus'}`),
    ),
    // four headline stats, each with a sparkline where a daily series exists
    createElement('div', { className: 'v3-stats', 'data-call-index-metrics': 'overview' },
      V3Stat({
        label: '调用次数', value: formatCallIndexCount(metrics.calls, exact), hint: coverageHint,
        ...(callSpark === undefined ? {} : { spark: Sparkline({ values: callSpark, tone: 'info' }) }),
      }),
      V3Stat({
        label: '成功率', value: formatCallIndexRate(rates.success?.rate), hint: rateHint(rates.success),
        ...(successSpark === undefined ? {} : { spark: Sparkline({ values: successSpark, tone: 'ok' }) }),
      }),
      V3Stat({
        label: '失败', value: formatCallIndexCount(metrics.failed, exact), hint: failHint,
        ...(errorSpark === undefined ? {} : { spark: Sparkline({ values: errorSpark, tone: 'bad' }) }),
      }),
      V3Stat({ label: '不同工具', value: formatCallIndexCount(metrics.distinctTools, exact), hint: '按 toolName 去重' }),
    ),
    callIndexHasUnexplainedSources(aggregates)
      ? createElement('p', { className: 'v3-hint', 'data-call-index-note': 'unexplained-sources', style: { marginTop: 10 } },
          '插件工具与技能执行入口的归属目前都解析为 0：Host 无法证明插件 owner，技能执行归属也未验证，所以这两个 0 表示「未解析出」，不表示「未使用」。')
      : null,
    // board: daily trend (2.15fr) + source composition (1fr)
    createElement('div', { className: 'v3-board', style: { marginTop: 12 } },
      createElement('div', { className: 'v3-panel' },
        createElement('div', { className: 'v3-ph' },
          createElement('span', { className: 'v3-pt' }, '按日调用趋势'),
          createElement('span', { className: 'v3-pn' }, aggregates === undefined
            ? '趋势不可用'
            : `合计 ${trend.totalCalls} 次 · 峰值 ${trend.maxCalls} 次`),
        ),
        aggregates === undefined
          ? createElement('p', { className: 'v3-hint', 'data-call-index-missing': 'aggregates' }, 'Host 未返回按日聚合（aggregates）；这不是「没有调用」，趋势不可用。')
          : !trend.available
            ? createElement('p', { className: 'v3-hint', 'data-call-index-missing': 'by-day' }, '该筛选在所选范围内没有任何按日桶，趋势为空；单个日粒度为 0 不参与绘制。')
            : createElement(OverviewTrendSvg, { chart: trend }),
        aggregates === undefined || !trend.available
          ? null
          : createElement('div', { className: 'v3-legend' },
              createElement('span', null, createElement('i', { style: { background: 'var(--v3-info)' } }), '每日调用量（折线 + 面积）'),
              createElement('span', null, createElement('i', { 'data-mark': 'square', style: { background: 'var(--v3-bad)' } }), '每日失败数（底柱）'),
              createElement('span', null, createElement('i', { style: { background: 'var(--v3-info)', opacity: 0.3, height: 8, borderRadius: 2 } }), '最近一周'),
            ),
      ),
      OverviewSourcePanel({
        ...(aggregates?.bySource === undefined ? {} : { bySource: aggregates.bySource }),
        ...(exact === undefined ? {} : { totalExact: exact }),
      }),
    ),
    // board: tool ranking (top 12) + fault concentration
    createElement('div', { className: 'v3-board', style: { marginTop: 12 } },
      createElement('div', { className: 'v3-panel' },
        createElement('div', { className: 'v3-ph' },
          createElement('span', { className: 'v3-pt' }, '工具调用排行'),
          createElement('span', { className: 'v3-pn' }, topRows === undefined
            ? '前 12 名'
            : `前 12 名${topCoverage === undefined ? '' : ` · 占已读取调用的 ${topCoverage}%`}`
              + (metrics.calls !== undefined && totalToolCalls < metrics.calls
                ? ` · 已读取 ${formatCallIndexCount(totalToolCalls, exact)} / 共 ${formatCallIndexCount(metrics.calls, exact)} 次`
                : '')),
        ),
        toolsNotice !== null
          ? toolsNotice
          : createElement('div', { className: 'v3-rank' },
              ...topRows!.map(row => {
                const bad = row.error > 0 && row.error / row.calls >= 0.2
                return createElement('div', { key: 'rank-' + row.toolName + '::' + row.sourceKind, className: 'v3-rank-row', title: row.toolName },
                  createElement('span', { className: 'v3-nm' }, toolDisplayLabel(row.toolName)),
                  createElement('span', { className: 'v3-bar' }, createElement('span', {
                    ...(bad ? { 'data-bad': 'true' } : {}),
                    style: { width: `${Math.max(3, Math.round((row.calls / rankMax) * 100))}%` },
                  })),
                  createElement('span', { className: 'v3-n' }, String(row.calls)),
                  createElement('span', {
                    className: 'v3-e',
                    ...(bad ? { 'data-bad': 'true' } : {}),
                    ...(row.error === 0 ? { 'data-zero': 'true' } : {}),
                  }, `失败 ${row.error}`),
                )
              })),
      ),
      createElement('div', { className: 'v3-panel' },
        createElement('div', { className: 'v3-ph' },
          createElement('span', { className: 'v3-pt' }, '异常集中度'),
          createElement('span', { className: 'v3-pn' }, tools === undefined ? '按失败数排序' : `${formatCallIndexCount(metrics.failed, exact)} 次失败`),
        ),
        toolsNotice !== null
          ? toolsNotice
          : failingRows === undefined || failingRows.length === 0
            ? createElement('p', { className: 'v3-hint' }, '当前范围没有失败调用。')
            : createElement('div', null,
                createElement('div', { className: 'v3-rank' },
                  ...failingTop.map(row => createElement('div', { key: 'fc-' + row.toolName + '::' + row.sourceKind, className: 'v3-rank-row' },
                    createElement('span', { className: 'v3-nm', style: { width: 'auto', flex: '1 1 auto' } }, toolDisplayLabel(row.toolName)),
                    createElement('span', { className: 'v3-n', style: { color: 'var(--v3-bad)', fontWeight: 600 } }, String(row.error)),
                  )),
                  ...(failingRest.length === 0 ? [] : [createElement('div', { key: 'fc-rest', className: 'v3-rank-row' },
                    createElement('span', { className: 'v3-nm', style: { width: 'auto', flex: '1 1 auto' } }, `其余 ${failingRest.length} 个工具合计`),
                    createElement('span', { className: 'v3-n', style: { color: 'var(--v3-t2)' } }, String(failingRestErrors)),
                  )]),
                ),
                // Denominator must be the OVERALL failure count, not the sum over
                // the rows we happened to read: the page appends a bounded number
                // of pages, so a partial read would otherwise inflate this share.
                (failDenominator > 0)
                  ? createElement('p', { className: 'v3-hint', style: { marginTop: 9 } },
                      `这些失败合计占全部失败的 ${Math.round((failingTop.reduce((sum, row) => sum + row.error, 0) / failDenominator) * 100)}%（占全部失败，不是占单个工具）${readIsPartial ? '；分母是全部失败数，分子只含已读取的逐工具行' : ''}。`)
                  : null,
                worstRateTool === undefined ? null : createElement('div', { style: { marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--v3-line)' } },
                  createElement('div', { className: 'v3-src', style: { fontSize: 11.5 } },
                    createElement('span', { className: 'v3-nm', style: { color: 'var(--v3-t4)', flex: '1 1 auto' } }, '失败率最高的工具'),
                    createElement('b', { style: { color: 'var(--v3-bad)' } }, `${Math.round((worstRateTool.error / worstRateTool.calls) * 100)}%`),
                  ),
                  createElement('p', { className: 'v3-hint', style: { marginTop: 4 } },
                    `${worstRateTool.toolName} ${worstRateTool.error} / ${worstRateTool.calls}（占该工具失败率，不是占全部失败）。`),
                ),
                createElement('div', { style: { marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--v3-line)' } },
                  createElement('div', { className: 'v3-src', style: { fontSize: 11.5 } },
                    createElement('span', { className: 'v3-nm', style: { color: 'var(--v3-t4)', flex: '1 1 auto' } }, '未配对结果'),
                    createElement('b', { style: { color: 'var(--v3-warn)' } }, formatCallIndexCount(mix?.unresolved, exact)),
                  ),
                  createElement('p', { className: 'v3-hint', style: { marginTop: 4 } }, '没有捕获到结果，不计入成功率分母，也不等于失败。'),
                ),
              ),
      ),
    ),
    // index status: a four-column key/value grid
    createElement('div', { className: 'v3-panel', style: { marginTop: 12 } },
      createElement('div', { className: 'v3-ph' },
        createElement('span', { className: 'v3-pt' }, '索引状态'),
        createElement('span', { className: 'v3-pn' }, metrics.tasks === undefined ? '最近扫描未记录' : `最近扫描 ${metrics.tasks.mode} · ${metrics.tasks.phase}`),
      ),
      createElement('div', { className: 'v3-kv' },
        createElement('div', null,
          createElement('div', { className: 'v3-kv-l' }, '数据范围'),
          createElement('div', { className: 'v3-kv-v' }, overview?.corpus === 'persisted-plus-observed-live' ? '已持久化 + 挂载后实时观测' : 'Host 未声明')),
        createElement('div', null,
          createElement('div', { className: 'v3-kv-l' }, 'Session 列出 / 可见'),
          createElement('div', { className: 'v3-kv-v v3-num' }, sessionInfo === undefined ? '—' : `${sessionInfo.listed} / ${sessionInfo.visible}`)),
        createElement('div', null,
          createElement('div', { className: 'v3-kv-l' }, '待处理 / 失败'),
          createElement('div', { className: 'v3-kv-v v3-num' }, sessionInfo === undefined ? '—' : `${sessionInfo.pending} / ${sessionInfo.failed}`)),
        createElement('div', null,
          createElement('div', { className: 'v3-kv-l' }, '覆盖（事件 / 枚举 / 语义）'),
          createElement('div', { className: 'v3-kv-v' }, status === undefined
            ? '—'
            : `${COVERAGE_LABELS[status.eventCoverage]} / ${COVERAGE_LABELS[status.enumerationCoverage]} / ${COVERAGE_LABELS[status.coverage]}`)),
      ),
      taskNote,
    ),
  )
}

interface DetailState {
  readonly status?: CallIndexStatusView
  readonly page?: CallIndexCallPageView
  readonly sessions?: CallIndexSessionPageView
  readonly detail?: CallIndexDetailView
  readonly detailTarget?: { readonly sessionId: string; readonly callSeq: number }
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly loadingDetail: boolean
  readonly failure?: CallIndexPanelFailure
  readonly detailFailure?: CallIndexPanelFailure
  readonly startTask?: CallIndexTaskView
  readonly startFailure?: CallIndexPanelFailure
  /** A failed "加载更多"; shown so the button is never a silent no-op. */
  readonly moreFailure?: CallIndexPanelFailure
}

export interface CallIndexDetailPanelProps {
  /** Stable across renders; an inline object would re-read on every paint. */
  readonly api: CallIndexPanelApi
  readonly initialQuery?: Partial<CallIndexQuery>
  /**
   * Resolve the live 按会话 / 按工作区 target.
   *
   * Supplied by the plugin root because `settings.section` is root-scoped and
   * receives no Session props. Called only when the operator picks a narrowed
   * scope, so a tab that stays on 全部 never pays for it.
   */
  readonly resolveScopeTarget?: () => CallIndexScopeTarget
  /**
   * Session names + switchable list for 按会话.
   *
   * Read on every render rather than cached: the Host catalog changes when a
   * conversation is created, renamed or closed, and a stale name is worse than
   * a re-read. It is a synchronous snapshot read, not a subscription.
   */
  readonly resolveSessionCatalog?: () => CallIndexSessionCatalog
}

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 720px)')
    const sync = (): void => setNarrow(query.matches)
    sync()
    if (typeof query.addEventListener !== 'function') return
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return narrow
}

/**
 * Decide what happens to the open detail pane after a refresh.
 *
 * The pane is addressed by (sessionId, callSeq) — NOT by the snapshot id — so a
 * refresh does not invalidate it. Clearing it unconditionally is what made the
 * popup flash: the automatic scan finishing triggered a refresh, which closed
 * the pane the user had just opened, about a second later.
 *
 * Extracted as a pure function because the container owns hooks and the suite
 * has no DOM harness: a test that only renders the view cannot catch this.
 */
/**
 * Merge a background refresh into a page the operator may have extended.
 *
 * The auto-refresh (which runs while a scan is in progress) re-reads only the
 * FIRST page. Assigning it directly threw away every page the operator had
 * appended with 加载更多, so the table visibly collapsed back to page one —
 * reported as 「加载更多会自动收起，显示快照代 55」.
 *
 * `appended` is how many extra pages are currently on screen. While it is > 0 we
 * keep the existing rows and only take the fresh metadata (generation, coverage,
 * counts), because the appended rows belong to the same snapshot. A genuinely new
 * snapshot (different id) means the old rows are stale, so it resets.
 */
export function mergeRefreshedPage(
  previous: CallIndexCallPageView | undefined,
  fresh: CallIndexCallPageView,
  appended: number,
): CallIndexCallPageView {
  if (previous === undefined || appended <= 0) return fresh
  if (previous.snapshotId !== fresh.snapshotId) return fresh
  return {
    ...fresh,
    items: previous.items,
    // Keep the union's drop count; the fresh page only knows its own rows.
    droppedItems: Math.max(previous.droppedItems, fresh.droppedItems),
  }
}

export function detailAfterRefresh(
  previous: { readonly detailTarget?: { readonly sessionId: string; readonly callSeq: number } },
  page: CallIndexCallPageView | undefined,
): { detail?: undefined; detailTarget?: undefined; detailFailure?: undefined } | Record<string, never> {
  const target = previous.detailTarget
  if (target === undefined) return {}
  // An unreadable page is not evidence the row vanished; keep the pane.
  if (page === undefined) return {}
  const present = page.items.some(item => item.sessionId === target.sessionId && item.callSeq === target.callSeq)
  return present ? {} : { detail: undefined, detailTarget: undefined, detailFailure: undefined }
}

/**
 * Container for 调用明细: owns the query, the paging cursor and the detail read.
 * Keeps the previous page visible while the next one loads, so a range click
 * reads as a filter rather than a reset.
 */
export function CallIndexDetailPanel({ api, initialQuery, resolveScopeTarget, resolveSessionCatalog }: CallIndexDetailPanelProps): ReactElement {
  const [query, setQuery] = useState<CallIndexQuery>(() => normalizeCallIndexQuery(initialQuery))
  const [state, setState] = useState<DetailState>({ loading: true, loadingMore: false, loadingDetail: false })
  const [refreshToken, setRefreshToken] = useState(0)
  // Local tool-name filter for the detail card. Client-only: it never narrows the
  // wire query, so the Host keeps returning the same snapshot while the operator
  // types. Resets only on a full remount, matching the tab's lifetime.
  const [search, setSearch] = useState('')
  const generation = useRef(0)
  // The `now` the current page was fetched with. Paging must reuse it, or the
  // cursor's filter no longer matches and the Host answers invalid-request.
  const pageAnchor = useRef<number | undefined>(undefined)
  /** How many extra pages 加载更多 has appended; 0 means only the first page. */
  const appendedPages = useRef(0)
  // A different query invalidates paging: the rows are a different set. This is
  // the ONLY place the counter resets — the refresh effect must not touch it,
  // because that effect also runs for the 2s background poll.
  const queryKey = JSON.stringify(query)
  const lastQueryKey = useRef(queryKey)
  if (lastQueryKey.current !== queryKey) {
    lastQueryKey.current = queryKey
    appendedPages.current = 0
  }
  const narrow = useNarrowViewport()
  // Read the Host Session catalog on every render: names must not go stale, and
  // this is a synchronous snapshot, not a subscription. Guarded so a missing
  // catalog leaves the panel on ids instead of throwing.
  const catalog: CallIndexSessionCatalog | undefined = (() => {
    if (resolveSessionCatalog === undefined) return undefined
    try { return resolveSessionCatalog() } catch { return undefined }
  })()

  useEffect(() => {
    const requestGeneration = ++generation.current
    let active = true
    // Pin one clock reading for this page set; every later page reuses it.
    const anchor = Date.now()
    pageAnchor.current = anchor
    // NOTE: do NOT reset `appendedPages` here. This effect also runs for the
    // 2s background refresh (it depends on `refreshToken`), so resetting here
    // cleared the counter on every tick — the merge then always saw 0 and
    // collapsed the table back to page one. That was the second half of
    // 「点加载更多后自动缩回」. The counter is reset only when the QUERY
    // changes, which is the one event that genuinely invalidates paging.
    setState(previous => ({ ...previous, loading: true, moreFailure: undefined }))
    void (async () => {
      const [statusResult, pageResult, sessionsResult] = await Promise.all([
        api.getStatus(),
        api.listCalls(query, undefined, anchor),
        api.listSessions(query),
      ])
      if (!active || generation.current !== requestGeneration) return
      setState(previous => {
        const failures: CallIndexPanelFailure[] = []
        if (!pageResult.ok) failures.push(pageResult)
        else if (!statusResult.ok) failures.push(statusResult)
        const failure = failures[0]
        return {
          ...previous,
          loading: false,
          ...(statusResult.ok ? { status: statusResult.value } : {}),
          // A background refresh replaces the FIRST page only. If the operator had
          // already appended pages, keeping just the new first page silently threw
          // them away — the reported "加载更多会自动收起，回到快照代 55". When rows
          // were appended, keep them and let the next explicit reload reset.
          ...(pageResult.ok
            ? { page: mergeRefreshedPage(previous.page, pageResult.value, appendedPages.current) }
            : {}),
          ...(sessionsResult.ok ? { sessions: sessionsResult.value } : {}),
          ...(failure === undefined ? { failure: undefined } : { failure }),
          // The open detail is addressed by (sessionId, callSeq), NOT by the
          // snapshot id, so a refresh does not invalidate it. Clearing it here
          // is what made the detail popup flash open and then snap back to
          // 「尚未选择调用」 one second later: any refresh (the automatic scan
          // finishing, a filter change) closed the pane the user had just
          // opened. It now survives a refresh, and is closed only when the row
          // it points at is gone from the new page.
          ...detailAfterRefresh(previous, pageResult.ok ? pageResult.value : undefined),
        }
      })    })()
    return () => { active = false }
  }, [api, query, refreshToken])

  /**
   * Re-read while a scan is running.
   *
   * The 刷新 button is gone (D-031): indexing starts by itself, so the page must
   * also refresh by itself or it would freeze on the first, empty snapshot. This
   * polls ONLY while the Host reports an unfinished scan, then stops — it is not
   * a permanent timer, and it never triggers indexing, only reads.
   */
  const scanningNow = state.status !== undefined
    && (state.status.phase === 'running' || state.status.sessions.pending > 0)
  useEffect(() => {
    if (!scanningNow) return
    const timer = setTimeout(() => setRefreshToken(value => value + 1), 2000)
    return () => clearTimeout(timer)
  }, [scanningNow, refreshToken, state.page?.generation])

  /**
   * Append the next page.
   *
   * The cursor pins the filter it was issued for, so paging MUST reuse the SAME
   * time window the first page used. It used to rebuild the request from `query`
   * with a fresh `now`, which shifted `fromMs`/`toMs` by a few hundred
   * milliseconds; the Host saw a different filterKey for the same cursor and
   * answered `invalid-request`. The button then appeared to do nothing at all,
   * because the failure was stored but never shown.
   */
  const loadMore = useCallback(() => {
    const cursor = state.page?.nextCursor
    if (cursor === undefined) return
    const requestGeneration = generation.current
    const pinnedAt = pageAnchor.current
    setState(previous => ({ ...previous, loadingMore: true, moreFailure: undefined }))
    void (async () => {
      const result = await api.listCalls(query, cursor, pinnedAt)
      setState(previous => {
        if (generation.current !== requestGeneration) return { ...previous, loadingMore: false }
        // A failed page must be visible: a silent no-op is indistinguishable from
        // a broken button, which is exactly how this was reported.
        if (!result.ok) return { ...previous, loadingMore: false, moreFailure: result }
        appendedPages.current += 1
        return {
          ...previous,
          loadingMore: false,
          moreFailure: undefined,
          page: {
            ...result.value,
            // Append; the summary and meta stay the newer page's, which carries
            // the same snapshotId because the cursor pins the view.
            items: [...(previous.page?.items ?? []), ...result.value.items],
            droppedItems: (previous.page?.droppedItems ?? 0) + result.value.droppedItems,
          },
        }
      })
    })()
  }, [api, query, state.page?.nextCursor])

  /**
   * Fill the table to the end of the snapshot without a button.
   *
   * 「加载更多」 used to be the only way past the first 50 CALLS, which after
   * per-tool aggregation is a handful of tool rows — the operator asked to see
   * every tool at once and scroll, not to page a table that comfortably fits.
   * This keeps requesting the next page while the wire offers a cursor.
   *
   * Bounded: `pageAnchor` guards against a cursor loop that would otherwise
   * re-request the same page forever, and the cap stops one pathological
   * snapshot from turning the panel into a thousand round-trips.
   */
  useEffect(() => {
    if (state.page?.nextCursor === undefined || state.loadingMore || state.loading) return
    if (appendedPages.current >= MAX_AUTO_PAGES) return
    if (state.moreFailure !== undefined) return
    loadMore()
  }, [state.page?.nextCursor, state.loadingMore, state.loading, state.moreFailure, loadMore])

  const select = useCallback((row: CallIndexCallRow) => {
    setState(previous => ({
      ...previous,
      detailTarget: { sessionId: row.sessionId, callSeq: row.callSeq },
      detail: undefined,
      detailFailure: undefined,
      loadingDetail: true,
    }))
    void (async () => {
      const result = await api.getDetail(row.sessionId, row.callSeq)
      setState(previous => {
        const target = previous.detailTarget
        if (target === undefined || target.sessionId !== row.sessionId || target.callSeq !== row.callSeq) {
          return { ...previous, loadingDetail: false }
        }
        return result.ok
          ? { ...previous, loadingDetail: false, detail: result.value, detailFailure: undefined }
          : { ...previous, loadingDetail: false, detailFailure: result }
      })
    })()
  }, [api])

  const closeDetail = useCallback(() => {
    setState(previous => ({
      ...previous,
      detail: undefined,
      detailTarget: undefined,
      detailFailure: undefined,
      loadingDetail: false,
    }))
  }, [])

  /**
   * Start one explicit history scan, then refresh so the new task's state and
   * any freshly indexed Sessions show up. Deliberately no polling loop: the
   * task is idempotent on the Host and the button re-enables after the refresh.
   */
  const startIndex = useCallback((mode: 'full' | 'incremental') => {
    const start = api.startIndex
    // A Host older than N23 has no startIndex; report that instead of throwing.
    if (start === undefined) return
    setState(previous => ({
      ...previous,
      loading: true,
      startFailure: undefined,
    }))
    void (async () => {
      const result = await start.call(api, mode)
      setState(previous => result.ok
        ? { ...previous, loading: false, startTask: result.value, startFailure: undefined }
        : { ...previous, loading: false, startFailure: result })
      // No automatic refresh here: the mount-time scan already runs once, and
      // re-reading on every task start was another source of the pane flashing
      // closed. The status line shows the task; 刷新 re-reads when asked.
    })()
  }, [api])

  return createElement(CallIndexDetailPanelView, {
    query,
    ...(state.status === undefined ? {} : { status: state.status }),
    ...(state.page === undefined ? {} : { page: state.page }),
    ...(state.sessions === undefined ? {} : { sessions: state.sessions }),
    ...(state.detail === undefined ? {} : { detail: state.detail }),
    ...(state.detailTarget === undefined ? {} : { detailTarget: state.detailTarget }),
    ...(state.detailFailure === undefined ? {} : { detailFailure: state.detailFailure }),
    ...(state.failure === undefined ? {} : { failure: state.failure }),
    ...(state.startFailure === undefined ? {} : { startFailure: state.startFailure }),
    ...(state.startTask === undefined ? {} : { startTask: state.startTask }),
    ...(state.moreFailure === undefined ? {} : { moreFailure: state.moreFailure }),
    loading: state.loading,
    loadingMore: state.loadingMore,
    loadingDetail: state.loadingDetail,
    narrow,
    search,
    onSearchChange: setSearch,
    onQueryChange: setQuery,
    onRefresh: () => setRefreshToken(value => value + 1),
    onStartIndex: startIndex,
    ...(resolveScopeTarget === undefined ? {} : { onResolveScope: resolveScopeTarget }),
    ...(catalog === undefined ? {} : { catalog }),
    onSelect: select,
    onCloseDetail: closeDetail,
  })
}

export interface CallIndexOverviewPanelProps {
  readonly api: CallIndexPanelApi
}

/**
 * Container for 总览. Reads the status once, one all-time summary, AND one
 * `listCalls` snapshot — because the overview reply carries no per-tool counts,
 * and the v3 ranking / fault panels need them. The per-tool read fills up to
 * `MAX_AUTO_PAGES` pages (same bound the detail page uses) then aggregates with
 * the shared pure `callIndexToolRows`. Failing to read rows never blocks the
 * headline numbers; it only shows an honest empty state in the two panels.
 */
export function CallIndexOverviewPanel({ api }: CallIndexOverviewPanelProps): ReactElement {
  const [state, setState] = useState<{
    readonly status?: CallIndexStatusView
    readonly overview?: CallIndexOverviewView
    readonly tools?: readonly CallIndexToolRow[]
    readonly toolsFailure?: CallIndexPanelFailure
    readonly loading: boolean
    readonly failure?: CallIndexPanelFailure
  }>({ loading: true })
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let active = true
    setState(previous => ({ ...previous, loading: true }))
    const query: CallIndexQuery = { range: CALL_INDEX_OVERVIEW_RANGE }
    // Pin one clock reading so every paginated page shares the first page's
    // filter (a cursor only matches the window it was issued for).
    const anchor = Date.now()
    void (async () => {
      const [statusResult, overviewResult, callsResult] = await Promise.all([
        api.getStatus(),
        api.getOverview(query),
        api.listCalls(query, undefined, anchor),
      ])
      if (!active) return
      const failure = overviewResult.ok ? (statusResult.ok ? undefined : statusResult) : overviewResult
      let tools: readonly CallIndexToolRow[] | undefined
      let toolsFailure: CallIndexPanelFailure | undefined
      if (callsResult.ok) {
        const items = [...callsResult.value.items]
        let cursor = callsResult.value.nextCursor
        let pages = 0
        while (cursor !== undefined && pages < MAX_AUTO_PAGES) {
          const next = await api.listCalls(query, cursor, anchor)
          if (!next.ok) { toolsFailure = next; break }
          items.push(...next.value.items)
          cursor = next.value.nextCursor
          pages += 1
        }
        tools = callIndexToolRows({ ...callsResult.value, items })
      } else {
        toolsFailure = callsResult
      }
      if (!active) return
      setState({
        loading: false,
        ...(statusResult.ok ? { status: statusResult.value } : {}),
        ...(overviewResult.ok ? { overview: overviewResult.value } : {}),
        ...(failure === undefined ? {} : { failure }),
        ...(tools === undefined ? {} : { tools }),
        ...(toolsFailure === undefined ? {} : { toolsFailure }),
      })
    })()
    return () => { active = false }
  }, [api, refreshToken])

  return createElement(CallIndexOverviewPanelView, {
    ...(state.status === undefined ? {} : { status: state.status }),
    ...(state.overview === undefined ? {} : { overview: state.overview }),
    ...(state.tools === undefined ? {} : { tools: state.tools }),
    ...(state.toolsFailure === undefined ? {} : { toolsFailure: state.toolsFailure }),
    ...(state.failure === undefined ? {} : { failure: state.failure }),
    loading: state.loading,
    toolsLoading: state.loading,
    onRefresh: () => setRefreshToken(value => value + 1),
  })
}
