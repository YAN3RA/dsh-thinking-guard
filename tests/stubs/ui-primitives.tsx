/**
 * Test stub for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * WHY THIS EXISTS — the shipped package imports ~20 packages it never declares
 * (`clsx`, `shiki/*`, `katex`, `diff`, `simple-icons`, `@deepseek-ai/dsh-client-store`,
 * …) and ships `.module.css` files. The DSH client module loader resolves all of
 * that in production; a Vitest process cannot, and installing the whole set as
 * devDependencies would mean maintaining a list that tracks an upstream package
 * we do not own.
 *
 * These tests assert OUR shell's contract (which views exist, which props reach
 * them, which element is a tab/panel). They never assert the primitives'
 * internals. `vitest.config.ts` aliases the real specifier to this file, so the
 * API surface here must stay a faithful subset of the real one — if we call a
 * prop that does not exist, this stub should not be the reason it passes.
 */
import { createElement, type ReactNode } from 'react'

interface BasicProps {
  readonly children?: ReactNode
  readonly className?: string
  readonly [key: string]: unknown
}

/** Real API: {variant, size, icon} + native button attributes. */
export function Button(props: BasicProps) {
  const { variant: _variant, size: _size, icon: _icon, ...rest } = props
  return createElement('button', { ...rest, type: rest.type ?? 'button' })
}

/** Real API: {icon} + native input attributes. */
export function Input(props: BasicProps) {
  const { icon: _icon, ...rest } = props
  return createElement('input', rest)
}

/** Real API: {open, onClose, title, closeLabel, children, footer, headless, …}. */
export function Modal(props: BasicProps) {
  const { open, onClose: _onClose, title, closeLabel: _closeLabel, footer, headless: _h, backdropBlur: _b, contentClassName: _c, shortcutModal: _s, onKeyDownCapture: _k, ...rest } = props
  if (open !== true) return null
  const children = [title, rest.children, footer]
  return createElement('div', { ...rest, role: 'dialog' }, ...(children as ReactNode[]))
}

/** Real API: {tone, children}. */
export function Tag(props: BasicProps) {
  const { tone: _tone, ...rest } = props
  return createElement('span', rest)
}

/** Real API: {active, children, onClick} + native button attributes. */
export function Pill(props: BasicProps) {
  const { active: _active, ...rest } = props
  return createElement('button', { ...rest, type: rest.type ?? 'button' })
}

/**
 * Real API: {items, value, onChange, label} — renders the tab list only, and the
 * panels stay caller-owned. Mirrored here so tests can walk `role="tab"`.
 */
export function SegmentedTabs(props: BasicProps) {
  const { items, value, label } = props as unknown as {
    items: readonly { value: string; label: ReactNode; id: string; panelId: string }[]
    value: string
    onChange: (value: string) => void
    label: string
  }
  return createElement(
    'div',
    { role: 'tablist', 'aria-label': label },
    ...items.map(item =>
      createElement(
        'button',
        {
          key: item.value,
          type: 'button',
          role: 'tab',
          id: item.id,
          'aria-controls': item.panelId,
          'aria-selected': item.value === value,
        },
        item.label,
      ),
    ),
  )
}

/** Real API: {text, tone, anchor, holdMs, actions, onDone} — a portal in production. */
export function Toast(props: BasicProps) {
  const { text, tone: _tone, anchor: _a, holdMs: _h, actions: _ac, onDone: _d, ...rest } = props
  return createElement('div', { ...rest, role: 'status' }, text as ReactNode)
}
