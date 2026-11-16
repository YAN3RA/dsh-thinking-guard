/**
 * TG-14 #5 · 阈值编辑的完整草稿模型（真实 jsdom 挂载）。
 *
 * 旧实现把「每次按键」当成提交：只要单项在 2..50 就直接 onChange，于是
 * 「8→20」的中间态 2 会拼出 [3,5,2] 发到 Host，被拒后回滚。本文件验证新模型：
 *
 *  - 键入只改本地草稿，绝不发 RPC；允许清空、允许多位数中间态；
 *  - 只有 Enter / blur / 明确「保存」才提交，且提交的是**完整合法**递增数组；
 *  - 非法草稿保留在框里（可继续改），不会被悄悄重置成 Host 值；
 *  - Host 拒绝（父层不改 committed）时草稿不丢，父层错误照常回显；
 *  - 外部值真正变化时草稿同步；同值轮询不吞掉正在输入的草稿；
 *  - onChange 缺失（旧 Host / busy）→ 只读，草稿仍保留，busy 结束后不丢。
 *
 * 这里全部是真实 DOM 事件（input / keydown / focusout / click），不靠读 React
 * props 假装交互。
 *
 * @vitest-environment jsdom
 */
import { createElement, useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuardPanel, type GuardPanelProps } from '../src/client/GuardPanel.tsx'
import { GuardContainer, type GuardSwitchRemote } from '../src/client/GuardContainer.tsx'
import type { GuardSwitches } from '../src/client/remote.ts'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => key

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  if (root !== undefined) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  host?.remove()
  host = undefined
})

function boxes(el: HTMLElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll('[data-guard-thresholds="true"] input')) as HTMLInputElement[]
}

function values(el: HTMLElement): string[] {
  return boxes(el).map(input => input.value)
}

function saveButton(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector('[data-guard-threshold-save="true"]') as HTMLButtonElement | null
}

/** The editor body's conflict flag (the wrapper itself belongs to the pure view). */
function conflictFlag(el: HTMLElement): string | null {
  return el.querySelector('[data-guard-threshold-conflict]')!.getAttribute('data-guard-threshold-conflict')
}

/** Type into a box the way a user would (bypassing React's value tracker). */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })) })
}

async function pressEnter(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** The element a test mounts; overridden per case. */
function panelElement(props: Partial<GuardPanelProps>): ReturnType<typeof createElement> {
  return createElement(GuardPanel, {
    t: t as never,
    enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
    duplicateThresholds: [3, 5, 8],
    onThresholdsChange: () => {},
    ...props,
  } as GuardPanelProps)
}

/** Mount the real panel once; returns the container element. */
async function mount(props: Partial<GuardPanelProps> = {}): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(panelElement(props)) })
  return host
}

/**
 * Re-render the SAME root with new props — what a container does when the Host
 * reports a new list, when a poll re-delivers the same one, or when busy flips.
 * A fresh mount would prove nothing about prop updates.
 */
async function rerender(props: Partial<GuardPanelProps>): Promise<void> {
  await act(async () => { root!.render(panelElement(props)) })
}

/**
 * A parent that behaves like the real container: it owns the committed list and
 * either ACCEPTS (adopts the new list) or REFUSES (keeps the old one and shows
 * the Host's error). The editor's props therefore only change when the Host
 * really changed them — no fake props.
 */
function HostParent(props: {
  readonly initial: readonly number[]
  readonly accept: boolean
  readonly onAttempt: (next: readonly number[]) => void
}): ReturnType<typeof createElement> {
  const { initial, accept, onAttempt } = props
  const [committed, setCommitted] = useState<readonly number[]>(initial)
  const [error, setError] = useState<string | undefined>(undefined)
  return createElement('div', null,
    createElement(GuardPanel, {
      t: t as never,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: committed,
      onThresholdsChange: (next: readonly number[]) => {
        onAttempt(next)
        if (accept) {
          setCommitted(next)
          setError(undefined)
        } else {
          setError('repeatThresholds rejected by Host')
        }
      },
    } as GuardPanelProps),
    error === undefined ? null : createElement('p', { 'data-host-error': 'true' }, error),
  )
}

async function mountParent(props: Parameters<typeof HostParent>[0]): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(HostParent, props)) })
  return host
}

describe('草稿模型 · 键入不提交', () => {
  it('does not write while typing a multi-digit value (8 → 20 keeps the 2 as an intermediate)', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    // 最后一格：8 → 20 的中间态 2 会拼出 [3,5,2]，正是被报的那个 bug。
    const input = boxes(el)[2]!
    await type(input, '2')
    expect(onChange).not.toHaveBeenCalled()
    expect(values(el)).toEqual(['3', '5', '2'])
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await type(input, '20')
    expect(onChange).not.toHaveBeenCalled()
    expect(values(el)).toEqual(['3', '5', '20'])
    expect(input.getAttribute('aria-invalid')).toBe('false')
  })

  it('keeps a cleared box as an empty draft instead of snapping back', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const input = boxes(el)[0]!
    await type(input, '')
    expect(onChange).not.toHaveBeenCalled()
    expect(values(el)).toEqual(['', '5', '8'])
    expect(input.getAttribute('aria-invalid')).toBe('true')
    // 清空后重新输入合法值，草稿继续走。
    await type(input, '2')
    expect(values(el)).toEqual(['2', '5', '8'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks a dirty draft without writing it', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    expect(boxes(el).every(input => input.getAttribute('data-guard-threshold-dirty') === 'false')).toBe(true)
    await type(boxes(el)[1]!, '6')
    expect(boxes(el).every(input => input.getAttribute('data-guard-threshold-dirty') === 'true')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('草稿模型 · 明确提交', () => {
  it('commits the whole valid list on Enter', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const inputs = boxes(el)
    await type(inputs[0]!, '2')
    await type(inputs[1]!, '9')
    await type(inputs[2]!, '20')
    expect(onChange).not.toHaveBeenCalled()
    await pressEnter(inputs[2]!)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith([2, 9, 20])
  })

  it('commits the whole valid list on blur', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const input = boxes(el)[1]!
    await type(input, '6')
    await blur(input)
    expect(onChange).toHaveBeenCalledWith([3, 6, 8])
  })

  it('commits through the explicit 保存 button, which is disabled until dirty', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const button = saveButton(el)
    expect(button).not.toBeNull()
    expect(button!.disabled).toBe(true)
    await type(boxes(el)[1]!, '6')
    expect(saveButton(el)!.disabled).toBe(false)
    await click(saveButton(el)!)
    expect(onChange).toHaveBeenCalledWith([3, 6, 8])
  })

  it('does not write an untouched field on Enter (no pointless Host round-trip)', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    await pressEnter(boxes(el)[0]!)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not write an invalid draft on Enter or blur, and keeps it editable', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const inputs = boxes(el)
    await type(inputs[0]!, '9')   // [9,5,8] 不是递增
    await pressEnter(inputs[0]!)
    await blur(inputs[0]!)
    await click(saveButton(el)!)
    expect(onChange).not.toHaveBeenCalled()
    // 草稿仍在，用户可以直接改。
    expect(values(el)).toEqual(['9', '5', '8'])
    expect(el.querySelector('[data-guard-threshold-invalid="true"]')).not.toBeNull()
    await type(inputs[0]!, '2')
    await pressEnter(inputs[0]!)
    expect(onChange).toHaveBeenCalledWith([2, 5, 8])
  })

  it('rejects a value outside 2..50 on commit', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const inputs = boxes(el)
    await type(inputs[2]!, '51')
    await pressEnter(inputs[2]!)
    expect(onChange).not.toHaveBeenCalled()
    await type(inputs[2]!, '50')
    await pressEnter(inputs[2]!)
    expect(onChange).toHaveBeenCalledWith([3, 5, 50])
  })
})

describe('草稿模型 · 外部值与失败', () => {
  it('adopts a real external (Host) change when the draft is clean', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    await rerender({ onThresholdsChange: onChange, duplicateThresholds: [2, 4, 6] })
    expect(values(el)).toEqual(['2', '4', '6'])
    expect(boxes(el).every(input => input.getAttribute('data-guard-threshold-dirty') === 'false')).toBe(true)
    expect(conflictFlag(el)).toBe('false')
  })

  it('keeps a dirty draft when the Host value really changed, and flags the conflict', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    await type(boxes(el)[1]!, '6')
    // 外部真的换了值：不静默吞掉用户输入，也不静默忽略新值 —— 保留草稿并标记冲突。
    await rerender({ onThresholdsChange: onChange, duplicateThresholds: [2, 4, 6] })
    expect(values(el)).toEqual(['3', '6', '8'])
    expect(boxes(el).every(input => input.getAttribute('data-guard-threshold-dirty') === 'true')).toBe(true)
    expect(conflictFlag(el)).toBe('true')
    // 用户随后提交，用的仍是自己的草稿。
    await pressEnter(boxes(el)[1]!)
    expect(onChange).toHaveBeenCalledWith([3, 6, 8])
  })

  it('keeps a dirty draft when a poll re-delivers the SAME committed list', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    await type(boxes(el)[1]!, '6')
    // 同一个 committed 列表再投一次（轮询）：不能把正在输入的草稿冲掉。
    await rerender({ onThresholdsChange: onChange, duplicateThresholds: [3, 5, 8] })
    expect(values(el)).toEqual(['3', '6', '8'])
  })

  it('keeps the draft when the Host refuses the write, and the parent shows the error', async () => {
    const attempts: Array<readonly number[]> = []
    const el = await mountParent({ initial: [3, 5, 8], accept: false, onAttempt: next => { attempts.push(next) } })
    const inputs = boxes(el)
    await type(inputs[1]!, '6')
    await pressEnter(inputs[1]!)
    expect(attempts).toEqual([[3, 6, 8]])
    // 父层拒绝：committed 未变，草稿必须留在框里（不是回滚成 3/5/8）。
    expect(values(el)).toEqual(['3', '6', '8'])
    expect(el.querySelector('[data-host-error="true"]')).not.toBeNull()
    // 用户还能继续改并再次提交。
    await type(inputs[1]!, '7')
    await pressEnter(inputs[1]!)
    expect(attempts).toEqual([[3, 6, 8], [3, 7, 8]])
  })

  it('clears the draft once the parent accepts it', async () => {
    const attempts: Array<readonly number[]> = []
    const el = await mountParent({ initial: [3, 5, 8], accept: true, onAttempt: next => { attempts.push(next) } })
    const inputs = boxes(el)
    await type(inputs[1]!, '6')
    await pressEnter(inputs[1]!)
    expect(attempts).toEqual([[3, 6, 8]])
    expect(values(el)).toEqual(['3', '6', '8'])
    expect(boxes(el).every(input => input.getAttribute('data-guard-threshold-dirty') === 'false')).toBe(true)
    expect(saveButton(el)!.disabled).toBe(true)
    // The Host caught up with the draft: nothing is left in conflict.
    expect(conflictFlag(el)).toBe('false')
  })
})

describe('草稿模型 · 只读与 busy', () => {
  it('is read-only with no save button when the Host cannot edit thresholds', async () => {
    const el = await mount({ onThresholdsChange: undefined })
    expect(boxes(el).every(input => input.disabled && input.readOnly)).toBe(true)
    expect(saveButton(el)).toBeNull()
  })

  it('keeps the draft across a busy window (onChange withdrawn, then restored)', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    await type(boxes(el)[1]!, '6')
    // busy：容器撤掉 onChange，输入框只读；草稿不能丢。
    await rerender({ onThresholdsChange: undefined })
    expect(boxes(el).every(input => input.disabled)).toBe(true)
    expect(values(el)).toEqual(['3', '6', '8'])
    expect(onChange).not.toHaveBeenCalled()
    // busy 结束：草稿还在，可以继续提交。
    await rerender({ onThresholdsChange: onChange })
    await pressEnter(boxes(el)[1]!)
    expect(onChange).toHaveBeenCalledWith([3, 6, 8])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 真实 GuardContainer 整合（不 mock onChange 回调）
//
// 前面的用例挂的是 GuardPanel + 自造父组件，那只能证明「父层拒绝时草稿还在」。
// 这里挂真的 GuardContainer，用它真实的写入队列 / runWrite / readAll / busy，
// 只把 remote 换成可控的 Host stub：
//  - 延迟拒绝：保存后进入 busy，RPC 返回 ok:false，回读仍是旧值 → 草稿必须仍是
//    用户输入的 20，错误可见，且能再次提交；
//  - 延迟接受：RPC 成功 + 回读新值 → 草稿与 Host 一致、不再 dirty；
//  - 真实 blur + 保存是否重复提交。
// ─────────────────────────────────────────────────────────────────────────────

const containerLabels: Record<string, string> = {
  guardThresholds: '重复提醒阈值',
  guardThresholdSave: '保存',
  guardThresholdDraftHint: '需为 2–50 的递增整数、最多 5 个',
  guardThresholdHint: '阈值说明',
  overviewRefresh: '刷新',
}

/** The container's `t`, resolved through a small real dictionary. */
function containerT(key: string): string {
  return containerLabels[key] ?? key
}

type WriteResult = { ok: true; value: void } | { ok: false; error: { code: string; message: string } }

interface Gate { readonly promise: Promise<WriteResult>; readonly resolve: (value: WriteResult) => void }

function gate(): Gate {
  let resolve!: (value: WriteResult) => void
  const promise = new Promise<WriteResult>(r => { resolve = r })
  return { promise, resolve }
}

/**
 * A Host stub whose thresholds write can be held open and then accepted/refused,
 * exactly like a real remote: getGuard returns whatever the Host has actually
 * committed, so a refused write re-reads the OLD list.
 */
function makeHost(initial: readonly number[]) {
  let committed: readonly number[] = initial
  const writes: Array<readonly number[]> = []
  const pending: Gate[] = []
  const remote: GuardSwitchRemote = {
    getGuard: async () => ({
      ok: true as const,
      value: {
        enabled: true,
        duplicateDetection: true,
        alternatingCycleDetection: true,
        noProgressProtection: true,
        repeatThresholds: committed,
      } satisfies GuardSwitches,
    }),
    updateGuard: async (change) => {
      const next = change.repeatThresholds
      if (next === undefined) return { ok: true as const, value: undefined }
      writes.push(next)
      const pendingGate = gate()
      pending.push(pendingGate)
      const result = await pendingGate.promise
      if (result.ok) committed = next
      return result
    },
  }
  return {
    remote,
    writes,
    /** Answer the oldest outstanding thresholds write. */
    async answer(accept: boolean): Promise<void> {
      const pendingGate = pending.shift()
      if (pendingGate === undefined) throw new Error('no pending write')
      pendingGate.resolve(accept
        ? { ok: true as const, value: undefined }
        : { ok: false as const, error: { code: 'invalid', message: 'repeatThresholds rejected by Host' } })
      await act(async () => { await Promise.resolve() })
    },
    get committed(): readonly number[] { return committed },
  }
}

async function mountContainer(remote: GuardSwitchRemote): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(GuardContainer, { t: containerT as never, remote, active: false }))
  })
  return host
}

function errorText(el: HTMLElement): string | undefined {
  return (el.querySelector('.mc-error-hint') as HTMLElement | null)?.textContent ?? undefined
}

describe('真实 GuardContainer · 延迟拒绝 / 成功回显', () => {
  it('keeps the typed draft after a LATE rejection, shows the error, and allows a retry', async () => {
    const hostStub = makeHost([3, 5, 8])
    const el = await mountContainer(hostStub.remote)
    expect(values(el)).toEqual(['3', '5', '8'])

    await type(boxes(el)[2]!, '20')
    expect(hostStub.writes).toEqual([])
    await click(saveButton(el)!)

    // 写入在飞：容器 busy，editor 只读，但草稿仍是 20。
    expect(hostStub.writes).toEqual([[3, 5, 20]])
    expect(values(el)).toEqual(['3', '5', '20'])
    expect(boxes(el).every(input => input.disabled)).toBe(true)
    // 关键：容器对 thresholds **不做乐观提交** —— 在飞期间 Host 的 committed
    // 仍是旧值，编辑器 props 没有被“假成功”推进；这正是拒绝后不丢草稿的机制。
    expect(hostStub.committed).toEqual([3, 5, 8])

    // 延迟拒绝：RPC 失败 → 容器回读旧值 3/5/8，并显示错误。
    await hostStub.answer(false)
    expect(hostStub.committed).toEqual([3, 5, 8])
    expect(errorText(el)).toContain('repeatThresholds rejected by Host')
    // 关键断言：草稿没有被“父 props 追平”清掉，仍是用户输入的 20。
    expect(values(el)).toEqual(['3', '5', '20'])

    // 可重试：再改一次并提交，RPC 收到新的完整列表。
    await type(boxes(el)[2]!, '21')
    await click(saveButton(el)!)
    expect(hostStub.writes).toEqual([[3, 5, 20], [3, 5, 21]])
    await hostStub.answer(true)
    expect(hostStub.committed).toEqual([3, 5, 21])
    expect(values(el)).toEqual(['3', '5', '21'])
    expect(boxes(el).every(input => input.getAttribute('data-guard-threshold-dirty') === 'false')).toBe(true)
  })

  it('adopts the accepted value and clears dirty after a LATE success', async () => {
    const hostStub = makeHost([3, 5, 8])
    const el = await mountContainer(hostStub.remote)
    await type(boxes(el)[1]!, '6')
    await click(saveButton(el)!)
    expect(hostStub.writes).toEqual([[3, 6, 8]])
    await hostStub.answer(true)
    expect(hostStub.committed).toEqual([3, 6, 8])
    expect(values(el)).toEqual(['3', '6', '8'])
    expect(boxes(el).every(input => input.getAttribute('data-guard-threshold-dirty') === 'false')).toBe(true)
    expect(saveButton(el)!.disabled).toBe(true)
    expect(errorText(el)).toBeUndefined()
  })

  it('does not double-submit when blur is followed by an attempted save', async () => {
    const hostStub = makeHost([3, 5, 8])
    const el = await mountContainer(hostStub.remote)
    await type(boxes(el)[1]!, '6')
    // 真实路径：先离开输入框（blur 提交）。
    await blur(boxes(el)[1]!)
    expect(hostStub.writes).toEqual([[3, 6, 8]])
    // 写入在飞 ⇒ 容器撤掉 onChange，editor 只读、保存按钮不再渲染：
    // 这就是真实 UI 里「blur 之后再点保存」无法重复提交的机制。
    expect(boxes(el).every(input => input.disabled)).toBe(true)
    expect(saveButton(el)).toBeNull()
    await hostStub.answer(true)
    expect(hostStub.writes).toEqual([[3, 6, 8]])
  })

  it('does not double-submit when Enter is followed by an attempted save', async () => {
    const hostStub = makeHost([3, 5, 8])
    const el = await mountContainer(hostStub.remote)
    await type(boxes(el)[2]!, '20')
    await pressEnter(boxes(el)[2]!)
    expect(hostStub.writes).toEqual([[3, 5, 20]])
    expect(saveButton(el)).toBeNull()
    // 写入未完成时再按 Enter（只读输入框不会触发 onChange，但即使派发事件，
    // editor 也不在可提交状态）——RPC 仍然只有一次。
    await pressEnter(boxes(el)[2]!)
    expect(hostStub.writes).toEqual([[3, 5, 20]])
    await hostStub.answer(true)
    expect(hostStub.writes).toEqual([[3, 5, 20]])
    expect(values(el)).toEqual(['3', '5', '20'])
  })
})

