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
  callIndexScanActive,
  createCallIndexPanelApi,
  type CallIndexCallPageView,
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
  | 'guardThresholdSave'
  | 'guardThresholdDraftHint'
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

// ── TG-10: 工具目录调用统计（有界读取也要如实） ──────────────────
//
// The catalog shows a per-tool call count beside each capability. The count is
// built by paging the call index, but a bounded read is NOT a complete census:
// stopping on a page cap (or reading a partial corpus, or dropping rows) must
// never be rendered as an exact zero for the tools that were simply never
// reached. Because the catalog prop can only carry observed counts, an
// incomplete read is published as `undefined` (the page's honest 「—」), never as
// a zero-filled map.

/** Hard safety cap on catalog usage pages (page size 50 → 10k calls). */
export const CATALOG_USAGE_MAX_PAGES = 200

/** Completeness facts for one catalog usage read; kept for tests/diagnostics. */
export interface CatalogUsageCompleteness {
  readonly complete: boolean
  readonly readCalls: number
  readonly total?: number
  readonly hasMore: boolean
  readonly truncated: boolean
  readonly dropped: number
}

export interface CatalogUsageAggregation {
  /** Observed per-tool counts, or `undefined` when the read is not complete. */
  readonly usage?: ReadonlyMap<string, CatalogUsage>
  readonly completeness: CatalogUsageCompleteness
}

/**
 * Aggregate the successfully read pages of one catalog usage pass.
 *
 * Only a read that is complete in EVERY sense is published as exact per-tool
 * counts: the cursor was exhausted, every page reported `complete` coverage,
 * no page admitted a dropped (allowlist-rejected) row, `totalExact` was never
 * `false`, and the rows read equal the Host's `total`. Anything less stays
 * unknown — a missing entry means "not observed", not "zero calls".
 */
export function summarizeCatalogUsage(
  pages: readonly CallIndexCallPageView[],
  options: { readonly truncated?: boolean } = {},
): CatalogUsageAggregation {
  const truncated = options.truncated === true
  let readCalls = 0
  let dropped = 0
  let coverageComplete = true
  let exact = true
  let last: CallIndexCallPageView | undefined
  const totals = new Map<string, { uses: number; failures: number }>()
  for (const page of pages) {
    last = page
    readCalls += page.items.length
    dropped += page.droppedItems
    if (page.coverage !== 'complete') coverageComplete = false
    if (page.totalExact === false) exact = false
    for (const row of page.items) {
      const entry = totals.get(row.toolName) ?? { uses: 0, failures: 0 }
      entry.uses += 1
      if (row.outcome === 'error') entry.failures += 1
      totals.set(row.toolName, entry)
    }
  }
  const total = last?.total
  const hasMore = truncated || (last !== undefined && last.nextCursor !== undefined)
  const totalConsistent = total === undefined || readCalls === total
  const complete = pages.length > 0 && !hasMore && coverageComplete && exact && dropped === 0 && totalConsistent
  const usage = complete
    ? new Map<string, CatalogUsage>(
        [...totals.entries()].map(([toolName, entry]) => [toolName, {
          uses: entry.uses,
          ...(entry.failures > 0 ? { failures: entry.failures } : {}),
        }]),
      )
    : undefined
  return {
    usage,
    completeness: {
      complete,
      readCalls,
      ...(total === undefined ? {} : { total }),
      hasMore,
      truncated,
      dropped,
    },
  }
}

// ── TG-12: 共享索引状态轮询（单飞 + 失败恢复 + 终态降频） ──────────
//
// One shell timer polls index health for the shared diagnostic box. It must
// never start a second overlapping request, must keep polling after a failure
// (bounded backoff) and after the scan reaches a terminal state (slower, so a
// later task / live event is still noticed) — the old version stopped forever
// on the first failure or the first non-scanning tick.

export const INDEX_STATUS_POLL_SCANNING_MS = 3000
export const INDEX_STATUS_POLL_IDLE_MS = 15000
export const INDEX_STATUS_POLL_ERROR_BASE_MS = 3000
export const INDEX_STATUS_POLL_ERROR_MAX_MS = 30000

/**
 * Is the index ACTUALLY working right now? (Seventh batch: one definition.)
 *
 * This used to be a second, private definition —
 * `phase === 'running' || pending > 0 || pendingLive > 0` — while 调用明细 used
 * `callIndexScanActive`. The two disagreed exactly where it hurt: under a
 * capacity pause (`paused: true`) or with only a leftover backlog the detail
 * page had already settled into its terminal story (「可恢复」, 15s cadence) while
 * this shared diagnostic box kept a 3s timer spinning forever, re-reading a
 * status that could not change.
 *
 * There is now ONE predicate, owned by the call-index surface: a backlog is owed
 * work, not activity; a pause is terminal-but-resumable; without a readable
 * scope there is no corpus to scan; and when the Host reports a scheduler its
 * state is the whole answer (`scheduled`/`running` = active, `idle`/`stopped` =
 * not). An older Host that sends no `auto` keeps the conservative reading: only
 * `phase: 'running'` may claim activity — so a live queue alone slows the shared
 * timer to 15s instead of pretending a scan is running. That delay is the
 * accepted cost: a scan that starts on such a Host is noticed on the next
 * terminal tick (≤15s), never never.
 *
 * The name is kept (and exported) because it is the poll policy's vocabulary and
 * the suite drives it directly; the SIGNATURE is widened to accept `undefined`
 * because the container's first tick may have no status yet.
 */
export function isIndexScanning(status: CallIndexStatusView | undefined): boolean {
  return callIndexScanActive(status)
}

/**
 * Delay before the next shared status poll.
 *
 * Scanning → fast cadence; terminal → slow cadence (keep watching, never stop);
 * failure → capped exponential backoff so a broken Host is retried instead of
 * being abandoned.
 */
export function indexStatusPollDelay(
  result: { ok: true; value: CallIndexStatusView } | { ok: false },
  consecutiveErrors: number,
): number {
  if (result.ok) return isIndexScanning(result.value) ? INDEX_STATUS_POLL_SCANNING_MS : INDEX_STATUS_POLL_IDLE_MS
  const exponent = Math.max(0, consecutiveErrors - 1)
  return Math.min(INDEX_STATUS_POLL_ERROR_MAX_MS, INDEX_STATUS_POLL_ERROR_BASE_MS * 2 ** exponent)
}

/** Whether a scan→terminal transition should re-read the catalog usage once. */
export function shouldReloadCatalog(previousScanning: boolean | undefined, nextScanning: boolean): boolean {
  return previousScanning === true && nextScanning === false
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
  /** Bumped when a scan finishes, so the catalog's usage map is re-read once. */
  const [usageToken, setUsageToken] = useState(0)
  useEffect(() => {
    // One single-flight status stream for the shared diagnostic box.
    //
    // TG-12: the previous version returned on the first failure and stopped
    // forever after the first terminal tick, so a later scan failure looked
    // healthy and the catalog never refreshed again. Now the timer is only
    // re-armed AFTER an awaited tick (single-flight, never overlapping), a
    // failure retries with capped backoff, and a terminal scan slows down but
    // keeps watching for a next task / live event.
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let consecutiveErrors = 0
    let previousScanning: boolean | undefined
    const schedule = (delay: number): void => {
      if (!live) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => { void tick() }, delay)
    }
    const tick = async (): Promise<void> => {
      const result = await callIndexApi.getStatus()
      if (!live) return
      if (result.ok) {
        consecutiveErrors = 0
        const scanning = isIndexScanning(result.value)
        setDiagnostics({ status: result.value })
        // Re-read the catalog exactly once, on the scan→terminal edge.
        if (shouldReloadCatalog(previousScanning, scanning)) setUsageToken(value => value + 1)
        previousScanning = scanning
      } else {
        consecutiveErrors += 1
        setDiagnostics({ failure: result })
      }
      schedule(indexStatusPollDelay(result, consecutiveErrors))
    }
    void tick()
    return () => { live = false; if (timer !== undefined) clearTimeout(timer) }
  }, [callIndexApi])
  useEffect(() => {
    // Read EVERY page of the same pinned window, never just the first 50 calls:
    // a first-page-only map under-counts large corpora and reports "0 calls" for
    // tools that simply fell off page one.
    //
    // TG-10: a bounded read is not a census. If the pass hits the safety page
    // cap, reads a partially-scanned corpus, drops an allowlist-rejected row, or
    // cannot reconcile the row count with the Host total, `summarizeCatalogUsage`
    // returns NO map, so the catalog shows 「—」 for every row instead of a
    // fabricated zero for tools that were never reached. A read failure likewise
    // clears the map rather than leaving stale counts.
    let live = true
    const anchor = Date.now()
    void (async () => {
      const pages: CallIndexCallPageView[] = []
      let cursor: string | undefined
      let truncated = false
      for (let index = 0; index < CATALOG_USAGE_MAX_PAGES; index += 1) {
        const result = await callIndexApi.listCalls({ range: 'all' }, cursor, anchor)
        if (!live) return
        if (!result.ok) { setCatalogUsage(undefined); return }
        pages.push(result.value)
        cursor = result.value.nextCursor
        if (cursor === undefined) break
        if (index === CATALOG_USAGE_MAX_PAGES - 1) truncated = true
      }
      if (!live) return
      setCatalogUsage(summarizeCatalogUsage(pages, { truncated }).usage)
    })()
    return () => { live = false }
  }, [callIndexApi, usageToken])
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
    // Only the visible 执行保护 tab polls its counters; the other tabs tell the
    // container to stay quiet so no timer runs while it is hidden.
    panel('guard', createElement(GuardContainer, { t, remote: guardRemote, duplicateThresholds: [3, 5, 8], active: active === 'guard' })),
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
