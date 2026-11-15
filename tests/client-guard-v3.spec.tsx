/**
 * v3 执行保护（D-044 / README 5.3 ②）— the Guard switches become a two-column
 * grid of .v3-gitem cards.
 *
 * Same constraint as the other client specs: this package has no DOM harness, so
 * the component is inspected as an element tree rather than mounted. This file
 * only asserts the v3 SHAPE; the published DOM contract (nine mc-guard-point,
 * data-guard-section order, the single threshold input, the counters) is still
 * covered by client-plugin-section.spec.tsx, which this change must not break.
 */
import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { GuardPanel, type GuardPanelProps } from '../src/client/GuardPanel.tsx'

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

/** Every element matching 'predicate', EXPANDING function components. */
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

  it('renders the thresholds as .v3-kbd chips', () => {
    const kbds = nodesWhere(render(), (node) => classHas(node, 'v3-kbd'))
    expect(kbds).toHaveLength(3)
    expect(kbds.map((node) => node.props.children)).toEqual(['3', '5', '8'])
  })

  it('keeps the four-cell guard counter board (and its since line)', () => {
    const cells = nodesWhere(render(), (node) => node.props['data-guard-stat'] !== undefined)
    expect(cells).toHaveLength(4)
    const boards = nodesWhere(render(), (node) => node.props['data-guard-stats'] === 'true')
    expect(boards).toHaveLength(1)

    const withStats = render({
      stats: {
        observations: 128,
        outcomes: { success: 120, error: 8, cancelled: 0 },
        reminders: { repeat: 4, cycle: 1 },
        denials: 2,
        since: Date.UTC(2026, 10, 15, 1, 0),
      },
    })
    const since = nodesWhere(withStats, (node) => node.props['data-guard-stats-since'] !== undefined)
    expect(since).toHaveLength(1)
  })

  it('makes the fourth cell a scope note, not a switch', () => {
    const grid = guardGrid(render())
    // The three guard cards each carry exactly one switch.
    for (let index = 0; index < 3; index += 1) {
      expect(countSwitches(grid[index])).toBe(1)
    }
    // The fourth cell explains the effective scope and has no switch.
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
