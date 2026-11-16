/**
 * Rules for the single combined settings page.
 *
 * Most cases inspect the component as an element tree rather than mounting it
 * (same constraint as `client-usage.spec.tsx`). The seventh-batch polling cases
 * at the bottom of this file DO mount the real container under jsdom with fake
 * timers: the shared diagnostic timer is the thing under test, and a timer's
 * cadence cannot be observed on an unmounted element tree.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import { act } from 'react'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement, ReactNode } from 'react'
import { callIndexReply } from '../src/usage/call-index-wire.ts'

// React only batches under `act` when it is told it is in a test environment;
// without this the mounted cases still pass but every update logs a warning.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The shell tests are about the tab bar and which views stay mounted, so the
// heavy catalog view is stubbed out. The pure v3 catalog pieces (CatalogStatStrip
// / ToolGroupsView) are NOT stubbed — the mock spreads the real module and only
// replaces `CapabilitySection`, so the catalog assertions below can call them
// directly (same hook-free pattern as `GuardPanel`).
/**
 * Every props object the stubbed catalog received, in render order.
 *
 * The mounted polling cases need to see how many times the container actually
 * RE-READ the per-tool usage map (the scan→terminal edge must refresh it exactly
 * once). The catalog is stubbed to `null`, so its props are the only observable
 * trace — and counting distinct `usage` map identities is immune to unrelated
 * re-renders, unlike counting renders.
 */
const catalogRenders = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))

vi.mock('../src/client/CapabilitySection.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/CapabilitySection.tsx')>()
  return {
    ...actual,
    CapabilitySection: function CapabilitySection(props: Record<string, unknown>) {
      catalogRenders.props.push(props)
      return null
    },
  }
})

import {
  CATALOG_USAGE_MAX_PAGES,
  INDEX_STATUS_POLL_ERROR_BASE_MS,
  INDEX_STATUS_POLL_ERROR_MAX_MS,
  INDEX_STATUS_POLL_IDLE_MS,
  INDEX_STATUS_POLL_SCANNING_MS,
  PluginSection,
  PluginSectionView,
  indexStatusPollDelay,
  isIndexScanning,
  shouldReloadCatalog,
  summarizeCatalogUsage,
  type PluginCategory,
  type PluginSectionProps,
} from '../src/client/PluginSection.tsx'
import type { CallIndexCallPageView, CallIndexRemoteFace } from '../src/client/call-index.tsx'
import type { CallIndexStatusView } from '../src/client/call-index-adapter.ts'
import { UsagePanel, type UsagePanelApi } from '../src/client/usage.tsx'
import { OverviewContainer } from '../src/client/OverviewContainer.tsx'
import { GuardPanel, HOOK_COMPONENT, parseGuardThresholds } from '../src/client/GuardPanel.tsx'
import { GuardContainer } from '../src/client/GuardContainer.tsx'
import {
  CatalogStatStrip,
  ToolGroupsView,
  type CapabilitySectionInjected,
  type CatalogUsage,
} from '../src/client/CapabilitySection.tsx'
import type { CapabilityRow } from '../src/client/remote.ts'

const capability = {
  remote: {} as CapabilitySectionInjected['remote'],
  t: (key: string) => key,
  subscribeSignals: () => () => undefined,
} satisfies CapabilitySectionInjected

const usageApi: UsagePanelApi = {
  getSnapshot: async () => ({ ok: false, error: { code: 'unavailable', message: 'test' } }),
  refresh: async () => ({ ok: false, error: { code: 'unavailable', message: 'test' } }),
} as unknown as UsagePanelApi

const labels: Record<string, string> = {
  nav: '能力管理',
  tabOverview: '总览',
  tabGuard: '执行保护',
  tabCatalog: '工具与技能',
  tabUsage: '调用明细',
}

const guardRemote = {
  getGuard: async () => ({
    ok: true as const,
    value: { enabled: true, duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: true },
  }),
  updateGuard: async () => ({ ok: true as const, value: undefined }),
  classifyAll: async () => ({ ok: true as const, value: [] }),
}

function props(): PluginSectionProps {
  return { capability, usageApi, guardRemote, t: (key: string) => labels[key] ?? key }
}

interface TreeNode {
  readonly type: unknown
  readonly props: Record<string, unknown>
}

function isElement(value: unknown): value is ReactElement {
  return isValidElement(value)
}

/** Depth-first walk over the static element tree. */
function walk(node: ReactNode, visit: (element: TreeNode) => void): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isElement(node)) return
  const element = node as unknown as TreeNode
  visit(element)
  walk(element.props.children as ReactNode, visit)
}

/**
 * Every element matching `predicate`, in tree order, EXPANDING function
 * components.
 *
 * `walk` deliberately does not expand components — the combined-page tests
 * depend on seeing `PluginSectionView` as a single node. The Guard board and the
 * other hook-free components are only reachable through this variant.
 *
 * One exception, and only one: a component tagged with `HOOK_COMPONENT` (the
 * threshold editor owns a draft) calls hooks, so calling it outside a render
 * throws "Invalid hook call". It is SKIPPED — every other component is still
 * expanded, so no hook-free assertion is weakened. That editor's real behaviour
 * is asserted by jsdom mounts in tests/tg-draft-editor.spec.tsx.
 */
function nodesWhere(node: ReactNode, predicate: (element: TreeNode) => boolean): TreeNode[] {
  const out: TreeNode[] = []
  const visit = (current: ReactNode): void => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (Array.isArray(current)) { for (const child of current) visit(child); return }
    if (!isElement(current)) return
    const element = current as unknown as TreeNode
    if (predicate(element)) out.push(element)
    const type = element.type as unknown
    if (typeof type === 'function' && (type as unknown as Record<symbol, boolean>)[HOOK_COMPONENT] !== true) {
      visit((type as (props: unknown) => ReactNode)(element.props))
    }
    visit(element.props.children as ReactNode)
  }
  visit(node)
  return out
}

function find(node: ReactNode, predicate: (element: TreeNode) => boolean): TreeNode | undefined {
  let hit: TreeNode | undefined
  walk(node, (element) => {
    if (hit === undefined && predicate(element)) hit = element
  })
  return hit
}

function render(active: PluginCategory = 'overview'): ReactElement {
  return PluginSectionView({ ...props(), active, onSelect: () => undefined }) as ReactElement
}

/**
 * Call the container `settings.section` actually registers, which uses one hook.
 *
 * There is no DOM harness here, so React's dispatcher is absent and every hook
 * call throws. Installing a minimal dispatcher that returns the initial state
 * lets the real container run and hand back the element tree it would render —
 * enough to assert that props survive the hop into `PluginSectionView`.
 *
 * React reads the dispatcher off its internals object; this is deliberately the
 * narrowest possible stub (one `useState`, always returning the initial value)
 * so nothing here can mask a real hook bug elsewhere.
 */
function mountThroughContainer(input: PluginSectionProps): ReactElement {
  const internals = (React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
      ReactCurrentDispatcher: { current: unknown }
    }
  }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  if (internals === undefined) throw new Error('React internals unavailable; cannot stand in a dispatcher')
  const previous = internals.ReactCurrentDispatcher.current
  internals.ReactCurrentDispatcher.current = {
    useState<T>(initial: T | (() => T)): [T, (next: T) => void] {
      const value = typeof initial === 'function' ? (initial as () => T)() : initial
      return [value, () => undefined]
    },
    // The container now also reads index health in an effect (D-037). A no-op
    // effect is enough: the stub never re-renders, so the initial state is all
    // this test can observe — and all it asserts.
    useEffect(): void {
      /* intentionally not run: the stub renders once with initial state */
    },
  }
  try {
    return PluginSection(input) as ReactElement
  } finally {
    internals.ReactCurrentDispatcher.current = previous
  }
}

const tree = render()

/**
 * The tab list comes from the official `SegmentedTabs`, which renders the
 * tablist from its `items` prop rather than from `children`. Expand that one
 * hook-free component so the walk can see the real `role="tab"` buttons — the
 * same technique `client-usage.spec.tsx` already uses for nested components.
 */
function tabsTreeOf(source: ReactNode): ReactNode {
  const tabs = find(source, element => String((element.type as { name?: string })?.name) === 'SegmentedTabs')
  if (tabs === undefined) return null
  const renderFn = tabs.type as (props: unknown) => ReactNode
  return renderFn(tabs.props)
}

function tabButtons(source: ReactNode = tree): TreeNode[] {
  const buttons: TreeNode[] = []
  walk(tabsTreeOf(source), (element) => {
    if (element.props.role === 'tab') buttons.push(element)
  })
  return buttons
}

function panelsOf(source: ReactNode = tree): TreeNode[] {
  const panels: TreeNode[] = []
  walk(source, (element) => {
    if (element.props.role === 'tabpanel') panels.push(element)
  })
  return panels
}

describe('combined settings page', () => {
  it('renders the four categories in the product-specified order', () => {
    const buttons = tabButtons()
    expect(buttons.map(button => button.props.children))
      .toEqual(['总览', '执行保护', '工具与技能', '调用明细'])
  })

  it('selects exactly one tab on first paint, and it is 总览', () => {
    const buttons = tabButtons()
    expect(buttons.filter(button => button.props['aria-selected'] === true)).toHaveLength(1)
    expect(buttons[0]?.props['aria-selected']).toBe(true)
  })

  it('starts on 总览', () => {
    const panels = panelsOf()
    expect(panels).toHaveLength(4)
    // 总览 visible first; the other three mounted but hidden, so they keep their
    // subscriptions instead of refetching on every tab click.
    expect(panels[0]?.props.hidden).toBe(false)
    expect(panels.slice(1).every(panel => panel.props.hidden === true)).toBe(true)
  })

  it('keeps every view mounted, not conditionally swapped', () => {
    // 总览 is wired through its container so it reads the real usage snapshot;
    // the pure view is covered separately by OverviewPanel's own contract.
    expect(find(tree, element => element.type === OverviewContainer)).toBeDefined()
    // 思考限制 is wired through its container so the switches read the real Host
    // configuration; `GuardPanel` is covered as a pure view below.
    expect(find(tree, element => element.type === GuardContainer)).toBeDefined()
    expect(find(tree, element => element.type === UsagePanel)).toBeDefined()
    // The capability view is a function component; assert its element exists
    // rather than reaching into its internals.
    expect(find(tree, element => String((element.type as { name?: string })?.name) === 'CapabilitySection'))
      .toBeDefined()
  })

  it('passes the usage api straight through', () => {
    const panel = find(tree, element => element.type === UsagePanel)
    expect((panel?.props as { api?: unknown } | undefined)?.api).toBe(usageApi)
  })

  it('flips the visible panel when the category changes', () => {
    for (const [index, category] of (['overview', 'guard', 'catalog', 'usage'] as const).entries()) {
      const panels = panelsOf(render(category))
      const hidden = panels.map(panel => panel.props.hidden)
      expect(hidden[index]).toBe(false)
      expect(hidden.filter(value => value === false)).toHaveLength(1)
    }
  })

  it('reports the selected category on the tabs', () => {
    const buttons = tabButtons(render('usage'))
    expect(buttons.map(button => button.props['aria-selected']))
      .toEqual([false, false, false, true])
  })
})

describe('思考限制 page', () => {
  it('renders the three sections in order without a summary panel', () => {
    const element = GuardPanel({
      t: (key: string) => labels[key] ?? key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
    }) as ReactElement

    const ids: unknown[] = []
    walk(element, (node) => {
      if (node.props['data-guard-section'] !== undefined) ids.push(node.props['data-guard-section'])
    })
    expect(ids).toEqual(['duplicate_call', 'alternating_cycle', 'no_progress'])

    // No summary block: the 总览 page owns "what is on right now".
    const text: string[] = []
    walk(element, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    expect(text.some(value => value.includes('当前生效'))).toBe(false)
  })

  it('exposes the model-side id so the English reminder can be traced', () => {
    const element = GuardPanel({
      t: (key: string) => labels[key] ?? key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
    }) as ReactElement

    const text: string[] = []
    walk(element, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    for (const id of ['duplicate_call', 'alternating_cycle', 'no_progress']) {
      expect(text.some(value => value.includes(id))).toBe(true)
    }
  })

  it('explains what each switch does instead of showing a bare toggle', () => {
    // A switch alone does not tell a reader whether turning it off stops
    // reminders only or also stops local denials, so each section carries the
    // bullets that state the real behaviour.
    const element = GuardPanel({
      t: (key: string) => key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
    }) as ReactElement

    const bullets: string[] = []
    walk(element, (node) => {
      if (node.props.className === 'mc-guard-point') {
        const child = node.props.children
        if (typeof child === 'string') bullets.push(child)
      }
    })
    // Three sections x three bullets.
    expect(bullets).toHaveLength(9)
    expect(bullets).toEqual(expect.arrayContaining([
      'guardABody1', 'guardABody2', 'guardABody3',
      'guardBBody1', 'guardBBody2', 'guardBBody3',
      'guardCBody1', 'guardCBody2', 'guardCBody3',
    ]))
  })

  it('renders the thresholds as one editable field, in section A only', () => {
    // These thresholds used to be a hard-coded 3/5/8 rendered as text, so the
    // operator could read them but not change them. They are now one
    // comma-separated input whose value comes from the Host.
    const element = GuardPanel({
      t: (key: string) => key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
      onThresholdsChange: () => {},
    }) as ReactElement
    const inputs = nodesWhere(element, node => node.props['data-guard-thresholds'] === 'true')
    expect(inputs).toHaveLength(1)
    // The wrapper is hook-free, so the walk sees it; the boxes inside belong to
    // the draft hook component and are asserted by real jsdom mounts in
    // tg-draft-editor.spec.tsx. Here the wiring is what matters: one wrapper,
    // the Host's list, and an editable (not read-only) surface.
    expect(inputs[0].props['data-guard-thresholds-values']).toBe('3,5,8')
    expect(inputs[0].props['data-guard-thresholds-editable']).toBe('true')
    expect(nodesWhere(element, node => node.type === 'input')).toHaveLength(0)
  })

  it('reads the field back as a plain list, with no Chinese-only punctuation', () => {
    // The label and the value are separate nodes on purpose: interpolating them
    // forced a literal `：`, which then leaked into the English UI.
    const element = GuardPanel({
      t: (key: string) => labels[key] ?? key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
      onThresholdsChange: () => {},
    }) as ReactElement
    // The values live on the <input>s inside the hook-owned editor, which this
    // walk does not expand; the initial rendering of those boxes is asserted by
    // the jsdom mounts in tg-draft-editor.spec.tsx. What this case guards is that
    // no Chinese-only punctuation leaks into the label/text around them.
    const text: string[] = []
    walk(element, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    expect(text.some(value => value.includes('：'))).toBe(false)
  })

  it('refuses an invalid threshold list instead of sending it', () => {
    // Parsing happens here as well as on the Host so a bad keystroke never
    // round-trips and flickers the field.
    expect(parseGuardThresholds('3, 5, 8')).toEqual([3, 5, 8])
    expect(parseGuardThresholds('3,5,8')).toEqual([3, 5, 8])
    expect(parseGuardThresholds('8, 5, 3')).toBeUndefined()   // not ascending
    expect(parseGuardThresholds('3, 3, 8')).toBeUndefined()   // not strictly
    expect(parseGuardThresholds('1, 5')).toBeUndefined()      // below 2
    expect(parseGuardThresholds('3, 51')).toBeUndefined()     // above 50
    expect(parseGuardThresholds('3, x')).toBeUndefined()      // not a number
    expect(parseGuardThresholds('')).toBeUndefined()          // empty
    expect(parseGuardThresholds('2,3,4,5,6,7')).toBeUndefined() // over 5
  })

  it('shows the real Guard counters, and — when the Host reports none', () => {
    const withStats = GuardPanel({
      t: (key: string) => key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
      stats: {
        observations: 128,
        outcomes: { success: 120, error: 8, cancelled: 0 },
        reminders: { repeat: 4, cycle: 1 },
        denials: 2,
        since: Date.UTC(2026, 10, 15, 1, 0),
      },
    }) as ReactElement
    const values = nodesWhere(withStats, node => node.props['data-guard-stat'] !== undefined)
      .map(node => node.props['data-guard-stat'] as string)
    expect(values.length).toBe(4)
    // Read the four value cells through the expanding helper: the board is its
    // own component, so a plain `walk` never reaches them.
    const cells = nodesWhere(withStats, node => node.props['data-guard-stat'] !== undefined)
    const valuesText = cells.map(node => {
      const kids = node.props.children as ReactNode[]
      const flat: string[] = []
      walk(kids as ReactNode, (inner) => {
        if (typeof inner.props.children === 'string') flat.push(inner.props.children)
      })
      return flat.join('|')
    })
    expect(valuesText.some(value => value.includes('128'))).toBe(true)
    expect(valuesText.some(value => value.includes('120 / 8'))).toBe(true)
    expect(valuesText.some(value => value.includes('4 / 1'))).toBe(true)
    // An older Host reports nothing: the board must read 「—」, never a fake 0.
    const withoutStats = GuardPanel({
      t: (key: string) => key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
    }) as ReactElement
    const bareCells = nodesWhere(withoutStats, node => node.props['data-guard-stat'] !== undefined)
    const bareText = bareCells.map(node => {
      const flat: string[] = []
      walk(node.props.children as ReactNode, (inner) => {
        if (typeof inner.props.children === 'string') flat.push(inner.props.children)
      })
      return flat.join('|')
    })
    // Four cells, each showing 「—」 and never a fabricated 0.
    expect(bareText).toHaveLength(4)
    expect(bareText.every(value => value.includes('—'))).toBe(true)
    expect(bareText.some(value => /\b0\b/.test(value))).toBe(false)
  })

  it('toggles a section through the callback', () => {
    const calls: Array<[string, boolean]> = []
    const element = GuardPanel({
      t: (key: string) => labels[key] ?? key,
      enabled: { duplicate_call: true, alternating_cycle: false, no_progress: true },
      duplicateThresholds: [3, 5, 8],
      onToggle: (id, next) => calls.push([id, next]),
    }) as ReactElement

    const switches: TreeNode[] = []
    walk(element, (node) => {
      if (node.props.role === 'switch') switches.push(node)
    })
    expect(switches).toHaveLength(3)
    for (const node of switches) (node.props.onClick as () => void)()
    expect(calls).toEqual([
      ['duplicate_call', false],
      ['alternating_cycle', true],
      ['no_progress', false],
    ])
  })
})

describe('callIndex wiring', () => {
  /** Names of the components actually mounted in a given panel. */
  function panelTypes(active: PluginCategory, extra: Partial<PluginSectionProps> = {}): Record<string, string[]> {
    const element = PluginSectionView({ ...props(), ...extra, active, onSelect: () => undefined }) as ReactElement
    const out: Record<string, string[]> = {}
    for (const child of element.props.children as Array<ReactElement | null | undefined>) {
      // The shared diagnostic box renders `null` when everything is healthy, so
      // the child list is not guaranteed to be all elements.
      if (child === null || child === undefined) continue
      const id = child.props.id as string | undefined
      if (id === undefined) continue
      const names: string[] = []
      walk(child.props.children as ReactNode, (node) => {
        const name = (node.type as { name?: string })?.name
        if (name !== undefined && name.length > 0) names.push(name)
      })
      out[id] = names
    }
    return out
  }

  it('mounts the callIndex panels when the namespace is available', () => {
    const types = panelTypes('overview', { callIndexRemote: () => ({}) as never })
    expect(types['mc-category-panel-overview']).toContain('CallIndexOverviewPanel')
    expect(types['mc-category-panel-usage']).toContain('CallIndexDetailPanel')
  })

  it('falls back to the legacy usage views only when callIndex is absent', () => {
    // No provider at all, and a legacy usage face present: an older Host must
    // still render something real rather than an empty page.
    const types = panelTypes('overview', { usageApi })
    expect(types['mc-category-panel-overview']).toContain('OverviewContainer')
    expect(types['mc-category-panel-usage']).toContain('UsagePanel')
  })

  it('does not fall back when a callIndex provider exists but resolves nothing yet', () => {
    // The namespace mounts after the section is constructed, so a provider that
    // returns undefined right now must NOT be read as "no callIndex support".
    const types = panelTypes('usage', { callIndexRemote: () => undefined })
    expect(types['mc-category-panel-usage']).toContain('CallIndexDetailPanel')
  })

  it('reuses one API object per provider, and a fresh one for a new provider', () => {
    // The earlier version of this case compared rendered component names, which
    // are identical no matter what the memo returns — it could not fail even
    // with the memo deleted. Compare the `api` prop identity instead.
    const usagePanelApi = (active: PluginCategory, extra: Partial<PluginSectionProps>): unknown => {
      const element = PluginSectionView({ ...props(), ...extra, active, onSelect: () => undefined }) as ReactElement
      // The diagnostic box contributes a `null` child when healthy.
      const panel = (element.props.children as Array<{ props: { id?: string; children: unknown } } | null | undefined>)
        .filter((child): child is { props: { id?: string; children: unknown } } => child !== null && child !== undefined)
        .find(child => child.props.id === 'mc-category-panel-usage')
      let captured: unknown
      walk(panel!.props.children as ReactNode, (node) => {
        if ((node.type as { name?: string })?.name === 'CallIndexDetailPanel') captured = node.props.api
      })
      return captured
    }

    const provider = () => undefined
    expect(usagePanelApi('usage', { callIndexRemote: provider })).toBe(usagePanelApi('usage', { callIndexRemote: provider }))
    // A different provider must get its own api, so a test (or a second section)
    // cannot inherit another provider's memoized bridge.
    expect(usagePanelApi('usage', { callIndexRemote: provider }))
      .not.toBe(usagePanelApi('usage', { callIndexRemote: () => undefined }))
  })

  /**
   * Everything above calls `PluginSectionView` directly, which is why the
   * container could drop `callIndexRemote` on the floor and still stay green:
   * the prop is optional, so `tsc` had nothing to complain about either. This
   * case drives the real registry entry point (`PluginSection`, the component
   * `settings.section` mounts) and would have caught that bug.
   */
  it('forwards callIndexRemote through the registered container, not just the view', () => {
    const provider = () => ({}) as never
    // The container renders `PluginSectionView` by returning its element, so the
    // tree is one level down: expand that element with the props it received.
    // This is exactly the hop that used to lose `callIndexRemote`.
    const rendered = mountThroughContainer({ ...props(), callIndexRemote: provider })
    const forwarded = rendered.props as PluginSectionProps
    expect(forwarded.callIndexRemote).toBe(provider)

    const view = PluginSectionView({ ...forwarded, active: 'usage', onSelect: () => undefined }) as ReactElement
    const panel = (view.props.children as Array<{ props: { id?: string; children: unknown } } | null | undefined>)
      .filter((child): child is { props: { id?: string; children: unknown } } => child !== null && child !== undefined)
      .find(child => child.props.id === 'mc-category-panel-usage')
    expect(panel).toBeDefined()
    const names: string[] = []
    walk(panel!.props.children as ReactNode, (node) => {
      const name = (node.type as { name?: string })?.name
      if (name !== undefined && name.length > 0) names.push(name)
    })
    expect(names).toContain('CallIndexDetailPanel')
    expect(names).not.toContain('UsagePanel')
  })
})

// ── v3 工具与技能（V3-c）─────────────────────────────────────
//
// These cases target the pure, hook-free presentation components that ReadyBody
// now composes. They assert the v3 structure the design specifies — the 4-cell
// `.v3-catstat`, the two-column `.v3-catgrid`, native `<details>` folding in
// `.v3-group`, the 10px `.v3-tag` tones, and the inline `.v3-uses` call count.
describe('工具与技能 v3 版式', () => {
  function tool(partial: Partial<CapabilityRow> & Pick<CapabilityRow, 'id' | 'name' | 'class'>): CapabilityRow {
    return { kind: 'tool', mandatory: false, ...partial } as CapabilityRow
  }

  /** Every element whose className contains the given token. */
  function byClass(root: ReactNode, token: string): TreeNode[] {
    const out: TreeNode[] = []
    walk(root, node => {
      const className = node.props.className
      if (typeof className === 'string' && className.split(/\s+/).includes(token)) out.push(node)
    })
    return out
  }

  /** Concatenate every string/number descendant, the way the DOM would read it. */
  function textOf(root: ReactNode): string {
    const parts: string[] = []
    const visit = (cur: ReactNode): void => {
      if (cur === null || cur === undefined || typeof cur === 'boolean') return
      if (typeof cur === 'string' || typeof cur === 'number') { parts.push(String(cur)); return }
      if (Array.isArray(cur)) { for (const child of cur) visit(child); return }
      if (!isElement(cur)) return
      visit((cur as unknown as TreeNode).props.children as ReactNode)
    }
    visit(root)
    return parts.join('')
  }

  it('renders the four-cell .v3-catstat strip (常驻 / 按需 / 禁用 / 零调用)', () => {
    const strip = CatalogStatStrip({
      cells: [
        { label: '常驻', value: 12 },
        { label: '按需', value: 13 },
        { label: '禁用', value: 4 },
        { label: '零调用', value: '—' },
      ],
    }) as ReactElement
    const [stat] = byClass(strip, 'v3-catstat')
    expect(stat).toBeDefined()
    const labelsCells = byClass(strip, 'v3-l')
    expect(labelsCells).toHaveLength(4)
    expect(labelsCells.map(node => node.props.children)).toEqual(['常驻', '按需', '禁用', '零调用'])
    const values = byClass(strip, 'v3-v')
    expect(values).toHaveLength(4)
    // A missing usage source stays an honest dash, never a fabricated 0.
    expect(textOf(values[3]!.props.children as ReactNode)).toBe('—')
  })

  it('keeps the zero-call cell hint 按已索引调用统计', () => {
    const strip = CatalogStatStrip({
      cells: [
        { label: '常驻', value: 6 },
        { label: '按需', value: 5 },
        { label: '禁用', value: 2 },
        { label: '零调用', value: 0, hint: '按已索引调用统计' },
      ],
    }) as ReactElement
    expect(byClass(strip, 'v3-catstat')).toHaveLength(1)
    const values = byClass(strip, 'v3-v')
    expect(textOf(values[3]!.props.children as ReactNode)).toContain('按已索引调用统计')
  })

  const groups = [{
    server: 'github',
    tools: [
      tool({ id: 'github.list_issues', name: 'mcp__github__list_issues', class: 'resident' }),
      tool({ id: 'github.create_issue', name: 'mcp__github__create_issue', class: 'on-demand', classLabel: 'On-demand' }),
      tool({ id: 'github.search_code', name: 'mcp__github__search_code', class: 'disabled' }),
    ],
  }]

  function renderTools(open: boolean, usage?: ReadonlyMap<string, CatalogUsage>): ReactElement {
    return ToolGroupsView({
      t: (key: string) => labels[key] ?? key,
      groups,
      openServers: open ? new Set(['github']) : new Set<string>(),
      busy: false,
      usage,
      onToggle: () => undefined,
      onCycle: () => undefined,
      onOpenDetail: () => undefined,
      onEditServer: () => undefined,
      onEditSearch: () => undefined,
    }) as ReactElement
  }

  it('lays the server groups out in a two-column .v3-catgrid', () => {
    const tree = renderTools(false)
    expect(byClass(tree, 'v3-catgrid')).toHaveLength(1)
    expect(byClass(tree, 'v3-group')).toHaveLength(1)
  })

  it('folds each group with a native <details>/<summary> and a .v3-chev', () => {
    const collapsed = renderTools(false)
    const [groupClosed] = byClass(collapsed, 'v3-group')
    expect(groupClosed?.type).toBe('details')
    expect(groupClosed?.props.open).toBe(false)
    // Nothing renders while folded.
    expect(byClass(collapsed, 'v3-trow')).toHaveLength(0)

    const expanded = renderTools(true)
    const [groupOpen] = byClass(expanded, 'v3-group')
    expect(groupOpen?.type).toBe('details')
    expect(groupOpen?.props.open).toBe(true)
    expect(byClass(expanded, 'v3-chev')).toHaveLength(1)
    expect(byClass(expanded, 'v3-trow')).toHaveLength(3)
  })

  it('labels class chips as 11px .v3-tag with data-tone info|warn|bad', () => {
    const tree = renderTools(true)
    const tones = byClass(tree, 'v3-tag')
      .map(node => node.props['data-tone'])
      .filter(tone => tone !== undefined)
    expect(tones).toContain('info')  // resident
    expect(tones).toContain('warn')  // on-demand
    expect(tones).toContain('bad')   // disabled
  })

  it('shows each tool inline call count in .v3-uses when usage is present', () => {
    const usage = new Map<string, CatalogUsage>([
      ['github.list_issues', { uses: 132 }],
      ['github.create_issue', { uses: 7, failures: 4 }],
    ])
    const tree = renderTools(true, usage)
    const uses = byClass(tree, 'v3-uses')
    expect(uses).toHaveLength(2)
    expect(textOf(uses[0]!.props.children as ReactNode)).toContain('132')
    expect(textOf(uses[1]!.props.children as ReactNode)).toContain('7')
    expect(textOf(uses[1]!.props.children as ReactNode)).toContain('失败 4')
    // Without a usage source no count element is fabricated.
    expect(byClass(renderTools(true), 'v3-uses')).toHaveLength(0)
  })
})
describe('工具与技能 · 调用次数接线', () => {
  const catalogPanel = (view: ReactElement): { props: { id?: string; children: unknown } } | undefined =>
    (view.props.children as Array<{ props: { id?: string; children: unknown } } | null | undefined>)
      .filter((child): child is { props: { id?: string; children: unknown } } => child !== null && child !== undefined)
      .find(child => child.props.id === 'mc-category-panel-catalog')

  it('passes the call-index usage map down to the catalog', () => {
    const usage = new Map([['read', { uses: 12, failures: 1 }]])
    const view = PluginSectionView({ ...props(), catalogUsage: usage, active: 'catalog', onSelect: () => undefined }) as ReactElement
    const panel = catalogPanel(view)
    expect(panel).toBeDefined()
    const catalog = find(panel!.props.children as ReactNode, node => (node.type as { name?: string })?.name === 'CapabilitySection')
    expect(catalog).toBeDefined()
    expect(catalog!.props.usage).toBe(usage)
  })

  it('omits usage when no corpus was read, so the page shows an honest dash', () => {
    const view = PluginSectionView({ ...props(), active: 'catalog', onSelect: () => undefined }) as ReactElement
    const panel = catalogPanel(view)
    const catalog = find(panel!.props.children as ReactNode, node => (node.type as { name?: string })?.name === 'CapabilitySection')
    expect(catalog).toBeDefined()
    expect(catalog!.props.usage).toBeUndefined()
  })
})

describe('执行保护 · active 接线', () => {
  it('tells the Guard page whether it is the visible tab', () => {
    // The container must only poll its counters while the 执行保护 tab is the one
    // on screen. The pure view is hook-free, so this asserts the prop it hands
    // down; the mounted container proves it actually stops the timer.
    const guardOn = find(render('guard'), element => element.type === GuardContainer)
    expect((guardOn?.props as { active?: boolean } | undefined)?.active).toBe(true)
    for (const category of ['overview', 'catalog', 'usage'] as const) {
      const guardOff = find(render(category), element => element.type === GuardContainer)
      expect((guardOff?.props as { active?: boolean } | undefined)?.active).toBe(false)
    }
  })
})

// ── TG-10：工具目录调用统计的完整性口径 ─────────────────────────────
function callPage(
  items: Array<{ toolName: string; outcome?: string }>,
  extra: Partial<CallIndexCallPageView> = {},
): CallIndexCallPageView {
  return {
    snapshotId: 'snap',
    generation: 1,
    coverage: 'complete',
    summary: { total: items.length, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0 },
    items: items.map((item, index) => ({
      sessionId: 's',
      callSeq: index,
      callId: 'c' + index,
      toolName: item.toolName,
      startedAt: 1000,
      outcome: (item.outcome ?? 'success') as never,
      inherited: false,
      sourceKind: 'unknown' as never,
      layer: 'unknown',
    })),
    droppedItems: 0,
    ...extra,
  } as unknown as CallIndexCallPageView
}

describe('工具目录调用统计 · TG-10 完整性', () => {
  it('aggregates every page and publishes exact per-tool counts only when complete', () => {
    const p1 = callPage([{ toolName: 'read_file' }, { toolName: 'read_file', outcome: 'error' }], { total: 3, nextCursor: 'c1' })
    const p2 = callPage([{ toolName: 'ops_bash' }], { total: 3 })
    const agg = summarizeCatalogUsage([p1, p2])
    expect(agg.completeness.complete).toBe(true)
    expect(agg.completeness.readCalls).toBe(3)
    expect(agg.usage?.get('read_file')).toEqual({ uses: 2, failures: 1 })
    expect(agg.usage?.get('ops_bash')).toEqual({ uses: 1 })
    // A tool that was simply not seen is an absent key, never an invented zero.
    expect(agg.usage?.has('never_called')).toBe(false)
  })

  it('does not fabricate zero when the page cap truncates the read', () => {
    const agg = summarizeCatalogUsage(
      [callPage([{ toolName: 'read_file' }], { total: 1001, nextCursor: 'more' })],
      { truncated: true },
    )
    expect(agg.usage).toBeUndefined()
    expect(agg.completeness.complete).toBe(false)
    expect(agg.completeness.hasMore).toBe(true)
    expect(agg.completeness.truncated).toBe(true)
  })

  it('treats partial coverage, dropped rows or a total mismatch as unknown', () => {
    const partial = summarizeCatalogUsage([callPage([{ toolName: 'x' }], { total: 1, coverage: 'partial' })])
    expect(partial.usage).toBeUndefined()
    expect(partial.completeness.complete).toBe(false)

    const dropped = summarizeCatalogUsage([callPage([{ toolName: 'x' }], { total: 1, droppedItems: 2 })])
    expect(dropped.usage).toBeUndefined()

    const mismatch = summarizeCatalogUsage([callPage([{ toolName: 'x' }], { total: 5 })])
    expect(mismatch.usage).toBeUndefined()
    expect(mismatch.completeness.readCalls).toBe(1)
    expect(mismatch.completeness.total).toBe(5)
  })

  it('honours the 1000-call read budget boundary (complete at the edge, unknown past it)', () => {
    const page = (cursor?: string): CallIndexCallPageView => callPage(
      Array.from({ length: 50 }, () => ({ toolName: 'read_file' })),
      { total: 1000, ...(cursor === undefined ? {} : { nextCursor: cursor }) },
    )
    const exact = Array.from({ length: 20 }, (_, i) => page(i < 19 ? 'c' + i : undefined))
    const okAgg = summarizeCatalogUsage(exact)
    expect(okAgg.completeness.complete).toBe(true)
    expect(okAgg.completeness.readCalls).toBe(1000)

    const over = Array.from({ length: 20 }, (_, i) => page('c' + i))
    const overAgg = summarizeCatalogUsage(over, { truncated: true })
    expect(overAgg.usage).toBeUndefined()
    expect(overAgg.completeness.hasMore).toBe(true)
    expect(CATALOG_USAGE_MAX_PAGES).toBe(200)
  })
})

// ── TG-12：共享索引状态轮询的恢复口径 ───────────────────────────────
//
// 第七批统一口径：这里曾经有自己的 "is it scanning" 定义
// （`phase === 'running' || pending > 0 || pendingLive > 0`），而 调用明细
// 用的是 `callIndexScanActive`。两者对「容量暂停」和「只剩积压」给出相反答案：
// 暂停/仅积压时明细页判终态，共享诊断框却仍按 3s 轮询空转。现在只有一个定义。
function statusOf(partialStatus: {
  phase?: string
  pending?: number
  pendingLive?: number
  paused?: boolean
  auto?: 'idle' | 'scheduled' | 'running' | 'stopped'
  scopeReady?: boolean
}): CallIndexStatusView {
  return {
    scope: partialStatus.scopeReady === false
      ? { status: 'disabled', mode: 'disabled', reason: 'not-enabled' }
      : { status: 'ready', mode: 'host-visible' },
    generation: 1,
    censusGeneration: 1,
    phase: (partialStatus.phase ?? 'idle') as never,
    coverage: 'complete',
    eventCoverage: 'complete',
    enumerationCoverage: 'complete',
    semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
    sessions: {
      listed: 0,
      visible: 0,
      completed: 0,
      pending: partialStatus.pending ?? 0,
      failed: 0,
      pendingLive: partialStatus.pendingLive ?? 0,
    },
    estimatedBytes: 0,
    reasons: [],
    ...(partialStatus.paused === undefined ? {} : { paused: partialStatus.paused }),
    // An old Host omits `auto` entirely; that absence is exercised below.
    ...(partialStatus.auto === undefined ? {} : { auto: { state: partialStatus.auto, round: 1 } }),
    totals: { calls: 0, succeeded: 0, failed: 0, unresolved: 0, unknown: 0, cancelled: 0, running: 0, inherited: 0 },
  } as unknown as CallIndexStatusView
}

describe('共享索引状态轮询 · TG-12 恢复', () => {
  it('keeps a fast cadence while scanning and a slow-but-nonzero cadence once terminal', () => {
    expect(isIndexScanning(statusOf({ phase: 'running' }))).toBe(true)
    expect(isIndexScanning(statusOf({ phase: 'complete' }))).toBe(false)
    expect(indexStatusPollDelay({ ok: true, value: statusOf({ phase: 'running' }) }, 0)).toBe(INDEX_STATUS_POLL_SCANNING_MS)
    const idle = indexStatusPollDelay({ ok: true, value: statusOf({ phase: 'complete' }) }, 0)
    expect(idle).toBe(INDEX_STATUS_POLL_IDLE_MS)
    expect(idle).toBeGreaterThan(0)
  })

  it('does not call a leftover backlog "scanning" — the fourth-batch definition', () => {
    // A finished pass that left Sessions unread owes work; it is not activity.
    // The old definition returned true here and the 3s timer span forever.
    expect(isIndexScanning(statusOf({ phase: 'complete', pending: 6 }))).toBe(false)
    expect(isIndexScanning(statusOf({ phase: 'partial', pending: 6 }))).toBe(false)
    // A live queue alone is likewise owed work, not a running scan.
    expect(isIndexScanning(statusOf({ phase: 'complete', pendingLive: 2 }))).toBe(false)
    for (const status of [
      statusOf({ phase: 'complete', pending: 6 }),
      statusOf({ phase: 'complete', pendingLive: 2 }),
      statusOf({ phase: 'partial', pending: 32, pendingLive: 3 }),
    ]) {
      expect(indexStatusPollDelay({ ok: true, value: status }, 0)).toBe(INDEX_STATUS_POLL_IDLE_MS)
    }
  })

  it('treats a capacity pause as terminal-but-observed, never as 3s activity', () => {
    const paused = statusOf({
      phase: 'partial',
      paused: true,
      pending: 6,
      pendingLive: 3,
      auto: 'stopped',
    })
    expect(isIndexScanning(paused)).toBe(false)
    expect(indexStatusPollDelay({ ok: true, value: paused }, 0)).toBe(INDEX_STATUS_POLL_IDLE_MS)
    // The pause is resumable, so the terminal cadence must stay nonzero.
    expect(INDEX_STATUS_POLL_IDLE_MS).toBeGreaterThan(0)
  })

  it('never paints activity without a readable scope', () => {
    expect(isIndexScanning(statusOf({ phase: 'running', scopeReady: false }))).toBe(false)
    expect(indexStatusPollDelay({ ok: true, value: statusOf({ phase: 'running', scopeReady: false }) }, 0))
      .toBe(INDEX_STATUS_POLL_IDLE_MS)
  })

  it('follows the automatic scheduler when the Host reports one', () => {
    // Between passes: another pass is queued, so this is still activity.
    expect(isIndexScanning(statusOf({ phase: 'complete', auto: 'scheduled' }))).toBe(true)
    expect(isIndexScanning(statusOf({ phase: 'idle', auto: 'running' }))).toBe(true)
    // A stopped or idle scheduler is terminal even with a backlog left over.
    expect(isIndexScanning(statusOf({ phase: 'complete', pending: 9, auto: 'stopped' }))).toBe(false)
    expect(isIndexScanning(statusOf({ phase: 'complete', pending: 9, auto: 'idle' }))).toBe(false)
    expect(indexStatusPollDelay({ ok: true, value: statusOf({ phase: 'complete', auto: 'scheduled' }) }, 0))
      .toBe(INDEX_STATUS_POLL_SCANNING_MS)
    expect(indexStatusPollDelay({ ok: true, value: statusOf({ phase: 'complete', pending: 9, auto: 'stopped' }) }, 0))
      .toBe(INDEX_STATUS_POLL_IDLE_MS)
  })

  it('stays conservative on an older Host that reports no scheduler', () => {
    // Old Host: no `auto` at all. Only a running pass can claim activity, so a
    // backlog — even a live one — must not spin the shared timer at 3s.
    expect(isIndexScanning(statusOf({ phase: 'idle', pendingLive: 5 }))).toBe(false)
    expect(isIndexScanning(statusOf({ phase: 'idle', pending: 5 }))).toBe(false)
    expect(isIndexScanning(statusOf({ phase: 'running' }))).toBe(true)
    expect(indexStatusPollDelay({ ok: true, value: statusOf({ phase: 'idle', pendingLive: 5 }) }, 0))
      .toBe(INDEX_STATUS_POLL_IDLE_MS)
  })

  it('retries after a failure with a capped backoff instead of stopping forever', () => {
    expect(indexStatusPollDelay({ ok: false }, 1)).toBe(INDEX_STATUS_POLL_ERROR_BASE_MS)
    expect(indexStatusPollDelay({ ok: false }, 2)).toBe(INDEX_STATUS_POLL_ERROR_BASE_MS * 2)
    expect(indexStatusPollDelay({ ok: false }, 30)).toBe(INDEX_STATUS_POLL_ERROR_MAX_MS)
    expect(indexStatusPollDelay({ ok: false }, 30)).toBeGreaterThan(0)
    // The cap is a ceiling, not a stop: it is still a finite retry delay.
    expect(INDEX_STATUS_POLL_ERROR_MAX_MS).toBe(30000)
  })

  it('reloads the catalog exactly on the scan→terminal transition', () => {
    // A mount read already happened: undefined→terminal does not double-read.
    expect(shouldReloadCatalog(undefined, false)).toBe(false)
    expect(shouldReloadCatalog(false, false)).toBe(false)
    expect(shouldReloadCatalog(true, true)).toBe(false)
    expect(shouldReloadCatalog(true, false)).toBe(true)
    // The edge is defined on the UNIFIED predicate, so a pause is an edge too.
    expect(shouldReloadCatalog(isIndexScanning(statusOf({ phase: 'running' })), isIndexScanning(statusOf({ phase: 'partial', paused: true }))))
      .toBe(true)
  })
})

// ── 第七批：真实 mounted 的共享轮询（jsdom + fake timers）────────────────
//
// The helper cases above prove the PREDICATE. These prove the TIMER: the shared
// diagnostic box used to re-arm itself every 3s whenever `pending`/`pendingLive`
// was non-zero, so a capacity pause — which 调用明细 already renders as a terminal
// 「可恢复」 story — kept a 3s status request running forever on every tab.
//
// A cadence cannot be observed on an unmounted element tree, so this block mounts
// the real container (`settings.section`'s own entry point) with fake timers.
// It asserts the observable consequence, not an implementation detail: how many
// status reads the timer actually issues, and how many times the catalog usage
// map is re-read on the scan→terminal edge.

const POLL_SUMMARY = {
  total: 0, success: 0, error: 0, cancelled: 0, unresolved: 0, unknown: 0, running: 0, inherited: 0,
}

const POLL_META = {
  snapshotId: 'snap-poll',
  generation: 1,
  coverage: 'complete' as const,
  totalExact: true,
}

/** One wire-valid status payload; the real projector decides whether it parses. */
function wireStatus(options: {
  phase?: string
  pending?: number
  pendingLive?: number
  paused?: boolean
  auto?: 'idle' | 'scheduled' | 'running' | 'stopped'
}): Record<string, unknown> {
  return {
    ...POLL_META,
    censusGeneration: 1,
    phase: options.phase ?? 'idle',
    eventCoverage: 'complete',
    enumerationCoverage: 'complete',
    semanticCoverage: { source: 'unknown', ptc: 'unknown', skillExecution: 'unavailable', denied: 'unavailable' },
    listedSessions: 0,
    visibleSessions: 0,
    completedSessions: 0,
    pendingSessions: options.pending ?? 0,
    failedSessions: 0,
    pendingLive: options.pendingLive ?? 0,
    estimatedBytes: 0,
    reasons: [],
    totals: POLL_SUMMARY,
    scope: { status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 },
    ...(options.paused === undefined ? {} : { paused: options.paused }),
    ...(options.auto === undefined ? {} : { auto: { state: options.auto, round: 1 } }),
  }
}

const POLL_ROW = {
  sessionId: 'sess-poll',
  callSeq: 1,
  callId: 'call-poll-1',
  toolName: 'read_file',
  startedAt: 1_700_000_000_000,
  outcome: 'success' as const,
  inherited: false,
  sourceKind: 'native' as const,
  layer: 'unknown',
}

/**
 * Build a reply the REAL wire projector accepts.
 *
 * Using the projector (not a hand-built envelope) matters: a payload the Host
 * would reject must fail here too, or these cases would prove a cadence for a
 * status the page can never receive.
 */
function wireReply(kind: 'status' | 'calls' | 'sessions' | 'summary', data: Record<string, unknown>): unknown {
  const reply = callIndexReply({ schemaVersion: 1, ok: true, kind, data })
  if ((reply as { ok?: boolean }).ok !== true) throw new Error('wire rejected the ' + kind + ' payload: ' + JSON.stringify(reply))
  return reply
}

interface PollHarness {
  readonly face: CallIndexRemoteFace
  readonly statusReads: () => number
  setStatus(next: Record<string, unknown>): void
}

function pollHarness(initial: Record<string, unknown>): PollHarness {
  let statusData = initial
  let statusReads = 0
  const face: CallIndexRemoteFace = {
    getIndexStatus: async () => {
      statusReads += 1
      return { ok: true as const, value: wireReply('status', statusData) as never }
    },
    // One complete page: the catalog's bounded read must publish a real map, so
    // a re-read is observable as a NEW map identity (and a non-read as none).
    listCalls: async () => ({
      ok: true as const,
      value: wireReply('calls', {
        ...POLL_META,
        summary: { ...POLL_SUMMARY, total: 1, success: 1 },
        total: 1,
        items: [POLL_ROW],
      }) as never,
    }),
    listSessions: async () => ({
      ok: true as const,
      value: wireReply('sessions', { ...POLL_META, summary: POLL_SUMMARY, total: 0, items: [] }) as never,
    }),
    getSummary: async () => ({
      ok: true as const,
      value: wireReply('summary', { ...POLL_META, summary: POLL_SUMMARY, total: 0 }) as never,
    }),
    // The mounted cases never open a detail pane; leaving the method out is the
    // documented "older Host exposes fewer methods" path.
  }
  return {
    face,
    statusReads: () => statusReads,
    setStatus: (next) => { statusData = next },
  }
}

let pollRoot: Root | undefined
let pollHost: HTMLDivElement | undefined

async function mountPolled(face: CallIndexRemoteFace): Promise<HTMLDivElement> {
  pollHost = document.createElement('div')
  document.body.appendChild(pollHost)
  pollRoot = createRoot(pollHost)
  await act(async () => {
    pollRoot!.render(React.createElement(PluginSection, { ...props(), callIndexRemote: () => face }))
  })
  return pollHost
}

/** How many DISTINCT usage maps the catalog has been handed (one per real re-read). */
function distinctUsageMaps(): number {
  const seen = new Set<unknown>()
  for (const render of catalogRenders.props) {
    if (render.usage !== undefined) seen.add(render.usage)
  }
  return seen.size
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

afterEach(async () => {
  vi.useRealTimers()
  if (pollRoot !== undefined) {
    const current = pollRoot
    pollRoot = undefined
    await act(async () => { current.unmount() })
  }
  pollHost?.remove()
  pollHost = undefined
  catalogRenders.props.length = 0
})

describe('共享索引状态轮询 · 第七批 mounted 口径', () => {
  it('a capacity pause does not re-arm the 3s timer, but the 15s observation still runs', async () => {
    vi.useFakeTimers()
    const harness = pollHarness(wireStatus({ phase: 'partial', paused: true, pending: 6, pendingLive: 3, auto: 'stopped' }))
    await mountPolled(harness.face)
    const afterMount = harness.statusReads()
    // The whole defect: the old predicate saw pending/pendingLive > 0 and fired
    // a status read every 3s while 调用明细 had already settled on 「可恢复」.
    await advance(INDEX_STATUS_POLL_SCANNING_MS)
    expect(harness.statusReads()).toBe(afterMount)
    // Terminal is slower, never stopped: one more observation by the 15s mark.
    await advance(INDEX_STATUS_POLL_IDLE_MS)
    expect(harness.statusReads()).toBe(afterMount + 1)
    // No catalog re-read ever happened: there was no scan→terminal edge to cross.
    expect(distinctUsageMaps()).toBe(1)
  })

  it('stays terminal for an older Host that reports only a live backlog', async () => {
    vi.useFakeTimers()
    const harness = pollHarness(wireStatus({ phase: 'idle', pendingLive: 5 }))
    await mountPolled(harness.face)
    const afterMount = harness.statusReads()
    await advance(INDEX_STATUS_POLL_SCANNING_MS)
    expect(harness.statusReads()).toBe(afterMount)
    await advance(INDEX_STATUS_POLL_IDLE_MS)
    expect(harness.statusReads()).toBe(afterMount + 1)
  })

  it('re-reads the catalog exactly once on the real scan→terminal edge', async () => {
    vi.useFakeTimers()
    const harness = pollHarness(wireStatus({ phase: 'running', pending: 6, auto: 'running' }))
    await mountPolled(harness.face)
    // The mount read already produced one usage map.
    expect(distinctUsageMaps()).toBe(1)
    // Still scanning: the 3s tick must NOT re-read the catalog.
    await advance(INDEX_STATUS_POLL_SCANNING_MS)
    expect(distinctUsageMaps()).toBe(1)
    // The Host finishes its pass. The next tick crosses the edge.
    harness.setStatus(wireStatus({ phase: 'complete', auto: 'stopped' }))
    await advance(INDEX_STATUS_POLL_SCANNING_MS)
    expect(distinctUsageMaps()).toBe(2)
    // Exactly once: neither the next 3s window nor a later 15s observation
    // re-reads again, because the edge only fires on true→false.
    await advance(INDEX_STATUS_POLL_SCANNING_MS)
    expect(distinctUsageMaps()).toBe(2)
    await advance(INDEX_STATUS_POLL_IDLE_MS)
    expect(distinctUsageMaps()).toBe(2)
  })
})
