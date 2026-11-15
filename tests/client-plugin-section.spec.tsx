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

// The shell tests are about the tab bar and which views stay mounted, so the
// heavy catalog view is stubbed out. The pure v3 catalog pieces (CatalogStatStrip
// / ToolGroupsView) are NOT stubbed — the mock spreads the real module and only
// replaces `CapabilitySection`, so the catalog assertions below can call them
// directly (same hook-free pattern as `GuardPanel`).
vi.mock('../src/client/CapabilitySection.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/CapabilitySection.tsx')>()
  return { ...actual, CapabilitySection: function CapabilitySection() { return null } }
})

import {
  PluginSection,
  PluginSectionView,
  type PluginCategory,
  type PluginSectionProps,
} from '../src/client/PluginSection.tsx'
import { UsagePanel, type UsagePanelApi } from '../src/client/usage.tsx'
import { OverviewContainer } from '../src/client/OverviewContainer.tsx'
import { GuardPanel, parseGuardThresholds } from '../src/client/GuardPanel.tsx'
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
 * depend on seeing `PluginSectionView` as a single node. The Guard board and
 * threshold editor are separate hook-free components, so their contents are
 * only reachable through this variant.
 */
function nodesWhere(node: ReactNode, predicate: (element: TreeNode) => boolean): TreeNode[] {
  const out: TreeNode[] = []
  const visit = (current: ReactNode): void => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (Array.isArray(current)) { for (const child of current) visit(child); return }
    if (!isElement(current)) return
    const element = current as unknown as TreeNode
    if (predicate(element)) out.push(element)
    if (typeof element.type === 'function') {
      visit((element.type as (props: unknown) => ReactNode)(element.props))
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
    // The thresholds are now three number steppers (v3.1) instead of one
    // comma-separated text field, so the same edit affordance is three inputs.
    const field = nodesWhere(element, node => node.type === 'input')
    expect(field).toHaveLength(3)
    expect(field.map(node => node.props.value)).toEqual(['3', '5', '8'])
    expect(field.every(node => node.props.readOnly !== true)).toBe(true)
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
    // The value lives on the <input>, so it is read from props rather than from
    // text nodes — and the helper must expand the editor component to reach it.
    const field = nodesWhere(element, node => node.type === 'input')
    expect(field.map(node => node.props.value)).toEqual(['3', '5', '8'])
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
