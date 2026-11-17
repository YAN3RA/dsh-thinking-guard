import { describe, expect, it } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { GuardPanel, thresholdStages } from '../src/client/GuardPanel.tsx'
import { guardDictionaries } from '../src/client/guard-section.tsx'

/**
 * 思考限制页 A / B / C 三张卡的结构与状态表达。
 *
 * 这些断言只覆盖「显示层」的产品承诺：状态不能只靠一个绿点、触发条件 / 处理方式 /
 * 执行边界必须分开、阈值阶段名要与真实触发次数一致、读不到开关时显示「状态未知」
 * 而不是「已关闭」。检测算法本身由 guard-loop-core.spec.ts / guard.spec.ts 负责，
 * 这里一条都不碰。
 */

const zh = guardDictionaries().zh
const t = (key: keyof typeof zh): string => zh[key]

interface FlatElement {
  readonly type: string
  readonly props: Record<string, unknown>
}

/** 摊平元素树；带 HOOK_COMPONENT 标记的组件只记录、不调用（阈值编辑器有 hook）。 */
function flatten(node: ReactNode, out: FlatElement[] = []): FlatElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  const element = node as ReactElement<Record<string, unknown>>
  if (typeof element.type === 'function') {
    const tagged = (element.type as unknown as Record<symbol, unknown>)[Symbol.for('dsh-thinking-guard.hook-component')]
    if (tagged === true) {
      out.push({ type: 'hook-component', props: element.props })
      return out
    }
    flatten((element.type as (props: Record<string, unknown>) => ReactNode)(element.props), out)
    return out
  }
  out.push({ type: element.type as string, props: element.props })
  flatten(element.props.children as ReactNode, out)
  return out
}

function byData(nodes: readonly FlatElement[], name: string): FlatElement[] {
  return nodes.filter(node => node.props[name] !== undefined)
}

const ALL_ON = {
  duplicate_call: true,
  alternating_cycle: true,
  no_progress: true,
} as const

function render(overrides: Record<string, unknown> = {}): FlatElement[] {
  return flatten(GuardPanel({
    t,
    enabled: ALL_ON,
    duplicateThresholds: [3, 5, 8],
    onToggle: () => {},
    onThresholdsChange: () => {},
    ...overrides,
  }))
}

describe('thresholdStages', () => {
  it('names the three default stages first / again / top', () => {
    expect(thresholdStages([3, 5, 8])).toEqual([
      { value: 3, stage: 'first' },
      { value: 5, stage: 'again' },
      { value: 8, stage: 'top' },
    ])
  })

  it('does not force a three-stage shape onto a single threshold', () => {
    expect(thresholdStages([5])).toEqual([{ value: 5, stage: 'only' }])
  })

  it('handles two thresholds and missing input', () => {
    expect(thresholdStages([3, 8])).toEqual([{ value: 3, stage: 'first' }, { value: 8, stage: 'top' }])
    expect(thresholdStages([])).toEqual([])
    expect(thresholdStages(undefined)).toEqual([])
  })
})

describe('GuardPanel structure', () => {
  it('renders exactly the three mechanisms, in product order', () => {
    expect(byData(render(), 'data-guard-section').map(node => node.props['data-guard-section']))
      .toEqual(['duplicate_call', 'alternating_cycle', 'no_progress'])
  })

  it('splits every card into trigger / action / boundary, plus parameters for A', () => {
    const nodes = render()
    const blocksOf = (section: string): string[] => {
      const card = byData(nodes, 'data-guard-section').find(node => node.props['data-guard-section'] === section)!
      return flatten(card.props.children as ReactNode)
        .filter(node => node.props['data-guard-block'] !== undefined)
        .map(node => node.props['data-guard-block'] as string)
    }
    expect(blocksOf('duplicate_call')).toEqual(['trigger', 'action', 'boundary', 'params'])
    expect(blocksOf('alternating_cycle')).toEqual(['trigger', 'action', 'boundary'])
    expect(blocksOf('no_progress')).toEqual(['trigger', 'action', 'boundary'])
  })

  it('shows a text status next to the dot, never a bare coloured dot', () => {
    const nodes = render()
    const statuses = byData(nodes, 'data-guard-status').map(node => [node.props['data-guard-status'], node.props.children])
    expect(statuses).toEqual([['on', '已启用'], ['on', '已启用'], ['on', '已启用']])
    const off = byData(render({ enabled: { ...ALL_ON, no_progress: false } }), 'data-guard-status')
    expect(off.map(node => [node.props['data-guard-status'], node.props.children])[2]).toEqual(['off', '已关闭'])
  })

  it('says 状态未知 and disables the switch when the switches were not read', () => {
    const nodes = render({ enabled: undefined })
    const statuses = byData(nodes, 'data-guard-status')
    expect(statuses.every(node => node.props.children === '状态未知')).toBe(true)
    const switches = byData(nodes, 'aria-label').filter(node => node.props.role === 'switch')
    expect(switches.length).toBe(3)
    expect(switches.every(node => node.props.disabled === true)).toBe(true)
    expect(switches.every(node => node.props['aria-checked'] === 'false')).toBe(true)
  })

  it('drives aria-checked from the real switches and keeps the write handler', () => {
    const nodes = render({ enabled: { ...ALL_ON, duplicate_call: false } })
    const switches = byData(nodes, 'aria-label').filter(node => node.props.role === 'switch')
    expect(switches.map(node => node.props['aria-checked'])).toEqual(['false', 'true', 'true'])
    expect(switches.every(node => node.props.disabled === false)).toBe(true)
  })

  it('keeps the threshold editor wrapped with its count, values and editability', () => {
    const wrapper = byData(render(), 'data-guard-thresholds')[0]!
    expect(wrapper.props['data-guard-thresholds-count']).toBe('3')
    expect(wrapper.props['data-guard-thresholds-values']).toBe('3,5,8')
    expect(wrapper.props['data-guard-thresholds-editable']).toBe('true')
    const readOnly = byData(render({ onThresholdsChange: undefined }), 'data-guard-thresholds')[0]!
    expect(readOnly.props['data-guard-thresholds-editable']).toBe('false')
  })

  it('labels the three stages with the real firing counts', () => {
    const stages = byData(render(), 'data-guard-stage-value')
      .map(node => [node.props['data-stage'], node.props.children])
    expect(stages).toEqual([
      ['first', '第 3 次 · 首次提醒'],
      ['again', '第 5 次 · 再次提醒'],
      ['top', '第 8 次 · 最高阈值 · 也是拒绝候选门槛'],
    ])
  })

  it('shows the alternating-cycle picture as an illustration, with a caveat', () => {
    const nodes = render()
    const flow = byData(nodes, 'data-guard-flow')[0]!
    expect(flow.props['data-guard-flow']).toBe('alternating')
    const inner = flatten(flow.props.children as ReactNode)
    expect(inner.filter(node => node.props.className === 'gd-node').map(node => node.props.children))
      .toEqual(['工具 A', '工具 B', '工具 A', '工具 B'])
    expect(byData(nodes, 'data-guard-flow-note')[0]!.props.children).toContain('示意')
  })

  it('states the no-progress evidence requirement on C', () => {
    const card = byData(render(), 'data-guard-section')
      .find(node => node.props['data-guard-section'] === 'no_progress')!
    const text = flatten(card.props.children as ReactNode)
      .filter(node => node.props['data-guard-block'] === 'boundary')
      .map(node => flatten(node.props.children as ReactNode).length)
    expect(text.length).toBe(1)
    expect(zh.guardCBoundary).toContain('不是达到次数就直接拒绝')
    expect(zh.guardCTrigger).toContain('证明没有进展')
  })
})
