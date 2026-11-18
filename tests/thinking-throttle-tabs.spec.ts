/**
 * C1：外壳页签的手动激活 + roving tabindex + 面板语义（0.4.0 UI 任务书 §5 C-1）。
 *
 * 与既有 UI 测试一致：node 环境无 jsdom，用受控 React hook 替身驱动重渲染，
 * 直接调用真实 ThinkingThrottleSection，摊平 element tree 断言。
 * 三个子页用空组件替身，避免加载浏览器端数据/原语。
 * 关键产品承诺：方向键/Home/End 只移焦（不改 active、不挂载、不发 RPC）；Enter/Space 才激活。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const H = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, rerender: false }))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  const slot = <T,>(index: number, init: () => T): T => {
    if (!(index in H.slots)) H.slots[index] = init()
    return H.slots[index] as T
  }
  return {
    ...actual,
    useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] {
      const index = H.cursor++
      const value = slot<T>(index, () => initial)
      return [value, (next: T | ((previous: T) => T)): void => {
        const previous = H.slots[index] as T
        const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
        if (Object.is(resolved, previous)) return
        H.slots[index] = resolved
        H.rerender = true
      }]
    },
    useRef<T>(initial: T): { current: T } {
      const index = H.cursor++
      return slot<{ current: T }>(index, () => ({ current: initial }))
    },
    // 面板可聚焦性探测依赖真实 DOM；node 测试下不执行 effect（组件按默认 false 渲染）。
    useEffect(): void { H.cursor++ },
  }
})

vi.mock('../src/client/capability-v3/section.tsx', () => ({ CapabilitySection: () => null }))
vi.mock('../src/client/overview-section.tsx', () => ({ OverviewSection: () => null }))
vi.mock('../src/client/guard-section.tsx', () => ({ GuardSection: () => null }))

import { ThinkingThrottleSection, resolveTabKey } from '../src/client/thinking-throttle.tsx'

interface FlatElement {
  readonly type: string
  readonly props: Record<string, unknown>
}

/** 摊平：宿主元素展开，函数组件只记录不调用（子页为空组件替身）。 */
function flatten(node: ReactNode, out: FlatElement[] = []): FlatElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) { for (const child of node) flatten(child, out); return out }
  const element = node as ReactElement<Record<string, unknown>>
  if (typeof element.type === 'function') {
    out.push({ type: 'component:' + ((element.type as { name?: string }).name ?? 'anon'), props: element.props })
    return out
  }
  out.push({ type: element.type as string, props: element.props })
  flatten(element.props.children as ReactNode, out)
  return out
}

const t = (key: string): string => key
const injected = () => ({ capability: {}, overview: {}, guard: {}, t } as never)

function mount() {
  H.slots = []
  H.cursor = 0
  H.rerender = false
  let view = renderPass()
  function renderPass(): FlatElement[] {
    let result: ReactElement | null = null
    let rounds = 0
    do {
      H.rerender = false
      H.cursor = 0
      result = ThinkingThrottleSection(injected())
      rounds += 1
      if (rounds > 30) throw new Error('render loop did not settle')
    } while (H.rerender)
    if (result === null) throw new Error('rendered nothing')
    return flatten(result)
  }
  return {
    get view(): FlatElement[] { return view },
    tabs: () => view.filter(node => node.props.role === 'tab'),
    panel: () => view.find(node => node.props.role === 'tabpanel')!,
    press(tab: string, key: string): void {
      const button = view.find(node => node.props.role === 'tab' && node.props['data-tab'] === tab)!
      const handler = button.props['onKeyDown'] as (e: { key: string; preventDefault(): void }) => void
      handler({ key, preventDefault() {} })
      view = renderPass()
    },
  }
}

describe('resolveTabKey', () => {
  it('moves focus with arrows / Home / End, wraps, and treats Enter/Space as activation', () => {
    expect(resolveTabKey('overview', 'ArrowRight')).toBe('guard')
    expect(resolveTabKey('capability', 'ArrowRight')).toBe('overview')
    expect(resolveTabKey('overview', 'ArrowLeft')).toBe('capability')
    expect(resolveTabKey('guard', 'Home')).toBe('overview')
    expect(resolveTabKey('guard', 'End')).toBe('capability')
    expect(resolveTabKey('overview', 'Enter')).toBe('activate')
    expect(resolveTabKey('overview', ' ')).toBe('activate')
    expect(resolveTabKey('overview', 'Escape')).toBe(null)
  })
})

describe('ThinkingThrottleSection tabs (manual activation + roving)', () => {
  it('renders three tabs with ids, aria-selected and roving tabindex on the selected one', () => {
    const ui = mount()
    const tabs = ui.tabs()
    expect(tabs.map(node => node.props['data-tab'])).toEqual(['overview', 'guard', 'capability'])
    expect(tabs.map(node => node.props.id)).toEqual(['tt-tab-overview', 'tt-tab-guard', 'tt-tab-capability'])
    expect(tabs.map(node => node.props['aria-selected'])).toEqual([true, false, false])
    expect(tabs.map(node => node.props.tabIndex)).toEqual([0, -1, -1])
    const panel = ui.panel()
    expect(panel.props.id).toBe('tt-panel')
    expect(panel.props['aria-labelledby']).toBe('tt-tab-overview')
    expect(panel.props['data-active-tab']).toBe('overview')
  })

  it('arrow / Home / End only move focus: active, aria-selected and panel do not change', () => {
    const ui = mount()
    ui.press('overview', 'ArrowRight')
    expect(ui.tabs().map(node => node.props['aria-selected'])).toEqual([true, false, false])
    expect(ui.tabs().map(node => node.props['data-focus'])).toEqual(['false', 'true', 'false'])
    expect(ui.tabs().map(node => node.props.tabIndex)).toEqual([0, -1, -1])
    expect(ui.panel().props['data-active-tab']).toBe('overview')
    // End 仍只移焦
    ui.press('overview', 'End')
    expect(ui.tabs().map(node => node.props['aria-selected'])).toEqual([true, false, false])
    expect(ui.panel().props['data-active-tab']).toBe('overview')
  })

  it('Enter activates the focused tab and moves the panel + roving tabstop', () => {
    const ui = mount()
    ui.press('overview', 'End') // 移到 capability（不激活）
    ui.press('capability', 'Enter') // 才激活
    expect(ui.tabs().map(node => node.props['aria-selected'])).toEqual([false, false, true])
    expect(ui.tabs().map(node => node.props.tabIndex)).toEqual([-1, -1, 0])
    expect(ui.panel().props['data-active-tab']).toBe('capability')
    expect(ui.panel().props['aria-labelledby']).toBe('tt-tab-capability')
  })
})
