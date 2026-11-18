/**
 * A-5：阈值草稿与宿主基线冲突时的可见提示（0.3.6 UI 任务书 §3 A-5）。
 *
 * vitest 运行在 node 环境，仓库没有 react-dom / jsdom，也没有引入它们的计划。所以这里
 * 沿用 tests/client-panel.spec.ts 的做法，用一层受控的 React Hook 替身驱动重渲染：
 * useState / useRef / useEffect / useCallback 由本文件实现，react 的其余导出保持原样。
 *
 * 真正被执行的仍然是 `useGuardThresholdDraft`（包括它自己的 useEffect 同步逻辑）和
 * `GuardThresholdEditor` 的渲染结果，断言读的是真实 element tree 里的文案与属性，
 * 不是替身里预先写死的一句话。
 *
 * 覆盖的四条产品承诺：
 *   1. 草稿脏着、宿主列表变了 → 草稿保留 + 可见文案 + `data-guard-threshold-conflict`；
 *   2. 草稿干净时宿主列表变了 → 草稿自动跟随，不出任何提示（回归保护）；
 *   3. 非法草稿只显示格式错误，冲突提示不与之叠在一起；
 *   4. 冲突后把草稿改回新基线 → 旧冲突文案不再显示。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { GuardThresholdEditor } from '../src/client/GuardPanel.tsx'
import { guardDictionaries } from '../src/client/guard-section.tsx'

/**
 * 受控 hook 状态：按调用顺序存放 hook 槽位，重渲染时游标归零。
 * `pending` 收下本轮渲染登记的 effect，渲染结束后统一比对依赖。
 */
const H = vi.hoisted(() => ({
  slots: [] as unknown[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  pending: new Map<number, { run: () => void | (() => void); deps?: readonly unknown[] }>(),
  cursor: 0,
  rerender: false,
}))

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
    useEffect(run: () => void | (() => void), deps?: readonly unknown[]): void {
      H.pending.set(H.cursor++, { run, deps })
    },
    useCallback<T>(callback: T, deps: readonly unknown[]): T {
      const index = H.cursor++
      const previous = H.slots[index] as { deps: readonly unknown[]; callback: T } | undefined
      if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.callback
      H.slots[index] = { deps, callback }
      return callback
    },
  }
})

/** GuardPanel 现在从宿主原语包导入 Switch/StateDot/Tag；本包无 clsx，需替身以加载模块。
 *  本文件只渲染 GuardThresholdEditor，不触及这三个原语，替身仅用于解析导入。 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Switch: 'button', StateDot: 'span', Tag: 'span' }))

const { zh, en } = guardDictionaries()

/** 文案按中文取，断言才能对着用户真正看到的那一句。 */
const t = (key: keyof typeof zh): string => zh[key]

function sameDeps(a?: readonly unknown[], b?: readonly unknown[]): boolean {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

/** 渲染结束后执行本轮登记的 effect；依赖未变则跳过（与 React 的语义一致）。 */
function flushEffects(): void {
  const pending = [...H.pending.entries()].sort(([left], [right]) => left - right)
  H.pending.clear()
  for (const [index, next] of pending) {
    const previous = H.effects[index]
    if (previous !== undefined && sameDeps(previous.deps, next.deps)) continue
    previous?.cleanup?.()
    const cleanup = next.run()
    H.effects[index] = { deps: next.deps, ...(typeof cleanup === 'function' ? { cleanup } : {}) }
  }
}

interface FlatElement {
  readonly type: string
  readonly props: Record<string, unknown>
}

/** 摊平真实 element tree。这里只渲染 GuardThresholdEditor 本身，子节点都是宿主元素。 */
function flatten(node: ReactNode, out: FlatElement[] = []): FlatElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  const element = node as ReactElement<Record<string, unknown>>
  if (typeof element.type === 'function') {
    // 本文件只直接渲染叶子组件；出现其它组件说明测试搭错了。
    throw new Error('unexpected nested component')
  }
  out.push({ type: element.type as string, props: element.props })
  flatten(element.props.children as ReactNode, out)
  return out
}

interface EditorProps {
  readonly thresholds: readonly number[]
  readonly onChange: (next: readonly number[]) => void
}

/**
 * 挂载 GuardThresholdEditor，并允许像父组件那样换 props 重渲染。
 *
 * `type()` 模拟一次真实输入：取当前输入框的 onChange、喂一个 value、再跑一遍渲染，
 * 和 React 在事件处理结束后重渲染的顺序一致。
 */
function mountEditor(initial: EditorProps) {
  H.slots = []
  H.effects = []
  H.pending.clear()
  H.cursor = 0
  H.rerender = false
  let props = initial
  let view = renderPass()

  function renderPass(): ReactElement {
    let result: ReactElement | null = null
    let rounds = 0
    do {
      H.rerender = false
      H.cursor = 0
      result = GuardThresholdEditor({ t, thresholds: props.thresholds, onChange: props.onChange })
      flushEffects()
      rounds += 1
      if (rounds > 25) throw new Error('render loop did not settle')
    } while (H.rerender)
    if (result === null) throw new Error('editor rendered nothing')
    return result
  }

  return {
    get view(): ReactElement { return view },
    update(next: EditorProps): void {
      props = next
      view = renderPass()
    },
    type(index: number, value: string): void {
      const input = flatten(view).filter(node => node.type === 'input')[index]
      if (input === undefined) throw new Error('missing threshold input ' + String(index))
      const onChange = input.props['onChange'] as (event: { target: { value: string } }) => void
      onChange({ target: { value } })
      view = renderPass()
    },
  }
}

const nodesOf = (view: ReactElement): FlatElement[] => flatten(view)

const bodyOf = (view: ReactElement): FlatElement =>
  nodesOf(view).find(node => node.props['className'] === 'mc-guard-threshold-body')!

/** 阈值输入框当前显示的草稿值。 */
const valuesOf = (view: ReactElement): string[] =>
  nodesOf(view).filter(node => node.type === 'input').map(node => node.props['value'] as string)

/** 常驻的宣布范围（aria-live 容器）。 */
const noticeRegionOf = (view: ReactElement): FlatElement =>
  nodesOf(view).find(node => node.props['aria-live'] === 'polite')!

/** 可见的冲突提示；没有就是 undefined（不是靠 data-* 判断）。 */
const conflictTextOf = (view: ReactElement): string | undefined => {
  const notice = nodesOf(view).find(node => node.props['data-guard-threshold-conflict'] !== undefined && node.type === 'p')
  return notice === undefined ? undefined : notice.props['children'] as string
}

/** 可见的格式错误提示。 */
const invalidTextOf = (view: ReactElement): string | undefined => {
  const hint = nodesOf(view).find(node => node.props['data-guard-threshold-invalid'] === 'true')
  return hint === undefined ? undefined : hint.props['children'] as string
}

describe('threshold draft vs host list', () => {
  it('keeps a dirty draft and shows an announced, visible notice when the host list moves', () => {
    const onChange = vi.fn()
    const editor = mountEditor({ thresholds: [3, 5, 8], onChange })
    expect(valuesOf(editor.view)).toEqual(['3', '5', '8'])
    expect(noticeRegionOf(editor.view).props['data-guard-threshold-notice']).toBe('none')
    expect(conflictTextOf(editor.view)).toBeUndefined()

    // 输入保持合法但脏：8 → 9。
    editor.type(2, '9')
    expect(valuesOf(editor.view)).toEqual(['3', '5', '9'])
    expect(bodyOf(editor.view).props['data-guard-threshold-conflict']).toBe('false')
    expect(conflictTextOf(editor.view)).toBeUndefined()
    expect(onChange).not.toHaveBeenCalled()

    // 宿主提交了另一份列表（草稿既不等于旧基线，也不等于新基线）。
    editor.update({ thresholds: [2, 5, 8], onChange })

    // 草稿一个字符都没丢。
    expect(valuesOf(editor.view)).toEqual(['3', '5', '9'])
    // 兼容属性仍在：body 上的 data-guard-threshold-conflict 跟随 hook 的原始标志。
    expect(bodyOf(editor.view).props['data-guard-threshold-conflict']).toBe('true')
    // 有可见文案，且文案本身带同名属性 —— 不是只靠 data-*。
    expect(conflictTextOf(editor.view)).toBe(zh.guardThresholdConflictHint)
    expect(zh.guardThresholdConflictHint).toContain('宿主值已变化')
    // aria-live 在常驻容器上（文案出现时它已经存在），不是文案节点自己。
    const region = noticeRegionOf(editor.view)
    expect(region.props['aria-live']).toBe('polite')
    expect(region.props['data-guard-threshold-notice']).toBe('conflict')
    expect(region.props['data-guard-threshold-conflict']).toBeUndefined()
    const notice = nodesOf(editor.view)
      .find(node => node.type === 'p' && node.props['data-guard-threshold-conflict'] !== undefined)!
    expect(notice.props['className']).toBe('mc-guard-threshold-hint')
  })

  it('follows a new host list without any notice while the draft is clean', () => {
    const editor = mountEditor({ thresholds: [3, 5, 8], onChange: vi.fn() })
    editor.update({ thresholds: [3, 6, 8], onChange: vi.fn() })
    expect(valuesOf(editor.view)).toEqual(['3', '6', '8'])
    expect(bodyOf(editor.view).props['data-guard-threshold-conflict']).toBe('false')
    expect(noticeRegionOf(editor.view).props['data-guard-threshold-notice']).toBe('none')
    expect(conflictTextOf(editor.view)).toBeUndefined()
    const dirty = nodesOf(editor.view).filter(node => node.type === 'input')
      .map(node => node.props['data-guard-threshold-dirty'])
    expect(dirty).toEqual(['false', 'false', 'false'])
  })

  it('shows only the format error for an invalid draft that is also out of sync', () => {
    const editor = mountEditor({ thresholds: [3, 5, 8], onChange: vi.fn() })
    // 3 → 3：不严格递增，草稿非法但仍是脏的。
    editor.type(1, '3')
    expect(invalidTextOf(editor.view)).toBe(zh.guardThresholdDraftHint)

    // 宿主列表在非法草稿期间变化：hook 会标记 conflict，但提示位只归格式错误。
    editor.update({ thresholds: [2, 5, 8], onChange: vi.fn() })
    expect(valuesOf(editor.view)).toEqual(['3', '3', '8'])
    expect(invalidTextOf(editor.view)).toBe(zh.guardThresholdDraftHint)
    expect(conflictTextOf(editor.view)).toBeUndefined()
    expect(noticeRegionOf(editor.view).props['data-guard-threshold-notice']).toBe('invalid')
  })

  it('stops showing the old conflict once the draft equals the new baseline again', () => {
    const editor = mountEditor({ thresholds: [3, 5, 8], onChange: vi.fn() })
    editor.type(2, '9')
    editor.update({ thresholds: [2, 5, 8], onChange: vi.fn() })
    expect(conflictTextOf(editor.view)).toBe(zh.guardThresholdConflictHint)

    editor.type(0, '2')
    editor.type(2, '8')
    expect(valuesOf(editor.view)).toEqual(['2', '5', '8'])
    expect(conflictTextOf(editor.view)).toBeUndefined()
    expect(noticeRegionOf(editor.view).props['data-guard-threshold-notice']).toBe('none')
    expect(invalidTextOf(editor.view)).toBeUndefined()
  })

  it('ships the conflict copy in both dictionaries', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(zh.guardThresholdConflictHint.length).toBeGreaterThan(0)
    expect(en.guardThresholdConflictHint.length).toBeGreaterThan(0)
    expect(en.guardThresholdConflictHint).not.toBe(zh.guardThresholdConflictHint)
    expect(en.guardThresholdConflictHint).toContain('draft')
  })
})
