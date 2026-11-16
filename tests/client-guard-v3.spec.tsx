/**
 * v3 执行保护（D-044 / README 5.3 ②）— the Guard switches become a two-column
 * grid of .v3-gitem cards, with the counters at the very top.
 *
 * Same constraint as the other client specs: this package has no DOM harness, so
 * the component is inspected as an element tree rather than mounted. This file
 * asserts the v3 SHAPE; the published DOM contract (nine mc-guard-point,
 * data-guard-section order, the counters) is also exercised by
 * client-plugin-section.spec.tsx, which this change must not touch.
 */
import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { GuardPanel, HOOK_COMPONENT, type GuardPanelProps } from '../src/client/GuardPanel.tsx'

interface TreeNode {
  readonly type: unknown
  readonly props: Record<string, unknown>
}

function isElement(value: unknown): value is ReactElement {
  return isValidElement(value)
}

/** Depth-first walk that does NOT expand function components. */
function walk(node: ReactNode, visit: (element: TreeNode) => void): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  if (!isElement(node)) return
  const element = node as unknown as TreeNode
  visit(element)
  walk(element.props.children as ReactNode, visit)
}

/**
 * Every element matching 'predicate', EXPANDING function components.
 *
 * One exception, and only one: a component tagged with `HOOK_COMPONENT` calls
 * hooks, so calling it here (outside a render) would throw "Invalid hook call".
 * Such a component is SKIPPED — the walk keeps expanding every other component,
 * so no hook-free assertion is weakened. The tagged component's own behaviour is
 * covered by real jsdom mounts in tests/tg-draft-editor.spec.tsx.
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

function classHas(node: TreeNode, name: string): boolean {
  const value = node.props.className
  return typeof value === 'string' && value.split(/\s+/).includes(name)
}

/** Concatenated string children under 'node' (plain walk, no component expansion). */
function textOf(node: ReactNode | TreeNode): string {
  let out = ''
  walk(node as ReactNode, (element) => {
    const child = element.props.children
    if (typeof child === 'string') out += child
  })
  return out
}

function countSwitches(node: ReactNode | TreeNode): number {
  let count = 0
  walk(node as ReactNode, (element) => { if (element.props.role === 'switch') count += 1 })
  return count
}

function render(overrides: Partial<GuardPanelProps> = {}): ReactElement {
  return GuardPanel({
    // Resolve just the scope-title key so the assertion below reads like the UI.
    t: (key: string) => (key === 'guardScopeTitle' ? '生效范围' : key),
    enabled: { duplicate_call: true, alternating_cycle: false, no_progress: true },
    duplicateThresholds: [3, 5, 8],
    ...overrides,
  }) as ReactElement
}

/** The four direct children of the .v3-gpanel grid (three cards + scope note). */
function guardGrid(el: ReactElement): TreeNode[] {
  const panels = nodesWhere(el, (node) => classHas(node, 'v3-gpanel'))
  expect(panels).toHaveLength(1)
  const children = panels[0].props.children as ReactNode[]
  expect(Array.isArray(children)).toBe(true)
  expect(children).toHaveLength(4)
  return children.map((child) => child as unknown as TreeNode)
}

interface Stats {
  observations: number
  outcomes: { success: number; error: number; cancelled: number }
  reminders: { repeat: number; cycle: number }
  denials: number
  since: number
}

const sampleStats: Stats = {
  observations: 128,
  outcomes: { success: 120, error: 8, cancelled: 0 },
  reminders: { repeat: 4, cycle: 1 },
  denials: 2,
  since: Date.UTC(2026, 10, 15, 1, 0),
}

describe('v3 执行保护卡片', () => {
  it('lays the switches out as a .v3-gpanel of four .v3-gitem cells', () => {
    const grid = guardGrid(render())
    for (const cell of grid) {
      expect(isElement(cell)).toBe(true)
      expect(classHas(cell, 'v3-gitem')).toBe(true)
    }
  })

  it('keeps the three sections in product order, each its own card', () => {
    const ids = nodesWhere(render(), (node) => node.props['data-guard-section'] !== undefined)
      .map((node) => node.props['data-guard-section'])
    expect(ids).toEqual(['duplicate_call', 'alternating_cycle', 'no_progress'])
  })

  it('keeps nine mc-guard-point bullets across the three cards', () => {
    const bullets = nodesWhere(render(), (node) => classHas(node, 'mc-guard-point'))
    expect(bullets).toHaveLength(9)
  })

  it('keeps ONE threshold wrapper, in section A only, and hands it the Host list', () => {
    const wrap = nodesWhere(render(), (node) => node.props['data-guard-thresholds'] === 'true')
    expect(wrap).toHaveLength(1)
    // The wrapper lives in this hook-free view, so the walk sees it directly; the
    // boxes inside are owned by the draft hook component, whose real behaviour is
    // asserted by jsdom mounts in tg-draft-editor.spec.tsx.
    expect(wrap[0].props['data-guard-thresholds-values']).toBe('3,5,8')
    expect(wrap[0].props['data-guard-thresholds-count']).toBe('3')
    expect(wrap[0].props['data-guard-thresholds-editable']).toBe('false')
  })

  it('tags the threshold editor as a hook component so tree walkers skip it', () => {
    // The editor owns a draft (useState/useRef/useEffect). A walker that calls it
    // outside a render would throw, so the tag is part of the contract; its real
    // typing/commit behaviour is asserted in tg-draft-editor.spec.tsx.
    const editor = nodesWhere(render(), (node) => typeof node.type === 'function' && node.props['data-guard-thresholds'] === undefined && (node.type as unknown as Record<symbol, boolean>)[HOOK_COMPONENT] === true)
    expect(editor.length).toBe(1)
    // …and no <input> is reachable without expanding it.
    expect(nodesWhere(render(), (node) => node.type === 'input')).toHaveLength(0)
  })

  it('puts one guardFired counter at each card foot, mapped per section', () => {
    const withStats = guardGrid(render({ stats: sampleStats }))
    const firedOf = (cell: TreeNode): unknown[] => {
      const hits: unknown[] = []
      walk(cell as unknown as ReactNode, (node) => { if (classHas(node, 'v3-kbd')) hits.push(node.props.children) })
      return hits
    }
    // A = reminders.repeat, B = reminders.cycle, C = denials.
    expect(firedOf(withStats[0])).toEqual(['4'])
    expect(firedOf(withStats[1])).toEqual(['1'])
    expect(firedOf(withStats[2])).toEqual(['2'])
  })

  it('shows — for a card with no reported counter, never a fake zero', () => {
    const bare = guardGrid(render())
    for (let index = 0; index < 3; index += 1) {
      const hits: unknown[] = []
      walk(bare[index] as unknown as ReactNode, (node) => { if (classHas(node, 'v3-kbd')) hits.push(node.props.children) })
      expect(hits).toEqual(['—'])
    }
  })

  it('states each card’s purpose / threshold hint', () => {
    const text = textOf(render())
    expect(text).toContain('guardPurposeB')
    expect(text).toContain('guardPurposeC')
    expect(text).toContain('guardThresholdHint')
    expect(text).toContain('guardFired')
  })

  it('keeps the four-cell guard counter board and the short boundary hint', () => {
    const cells = nodesWhere(render(), (node) => node.props['data-guard-stat'] !== undefined)
    expect(cells).toHaveLength(4)
    const boards = nodesWhere(render(), (node) => node.props['data-guard-stats'] === 'true')
    expect(boards).toHaveLength(1)

    const withStats = render({ stats: sampleStats })
    const values = nodesWhere(withStats, (node) => node.props['data-guard-stat'] !== undefined)
      .map((node) => {
        const flat: string[] = []
        walk(node.props.children as ReactNode, (inner) => {
          if (typeof inner.props.children === 'string') flat.push(inner.props.children)
        })
        return flat.join('|')
      })
    expect(values.some((value) => value.includes('128'))).toBe(true)
    expect(values.some((value) => value.includes('120 / 8'))).toBe(true)
    expect(values.some((value) => value.includes('4 / 1'))).toBe(true)

    // One short boundary hint, and no "counting since" line.
    const hints = nodesWhere(render(), (node) => classHas(node, 'v3-hint') && node.props.children === 'guardBoundaryShort')
    expect(hints).toHaveLength(1)
    expect(nodesWhere(render({ stats: sampleStats }), (node) => node.props['data-guard-stats-since'] !== undefined))
      .toHaveLength(0)
  })

  it('drops the in-page title and activity sub-title', () => {
    const el = GuardPanel({
      t: (key: string) => ({
        guardTitle: '执行保护',
        guardStatsTitle: '执行保护活动',
        guardStatsSince: '统计自',
        guardScopeTitle: '生效范围',
      } as Record<string, string>)[key] ?? key,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
      stats: sampleStats,
    }) as ReactElement
    const headings = nodesWhere(el, (node) => node.type === 'h1' || node.type === 'h2')
    expect(headings).toHaveLength(0)
    const text = textOf(el)
    expect(text).not.toContain('执行保护活动')
    expect(text).not.toContain('统计自')
  })

  it('makes the fourth cell a scope note, not a switch', () => {
    const grid = guardGrid(render())
    for (let index = 0; index < 3; index += 1) {
      expect(countSwitches(grid[index])).toBe(1)
    }
    expect(countSwitches(grid[3])).toBe(0)
    expect(textOf(grid[3])).toContain('生效范围')
  })

  it('keeps role=switch and reflects aria-checked from props', () => {
    const on = render({ enabled: { duplicate_call: true, alternating_cycle: false, no_progress: true } })
    expect(nodesWhere(on, (node) => node.props.role === 'switch').map((node) => node.props['aria-checked']))
      .toEqual(['true', 'false', 'true'])

    const off = render({ enabled: { duplicate_call: false, alternating_cycle: false, no_progress: false } })
    expect(nodesWhere(off, (node) => node.props.role === 'switch').map((node) => node.props['aria-checked']))
      .toEqual(['false', 'false', 'false'])
  })

  it('toggles a section through the callback', () => {
    const calls: Array<[string, boolean]> = []
    const el = render({
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      onToggle: (id, next) => { calls.push([id, next]) },
    })
    const switches = nodesWhere(el, (node) => node.props.role === 'switch')
    expect(switches).toHaveLength(3)
    for (const node of switches) (node.props.onClick as () => void)()
    expect(calls).toEqual([
      ['duplicate_call', false],
      ['alternating_cycle', false],
      ['no_progress', false],
    ])
  })
})
