/**
 * Rules for the single combined settings page.
 *
 * Same constraint as `client-usage.spec.tsx`: this package has no DOM harness,
 * so the component is inspected as an element tree rather than mounted. What
 * matters here is the shell's contract — one page, one tab bar keyed to
 * categories in the product-specified order, and every view present so none
 * loses its subscriptions.
 */
import { describe, expect, it, vi } from 'vitest'
import { isValidElement } from 'react'
import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'

// `CapabilitySection.tsx` pulls in `@deepseek-ai/dsh-client-ui-primitives`, whose
// runtime dependency on `clsx` is not installed in this package's test
// environment. This test is about the SHELL (tabs + which views stay mounted),
// so the heavy view is stubbed; `client-usage.spec.tsx` already covers usage.
vi.mock('../src/client/CapabilitySection.tsx', () => ({
  CapabilitySection: function CapabilitySection() { return null },
}))

import {
  PluginSection,
  PluginSectionView,
  type PluginCategory,
  type PluginSectionProps,
} from '../src/client/PluginSection.tsx'
import { UsagePanel, type UsagePanelApi } from '../src/client/usage.tsx'
import { OverviewContainer } from '../src/client/OverviewContainer.tsx'
import { GuardPanel } from '../src/client/GuardPanel.tsx'
import { GuardContainer } from '../src/client/GuardContainer.tsx'
import type { CapabilitySectionInjected } from '../src/client/CapabilitySection.tsx'

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

  it('still renders the fixed thresholds for section A only', () => {
    const element = GuardPanel({
      t: (key: string) => key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
    }) as ReactElement
    const text: string[] = []
    walk(element, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    const thresholdLines = text.filter(value => value.includes('3 / 5 / 8'))
    expect(thresholdLines).toHaveLength(1)
  })

  it('keeps the threshold line free of Chinese-only punctuation', () => {
    // The label and the numbers are separate nodes on purpose. Interpolating them
    // into one string forced a literal `：`, which then leaked into the English
    // UI as "Repeat reminder thresholds：3 / 5 / 8".
    const element = GuardPanel({
      t: (key: string) => labels[key] ?? key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
    }) as ReactElement

    const text: string[] = []
    walk(element, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    const thresholdLine = text.find(value => value.includes('3 / 5 / 8'))
    expect(thresholdLine).toBe('3 / 5 / 8')
    expect(text.some(value => value.includes('：'))).toBe(false)
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
