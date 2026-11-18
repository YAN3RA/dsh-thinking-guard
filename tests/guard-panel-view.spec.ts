import { describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { GuardPanel, thresholdStages } from '../src/client/GuardPanel.tsx'
import { guardDictionaries } from '../src/client/guard-section.tsx'

/**
 * 宿主原语替身：忠实复刻构建产物 lib/index.js 里的真实 DOM 输出
 * （Switch → button[role=switch][aria-checked][aria-label][disabled][title]，
 * StateDot → span[data-state]，Tag → span[data-tone]）。本包没有 clsx，
 * 真实原语在 node 环境无法加载，所以只替身 DOM 形状，断言仍读视图真实传来的参数。
 * aria-checked 用浏览器里实际呈现的字符串（'true'/'false'），与改前自建 button 一致。
 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  const Switch = (props: Record<string, unknown>): unknown => createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': props.checked === true ? 'true' : 'false',
    'aria-label': props.label,
    title: props.title,
    disabled: props.disabled === true,
    className: props.className,
  }, createElement('span', { className: 'thumb' }))
  const StateDot = (props: Record<string, unknown>): unknown => createElement('span', {
    'data-state': props.state,
    'aria-hidden': 'true',
    className: props.className,
  })
  const Tag = (props: Record<string, unknown>): unknown => createElement('span', {
    'data-tone': (props.tone as string | undefined) ?? 'outline',
    className: props.className,
  }, props.children as never)
  return { Switch, StateDot, Tag }
})

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

/**
 * data-guard-status 现在挂在最外层 span 上，可见文本在其内部的官方 Tag 里。
 * 读取嵌套文本，保持「状态值 + 文案逐字相等」的原语义 —— 不是弱化，只是把
 * 断言路径从「直接 children」改成「穿过 Tag 取文本」。
 */
function statusTextOf(node: FlatElement): unknown {
  const inner = flatten(node.props.children as ReactNode)
  const texts = inner.map(child => child.props.children).filter((child): child is string => typeof child === 'string')
  return texts.length === 1 ? texts[0] : texts
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
    const statuses = byData(nodes, 'data-guard-status').map(node => [node.props['data-guard-status'], statusTextOf(node)])
    expect(statuses).toEqual([['on', '已启用'], ['on', '已启用'], ['on', '已启用']])
    const off = byData(render({ enabled: { ...ALL_ON, no_progress: false } }), 'data-guard-status')
    expect(off.map(node => [node.props['data-guard-status'], statusTextOf(node)])[2]).toEqual(['off', '已关闭'])
  })

  it('says 状态未知 and disables the switch when the switches were not read', () => {
    const nodes = render({ enabled: undefined })
    const statuses = byData(nodes, 'data-guard-status')
    expect(statuses.every(node => statusTextOf(node) === '状态未知')).toBe(true)
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

/**
 * B 阶段（官方原语试点）的可见契约：只折叠视觉，业务状态、文案与 data-* 断言不变。
 *   - B-1：Switch 禁用时卡片内有可见原因行，且外包装用 aria-describedby 指向它（不传未知 prop）；
 *   - B-2：状态点换成 StateDot 的 data-state，外壳仍保留业务 data-tone；
 *   - B-3：机制卡状态 tag 换成 Tag，data-guard-status 与文案原样保留。
 */
describe('B 阶段：官方原语（Switch / StateDot / Tag）', () => {
  const dotStates = (nodes: FlatElement[]): unknown[] =>
    nodes.filter(node => node.props['data-state'] !== undefined).map(node => node.props['data-state'])
  const tagTones = (nodes: FlatElement[]): unknown[] =>
    nodes.filter(node => ['success', 'warning', 'neutral'].includes(String(node.props['data-tone'])))
      .map(node => node.props['data-tone'])

  it('maps the business status onto StateDot states without touching the text', () => {
    expect(dotStates(render())).toEqual(['done', 'done', 'done'])
    expect(dotStates(render({ enabled: { ...ALL_ON, no_progress: false } }))).toEqual(['done', 'done', 'idle'])
    expect(dotStates(render({ enabled: undefined }))).toEqual(['warning', 'warning', 'warning'])
  })

  it('keeps the business data-tone on the dot shell', () => {
    const tones = render().filter(node => node.props.className === 'v3-dot').map(node => node.props['data-tone'])
    expect(tones).toEqual(['ok', 'ok', 'ok'])
  })

  it('maps the status Tag tones ok→success and off→neutral', () => {
    expect(tagTones(render())).toEqual(['success', 'success', 'success'])
    expect(tagTones(render({ enabled: { ...ALL_ON, no_progress: false } }))).toEqual(['success', 'success', 'neutral'])
  })

  it('keeps data-guard-status and its text exactly as before inside the Tag', () => {
    const statuses = byData(render(), 'data-guard-status').map(node => [node.props['data-guard-status'], statusTextOf(node)])
    expect(statuses).toEqual([['on', '已启用'], ['on', '已启用'], ['on', '已启用']])
  })

  it('shows a visible reason referenced by aria-describedby when the switch is disabled', () => {
    const nodes = render({ enabled: undefined })
    const reasons = byData(nodes, 'data-guard-switch-reason')
    expect(reasons.length).toBe(3)
    expect(reasons.every(node => node.type === 'p')).toBe(true)
    expect(reasons.every(node => node.props.children === zh.guardSwitchReasonUnknown)).toBe(true)
    const groups = nodes.filter(node => node.props.role === 'group')
    expect(groups.length).toBe(3)
    const ids = new Set(reasons.map(node => node.props.id))
    expect(groups.every(group => ids.has(group.props['aria-describedby']))).toBe(true)
    // 原因行必须有可见文案，而不是只靠 data-* 属性。
    expect(zh.guardSwitchReasonUnknown.length).toBeGreaterThan(0)
    expect(guardDictionaries().en.guardSwitchReasonUnknown).not.toBe(zh.guardSwitchReasonUnknown)
  })

  it('shows a readonly reason when the surface has no write handler', () => {
    const nodes = render({ onToggle: undefined })
    const reasons = byData(nodes, 'data-guard-switch-reason')
    expect(reasons.length).toBe(3)
    expect(reasons.every(node => node.props.children === zh.guardSwitchReasonReadonly)).toBe(true)
  })

  it('omits the reason line and aria-describedby when the switches are interactive', () => {
    const nodes = render()
    expect(byData(nodes, 'data-guard-switch-reason').length).toBe(0)
    expect(nodes.filter(node => node.props.role === 'group' && node.props['aria-describedby'] !== undefined).length).toBe(0)
  })

  it('exposes the threshold format hint id that the C-5 inputs reference', () => {
    const hint = render().find(node => node.props.id === 'guard-thr-duplicate_call-format')
    expect(hint).toBeDefined()
    expect(String(hint!.props.className)).toContain('mc-guard-threshold-hint')
  })
})
