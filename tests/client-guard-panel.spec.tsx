/**
 * TG-14 (P2) · Guard threshold editor — mounted jsdom coverage.
 *
 * The rest of the Guard panel is asserted as a hook-free element tree in
 * client-guard-v3.spec.tsx / client-plugin-section.spec.tsx. Those suites cannot
 * see a real keystroke, so this file mounts the REAL GuardPanel under jsdom and
 * drives the three number inputs.
 *
 * Behaviour under test (插件功能与实现报告.md · TG-14 #5, 完整草稿模型):
 *  - a keystroke is NEVER committed: it only moves the local draft, so an empty
 *    box and a multi-digit intermediate ('2' on the way to '20') survive;
 *  - Enter / blur / the explicit 保存 button commit the WHOLE list, and only when
 *    it is a complete valid ascending 2..50 array;
 *  - an invalid draft is never sent AND is never silently reset — it stays in
 *    the boxes so the operator can correct it.
 *
 * The exhaustive draft matrix (Host refusal keeps the draft, external change vs
 * poll re-delivery, busy window, conflict flag) lives in tg-draft-editor.spec.tsx;
 * this file keeps the original TG-14 cases on the new semantics.
 *
 * @vitest-environment jsdom
 */
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuardPanel, type GuardPanelProps } from '../src/client/GuardPanel.tsx'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => key

let root: Root | undefined
let host: HTMLDivElement | undefined

async function mount(props: Partial<GuardPanelProps> = {}): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(GuardPanel, {
      t: t as never,
      enabled: { duplicate_call: true, alternating_cycle: true, no_progress: true },
      duplicateThresholds: [3, 5, 8],
      onThresholdsChange: () => {},
      ...props,
    }))
  })
  return host
}

function boxes(el: HTMLDivElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll('[data-guard-thresholds="true"] input')) as HTMLInputElement[]
}

/** Set an input's value the way a user would, bypassing React's value tracker. */
function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
}

afterEach(async () => {
  if (root !== undefined) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  host?.remove()
  host = undefined
})

describe('TG-14 · Guard threshold editor (mounted)', () => {
  it('renders the Host values in three number boxes', async () => {
    const el = await mount()
    const inputs = boxes(el)
    expect(inputs).toHaveLength(3)
    expect(inputs.map(i => i.value)).toEqual(['3', '5', '8'])
    expect(inputs.every(i => i.type === 'number')).toBe(true)
  })

  it('does NOT commit a keystroke that would make the list non-ascending ([3,5,2])', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const inputs = boxes(el)
    setValue(inputs[1]!, '2')
    await act(async () => { inputs[1]!.dispatchEvent(new Event('input', { bubbles: true })) })
    // The whole list [3,2,8] is not ascending: nothing may be sent.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does NOT commit a keystroke, even when the whole list would stay valid', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const inputs = boxes(el)
    setValue(inputs[1]!, '6')
    await act(async () => { inputs[1]!.dispatchEvent(new Event('input', { bubbles: true })) })
    // 键入只改草稿：提交必须由 Enter / blur / 保存 明确触发。
    expect(onChange).not.toHaveBeenCalled()
    expect(boxes(el).map(i => i.value)).toEqual(['3', '6', '8'])
  })

  it('commits the full edited list on Enter when every box is valid', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const inputs = boxes(el)
    for (const [index, value] of [['0', '2'], ['1', '9'], ['2', '20']] as const) {
      setValue(inputs[Number(index)]!, value)
      await act(async () => { inputs[Number(index)]!.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    await act(async () => {
      inputs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith([2, 9, 20])
  })

  it('never sends an invalid blur, and KEEPS the draft for correction', async () => {
    const onChange = vi.fn()
    const el = await mount({ onThresholdsChange: onChange })
    const inputs = boxes(el)
    setValue(inputs[1]!, '1')
    await act(async () => { inputs[1]!.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { inputs[1]!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(onChange).not.toHaveBeenCalled()
    // 非法草稿留在框里（不回滚成 Host 值），并明确标记不合法。
    expect(boxes(el).map(i => i.value)).toEqual(['3', '1', '8'])
    expect(el.querySelector('[data-guard-threshold-invalid="true"]')).not.toBeNull()
  })

  it('keeps the boxes disabled/read-only for a Host that cannot edit thresholds', async () => {
    const el = await mount({ onThresholdsChange: undefined })
    const inputs = boxes(el)
    expect(inputs.every(i => i.disabled && i.readOnly)).toBe(true)
  })
})
