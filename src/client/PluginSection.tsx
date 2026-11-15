/**
 * One settings page for the whole plugin, split into four pages.
 *
 * WHY THIS EXISTS — the package used to register two sibling `settings.section`
 * entries (`capability` = 能力菜单, `usage` = 调用统计). They describe the same
 * plugin and the user has to hunt through two side-bar rows to reach it. This
 * shell keeps exactly one entry and switches between the views with a category
 * tab bar, so the category is still one click away but the plugin is one place.
 *
 * Page order is fixed by the product decision: 总览 → 思考限制 → 能力目录 → 调用统计.
 * `catalog` and `usage` reuse their existing views verbatim; `overview` and
 * `guard` are owned by this file's siblings (`OverviewPanel`, `GuardPanel`).
 *
 * The tab bar is the official `SegmentedTabs` primitive rather than a hand-rolled
 * `role=tablist`: it brings the roving tabindex, Left/Right/Home/End navigation
 * and the sliding indicator that the shell's own tabs use. `SegmentedTabs`
 * renders no panels, so all panels stay caller-owned here — which is what we
 * want, because they are toggled with `hidden` instead of unmounting.
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { SegmentedTabs, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { CapabilitySection, type CapabilitySectionInjected, type CatalogUsage } from './CapabilitySection.tsx'
import {
  CallIndexDetailPanel,
  CallIndexDiagnostics,
  CallIndexOverviewPanel,
  callIndexToolRows,
  createCallIndexPanelApi,
  type CallIndexPanelApi,
  type CallIndexPanelFailure,
  type CallIndexRemoteFace,
} from './call-index.tsx'
import type { CallIndexStatusView } from './call-index-adapter.ts'
import { UsagePanel, type UsagePanelApi } from './usage.tsx'
import { OverviewContainer } from './OverviewContainer.tsx'
import { GuardContainer } from './GuardContainer.tsx'
import type { GuardSwitches } from './remote.ts'

/** Categories shown in the tab bar, in display order. */
export type PluginCategory = 'overview' | 'guard' | 'catalog' | 'usage'

export interface PluginSectionProps {
  /** Props for the 工具与技能 view, unchanged from its previous section entry. */
  readonly capability: CapabilitySectionInjected
  /**
   * Legacy usage face, still accepted so an older Host (or a test double) that
   * only knows `remote.usage` keeps rendering instead of showing an empty page.
   * The 调用明细/总览 panels read `callIndexRemote` when it resolves.
   */
  readonly usageApi?: UsagePanelApi | undefined
  /**
   * Resolves the `callIndex` remote face, or `undefined` when it is not mounted.
   *
   * A provider rather than a value: the namespace only becomes visible on
   * `ctx.get` after this plugin's `$mount` settles, so reading it once at
   * section construction would capture `undefined` forever.
   */
  readonly callIndexRemote?: (() => CallIndexRemoteFace | undefined) | undefined
  /**
   * Resolves the live target for the 按会话 / 按工作区 scopes.
   *
   * `settings.section` is root-scoped, so the shell passes no Session props;
   * the plugin resolves the selection from the client services instead. Read on
   * demand (a scope click), never subscribed.
   */
  readonly scopeTarget?: (() => { sessionId?: string; cwd?: string }) | undefined
  /**
   * Session display names plus the switchable list for 调用明细.
   *
   * The call index wire carries no title, so a scope line built from the wire
   * alone can only show a truncated id — which does not answer "which
   * conversation am I looking at". Names come from the Host Session catalog.
   */
  readonly sessionCatalog?: (() => {
    current?: { id: string; name: string }
    items: readonly { id: string; name: string; cwd?: string }[]
  }) | undefined
  /**
   * Latest index health, read by the container.
   *
   * Passed down as a value so this view stays hook-free. When present the shared
   * red box renders under the tab bar on every tab; when absent it renders
   * nothing, which is the healthy case.
   */
  readonly diagnostics?: {
    readonly status?: CallIndexStatusView
    readonly failure?: CallIndexPanelFailure
  } | undefined
  /** Guard switch face for 执行保护 and the 总览 status row. */
  readonly guardRemote: {
    getGuard?(): Promise<{ ok: true; value: GuardSwitches } | { ok: false; error: { code: string; message: string } }>
    updateGuard?(change: Partial<GuardSwitches>): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>
    classifyAll?(): Promise<
      { ok: true; value: readonly { class: 'resident' | 'on-demand' | 'disabled' }[] }
      | { ok: false; error: { code: string; message: string } }
    >
  }
  /** Copy for the tab bar and the two panels owned here. */
  readonly t: (key: PluginSectionKey) => string
}

/** Props the `settings.section` entry injects; identical to the panel props. */
export type PluginSectionInjected = PluginSectionProps

export type PluginSectionKey =
  | 'nav'
  | 'tabOverview'
  | 'tabGuard'
  | 'tabCatalog'
  | 'tabUsage'
  // 总览
  | 'overviewTitle'
  | 'overviewDesc'
  | 'overviewRefresh'
  | 'guardStateOn'
  | 'guardStateOff'
  | 'guardThresholds'
  // 执行保护 · 真实计数看板
  | 'guardStatsTitle'
  | 'guardStatObservations'
  | 'guardStatObservationsHint'
  | 'guardStatOutcomes'
  | 'guardStatOutcomesHint'
  | 'guardStatReminders'
  | 'guardStatRemindersHint'
  | 'guardStatDenials'
  | 'guardStatDenialsHint'
  | 'guardStatsSince'
  | 'guardThresholdsEditableHint'
  | 'guardThresholdsFixedHint'
  | 'recentCalls'
  | 'tierSummary'
  | 'attention'
  | 'attentionNone'
  | 'attentionFailures'
  | 'attentionIdle'
  | 'attentionCoverage'
  | 'tierResident'
  | 'tierOnDemand'
  | 'tierDisabled'
  // 思考限制
  | 'guardTitle'
  | 'guardDesc'
  | 'guardBoundary'
  | 'guardReset'
  | 'guardScopeTitle'
  | 'guardScopeBody'
  | 'guardScopeFoot'
  | 'guardBoundaryLabel'
  | 'guardBoundaryShort'
  | 'guardThresholdHint'
  | 'guardFired'
  | 'guardPurposeB'
  | 'guardPurposeC'
  | 'guardFootCycle'
  | 'guardFootNoProgress'
  | 'guardSectionA'
  | 'guardSectionB'
  | 'guardSectionC'
  | 'guardModelLabel'
  | 'guardABody1'
  | 'guardABody2'
  | 'guardABody3'
  | 'guardBBody1'
  | 'guardBBody2'
  | 'guardBBody3'
  | 'guardCBody1'
  | 'guardCBody2'
  | 'guardCBody3'

/** Tab id → rendered view. Kept as data so the bar cannot drift from the panels. */
const CATEGORIES: readonly [SegmentedTab<PluginCategory>, ...SegmentedTab<PluginCategory>[]] = [
  { value: 'overview', id: 'mc-category-tab-overview', panelId: 'mc-category-panel-overview', label: '' },
  { value: 'guard', id: 'mc-category-tab-guard', panelId: 'mc-category-panel-guard', label: '' },
  { value: 'catalog', id: 'mc-category-tab-catalog', panelId: 'mc-category-panel-catalog', label: '' },
  { value: 'usage', id: 'mc-category-tab-usage', panelId: 'mc-category-panel-usage', label: '' },
]

/** Localized tab labels, resolved at render so the shell controls `locale`. */
const CATEGORY_KEYS: Readonly<Record<PluginCategory, PluginSectionKey>> = {
  overview: 'tabOverview',
  guard: 'tabGuard',
  catalog: 'tabCatalog',
  usage: 'tabUsage',
}

/**
 * Memo of `createCallIndexPanelApi` keyed by provider identity.
 *
 * The panels hold their own request state and re-run effects when the `api`
 * object changes, so handing them a fresh object on every render would refetch
 * on each paint. Keying on the provider (`index.ts` passes one stable function)
 * gives the same object across renders while still letting a test pass a
 * different provider and get a fresh face.
 *
 * A module-level memo, not `useState`: this view must stay hook-free so the
 * suite can invoke it directly.
 */
const callIndexApis = new WeakMap<object, CallIndexPanelApi>()
let callIndexApiForNoProvider: CallIndexPanelApi | undefined

function callIndexApiFor(provider: (() => CallIndexRemoteFace | undefined) | undefined): CallIndexPanelApi {
  if (provider === undefined) {
    callIndexApiForNoProvider ??= createCallIndexPanelApi(undefined)
    return callIndexApiForNoProvider
  }
  const cached = callIndexApis.get(provider)
  if (cached !== undefined) return cached
  const created = createCallIndexPanelApi(provider)
  callIndexApis.set(provider, created)
  return created
}

export function PluginSection(props: PluginSectionProps): ReactElement {
  const [active, setActive] = useState<PluginCategory>('overview')
  // Read index health once here, so the shared red box can appear on ALL four
  // tabs — 执行保护 and 工具与技能 never touch the call index, and a broken
  // index used to look fine until the operator opened 调用明细.
  const callIndexApi = callIndexApiFor(props.callIndexRemote)
  const [diagnostics, setDiagnostics] = useState<{
    readonly status?: CallIndexStatusView
    readonly failure?: CallIndexPanelFailure
  } | undefined>(undefined)
  // Per-tool call counts for 工具与技能. Read once per mount here (the page itself
  // is hook-free and receives no corpus): the catalog can then show real usage
  // beside each policy instead of an empty column. A failed read leaves it
  // undefined, which the catalog renders as `—`, never as zero.
  const [catalogUsage, setCatalogUsage] = useState<ReadonlyMap<string, CatalogUsage> | undefined>(undefined)
  useEffect(() => {
    let live = true
    void (async () => {
      const result = await callIndexApi.getStatus()
      if (!live) return
      setDiagnostics(result.ok ? { status: result.value } : { failure: result })
    })()
    return () => { live = false }
  }, [callIndexApi])
  useEffect(() => {
    let live = true
    void (async () => {
      const result = await callIndexApi.listCalls({ range: 'all' })
      if (!live || !result.ok) return
      const map = new Map<string, CatalogUsage>()
      for (const row of callIndexToolRows(result.value)) {
        map.set(row.toolName, { uses: row.calls, failures: row.error })
      }
      setCatalogUsage(map)
    })()
    return () => { live = false }
  }, [callIndexApi])
  /**
   * Reset the settings content scroller when the category changes.
   *
   * The shell owns the scrolling column and swaps panels with `hidden`, so the
   * previous tab's scrollTop survives the switch and the next page opens halfway
   * down (observed: 执行保护 opened below its counter board). Reset the nearest
   * scrollable ancestor of the active panel.
   */
  useEffect(() => {
    const panel = document.getElementById('mc-category-panel-' + active)
    let node: HTMLElement | null = panel
    while (node !== null && !(node.scrollHeight > node.clientHeight + 4)) node = node.parentElement
    if (node !== null) node.scrollTop = 0
  }, [active])
  return createElement(PluginSectionView, {
    capability: props.capability,
    usageApi: props.usageApi,
    // MUST be forwarded: this component is what `settings.section` actually
    // registers, so dropping it here silently sends both panels to the legacy
    // fallback no matter what `index.ts` injects. The prop is optional, so
    // neither tsc nor a `PluginSectionView` test can catch the omission —
    // `client-plugin-section.spec.tsx` calls `PluginSection` itself for that.
    callIndexRemote: props.callIndexRemote,
    scopeTarget: props.scopeTarget,
    sessionCatalog: props.sessionCatalog,
    guardRemote: props.guardRemote,
    t: props.t,
    active,
    onSelect: setActive,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(catalogUsage === undefined ? {} : { catalogUsage }),
  })
}

export interface PluginSectionViewProps extends PluginSectionProps {
  /** Currently selected category. */
  readonly active: PluginCategory
  /** React to a tab click. */
  readonly onSelect: (category: PluginCategory) => void
  /** Per-capability call counts, read once by the container (see PluginSection). */
  readonly catalogUsage?: ReadonlyMap<string, CatalogUsage> | undefined
}

/**
 * Pure view: no hooks, so the test suite (which has no DOM harness) can call it
 * directly and walk the returned element tree — same pattern as
 * `UsagePanelView`.
 */
export function PluginSectionView(props: PluginSectionViewProps): ReactElement {
  const { capability, usageApi, callIndexRemote, scopeTarget, sessionCatalog, guardRemote, t, active, onSelect, diagnostics, catalogUsage } = props

  // One stable API object per provider identity. A `useState` initializer would
  // be the idiomatic way to hold it, but this view is deliberately hook-free so
  // the test suite can call it as a plain function and walk the element tree
  // (same pattern as `UsagePanelView`). Caching by provider keeps the panels'
  // effects from restarting on every render without introducing a hook.
  const callIndexApi = callIndexApiFor(callIndexRemote)

  const panel = (
    category: PluginCategory,
    children: ReactElement,
  ): ReactElement => createElement('div', {
    role: 'tabpanel',
    id: CATEGORIES.find(c => c.value === category)?.panelId,
    'aria-labelledby': CATEGORIES.find(c => c.value === category)?.id,
    hidden: active !== category,
    className: 'mc-panel',
  }, children)

  return createElement('div', { className: 'mc-plugin-section' },
    // The tab bar sits above the reused sections; each section already owns
    // its own heading, so no extra page title is injected here.
    createElement(SegmentedTabs<PluginCategory>, {
      items: CATEGORIES.map(category => ({
        ...category,
        label: t(CATEGORY_KEYS[category.value]),
      })) as unknown as readonly [SegmentedTab<PluginCategory>, ...SegmentedTab<PluginCategory>[]],
      value: active,
      onChange: onSelect,
      label: t('nav'),
    }),

    // One loud error box directly under the tab bar, shared by all four tabs.
    // Requested after several rounds of "it fails and I cannot tell why": the
    // per-page grey hints were easy to miss and some failures were never shown.
    // Data comes in as props: this view must stay hook-free (the suite calls it
    // as a plain function), so the container owns the read.
    CallIndexDiagnostics({
      ...(diagnostics?.status === undefined ? {} : { status: diagnostics.status }),
      ...(diagnostics?.failure === undefined ? {} : { failure: diagnostics.failure }),
    }),

    // `hidden` instead of unmounting: the catalog and usage views own live
    // Remote subscriptions and scroll positions, and re-mounting on every tab
    // click would refetch the whole catalog each time.
    // 总览 and 调用明细 read the call index. `UsagePanel` stays reachable as a
    // fallback only when the call-index namespace is absent AND a legacy usage
    // face exists, so a Host that predates N23 still shows something real
    // instead of an empty page.
    panel('overview', callIndexRemote === undefined && usageApi !== undefined
      ? createElement(OverviewContainer, { t, usageApi, guardRemote, policyRemote: guardRemote })
      : createElement(CallIndexOverviewPanel, { api: callIndexApi })),
    panel('guard', createElement(GuardContainer, { t, remote: guardRemote, duplicateThresholds: [3, 5, 8] })),
    panel('catalog', createElement(CapabilitySection, {
      ...capability,
      ...(catalogUsage === undefined ? {} : { usage: catalogUsage }),
    })),
    panel('usage', callIndexRemote === undefined && usageApi !== undefined
      ? createElement(UsagePanel, { api: usageApi })
      : createElement(CallIndexDetailPanel, {
          api: callIndexApi,
          ...(scopeTarget === undefined ? {} : { resolveScopeTarget: scopeTarget }),
          ...(sessionCatalog === undefined ? {} : { resolveSessionCatalog: sessionCatalog }),
        })),
  )
}
