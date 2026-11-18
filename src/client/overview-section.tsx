/**
 * 总览 — 三块：执行保护状态 / 执行保护统计 / 能力目录分布。
 *
 * 数据来源只有三个，都不含会话内容：
 *   1. Guard 开关与诊断（getGuard / getGuardDiagnostics）；
 *   2. Guard 计数（getGuardStats，落盘在本机，重启后继续累加）；
 *   3. 能力目录快照（classifyAll / catalogVersion / getDiagnostics）。
 *
 * 刻意不读会话历史：没有任何会话事件流、持久化会话索引或调用统计的代码。
 *
 * 三条硬规则（UI 优化任务书 §3.2 / §6.3）：
 *   - 状态必须来自真实数据；读不到就是「未知」，绝不默认显示正常；
 *   - 数字读不到显示「—」，绝不伪造成 0；
 *   - 比例条与占比只在有真实条目时计算，总数为零时整条轨道为空，不产生 NaN。
 *
 * 行为：挂载时读一次 + 一个「刷新」按钮，不轮询。三个区域各自独立，一块读失败
 * 只影响它自己的错误行。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { GuardDiagnostics, GuardRemote, GuardStatsSnapshot, GuardSwitches } from './guard-remote.ts'
import type { CapabilityDiagnostics, CapabilityPolicyRemote, CapabilityRow } from './store.ts'
import { V3_ROOT_CLASS } from './v3-ui.ts'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'

/** 本页文案键。zh / en 两份字典的键必须与此完全一致。 */
export type OverviewKey =
  | 'nav'
  | 'title'
  | 'overviewRefresh'
  | 'overviewRefreshing'
  | 'overviewLoading'
  | 'overviewUnknown'
  // 第一层：执行保护状态
  | 'overviewStatusTitle'
  | 'overviewStatusGuards'
  | 'overviewStatusMount'
  | 'overviewStatusPersist'
  | 'overviewStatusGuardsSuffix'
  | 'overviewStatusGuardsMasterOff'
  | 'overviewStatusGuardsAllOff'
  | 'overviewStatusMounted'
  | 'overviewStatusNotMounted'
  | 'overviewStatusInvalidPatch'
  | 'overviewStatusPersistOk'
  | 'overviewStatusPersistDirty'
  | 'overviewStatusPersistFailed'
  | 'overviewStatusSourceSwitches'
  | 'overviewStatusSourceMount'
  | 'overviewStatusSourcePersist'
  // 第二层：执行保护统计
  | 'overviewStatsTitle'
  | 'overviewStatsNote'
  | 'overviewGuardObservations'
  | 'overviewGuardRepeat'
  | 'overviewGuardCycle'
  | 'overviewGuardDenials'
  | 'overviewHintObservations'
  | 'overviewHintRepeat'
  | 'overviewHintCycle'
  | 'overviewHintDenials'
  | 'overviewStatsSince'
  | 'overviewStatsLastReminder'
  | 'overviewStatsLastDenial'
  | 'overviewStatsEmpty'
  | 'overviewGuardSource'
  | 'overviewGuardError'
  // 第三层：能力目录分布
  | 'overviewCatalogTitle'
  | 'overviewCatalogTotal'
  | 'overviewCatalogResident'
  | 'overviewCatalogOnDemand'
  | 'overviewCatalogDisabled'
  | 'overviewCatalogRatio'
  | 'overviewCatalogTools'
  | 'overviewCatalogSkills'
  | 'overviewCatalogObservedAt'
  | 'overviewCatalogVersion'
  | 'overviewCatalogJump'
  | 'overviewCatalogSource'
  | 'overviewCatalogError'

/** Props injected by the settings.section registration (see index.ts). */
export interface OverviewSectionInjected {
  guardRemote: GuardRemote
  capabilityRemote: CapabilityPolicyRemote
  t: (key: OverviewKey) => string
  /**
   * 跳到「能力菜单」页签。
   *
   * 由外壳注入（thinking-throttle.tsx）；缺省时分类行退化为纯文本，不出现点不动的
   * 按钮。只做页签跳转，不改能力菜单的过滤状态 —— 本页不该替另一页决定它显示什么。
   */
  onOpenCapability?: () => void
}

export type OverviewSectionProps = OverviewSectionInjected

interface OverviewState {
  readonly guardSwitches?: GuardSwitches
  readonly guardDiagnostics?: GuardDiagnostics
  readonly guardStats?: GuardStatsSnapshot
  readonly guardError?: string
  readonly catalogRows?: readonly CapabilityRow[]
  readonly catalogVersion?: number
  readonly catalogDiagnostics?: CapabilityDiagnostics
  readonly catalogError?: string
  /** 读到目录快照那一刻的本页时间；Host 侧的刷新时刻无从得知，也不伪造。 */
  readonly observedAt?: string
  readonly busy: boolean
}

const INITIAL_STATE: OverviewState = { busy: true }

/** Page-level rules; every colour comes from the v3 token layer. */
const OVERVIEW_CSS = [
  '.mc-overview-section.v3-root{display:flex;flex-direction:column;gap:12px}',
  '.mc-overview-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.mc-overview-bar .v3-hint{flex:1 1 240px;min-width:0}',
  // C-6A：外观交给官方 Button(outline/sm)，这里只留布局；用 .mc-btn-sm 提高 specificity
  // 把默认 28px 压到贴近原自建按钮（refresh 基线 25.333px → 26px，差 ≤2px）。
  '.mc-overview-refresh{margin-left:auto;flex:none}',
  '.mc-overview-refresh.mc-btn-sm{height:26px;min-height:26px;font-size:11.5px;line-height:16px;padding:0 12px}',
  '.mc-overview-card{display:flex;flex-direction:column;gap:10px}',
  '.mc-overview-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}',
  '.mc-overview-title{margin:0;font-size:13px;font-weight:600;color:var(--v3-t1)}',
  '.mc-overview-head .v3-pn{margin-left:auto}',
  '.mc-overview-error{margin:0}',
  '.mc-overview-error span{font-family:var(--v3-font-code);font-size:11px;color:var(--v3-t3);word-break:break-word}',
  '.mc-overview-source{margin:0;padding-top:8px;border-top:1px solid var(--v3-line)}',
  '.ov-status{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;min-width:0}',
  '.ov-scell{background:var(--v3-panel-2);border:1px solid var(--v3-line);border-left:3px solid var(--v3-line-2);'
    + 'border-radius:var(--v3-r-md);padding:8px 10px;min-width:0;display:flex;flex-direction:column;gap:2px}',
  '.ov-scell[data-tone=\'ok\']{border-left-color:var(--v3-ok)}',
  '.ov-scell[data-tone=\'warn\']{border-left-color:var(--v3-warn)}',
  '.ov-scell[data-tone=\'bad\']{border-left-color:var(--v3-bad)}',
  '.ov-slabel{font-size:10.5px;color:var(--v3-t4);letter-spacing:.02em}',
  '.ov-svalue{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;line-height:20px;min-width:0;color:var(--v3-t3)}',
  '.ov-svalue .ov-stext{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}',
  '.ov-svalue[data-tone=\'ok\'] .ov-stext{color:var(--v3-ok)}',
  '.ov-svalue[data-tone=\'warn\'] .ov-stext{color:var(--v3-warn)}',
  '.ov-svalue[data-tone=\'bad\'] .ov-stext{color:var(--v3-bad)}',
  '.ov-sdetail{font-size:10.5px;line-height:15px;color:var(--v3-t4);overflow-wrap:anywhere}',
  '.ov-statgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--v3-line);'
    + 'border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);overflow:hidden}',
  '.ov-statgrid .v3-stat{padding:12px 14px}',
  '.ov-statgrid .v3-stat-d{line-height:15px}',
  '.ov-note{margin:0;padding:5px 10px;border-radius:var(--v3-r-sm);background:var(--v3-panel-2);color:var(--v3-t3)}',
  '.ov-metarow{display:flex;align-items:center;gap:4px 14px;flex-wrap:wrap;font-size:11px;color:var(--v3-t4)}',
  '.ov-metarow b{font-weight:600;color:var(--v3-t2);font-variant-numeric:tabular-nums}',
  '.ov-metarow .ov-k{color:var(--v3-t4)}',
  '.ov-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--v3-panel-2);'
    + 'border:1px solid var(--v3-line)}',
  '.ov-bar>span{display:block;height:100%;min-width:0}',
  '.ov-bar>span[data-tier=\'resident\']{background:var(--v3-info)}',
  '.ov-bar>span[data-tier=\'on-demand\']{background:var(--v3-warn)}',
  '.ov-bar>span[data-tier=\'disabled\']{background:var(--v3-t4);opacity:.55}',
  '.ov-legend{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;min-width:0}',
  '.ov-lrow{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--v3-t2);min-width:0;width:100%;'
    + 'appearance:none;background:none;border:0;padding:3px 4px;border-radius:4px;font-family:inherit;text-align:left}',
  'button.ov-lrow{cursor:pointer}',
  'button.ov-lrow:hover{background:var(--v3-panel-2)}',
  'button.ov-lrow:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}',
  '.ov-lrow>i{width:7px;height:7px;border-radius:2px;flex:none;background:var(--v3-t4)}',
  '.ov-lrow>i[data-tier=\'resident\']{background:var(--v3-info)}',
  '.ov-lrow>i[data-tier=\'on-demand\']{background:var(--v3-warn)}',
  '.ov-lrow>i[data-tier=\'disabled\']{background:var(--v3-t4);opacity:.55}',
  '.ov-lrow .ov-lname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.ov-lrow .ov-ljump{font-size:10.5px;color:var(--v3-info)}',
  '.ov-lrow b{margin-left:auto;color:var(--v3-t1);font-weight:600;font-variant-numeric:tabular-nums}',
  '.ov-lrow em{font-style:normal;color:var(--v3-t4);min-width:46px;text-align:right;font-variant-numeric:tabular-nums;font-size:11px}',
  // 设置面板的内容列只有 564px（D-044 实测），三张状态卡必须在默认宽度下就横向排开；
  // 只有真的窄到放不下时才退化成单列。
  '@container v3 (max-width:460px){.ov-status{grid-template-columns:minmax(0,1fr)}}',
  '@container v3 (max-width:520px){.ov-statgrid{grid-template-columns:minmax(0,1fr)}}',
].join('')

/** '—' for a value that was not read; never a fabricated zero. */
function dash(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : String(value)
}

/** Turn an unknown thrown value into a message safe to render. */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

/** 'code: message' for a rejected remote result; the code names what broke. */
function failureText(error: { readonly code: string; readonly message: string }): string {
  return error.code + ': ' + error.message
}

/**
 * The common denominator of the two remotes this page reads.
 *
 * Guard (./guard-remote.ts) resolves RemoteResult<T>, whose failure is the
 * fully-typed RemoteFailure; the upstream capability face (./store.ts) only
 * promises { code, message }. This page renders just the code and the message,
 * so it accepts the narrower shape and both remotes satisfy it.
 */
type LooseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Run one remote call, collapsing every failure to a discriminated result. */
async function readResult<T>(
  call: () => Promise<LooseResult<T>>,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string }> {
  try {
    const result = await call()
    return result.ok ? { ok: true, value: result.value } : { ok: false, detail: failureText(result.error) }
  } catch (error) {
    return { ok: false, detail: errorText(error) }
  }
}

/** Optional channel: any failure is just "unknown" for this number. */
async function readOptional<T>(call: () => Promise<LooseResult<T>>): Promise<T | undefined> {
  const result = await readResult(call)
  return result.ok ? result.value : undefined
}

interface GuardRead {
  readonly switches?: GuardSwitches
  readonly diagnostics?: GuardDiagnostics
  readonly stats?: GuardStatsSnapshot
  readonly error?: string
}

/**
 * Read the three Guard faces for one area.
 *
 * The switch list is the load-bearing read (it is what 保护机制状态 is FOR), so its
 * failure becomes the area's error line; counters and diagnostics degrade to
 * 「未知」 / 「—」 instead, because a page that loses its counters must still tell
 * the operator whether the Guard is switched on.
 */
async function readGuard(remote: GuardRemote): Promise<GuardRead> {
  const [switches, stats, diagnostics] = await Promise.all([
    readResult(() => remote.getGuard()),
    readOptional(() => remote.getGuardStats()),
    readOptional(() => remote.getGuardDiagnostics()),
  ])
  return {
    ...(switches.ok ? { switches: switches.value } : { error: switches.detail }),
    ...(stats === undefined ? {} : { stats }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  }
}

interface CatalogRead {
  readonly rows?: readonly CapabilityRow[]
  readonly version?: number
  readonly diagnostics?: CapabilityDiagnostics
  readonly observedAt?: string
  readonly error?: string
}

/**
 * Read the capability catalog for one area.
 *
 * classifyAll is the load-bearing read (the three tier counts and the total); the
 * version number and the capability diagnostics are optional channels, so a Host
 * without them shows 「—」 instead of failing the area. The observed time is
 * stamped HERE, in the browser, at the moment the snapshot arrived — it is labeled
 * as this page's observation time on purpose, because the Host never tells us when
 * its catalog was last rebuilt.
 */
async function readCatalog(remote: CapabilityPolicyRemote): Promise<CatalogRead> {
  const [rows, version, diagnostics] = await Promise.all([
    readResult(() => remote.classifyAll()),
    readOptional(() => remote.catalogVersion()),
    remote.getDiagnostics === undefined ? Promise.resolve(undefined) : readOptional(() => remote.getDiagnostics!()),
  ])
  return {
    ...(rows.ok ? { rows: rows.value, observedAt: new Date().toLocaleTimeString() } : { error: rows.detail }),
    ...(version === undefined ? {} : { version }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  }
}

/** Tier tally of one classification list. */
export function countRows(rows: readonly CapabilityRow[] | undefined): {
  resident: number | undefined
  onDemand: number | undefined
  disabled: number | undefined
  total: number | undefined
  tools: number | undefined
  skills: number | undefined
} {
  if (rows === undefined) {
    return { resident: undefined, onDemand: undefined, disabled: undefined, total: undefined, tools: undefined, skills: undefined }
  }
  let resident = 0
  let onDemand = 0
  let disabled = 0
  let tools = 0
  for (const row of rows) {
    if (row.class === 'resident') resident += 1
    else if (row.class === 'on-demand') onDemand += 1
    else disabled += 1
    if (row.kind === 'tool') tools += 1
  }
  return { resident, onDemand, disabled, total: rows.length, tools, skills: rows.length - tools }
}

/* ------------------------------------------------------------------ *
 * 第一层：状态派生（纯函数，可单测）
 * ------------------------------------------------------------------ */

/** 状态色调：绿 / 灰 / 黄 / 红 / 未检测。 */
export type StatusTone = 'ok' | 'off' | 'warn' | 'bad' | 'unknown'

/**
 * 五状态 → 官方 StateDot 视觉状态（B-2：只折叠视觉，StatusTone 与三个推导函数零改）。
 * ok→done、warn→warning、bad→error、off→idle、unknown→idle（Q3：语义仍分开，视觉可同）。
 */
const STATUS_DOT_STATE: Readonly<Record<StatusTone, 'done' | 'warning' | 'error' | 'idle'>> = {
  ok: 'done',
  warn: 'warning',
  bad: 'error',
  off: 'idle',
  unknown: 'idle',
}

/** 一个状态格里要显示的文案键。 */
export type StatusCode =
  | 'overviewUnknown'
  | 'overviewStatusGuardsMasterOff'
  | 'overviewStatusGuardsAllOff'
  | 'overviewStatusMounted'
  | 'overviewStatusNotMounted'
  | 'overviewStatusInvalidPatch'
  | 'overviewStatusPersistOk'
  | 'overviewStatusPersistDirty'
  | 'overviewStatusPersistFailed'

/** 一个状态格：色调 + 文案键 + 需要拼在文案前的数字前缀。 */
export interface StatusCell {
  readonly tone: StatusTone
  readonly code: StatusCode
  /** 例如「3 / 3」；为空表示该格只显示文案本身。 */
  readonly prefix?: string
  /** 保护机制格在有前缀时需要在后面补一个「已启用」单位词。 */
  readonly suffix?: boolean
}

/** 三项被 Guard 管辖的检测开关（总开关之外）。 */
const GUARD_MECHANISMS: readonly (keyof GuardSwitches)[] = [
  'duplicateDetection',
  'alternatingCycleDetection',
  'noProgressProtection',
]

/**
 * 保护机制状态：已启用数量 / 总机制数量。
 *
 * 总开关关掉时三项开关的值不再代表「正在保护」，所以先判总开关；读不到开关就是
 * 「未知」，既不默认成「已启用」，也不默认成「已关闭」。
 */
export function guardStatusCell(switches: GuardSwitches | undefined): StatusCell {
  if (switches === undefined) return { tone: 'unknown', code: 'overviewUnknown' }
  const total = GUARD_MECHANISMS.length
  const on = GUARD_MECHANISMS.filter(field => switches[field] === true).length
  if (switches.enabled !== true) {
    return { tone: on === 0 ? 'off' : 'warn', code: 'overviewStatusGuardsMasterOff', prefix: on + ' / ' + total }
  }
  if (on === 0) return { tone: 'off', code: 'overviewStatusGuardsAllOff', prefix: '0 / ' + total }
  // suffix 分支的文案完全由 prefix + 单位词决定，code 只为满足类型（不会被渲染）。
  return { tone: on === total ? 'ok' : 'warn', code: 'overviewStatusGuardsMasterOff', prefix: on + ' / ' + total, suffix: true }
}

/**
 * 插件挂载状态：本进程里 Guard 钩子到底有没有注册。
 *
 * available: true 才是「已挂载」；invalid-patch 与 not-mounted 都是红色，因为两者
 * 都意味着执行保护此刻不起作用，只是原因不同。
 */
export function mountStatusCell(diagnostics: GuardDiagnostics | undefined): StatusCell {
  if (diagnostics === undefined) return { tone: 'unknown', code: 'overviewUnknown' }
  if (diagnostics.reasons.includes('not-mounted')) return { tone: 'bad', code: 'overviewStatusNotMounted' }
  if (diagnostics.reasons.includes('invalid-patch')) return { tone: 'bad', code: 'overviewStatusInvalidPatch' }
  if (diagnostics.available === true) return { tone: 'ok', code: 'overviewStatusMounted' }
  return { tone: 'unknown', code: 'overviewUnknown' }
}

/**
 * 持久化状态：开关状态文件写盘是否正常。
 *
 * 只覆盖 getGuardDiagnostics().persistence（guard.json）——计数落盘没有独立诊断
 * 接口，这里不替它宣称正常。写失败优先于「有未落盘改动」，因为写失败时 dirty
 * 一定也是 true，用户需要看到的是原因。
 */
export function persistenceStatusCell(diagnostics: GuardDiagnostics | undefined): StatusCell {
  if (diagnostics === undefined) return { tone: 'unknown', code: 'overviewUnknown' }
  if (diagnostics.persistence.lastErrorCode === 'write-failed') {
    return { tone: 'bad', code: 'overviewStatusPersistFailed' }
  }
  if (diagnostics.persistence.dirty) return { tone: 'warn', code: 'overviewStatusPersistDirty' }
  return { tone: 'ok', code: 'overviewStatusPersistOk' }
}

/* ------------------------------------------------------------------ *
 * 第三层：分类占比（纯函数，可单测）
 * ------------------------------------------------------------------ */

/** 三档分类的稳定顺序与展示键。 */
const TIERS: readonly { readonly key: 'resident' | 'on-demand' | 'disabled'; readonly labelKey: OverviewKey }[] = [
  { key: 'resident', labelKey: 'overviewCatalogResident' },
  { key: 'on-demand', labelKey: 'overviewCatalogOnDemand' },
  { key: 'disabled', labelKey: 'overviewCatalogDisabled' },
]

export interface TierSlice {
  readonly key: 'resident' | 'on-demand' | 'disabled'
  readonly labelKey: OverviewKey
  readonly count: number
  /** 0–100；总数为 0 时是 0，不是 NaN。 */
  readonly pct: number
}

export interface TierDistribution {
  readonly total: number
  readonly slices: readonly TierSlice[]
  /** 一个条目都没有（或目录没读出来）：比例条整条空轨道。 */
  readonly empty: boolean
}

/**
 * 三档占比。
 *
 * 数量为零的分类也要留在列表里（任务书 §3.4-5），只是它在比例条上的宽度为 0；
 * 总数为零时全部 pct = 0，页面渲染空轨道而不是 NaN 宽度。
 */
export function tierDistribution(counts: {
  readonly resident?: number
  readonly onDemand?: number
  readonly disabled?: number
}): TierDistribution {
  const raw: Record<'resident' | 'on-demand' | 'disabled', number | undefined> = {
    resident: counts.resident,
    'on-demand': counts.onDemand,
    disabled: counts.disabled,
  }
  const values = TIERS.map(tier => {
    const value = raw[tier.key]
    return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0
  })
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    total,
    empty: total === 0,
    slices: TIERS.map((tier, index) => ({
      key: tier.key,
      labelKey: tier.labelKey,
      count: values[index]!,
      pct: total === 0 ? 0 : (values[index]! / total) * 100,
    })),
  }
}

/** 时间戳 → 本地可读时间；缺失或非法值时给出占位文案。 */
function timeText(ms: number | undefined, fallback: string): string {
  if (ms === undefined || !Number.isFinite(ms)) return fallback
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString()
}

/** One stat cell; the hint carries a short Chinese meaning of the number. */
function StatCell(props: {
  readonly label: string
  readonly value: string
  readonly hint: string
  readonly stat: string
}): ReactElement {
  return (
    <div className="v3-stat" data-overview-stat={props.stat}>
      <div className="v3-stat-l">{props.label}</div>
      <div className="v3-stat-v">{props.value}</div>
      <div className="v3-stat-d">{props.hint}</div>
    </div>
  )
}

/** 一个状态卡；色调决定左边框、圆点与数值颜色。 */
function StatusCard(props: {
  readonly t: (key: OverviewKey) => string
  readonly cell: string
  readonly label: string
  readonly status: StatusCell
  readonly detail: string
}): ReactElement {
  const { t, cell, label, status, detail } = props
  // 有前缀时数字先说，单位词后补；没有前缀就是「未知 / 已挂载」这类纯文案。
  const text = status.prefix === undefined
    ? t(status.code)
    : status.prefix + ' ' + t(status.suffix === true ? 'overviewStatusGuardsSuffix' : status.code)
  const dot = status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : status.tone === 'bad' ? 'bad' : undefined
  return (
    <div className="ov-scell" data-overview-status-cell={cell} data-tone={status.tone}>
      <div className="ov-slabel">{label}</div>
      <div className="ov-svalue" data-tone={status.tone}>
        <span className="v3-dot" data-tone={dot} aria-hidden="true"><StateDot state={STATUS_DOT_STATE[status.tone]} size={7} /></span>
        <span className="ov-stext" data-overview-status-text={cell}>{text}</span>
      </div>
      <div className="ov-sdetail" data-overview-status-detail={cell}>{detail}</div>
    </div>
  )
}

/**
 * The 总览 page: 执行保护状态 + 执行保护统计 + 能力目录分布.
 *
 * Reads once on mount and again on 刷新; each area owns its own error line, so a
 * broken capability remote cannot blank the Guard areas (or the reverse).
 */
export function OverviewSection(props: OverviewSectionInjected): ReactElement {
  const { guardRemote, capabilityRemote, t, onOpenCapability } = props
  const [state, setState] = useState<OverviewState>(INITIAL_STATE)
  const alive = useRef(true)
  /** Monotonic generation: a slow older read must never overwrite a newer one. */
  const gen = useRef(0)
  const stateRef = useRef<OverviewState>(INITIAL_STATE)

  const commit = useCallback((at: number, patch: (current: OverviewState) => OverviewState): void => {
    if (!alive.current || at !== gen.current) return
    const next = patch(stateRef.current)
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
  }, [])

  /**
   * One full read of all three areas.
   *
   * The two remote families overlap, and a failure on one side is stored on its own
   * side — the payload keeps whatever the other side did return, so 刷新 after a
   * transient failure cannot silently clear a good area.
   */
  const load = useCallback(async (): Promise<void> => {
    gen.current += 1
    const at = gen.current
    commit(at, current => ({ ...current, busy: true }))
    const [guard, catalog] = await Promise.all([readGuard(guardRemote), readCatalog(capabilityRemote)])
    if (!alive.current || at !== gen.current) return
    commit(at, current => ({
      ...current,
      busy: false,
      ...(guard.switches === undefined ? {} : { guardSwitches: guard.switches }),
      ...(guard.stats === undefined ? {} : { guardStats: guard.stats }),
      ...(guard.diagnostics === undefined ? {} : { guardDiagnostics: guard.diagnostics }),
      ...(guard.error === undefined ? { guardError: undefined } : { guardError: guard.error }),
      ...(catalog.rows === undefined ? {} : { catalogRows: catalog.rows }),
      ...(catalog.version === undefined ? {} : { catalogVersion: catalog.version }),
      ...(catalog.diagnostics === undefined ? {} : { catalogDiagnostics: catalog.diagnostics }),
      ...(catalog.observedAt === undefined ? {} : { observedAt: catalog.observedAt }),
      ...(catalog.error === undefined ? { catalogError: undefined } : { catalogError: catalog.error }),
    }))
  }, [guardRemote, capabilityRemote, commit])

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      // Invalidate whatever is still in flight for this mount.
      gen.current += 1
    }
  }, [load])

  // Container tail: hand the loaded snapshot to the pure view. Every area gets its
  // own slice, so a failed read on one side cannot blank another.
  return (
    <OverviewView
      t={t}
      busy={state.busy}
      guard={{
        ...(state.guardSwitches === undefined ? {} : { switches: state.guardSwitches }),
        ...(state.guardStats === undefined ? {} : { stats: state.guardStats }),
        ...(state.guardDiagnostics === undefined ? {} : { diagnostics: state.guardDiagnostics }),
        ...(state.guardError === undefined ? {} : { error: state.guardError }),
      }}
      catalog={{
        ...(state.catalogRows === undefined ? {} : { rows: state.catalogRows }),
        ...(state.catalogVersion === undefined ? {} : { version: state.catalogVersion }),
        ...(state.catalogDiagnostics === undefined ? {} : { diagnostics: state.catalogDiagnostics }),
        ...(state.catalogError === undefined ? {} : { error: state.catalogError }),
        ...(state.observedAt === undefined ? {} : { observedAt: state.observedAt }),
      }}
      onRefresh={() => { void load() }}
      {...(onOpenCapability === undefined ? {} : { onOpenCapability })}
    />
  )
}

/** One area's slice: what the container read for it, plus its own error line. */
export interface OverviewGuardRecord {
  readonly switches?: GuardSwitches
  readonly stats?: GuardStatsSnapshot
  readonly diagnostics?: GuardDiagnostics
  readonly error?: string
}

/** The capability area's slice; observedAt is this page's reading time. */
export interface OverviewCatalogRecord {
  readonly rows?: readonly CapabilityRow[]
  readonly version?: number
  readonly diagnostics?: CapabilityDiagnostics
  readonly error?: string
  readonly observedAt?: string
}

export interface OverviewViewProps {
  readonly t: (key: OverviewKey) => string
  readonly guard: OverviewGuardRecord
  readonly catalog: OverviewCatalogRecord
  readonly busy: boolean
  /** Omitted = the 刷新 button renders disabled (read-only surface). */
  readonly onRefresh?: () => void
  /** Omitted = 分类行是纯文本，不渲染跳转按钮。 */
  readonly onOpenCapability?: () => void
}

/**
 * Pure view: no hooks, so a test can call it as a plain function and walk the
 * returned element tree (the same pattern PluginSectionView uses).
 */
export function OverviewView(props: OverviewViewProps): ReactElement {
  const { t, guard, catalog, busy, onRefresh, onOpenCapability } = props
  const { stats: guardStats, error: guardError, diagnostics } = guard
  const { rows: catalogRows, error: catalogError, version, observedAt } = catalog
  const counts = countRows(catalogRows)
  const distribution = tierDistribution(counts)

  const guards = guardStatusCell(guard.switches)
  const mount = mountStatusCell(diagnostics)
  const persistence = persistenceStatusCell(diagnostics)
  const unknown = t('overviewUnknown')

  const source = (kind: string, text: string): ReactElement => (
    <p className="v3-hint mc-overview-source" data-overview-source={kind}>{text}</p>
  )

  const legendRow = (slice: TierSlice): ReactElement => {
    const pct = distribution.empty ? unknown : String(Math.round(slice.pct)) + '%'
    const content = (
      <>
        <i data-tier={slice.key} aria-hidden="true" />
        <span className="ov-lname">{t(slice.labelKey)}</span>
        {onOpenCapability === undefined ? null : <span className="ov-ljump">{t('overviewCatalogJump')}</span>}
        <b>{dash(slice.count)}</b>
        <em data-overview-tier-pct={slice.key}>{pct}</em>
      </>
    )
    return (
      <li key={slice.key}>
        {onOpenCapability === undefined
          ? <div className="ov-lrow" data-overview-tier={slice.key}>{content}</div>
          : (
            <button
              type="button"
              className="ov-lrow"
              data-overview-tier={slice.key}
              data-overview-tier-jump="true"
              onClick={() => { onOpenCapability() }}
            >{content}</button>
          )}
      </li>
    )
  }

  return (
    <section className={V3_ROOT_CLASS + ' mc-overview-section'} data-overview-busy={busy ? 'true' : 'false'}>
      <style data-overview-style="true">{OVERVIEW_CSS}</style>
      <div className="mc-overview-bar">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mc-overview-refresh mc-btn-sm"
          data-overview-refresh="true"
          disabled={busy || onRefresh === undefined}
          onClick={() => { if (onRefresh !== undefined) onRefresh() }}
        >{busy ? t('overviewRefreshing') : t('overviewRefresh')}</Button>
      </div>

      <div className="v3-panel mc-overview-card" data-overview-card="status">
        <div className="mc-overview-head">
          <h3 className="mc-overview-title">{t('overviewStatusTitle')}</h3>
        </div>
        {guardError === undefined
          ? null
          : (
            <div className="v3-banner mc-overview-error" role="alert" data-overview-error="guard">
              <b>{t('overviewGuardError')}</b>
              <span>{guardError}</span>
            </div>
          )}
        <div className="ov-status" data-overview-status="true">
          <StatusCard t={t} cell="guards" label={t('overviewStatusGuards')} status={guards} detail={t('overviewStatusSourceSwitches')} />
          <StatusCard t={t} cell="mount" label={t('overviewStatusMount')} status={mount} detail={t('overviewStatusSourceMount')} />
          <StatusCard t={t} cell="persist" label={t('overviewStatusPersist')} status={persistence} detail={t('overviewStatusSourcePersist')} />
        </div>
      </div>

      <div className="v3-panel mc-overview-card" data-overview-card="guard">
        <div className="mc-overview-head">
          <h3 className="mc-overview-title">{t('overviewStatsTitle')}</h3>
        </div>
        {guardStats === undefined && guardError === undefined
          ? <p className="v3-hint" data-overview-loading="guard">{t('overviewLoading')}</p>
          : null}
        <div className="ov-statgrid" data-overview-stats="guard">
          <StatCell stat="observations" label={t('overviewGuardObservations')} value={dash(guardStats?.observations)} hint={t('overviewHintObservations')} />
          <StatCell stat="repeat" label={t('overviewGuardRepeat')} value={dash(guardStats?.reminders.repeat)} hint={t('overviewHintRepeat')} />
          <StatCell stat="cycle" label={t('overviewGuardCycle')} value={dash(guardStats?.reminders.cycle)} hint={t('overviewHintCycle')} />
          <StatCell stat="denials" label={t('overviewGuardDenials')} value={dash(guardStats?.denials)} hint={t('overviewHintDenials')} />
        </div>
        <p className="v3-hint ov-note" data-overview-note="cumulative">{t('overviewStatsNote')}</p>
        <div className="ov-metarow" data-overview-meta="guard">
          <span><span className="ov-k">{t('overviewStatsSince')}</span> <b data-overview-since="true">{timeText(guardStats?.since, unknown)}</b></span>
          <span><span className="ov-k">{t('overviewStatsLastReminder')}</span> <b data-overview-last-reminder="true">{timeText(guardStats?.lastReminderAt, t('overviewStatsEmpty'))}</b></span>
          <span><span className="ov-k">{t('overviewStatsLastDenial')}</span> <b data-overview-last-denial="true">{timeText(guardStats?.lastDenialAt, t('overviewStatsEmpty'))}</b></span>
        </div>
        {source('guard', t('overviewGuardSource'))}
      </div>

      <div className="v3-panel mc-overview-card" data-overview-card="catalog">
        <div className="mc-overview-head">
          <h3 className="mc-overview-title">{t('overviewCatalogTitle')}</h3>
          <span className="v3-pn" data-overview-catalog-total="true">{t('overviewCatalogTotal')} <b>{dash(counts.total)}</b></span>
          {version === undefined ? null : (
            <span className="v3-pn" data-overview-catalog-version="true">{t('overviewCatalogVersion')} {version}</span>
          )}
        </div>
        {catalogRows === undefined && catalogError === undefined
          ? <p className="v3-hint" data-overview-loading="catalog">{t('overviewLoading')}</p>
          : null}
        {catalogError === undefined
          ? null
          : (
            <div className="v3-banner mc-overview-error" role="alert" data-overview-error="catalog">
              <b>{t('overviewCatalogError')}</b>
              <span>{catalogError}</span>
            </div>
          )}
        <div
          className="ov-bar"
          data-overview-bar="true"
          data-overview-bar-empty={distribution.empty ? 'true' : 'false'}
          role="img"
          aria-label={t('overviewCatalogRatio')}
        >
          {distribution.slices.map(slice => (
            <span key={slice.key} data-tier={slice.key} style={{ width: slice.pct + '%' }} />
          ))}
        </div>
        <ul className="ov-legend" data-overview-legend="true">
          {distribution.slices.map(legendRow)}
        </ul>
        <div className="ov-metarow" data-overview-meta="catalog">
          <span><span className="ov-k">{t('overviewCatalogTools')}</span> <b data-overview-tools="true">{dash(counts.tools)}</b></span>
          <span><span className="ov-k">{t('overviewCatalogSkills')}</span> <b data-overview-skills="true">{dash(counts.skills)}</b></span>
          <span><span className="ov-k">{t('overviewCatalogObservedAt')}</span> <b data-overview-observed-at="true">{observedAt === undefined ? unknown : observedAt}</b></span>
        </div>
        {source('catalog', t('overviewCatalogSource'))}
      </div>
    </section>
  )
}

/**
 * 本页文案（zh / en），键与 OverviewKey 一一对应。
 *
 * 两行「来源」小字是本页的核心交付：它们说明每个数字来自哪一层、什么时候归零，
 * 这样「观察数 0」不会被读成「历史上从没调用过」，也不会被读成任何会话历史。
 *
 * 「本机累计统计 · 重启后继续累加」这句文案的授权来自 guard-state.ts：挂载时
 * readGuardStatsFile + processGuardStats.restore() 恢复计数并保留原 since，运行中
 * 每 5 秒落盘一次、卸载时再落一次（tests/guard-stats-persist.spec.ts 覆盖）。
 */
export function overviewDictionaries(): {
  zh: Record<OverviewKey, string>
  en: Record<OverviewKey, string>
} {
  const zh: Record<OverviewKey, string> = {
    nav: '总览',
    title: '总览',
    overviewRefresh: '刷新',
    overviewRefreshing: '正在读取…',
    overviewLoading: '正在读取…',
    overviewUnknown: '未知',
    overviewStatusTitle: '执行保护状态',
    overviewStatusGuards: '保护机制',
    overviewStatusMount: '插件挂载',
    overviewStatusPersist: '持久化',
    overviewStatusGuardsSuffix: '已启用',
    overviewStatusGuardsMasterOff: '总开关已关闭',
    overviewStatusGuardsAllOff: '三项检测全部关闭',
    overviewStatusMounted: '已挂载',
    overviewStatusNotMounted: '未挂载',
    overviewStatusInvalidPatch: '配置非法',
    overviewStatusPersistOk: '正常',
    overviewStatusPersistDirty: '有未落盘改动',
    overviewStatusPersistFailed: '写入失败',
    overviewStatusSourceSwitches: '来源 getGuard',
    overviewStatusSourceMount: '来源 getGuardDiagnostics',
    overviewStatusSourcePersist: '来源 getGuardDiagnostics',
    overviewStatsTitle: '执行保护统计',
    overviewStatsNote: '本机累计统计 · 重启后继续累加',
    overviewGuardObservations: '已观察调用',
    overviewGuardRepeat: '重复提醒',
    overviewGuardCycle: '循环提醒',
    overviewGuardDenials: '本地拒绝',
    overviewHintObservations: '检测器实际观察到的调用次数',
    overviewHintRepeat: '连续重复调用触发的提醒次数',
    overviewHintCycle: '交替循环识别触发的提醒次数',
    overviewHintDenials: '局部拒绝调用的次数',
    overviewStatsSince: '统计起始时间',
    overviewStatsLastReminder: '最近提醒',
    overviewStatsLastDenial: '最近拒绝',
    overviewStatsEmpty: '暂无记录',
    overviewGuardSource: '来源：四个数字是执行保护在本机的累计计数（getGuardStats），每 5 秒落盘、重启后继续累加；开关与诊断来自本机状态文件。',
    overviewGuardError: '执行保护设置读取失败',
    overviewCatalogTitle: '能力目录分布',
    overviewCatalogTotal: '总计',
    overviewCatalogResident: '常驻',
    overviewCatalogOnDemand: '按需',
    overviewCatalogDisabled: '禁用',
    overviewCatalogRatio: '能力目录三档占比',
    overviewCatalogTools: '工具',
    overviewCatalogSkills: '技能（全部来源）',
    overviewCatalogObservedAt: '本页观察时间',
    overviewCatalogVersion: '目录版本',
    overviewCatalogJump: '查看',
    overviewCatalogSource: '来源：三档数量与总计来自能力目录快照（classifyAll）；占比按当前快照实时计算，目录版本来自 catalogVersion，观察时间是本页读取快照的时间。',
    overviewCatalogError: '能力目录读取失败',
  }
  const en: Record<OverviewKey, string> = {
    nav: 'Overview',
    title: 'Overview',
    overviewRefresh: 'Refresh',
    overviewRefreshing: 'Reading…',
    overviewLoading: 'Reading…',
    overviewUnknown: 'Unknown',
    overviewStatusTitle: 'Execution protection status',
    overviewStatusGuards: 'Mechanisms',
    overviewStatusMount: 'Plugin mount',
    overviewStatusPersist: 'Persistence',
    overviewStatusGuardsSuffix: 'enabled',
    overviewStatusGuardsMasterOff: 'master switch is off',
    overviewStatusGuardsAllOff: 'all three detectors are off',
    overviewStatusMounted: 'Mounted',
    overviewStatusNotMounted: 'Not mounted',
    overviewStatusInvalidPatch: 'Invalid configuration',
    overviewStatusPersistOk: 'Healthy',
    overviewStatusPersistDirty: 'Unsaved changes',
    overviewStatusPersistFailed: 'Write failed',
    overviewStatusSourceSwitches: 'source getGuard',
    overviewStatusSourceMount: 'source getGuardDiagnostics',
    overviewStatusSourcePersist: 'source getGuardDiagnostics',
    overviewStatsTitle: 'Execution protection counters',
    overviewStatsNote: 'Cumulative on this machine · keeps counting after a restart',
    overviewGuardObservations: 'Calls observed',
    overviewGuardRepeat: 'Repeat reminders',
    overviewGuardCycle: 'Cycle reminders',
    overviewGuardDenials: 'Local denials',
    overviewHintObservations: 'Tool calls the detector actually observed',
    overviewHintRepeat: 'Reminders fired by consecutive identical calls',
    overviewHintCycle: 'Reminders fired by alternating-cycle detection',
    overviewHintDenials: 'Calls blocked locally',
    overviewStatsSince: 'Counting since',
    overviewStatsLastReminder: 'Last reminder',
    overviewStatsLastDenial: 'Last denial',
    overviewStatsEmpty: 'None yet',
    overviewGuardSource: 'Source: the four numbers are the cumulative Guard counters of this machine (getGuardStats), flushed every 5 seconds and continued after a restart; switches and diagnostics come from the local state file.',
    overviewGuardError: 'Failed to read the guard settings',
    overviewCatalogTitle: 'Capability catalog distribution',
    overviewCatalogTotal: 'Total',
    overviewCatalogResident: 'Resident',
    overviewCatalogOnDemand: 'On-demand',
    overviewCatalogDisabled: 'Disabled',
    overviewCatalogRatio: 'Share of the three capability tiers',
    overviewCatalogTools: 'Tools',
    overviewCatalogSkills: 'Skills (all sources)',
    overviewCatalogObservedAt: 'Observed at',
    overviewCatalogVersion: 'Catalog version',
    overviewCatalogJump: 'View',
    overviewCatalogSource: 'Source: the three tier counts and the total come from the catalog snapshot (classifyAll); shares are computed from that snapshot, the version number comes from catalogVersion, and the observation time is when this page read the snapshot.',
    overviewCatalogError: 'Failed to read the capability catalog',
  }
  return { zh, en }
}
