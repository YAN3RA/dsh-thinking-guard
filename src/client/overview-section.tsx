/**
 * 总览 — one page, two records, both traceable to a real source (v3, D-044).
 *
 * 本页只回答「现在什么状态」，不回答「刚才发生了什么」：所有数字都来自三个不含
 * 会话内容的来源 ——
 *   1. Guard 进程内计数（`getGuardStats`，重启归零）；
 *   2. Guard 状态文件里的开关与诊断（`getGuard` / `getGuardDiagnostics`）；
 *   3. 能力目录快照（`classifyAll` / `catalogVersion` / `getDiagnostics`）。
 *
 * 刻意不读会话历史：没有任何会话事件流、持久化会话索引或调用统计的代码。
 * 因此每张卡片底部都有一行「来源」小字，写明这堆数字是从哪一层读来
 * 的、什么时候会归零，避免把「进程内计数」误读成「历史总数」。
 *
 * 行为：挂载时读一次 + 一个「刷新」按钮，不轮询。两张卡片各自独立，一张读失败只
 * 影响它自己的错误行，另一张照常显示；读不到的数字显示「—」，绝不伪造成 0。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { GuardDiagnostics, GuardRemote, GuardStatsSnapshot, GuardSwitches } from './guard-remote.ts'
import type { CapabilityDiagnostics, CapabilityPolicyRemote, CapabilityRow } from './store.ts'
import { V3Styles, V3_ROOT_CLASS } from './v3-ui.ts'

/** 本页文案键。zh / en 两份字典的键必须与此完全一致。 */
export type OverviewKey =
  | 'nav'
  | 'title'
  | 'desc'
  | 'overviewRefresh'
  | 'overviewRefreshing'
  | 'overviewLoading'
  | 'overviewUnknown'
  // 执行保护记录
  | 'overviewGuardTitle'
  | 'overviewGuardSource'
  | 'overviewGuardError'
  | 'overviewGuardObservations'
  | 'overviewGuardRepeat'
  | 'overviewGuardCycle'
  | 'overviewGuardDenials'
  | 'overviewGuardSwitches'
  | 'overviewGuardMaster'
  | 'overviewGuardDuplicate'
  | 'overviewGuardCycleSwitch'
  | 'overviewGuardNoProgress'
  | 'overviewSwitchOn'
  | 'overviewSwitchOff'
  | 'overviewGuardDiag'
  | 'overviewGuardEffective'
  | 'overviewGuardNotEffective'
  | 'overviewDiagInvalidPatch'
  | 'overviewDiagNotMounted'
  | 'overviewDiagPersistenceDirty'
  | 'overviewDiagWriteFailed'
  | 'overviewDiagNone'
  // 能力菜单记录
  | 'overviewCatalogTitle'
  | 'overviewCatalogSource'
  | 'overviewCatalogError'
  | 'overviewCatalogResident'
  | 'overviewCatalogOnDemand'
  | 'overviewCatalogDisabled'
  | 'overviewCatalogTotal'
  | 'overviewCatalogVersion'
  | 'overviewCatalogObservedAt'
  | 'overviewCatalogTools'
  | 'overviewCatalogSkills'
  | 'overviewCatalogSkillsHint'
  | 'overviewCatalogState'
  | 'overviewCatalogStateEmpty'
  | 'overviewCatalogStateReady'
  | 'overviewCatalogStateHint'
  | 'overviewCatalogDiag'
  | 'overviewCatalogDiagUnavailable'
  | 'overviewCatalogDiagShadowed'
  | 'overviewCatalogDiagBrokenPreset'

/** Props injected by the `settings.section` registration (see index.ts). */
export interface OverviewSectionInjected {
  guardRemote: GuardRemote
  capabilityRemote: CapabilityPolicyRemote
  t: (key: OverviewKey) => string
}

export type OverviewSectionProps = OverviewSectionInjected

interface OverviewState {
  // 执行保护
  readonly guardSwitches?: GuardSwitches
  readonly guardDiagnostics?: GuardDiagnostics
  readonly guardStats?: GuardStatsSnapshot
  readonly guardError?: string
  // 能力目录
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
  '.mc-overview-refresh{margin-left:auto;flex:none;padding:4px 12px;border-radius:var(--v3-r-sm);font-size:11.5px;'
    + 'color:var(--v3-t1);background:var(--v3-panel-2);border:1px solid var(--v3-line);cursor:pointer}',
  '.mc-overview-refresh:disabled{opacity:.5;cursor:default}',
  '.mc-overview-refresh:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}',
  '.mc-overview-card{display:flex;flex-direction:column;gap:10px}',
  '.mc-overview-title{margin:0;font-size:13px;font-weight:600;color:var(--v3-t1)}',
  '.mc-overview-kv{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
  '.mc-overview-k{font-size:11px;color:var(--v3-t4)}',
  '.mc-overview-meta{margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
  '.mc-overview-meta b{font-weight:600;color:var(--v3-t2);font-variant-numeric:tabular-nums}',
  '.mc-overview-diag{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
  '.mc-overview-hint-names{margin:0}',
  '.mc-overview-source{margin:0;padding-top:8px;border-top:1px solid var(--v3-line)}',
  '.mc-overview-error{margin:0}',
  '.mc-overview-error span{font-family:var(--v3-font-code);font-size:11px;color:var(--v3-t3);word-break:break-word}',
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
 * Guard (`./guard-remote.ts`) resolves `RemoteResult<T>`, whose failure is the
 * fully-typed `RemoteFailure`; the upstream capability face (`./store.ts`) only
 * promises `{ code, message }`. This page renders just the code and the message,
 * so it accepts the narrower shape and both remotes satisfy it.
 */
type LooseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Run one remote call, collapsing every failure to a discriminated result.
 *
 * Both shapes are kept because the two cards degrade differently: a missing Guard
 * counter is 「—」 (diagnostic, not load-bearing), while a missing switch value or
 * classification list must surface as an error line on its own card.
 */
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
 * Read the three Guard faces for one card.
 *
 * The switch list is the load-bearing read (it is what the card is FOR), so its
 * failure becomes the card's error line; counters and diagnostics degrade to
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
 * Read the capability catalog for one card.
 *
 * `classifyAll` is the load-bearing read (the three tier counts and the total);
 * the version number and the capability diagnostics are optional channels, so a
 * Host without them shows 「—」 / 「未知」 instead of failing the card. The observed
 * time is stamped HERE, in the browser, at the moment the snapshot arrived — it
 * is labeled as this page's observation time on purpose, because the Host never
 * tells us when its catalog was last rebuilt.
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
function countRows(rows: readonly CapabilityRow[] | undefined): {
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

/** One stat cell; the hint carries the RPC name so the number is traceable. */
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

/** One labeled switch state chip. */
function SwitchChip(props: {
  readonly t: (key: OverviewKey) => string
  readonly label: string
  readonly on: boolean | undefined
  readonly name: string
}): ReactElement {
  const { t, label, on, name } = props
  const text = on === undefined ? t('overviewUnknown') : on ? t('overviewSwitchOn') : t('overviewSwitchOff')
  return (
    <div className="mc-overview-kv">
      <span className="mc-overview-k">{label}</span>
      <span className="v3-tag" data-tone={on === undefined ? undefined : on ? 'ok' : undefined} data-overview-switch={name}>{text}</span>
    </div>
  )
}

/** Join at most `limit` names for a diagnostic line. */
function namesText(names: readonly string[], limit: number): string {
  return names.slice(0, limit).join(' · ')
}

/**
 * The 总览 page: 执行保护记录 + 能力菜单记录.
 *
 * Reads once on mount and again on 刷新; each card owns its own error line, so a
 * broken capability remote cannot blank the Guard record (or the reverse).
 */
export function OverviewSection(props: OverviewSectionInjected): ReactElement {
  const { guardRemote, capabilityRemote, t } = props
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
   * One full read of both cards.
   *
   * The two reads overlap, and a failure on one side is stored on its own side —
   * the payload keeps whatever the other side did return, so 刷新 after a transient
   * failure cannot silently clear a good card.
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

  // Container tail: hand the loaded snapshot to the pure view. Both cards get
  // their own slice, so a failed read on one side cannot blank the other.
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
    />
  )
}

/** One card's slice: what the container read for it, plus its own error line. */
export interface OverviewGuardRecord {
  readonly switches?: GuardSwitches
  readonly stats?: GuardStatsSnapshot
  readonly diagnostics?: GuardDiagnostics
  readonly error?: string
}

/** The capability card's slice; `observedAt` is this page's reading time. */
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
}

/**
 * Pure view: no hooks, so a test can call it as a plain function and walk the
 * returned element tree (the same pattern `PluginSectionView` uses).
 */
export function OverviewView(props: OverviewViewProps): ReactElement {
  const { t, guard, catalog, busy, onRefresh } = props
  const { switches: guardSwitches, stats: guardStats, diagnostics: guardDiagnostics, error: guardError } = guard
  const { rows: catalogRows, version: catalogVersion, diagnostics: catalogDiagnostics, error: catalogError, observedAt } = catalog
  const counts = countRows(catalogRows)
  const guardReasons = guardDiagnostics?.reasons ?? []
  const guardPersistence = guardDiagnostics?.persistence
  const catalogUnavailable = catalogDiagnostics?.unavailableSkills.length
  const catalogShadowed = catalogDiagnostics?.shadowedSkills.length
  const catalogBroken = catalogDiagnostics?.brokenPresets.length
  const catalogClean = catalogDiagnostics !== undefined
    && catalogUnavailable === 0 && catalogShadowed === 0 && catalogBroken === 0

  const source = (kind: string, text: string): ReactElement => (
    <p className="v3-hint mc-overview-source" data-overview-source={kind}>{text}</p>
  )

  return (
    <section className={V3_ROOT_CLASS + ' mc-overview-section'} data-overview-busy={busy ? 'true' : 'false'}>
      <V3Styles />
      <style data-overview-style="true">{OVERVIEW_CSS}</style>
      <div className="mc-overview-bar">
        <p className="v3-hint">{t('desc')}</p>
        <button
          type="button"
          className="mc-overview-refresh"
          data-overview-refresh="true"
          disabled={busy || onRefresh === undefined}
          onClick={() => { if (onRefresh !== undefined) onRefresh() }}
        >{busy ? t('overviewRefreshing') : t('overviewRefresh')}</button>
      </div>

      {/* 执行保护记录 ------------------------------------------------------ */}
      <div className="v3-panel mc-overview-card" data-overview-card="guard">
        <h3 className="mc-overview-title">{t('overviewGuardTitle')}</h3>
        {guardSwitches === undefined && guardStats === undefined && guardDiagnostics === undefined && guardError === undefined
          ? <p className="v3-hint" data-overview-loading="guard">{t('overviewLoading')}</p>
          : null}
        {guardError === undefined
          ? null
          : (
            <div className="v3-banner mc-overview-error" role="alert" data-overview-error="guard">
              <b>{t('overviewGuardError')}</b>
              <span>{guardError}</span>
            </div>
          )}
        <div className="v3-stats" data-overview-stats="guard">
          <StatCell stat="observations" label={t('overviewGuardObservations')} value={dash(guardStats?.observations)} hint="进程内计数" />
          <StatCell stat="repeat" label={t('overviewGuardRepeat')} value={dash(guardStats?.reminders.repeat)} hint="进程内计数" />
          <StatCell stat="cycle" label={t('overviewGuardCycle')} value={dash(guardStats?.reminders.cycle)} hint="进程内计数" />
          <StatCell stat="denials" label={t('overviewGuardDenials')} value={dash(guardStats?.denials)} hint="进程内计数" />
        </div>
        <div className="mc-overview-diag" data-overview-switches="guard">
          <span className="mc-overview-k">{t('overviewGuardSwitches')}</span>
          <SwitchChip t={t} label={t('overviewGuardMaster')} on={guardSwitches?.enabled} name="enabled" />
          <SwitchChip t={t} label={t('overviewGuardDuplicate')} on={guardSwitches?.duplicateDetection} name="duplicateDetection" />
          <SwitchChip t={t} label={t('overviewGuardCycleSwitch')} on={guardSwitches?.alternatingCycleDetection} name="alternatingCycleDetection" />
          <SwitchChip t={t} label={t('overviewGuardNoProgress')} on={guardSwitches?.noProgressProtection} name="noProgressProtection" />
        </div>
        <div className="mc-overview-diag" data-overview-diag="guard">
          <span className="mc-overview-k">{t('overviewGuardDiag')}</span>
          {guardDiagnostics === undefined
            ? <span className="v3-tag" data-overview-available="unknown">{t('overviewUnknown')}</span>
            : (
              <span
                className="v3-tag"
                data-tone={guardDiagnostics.available ? 'ok' : 'bad'}
                data-overview-available={guardDiagnostics.available ? 'true' : 'false'}
              >{t(guardDiagnostics.available ? 'overviewGuardEffective' : 'overviewGuardNotEffective')}</span>
            )}
          {/* Reasons are fixed wire codes; the page maps them, never echoes them. */}
          {guardReasons.includes('invalid-patch')
            ? <span className="v3-tag" data-tone="bad" data-overview-reason="invalid-patch">{t('overviewDiagInvalidPatch')}</span>
            : null}
          {guardReasons.includes('not-mounted')
            ? <span className="v3-tag" data-tone="bad" data-overview-reason="not-mounted">{t('overviewDiagNotMounted')}</span>
            : null}
          {guardPersistence?.dirty === true
            ? (
              <span className="v3-tag" data-tone="warn" data-overview-persistence={guardPersistence.lastErrorCode ?? 'pending'}>
                {t('overviewDiagPersistenceDirty')}
              </span>
            )
            : null}
          {guardPersistence?.lastErrorCode === 'write-failed'
            ? <span className="v3-tag" data-tone="bad" data-overview-write-failed="true">{t('overviewDiagWriteFailed')}</span>
            : null}
        </div>
        {source('guard', t('overviewGuardSource'))}
      </div>

      {/* 能力菜单记录 ------------------------------------------------------ */}
      <div className="v3-panel mc-overview-card" data-overview-card="catalog">
        <h3 className="mc-overview-title">{t('overviewCatalogTitle')}</h3>
        {catalogRows === undefined && catalogVersion === undefined && catalogDiagnostics === undefined && catalogError === undefined
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
        <div className="v3-stats" data-overview-stats="catalog">
          <StatCell stat="resident" label={t('overviewCatalogResident')} value={dash(counts.resident)} hint="目录快照" />
          <StatCell stat="on-demand" label={t('overviewCatalogOnDemand')} value={dash(counts.onDemand)} hint="目录快照" />
          <StatCell stat="disabled" label={t('overviewCatalogDisabled')} value={dash(counts.disabled)} hint="目录快照" />
          <StatCell stat="total" label={t('overviewCatalogTotal')} value={dash(counts.total)} hint="目录快照" />
        </div>
        <p className="mc-overview-meta">
          <span className="mc-overview-k">{t('overviewCatalogVersion')}</span>
          <b data-overview-version>{dash(catalogVersion)}</b>
          <span className="mc-overview-k">{t('overviewCatalogObservedAt')}</span>
          <b data-overview-observed-at>{observedAt ?? '—'}</b>
          <span className="mc-overview-k">{t('overviewCatalogTools')}</span>
          <b data-overview-tools>{dash(counts.tools)}</b>
          <span className="mc-overview-k">{t('overviewCatalogSkills')}</span>
          <b data-overview-skills>{dash(counts.skills)}</b>
        </p>
        {/* 技能口径说明：这一格含项目/预设来源，因此可能多于能力菜单 Skills 页 */}
        <p className="v3-hint" data-overview-skills-hint="true">{t('overviewCatalogSkillsHint')}</p>
        <div className="mc-overview-diag" data-overview-diag="catalog">
          <span className="mc-overview-k">{t('overviewCatalogDiag')}</span>
          {catalogDiagnostics === undefined
            ? <span className="v3-tag" data-overview-catalog-diag="unknown">{t('overviewUnknown')}</span>
            : (
              <>
                <span className="mc-overview-k">{t('overviewCatalogState')}</span>
                <span
                  className="v3-tag"
                  data-tone={catalogDiagnostics.catalog.state === 'ready' ? 'ok' : undefined}
                  data-overview-catalog-state={catalogDiagnostics.catalog.state}
                >{t(catalogDiagnostics.catalog.state === 'empty' ? 'overviewCatalogStateEmpty' : 'overviewCatalogStateReady')}</span>
                <span className="v3-tag" data-tone={catalogUnavailable === 0 ? undefined : 'warn'} data-overview-diag-unavailable={String(catalogUnavailable)}>
                  {t('overviewCatalogDiagUnavailable') + ' ' + String(catalogUnavailable)}
                </span>
                <span className="v3-tag" data-tone={catalogShadowed === 0 ? undefined : 'warn'} data-overview-diag-shadowed={String(catalogShadowed)}>
                  {t('overviewCatalogDiagShadowed') + ' ' + String(catalogShadowed)}
                </span>
                <span className="v3-tag" data-tone={catalogBroken === 0 ? undefined : 'bad'} data-overview-diag-broken={String(catalogBroken)}>
                  {t('overviewCatalogDiagBrokenPreset') + ' ' + String(catalogBroken)}
                </span>
                {catalogClean ? <span className="v3-tag">{t('overviewDiagNone')}</span> : null}
              </>
            )}
        </div>
        {/* 目录扫描状态与能力条目是两套口径，这里说清楚以免同屏矛盾 */}
        {catalogDiagnostics === undefined
          ? null
          : <p className="v3-hint" data-overview-state-hint="true">{t('overviewCatalogStateHint')}</p>}
        {/* Names, not just counts: a count alone cannot be acted on. Bounded to
            keep a large broken catalog from pushing the 来源 line off screen. */}
        {catalogDiagnostics !== undefined && (catalogUnavailable ?? 0) > 0
          ? (
            <p className="v3-hint mc-overview-hint-names" data-overview-names="unavailable">
              {namesText(catalogDiagnostics.unavailableSkills.map(item => item.name), 4)}
            </p>
          )
          : null}
        {catalogDiagnostics !== undefined && (catalogShadowed ?? 0) > 0
          ? (
            <p className="v3-hint mc-overview-hint-names" data-overview-names="shadowed">
              {namesText(catalogDiagnostics.shadowedSkills.map(item => item.name), 4)}
            </p>
          )
          : null}
        {catalogDiagnostics !== undefined && (catalogBroken ?? 0) > 0
          ? (
            <p className="v3-hint mc-overview-hint-names" data-overview-names="broken">
              {namesText(catalogDiagnostics.brokenPresets.map(item => item.id), 4)}
            </p>
          )
          : null}
        {source('catalog', t('overviewCatalogSource'))}
      </div>
    </section>
  )
}

/**
 * 本页文案（zh / en），键与 {@link OverviewKey} 一一对应。
 *
 * 两行「来源」小字是本页的核心交付：它们说明每个数字来自哪一层、什么时候归零，
 * 这样「观察数 0」不会被读成「历史上从没调用过」，也不会被读成任何会话历史。
 */
export function overviewDictionaries(): {
  zh: Record<OverviewKey, string>
  en: Record<OverviewKey, string>
} {
  const zh: Record<OverviewKey, string> = {
    nav: '总览',
    title: '总览',
    desc: '一眼看清执行保护与能力目录的状态；数字只来自本机计数、状态文件与能力目录快照，不读聊天记录。',
    overviewRefresh: '刷新',
    overviewRefreshing: '正在读取…',
    overviewLoading: '正在读取…',
    overviewUnknown: '未知',
    // 执行保护记录
    overviewGuardTitle: '执行保护记录',
    overviewGuardSource: '来源：观察数与提醒/拒绝次数是执行保护的累计计数，会保存在本机，重启或更新插件都不会清零；开关与诊断来自本机状态文件。',
    overviewGuardError: '执行保护设置读取失败',
    overviewGuardObservations: '已观察调用',
    overviewGuardRepeat: '重复提醒',
    overviewGuardCycle: '循环提醒',
    overviewGuardDenials: '本地拒绝',
    overviewGuardSwitches: '开关',
    overviewGuardMaster: '总开关',
    overviewGuardDuplicate: '重复检测',
    overviewGuardCycleSwitch: '交替循环',
    overviewGuardNoProgress: '无进展保护',
    overviewSwitchOn: '已开启',
    overviewSwitchOff: '已关闭',
    overviewGuardDiag: '诊断',
    overviewGuardEffective: '已生效',
    overviewGuardNotEffective: '未生效',
    overviewDiagInvalidPatch: '配置非法',
    overviewDiagNotMounted: '未挂载',
    overviewDiagPersistenceDirty: '有未落盘改动',
    overviewDiagWriteFailed: '状态文件写入失败',
    overviewDiagNone: '无异常',
    // 能力菜单记录
    overviewCatalogTitle: '能力菜单记录',
    overviewCatalogSource: '来源：三档计数与条目总数来自能力目录快照；版本号来自目录自身；观察时间是本页读取快照的时间。',
    overviewCatalogError: '能力目录读取失败',
    overviewCatalogResident: '常驻',
    overviewCatalogOnDemand: '按需',
    overviewCatalogDisabled: '禁用',
    overviewCatalogTotal: '条目总数',
    overviewCatalogVersion: '目录版本',
    overviewCatalogObservedAt: '本页观察时间',
    overviewCatalogTools: '工具',
    overviewCatalogSkills: '技能（全部来源）',
    overviewCatalogSkillsHint: '含项目与预设来源，可能多于能力菜单「技能」页里的全局技能。',
    overviewCatalogState: '技能目录扫描',
    overviewCatalogStateEmpty: '目录为空',
    overviewCatalogStateReady: '就绪',
    overviewCatalogStateHint: '技能目录扫描与上方能力条目是两套口径，条目数以上方「条目总数」为准。',
    overviewCatalogDiag: '诊断',
    overviewCatalogDiagUnavailable: '不可调用',
    overviewCatalogDiagShadowed: '重名',
    overviewCatalogDiagBrokenPreset: '坏预设',
  }
  const en: Record<OverviewKey, string> = {
    nav: 'Overview',
    title: 'Overview',
    desc: 'Current state of the execution guard and the capability catalog; every number comes from this process counters, the guard state file and the catalog snapshot, never from session history.',
    overviewRefresh: 'Refresh',
    overviewRefreshing: 'Reading…',
    overviewLoading: 'Reading…',
    overviewUnknown: 'Unknown',
    overviewGuardTitle: 'Execution protection record',
    overviewGuardSource: 'Source: observation, reminder and denial counts come from the in-process Guard counters (getGuardStats; reset on restart, never backfilled); switches and diagnostics come from the Guard state file (getGuard / getGuardDiagnostics).',
    overviewGuardError: 'Failed to read the guard settings',
    overviewGuardObservations: 'Calls observed',
    overviewGuardRepeat: 'Repeat reminders',
    overviewGuardCycle: 'Cycle reminders',
    overviewGuardDenials: 'Local denials',
    overviewGuardSwitches: 'Switches',
    overviewGuardMaster: 'Master',
    overviewGuardDuplicate: 'Repeat detection',
    overviewGuardCycleSwitch: 'Alternating cycles',
    overviewGuardNoProgress: 'No-progress protection',
    overviewSwitchOn: 'On',
    overviewSwitchOff: 'Off',
    overviewGuardDiag: 'Diagnostics',
    overviewGuardEffective: 'Active',
    overviewGuardNotEffective: 'Not in effect',
    overviewDiagInvalidPatch: 'Invalid configuration',
    overviewDiagNotMounted: 'Not mounted',
    overviewDiagPersistenceDirty: 'Unsaved changes',
    overviewDiagWriteFailed: 'State file write failed',
    overviewDiagNone: 'No issues',
    overviewCatalogTitle: 'Capability menu record',
    overviewCatalogSource: 'Source: the three tier counts and the total come from the catalog snapshot (classifyAll); the version number comes from catalogVersion; the observation time is this page clocks reading the snapshot, not the Host refresh time; catalog diagnostics come from getDiagnostics.',
    overviewCatalogError: 'Failed to read the capability catalog',
    overviewCatalogResident: 'Resident',
    overviewCatalogOnDemand: 'On-demand',
    overviewCatalogDisabled: 'Disabled',
    overviewCatalogTotal: 'Total entries',
    overviewCatalogVersion: 'Catalog version',
    overviewCatalogObservedAt: 'Observed at',
    overviewCatalogTools: 'Tools',
    overviewCatalogSkills: 'Skills (all sources)',
    overviewCatalogSkillsHint: 'Includes project and preset sources, so it can exceed the global skills listed on the capability Skills tab.',
    overviewCatalogState: 'Skill directory scan',
    overviewCatalogStateEmpty: 'Empty',
    overviewCatalogStateReady: 'Ready',
    overviewCatalogStateHint: 'The skill directory scan (getDiagnostics) and the capability entries above (classifyAll) are two different measures; the entry counts above are authoritative.',
    overviewCatalogDiag: 'Diagnostics',
    overviewCatalogDiagUnavailable: 'Unavailable',
    overviewCatalogDiagShadowed: 'Name collisions',
    overviewCatalogDiagBrokenPreset: 'Broken presets',
  }
  return { zh, en }
}