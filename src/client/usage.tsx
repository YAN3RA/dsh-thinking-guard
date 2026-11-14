/**
 * Standalone N8 usage-statistics panel.
 *
 * This module is deliberately not registered from `./index.ts` yet. It
 * consumes a small, pre-aggregated view model ({@link UsagePanelSnapshot})
 * rather than the raw `usage` wire face: the wire face is delivered separately
 * and returns per-session/day report rows plus a per-session coverage map. A
 * page-level adapter projects those rows into this view model; keeping that
 * projection outside this file keeps the dense rendering rules testable with
 * no browser, Remote import or Host session object.
 *
 * Rules baked into this first cut:
 * - Unknown coverage is not zero. Partial and unknown snapshots say so and
 *   label the numbers as observed lower bounds.
 * - Unknown sources stay unknown. They are never folded into MCP, Skill or
 *   plugin-tool totals.
 * - Filters render only when the snapshot supplies the dimension. Date ranges
 *   are the exception: 7/15/30 is part of the page contract.
 * - No browser APIs, stylesheet or Remote imports. The component reuses the
 *   existing `mc-*` scoped class names from CapabilitySection, so it can mount
 *   in the settings shell without a second stylesheet.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import { Button, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

/** Kinds mirror `src/usage/usage-core.ts`; the wire contract may re-export them. */
export type UsageCapabilityKind = 'mcp' | 'skill' | 'plugin-tool' | 'native' | 'unknown'

/** Coverage is first-class: a missing history is not an empty history. */
export type UsageCoverageStatus = 'complete' | 'partial' | 'unknown'

export type UsageRangeDays = 7 | 15 | 30

export type UsageWorkspaceAttribution = 'event-time' | 'current-mapping' | 'unknown'

/** Current exposure tier of a capability, when the Host can report it. */
export type UsageCapabilityStatus = 'resident' | 'on-demand' | 'disabled' | 'unavailable' | 'unknown'

/** Deliberately separate from "no calls": a suggestion needs enough evidence. */
export type UsageSuggestion = 'normal' | 'low' | 'on-demand' | 'disable' | 'insufficient-data'

export interface UsageCoverage {
  readonly status: UsageCoverageStatus
  /** Inclusive start of the observed window, UTC epoch milliseconds. */
  readonly from?: number
  /** Inclusive end of the observed window, UTC epoch milliseconds. */
  readonly through?: number
  readonly reasons?: readonly string[]
  readonly skippedSessions?: number
  readonly skippedEvents?: number
  readonly reasonsTruncated?: boolean
  readonly workspaceAttribution?: UsageWorkspaceAttribution
}

export interface UsageTotals {
  /** Observed tool/skill calls in the window — never a Token count. */
  readonly calls: number
  readonly succeeded?: number
  readonly failed?: number
  readonly denied?: number
  readonly cancelled?: number
  /** Calls whose result was never observed in the coverage window. */
  readonly unresolved?: number
  readonly distinctCapabilities?: number
  readonly mcpCalls?: number
  readonly activeMcpServers?: number
  readonly skillCalls?: number
  readonly pluginToolCalls?: number
  readonly nativeCalls?: number
  readonly unknownCalls?: number
  /** Only meaningful for 30-day queries with complete coverage. */
  readonly idleCandidates?: number
}

export interface UsageCapability {
  readonly id: string
  readonly name: string
  readonly kind: UsageCapabilityKind
  /** Server, skill root, plugin owner or a short explanation of an unknown source. */
  readonly source?: string
  readonly status?: UsageCapabilityStatus
  readonly suggestion?: UsageSuggestion
  readonly calls: number
  readonly succeeded?: number
  readonly failed?: number
  readonly lastUsedAt?: number
}

export interface UsageWorkspaceOption {
  readonly id: string
  readonly label: string
}

/**
 * Filter dimensions the Host can actually answer for this snapshot.
 *
 * `ranges` defaults to 7/15/30 when omitted. `workspaces` and `kinds` are only
 * rendered when present and non-empty; an empty list means "this deployment
 * cannot filter that way", not "the list is empty".
 */
export interface UsageFilterOptions {
  readonly ranges?: readonly UsageRangeDays[]
  readonly workspaces?: readonly UsageWorkspaceOption[]
  readonly kinds?: readonly UsageCapabilityKind[]
}

export interface UsagePanelSnapshot {
  /** When the Host assembled this snapshot, UTC epoch milliseconds. */
  readonly generatedAt?: number
  readonly coverage?: UsageCoverage
  readonly totals?: UsageTotals
  readonly capabilities?: readonly UsageCapability[]
  readonly filters?: UsageFilterOptions
  /** Short caveats such as "Skill 只统计显式加载入口". */
  readonly notes?: readonly string[]
  /**
   * Why the history backfill stopped short, keyed by reason code. Absent means
   * the Host did not report any (older Host, or the backfill has not run yet).
   * This is what tells "the window was too small" apart from "it never ran".
   */
  readonly backfillReasons?: Readonly<Record<string, number>>
}

export interface UsageQuery {
  readonly days: UsageRangeDays
  readonly workspaceId?: string
  readonly kind?: UsageCapabilityKind
}

/** Mirrors the generated Remote envelope so the adapter only maps `value`. */
export type UsageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Page data source, not the wire face. The real `usage.getSnapshot()` takes no
 * arguments and returns report rows; the adapter between them applies
 * days/workspace/kind filtering and produces this view model. The result
 * envelope matches the Remote shape so only the value projection is new.
 */
export interface UsagePanelApi {
  getSnapshot(query: UsageQuery): Promise<UsageResult<UsagePanelSnapshot>>
}

export interface UsagePanelProps {
  /**
   * Must be stable across renders (a generated namespace face is). An inline
   * object here would re-run the read on every render.
   */
  readonly api: UsagePanelApi
  readonly initialQuery?: Partial<UsageQuery>
}

export interface UsagePanelViewProps {
  readonly query: UsageQuery
  readonly snapshot?: UsagePanelSnapshot
  readonly loading?: boolean
  readonly error?: string
  readonly onQueryChange?: (query: UsageQuery) => void
  readonly onRefresh?: () => void
}

const DEFAULT_RANGES: readonly UsageRangeDays[] = [7, 15, 30]

interface UsagePanelState {
  readonly snapshot?: UsagePanelSnapshot
  readonly loading: boolean
  readonly error?: string
}

/**
 * Container: performs the one read, keeps the previous snapshot visible while
 * a filter change or refresh is in flight, and ignores out-of-order replies.
 */
export function UsagePanel({ api, initialQuery }: UsagePanelProps): ReactElement {
  const [query, setQuery] = useState<UsageQuery>(() => normalizeQuery(initialQuery))
  const [state, setState] = useState<UsagePanelState>({ loading: true })
  const [refreshToken, setRefreshToken] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const requestGeneration = ++generation.current
    let active = true
    // Keep the old numbers on screen while the next window loads. That is what
    // makes a range click feel like a filter rather than a page reset.
    setState(previous => ({ snapshot: previous.snapshot, loading: true }))
    void (async () => {
      try {
        const result = await api.getSnapshot(query)
        if (!active || generation.current !== requestGeneration) return
        if (result.ok) {
          setState({ snapshot: result.value, loading: false })
        } else {
          setState(previous => ({
            snapshot: previous.snapshot,
            loading: false,
            error: result.error.message === '' ? result.error.code : result.error.message,
          }))
        }
      } catch (error) {
        if (!active || generation.current !== requestGeneration) return
        setState(previous => ({ snapshot: previous.snapshot, loading: false, error: String(error) }))
      }
    })()
    return () => {
      active = false
    }
  }, [api, query, refreshToken])

  const changeQuery = useCallback((next: UsageQuery) => {
    setQuery(next)
  }, [])
  const refresh = useCallback(() => {
    setRefreshToken(value => value + 1)
  }, [])

  return (
    <UsagePanelView
      query={query}
      snapshot={state.snapshot}
      loading={state.loading}
      error={state.error}
      onQueryChange={changeQuery}
      onRefresh={refresh}
    />
  )
}

/**
 * Pure view. Kept separate from the container so the dense rendering rules can
 * be tested by walking the element tree, with no DOM or browser environment.
 */
export function UsagePanelView({
  query,
  snapshot,
  loading = false,
  error,
  onQueryChange,
  onRefresh,
}: UsagePanelViewProps): ReactElement {
  const ranges = normalizeRanges(snapshot?.filters?.ranges)
  const workspaces: readonly UsageWorkspaceOption[] = snapshot?.filters?.workspaces ?? []
  const kinds: readonly UsageCapabilityKind[] = snapshot?.filters?.kinds ?? []
  const capabilities: readonly UsageCapability[] = snapshot?.capabilities ?? []
  const totals = snapshot?.totals
  const coverageStatus = snapshot?.coverage?.status ?? 'unknown'
  const canChange = onQueryChange !== undefined
  // Absence of rows is only evidence of "no calls" when the window is complete
  // and the Host actually returned totals. Otherwise say what is missing.
  const emptyDetail = totals === undefined
    ? '没有可显示的调用明细；数据尚未完整返回，不能据此判断能力未使用。'
    : totals.calls === 0 && coverageStatus === 'complete'
      ? query.kind === undefined
        ? '所选范围内没有调用记录。'
        : `所选类型（${usageKindLabel(query.kind)}）没有调用记录。`
      : '没有可显示的调用明细；覆盖或明细可能不完整，不能据此判断能力未使用。'

  const change = (patch: Partial<UsageQuery>): void => {
    if (onQueryChange !== undefined) onQueryChange({ ...query, ...patch })
  }

  const updated = snapshot?.generatedAt === undefined
    ? '尚未更新'
    : `更新于 ${formatUsageTime(snapshot.generatedAt)}`
  const activity = loading
    ? snapshot === undefined ? '正在读取…' : '正在刷新…'
    : updated

  return (
    <section className="mc-section" aria-label="调用统计" aria-busy={loading}>
      <header className="mc-heading-row">
        <div className="mc-heading-meta">
          <h2 className="mc-heading">调用统计</h2>
          <span className="mc-version">{activity}</span>
        </div>
        <div className="mc-heading-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || onRefresh === undefined}
            onClick={() => onRefresh?.()}
          >
            刷新
          </Button>
        </div>
      </header>

      <p className="mc-desc">
        统计工具与技能的实际调用次数，不代表 Token 数；未确认来源的调用单独列出，不猜测归属。
      </p>

      <div className="mc-tabs">
        <div className="mc-tab-group" role="group" aria-label="时间范围">
          {ranges.map(days => {
            const active = query.days === days
            return (
              <Pill
                key={days}
                active={active}
                aria-pressed={active}
                disabled={!canChange}
                onClick={() => change({ days })}
              >
                {`${days} 天`}
              </Pill>
            )
          })}
        </div>
        <div className="mc-summary">
          {workspaces.length > 0 && (
            <label className="mc-summary-setting">
              <span>工作区</span>
              <select
                value={query.workspaceId ?? ''}
                disabled={!canChange}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const value = event.target.value
                  change({ workspaceId: value === '' ? undefined : value })
                }}
              >
                <option value="">全部工作区</option>
                {/* A stale selected id should stay visible rather than silently
                    falling back to "all workspaces" and mislabeling the data. */}
                {query.workspaceId !== undefined
                  && !workspaces.some(workspace => workspace.id === query.workspaceId) && (
                    <option value={query.workspaceId}>{`${query.workspaceId}（当前）`}</option>
                  )}
                {workspaces.map(workspace => (
                  <option key={workspace.id} value={workspace.id}>{workspace.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {kinds.length > 0 && (
        <div className="mc-subtabs" role="group" aria-label="能力类型">
          <Pill
            active={query.kind === undefined}
            aria-pressed={query.kind === undefined}
            disabled={!canChange}
            onClick={() => change({ kind: undefined })}
          >
            全部类型
          </Pill>
          {kinds.map(kind => {
            const active = query.kind === kind
            return (
              <Pill
                key={kind}
                active={active}
                aria-pressed={active}
                disabled={!canChange}
                onClick={() => change({ kind })}
              >
                {usageKindLabel(kind)}
              </Pill>
            )
          })}
        </div>
      )}

      {snapshot !== undefined && loading && (
        <p className="mc-desc">正在加载新的筛选结果；下面仍是上一次成功读取的数据。</p>
      )}

      {error !== undefined && (
        <div className="mc-error" role="alert">
          <p>{error}</p>
          {snapshot !== undefined && <p className="mc-error-hint">显示的是上一次成功读取的数据。</p>}
          {onRefresh !== undefined && (
            <div className="mc-error-actions">
              <Button size="sm" variant="outline" disabled={loading} onClick={onRefresh}>
                重试
              </Button>
            </div>
          )}
        </div>
      )}

      {snapshot === undefined && loading && <p className="mc-empty">正在读取调用统计…</p>}
      {snapshot === undefined && !loading && error === undefined && (
        <p className="mc-empty">尚未读取调用统计。</p>
      )}

      {snapshot !== undefined && (
        <>
          <CoverageNotice snapshot={snapshot} />

          <div className="mc-summary" style={{ justifyContent: 'flex-start' }} aria-label="调用统计总览">
            {usageMetrics(totals, query.days, coverageStatus)}
          </div>

          <div className="mc-heading-row">
            <div className="mc-heading-meta">
              <h3 className="mc-heading" style={{ fontSize: 14 }}>能力调用</h3>
              <span className="mc-version">{`${capabilities.length} 项`}</span>
              {query.kind !== undefined && <Tag>{`类型：${usageKindLabel(query.kind)}`}</Tag>}
            </div>
          </div>

          {capabilities.length === 0
            ? <p className="mc-empty">{emptyDetail}</p>
            : (
                <div className="mc-group">
                  <div className="mc-tools" style={{ borderTop: 0 }}>
                    {capabilities.map(capability => {
                      const source = capability.source
                        ?? (capability.kind === 'unknown' ? '来源未确认' : undefined)
                      return (
                        <div className="mc-tool" key={capability.id} style={{ cursor: 'default' }}>
                          <span className="mc-tool-name" title={capability.name}>{capability.name}</span>
                          <Tag>{usageKindLabel(capability.kind)}</Tag>
                          {source !== undefined && <span className="mc-source" title={source}>{source}</span>}
                          <span className="mc-tool-meta">
                            <Tag>{`${formatUsageCount(capability.calls)} 次`}</Tag>
                            {(capability.succeeded !== undefined || capability.failed !== undefined) && (
                              <span className="mc-source">
                                {`成功 ${formatUsageCount(capability.succeeded)} · 失败 ${formatUsageCount(capability.failed)}`}
                              </span>
                            )}
                            <span className="mc-source">{`最近 ${formatUsageTime(capability.lastUsedAt)}`}</span>
                            {capability.status !== undefined && (
                              <Tag>{usageStatusLabel(capability.status)}</Tag>
                            )}
                            {capability.suggestion !== undefined && (
                              <Tag>{usageSuggestionLabel(capability.suggestion)}</Tag>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

          <p className="mc-desc">
            Skill 只统计显式加载/调用入口；未确认 owner 的工具归入原生与其他或未知，不按名称前缀猜测插件包。
          </p>
        </>
      )}
    </section>
  )
}

/**
 * Coverage is the page's honesty layer. It always renders: a snapshot without
 * coverage data is "unknown", not "complete".
 */
function CoverageNotice({ snapshot }: { readonly snapshot: UsagePanelSnapshot }): ReactElement {
  const coverage = snapshot.coverage
  const status = coverage?.status ?? 'unknown'
  const reasons = coverage?.reasons ?? []
  const notes = snapshot.notes ?? []
  const skippedSessions = coverage?.skippedSessions ?? 0
  const skippedEvents = coverage?.skippedEvents ?? 0
  const warning = status === 'partial'
    ? '覆盖不完整：部分会话或事件未纳入统计，下面的数字是已观察到的下限，不能当作完整调用量。'
    : status === 'unknown'
      ? '覆盖未知：无法确认历史是否完整；下面的数字只代表已观察到的调用，0 不代表未使用。'
      : undefined
  const attribution = usageAttributionLabel(coverage?.workspaceAttribution)
  const backfill = usageBackfillSummary(snapshot.backfillReasons)
  const backfillHint = backfill === undefined ? '' : '（回补停止的原因，不是统计口径）'

  return (
    <div
      className="mc-notice"
      role="status"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
    >
      <div className="mc-counts">
        <Tag>{`覆盖：${usageCoverageLabel(status)}`}</Tag>
        <span className="mc-source">{coverageRange(coverage)}</span>
        {skippedSessions > 0 && <span className="mc-source">{`跳过 ${formatUsageCount(skippedSessions)} 个会话`}</span>}
        {skippedEvents > 0 && <span className="mc-source">{`跳过 ${formatUsageCount(skippedEvents)} 个事件`}</span>}
      </div>
      {warning !== undefined && <p className="mc-desc">{warning}</p>}
      {reasons.length > 0 && (
        <p className="mc-desc">
          {`原因：${reasons.join('；')}${coverage?.reasonsTruncated === true ? '；另有原因未列出' : ''}`}
        </p>
      )}
      {backfill !== undefined && (
        <p className="mc-desc">{`历史回补：${backfill}${backfillHint}`}</p>
      )}
      {attribution !== undefined && <p className="mc-desc">{attribution}</p>}
      {notes.length > 0 && <p className="mc-desc">{`说明：${notes.join('；')}`}</p>}
    </div>
  )
}

/** Rank the backfill stop reasons by count so the biggest blocker reads first. */
const USAGE_BACKFILL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  budget: '触及预算上限（会话数或事件数）',
  timeout: '触及墙钟上限',
  cancelled: '被取消',
  'backfill-incomplete': '会话未能完整读取',
  'backfill-disabled-profile-unknown': '无法识别 profile',
  'backfill-disabled-service-unavailable': '宿主未提供 sessionPersistence 服务（本机回补不可用，数字仅为实时观测）',
  'backfill-runtime-failed': '回补运行时出错',
})

function usageBackfillSummary(
  reasons: Readonly<Record<string, number>> | undefined,
): string | undefined {
  if (reasons === undefined) return undefined
  const rows = Object.entries(reasons).filter(([, count]) => count > 0)
  if (rows.length === 0) return undefined
  return rows
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${USAGE_BACKFILL_LABELS[reason] ?? reason} × ${count}`)
    .join('；')
}

function usageMetrics(
  totals: UsageTotals | undefined,
  days: UsageRangeDays,
  coverageStatus: UsageCoverageStatus,
): ReactElement[] {
  const metrics: ReactElement[] = [
    metric('调用总数', formatUsageCount(totals?.calls)),
    metric('成功 / 失败', `${formatUsageCount(totals?.succeeded)} / ${formatUsageCount(totals?.failed)}`),
    metric('成功率', successRate(totals)),
    metric('独立能力', formatUsageCount(totals?.distinctCapabilities)),
    metric('MCP 调用 / 活跃 Server', `${formatUsageCount(totals?.mcpCalls)} / ${formatUsageCount(totals?.activeMcpServers)}`),
    metric('技能调用', formatUsageCount(totals?.skillCalls)),
    metric('插件工具', formatUsageCount(totals?.pluginToolCalls)),
    metric('原生与其他', formatUsageCount(totals?.nativeCalls)),
    metric('来源未解析', formatUsageCount(totals?.unknownCalls)),
  ]
  if ((totals?.denied ?? 0) > 0) metrics.push(metric('拒绝', formatUsageCount(totals?.denied)))
  if ((totals?.cancelled ?? 0) > 0) metrics.push(metric('取消', formatUsageCount(totals?.cancelled)))
  if ((totals?.unresolved ?? 0) > 0) metrics.push(metric('未配对结果', formatUsageCount(totals?.unresolved)))
  // The 30-day zero-call candidate is only meaningful for the 30-day window
  // with complete coverage; never surface it on a shorter or gapped query.
  if (days === 30 && coverageStatus === 'complete' && totals?.idleCandidates !== undefined) {
    metrics.push(metric('30 天 0 调用候选', formatUsageCount(totals.idleCandidates)))
  }
  return metrics
}

function metric(label: string, value: string): ReactElement {
  return (
    <span className="mc-chip" key={label}>
      <span className="mc-desc">{label}</span>
      <strong>{value}</strong>
    </span>
  )
}

/** `YYYY-MM-DD HH:mm` in the Host/browser local timezone; `—` when unknown. */
export function formatUsageTime(time: number | undefined): string {
  if (time === undefined || !Number.isFinite(time)) return '—'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Thousands-separated count; missing or invalid values stay visibly unknown. */
export function formatUsageCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—'
  return Math.trunc(value).toLocaleString('en-US')
}

function successRate(totals: UsageTotals | undefined): string {
  if (totals?.succeeded === undefined || totals.failed === undefined) return '—'
  const resolved = totals.succeeded + totals.failed
  if (resolved <= 0) return '—'
  return `${Math.round((totals.succeeded / resolved) * 100)}%`
}

function coverageRange(coverage: UsageCoverage | undefined): string {
  const from = coverage?.from
  const through = coverage?.through
  if (from === undefined && through === undefined) return '时间范围未知'
  if (from === undefined) return `截至 ${formatUsageTime(through)}`
  if (through === undefined) return `自 ${formatUsageTime(from)}`
  return `${formatUsageTime(from)} – ${formatUsageTime(through)}`
}

function usageCoverageLabel(status: UsageCoverageStatus): string {
  switch (status) {
    case 'complete': return '完整'
    case 'partial': return '部分'
    case 'unknown': return '未知'
  }
}

function usageKindLabel(kind: UsageCapabilityKind): string {
  switch (kind) {
    case 'mcp': return 'MCP 工具'
    case 'skill': return 'Skills'
    case 'plugin-tool': return '第三方插件'
    case 'native': return '原生工具'
    case 'unknown': return '未知'
  }
}

function usageStatusLabel(status: UsageCapabilityStatus): string {
  switch (status) {
    case 'resident': return '常驻'
    case 'on-demand': return '按需'
    case 'disabled': return '禁用'
    case 'unavailable': return '不可用'
    case 'unknown': return '状态未知'
  }
}

function usageSuggestionLabel(suggestion: UsageSuggestion): string {
  switch (suggestion) {
    case 'normal': return '正常'
    case 'low': return '低频'
    case 'on-demand': return '建议按需'
    case 'disable': return '建议禁用'
    case 'insufficient-data': return '数据不足'
  }
}

function usageAttributionLabel(attribution: UsageWorkspaceAttribution | undefined): string | undefined {
  switch (attribution) {
    case 'event-time': return '工作区归属：事件发生时可确认。'
    case 'current-mapping': return '工作区归属：按当前映射推断，可能不同于调用发生时。'
    case 'unknown': return '工作区归属未知。'
    default: return undefined
  }
}

function normalizeQuery(initial: Partial<UsageQuery> | undefined): UsageQuery {
  const days = initial?.days
  return {
    days: days !== undefined && isRangeDays(days) ? days : 7,
    ...(initial?.workspaceId !== undefined && initial.workspaceId !== ''
      ? { workspaceId: initial.workspaceId }
      : {}),
    ...(initial?.kind !== undefined ? { kind: initial.kind } : {}),
  }
}

function normalizeRanges(ranges: readonly UsageRangeDays[] | undefined): readonly UsageRangeDays[] {
  if (ranges === undefined) return DEFAULT_RANGES
  const seen = new Set<UsageRangeDays>()
  const normalized: UsageRangeDays[] = []
  for (const range of ranges) {
    if (isRangeDays(range) && !seen.has(range)) {
      seen.add(range)
      normalized.push(range)
    }
  }
  // An explicitly empty list is treated as "not supplied" rather than leaving
  // the page without its contractual time filter.
  return normalized.length > 0 ? normalized : DEFAULT_RANGES
}

function isRangeDays(value: number): value is UsageRangeDays {
  return value === 7 || value === 15 || value === 30
}
