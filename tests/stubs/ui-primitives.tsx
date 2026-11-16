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
 *
 * Modal is the one primitive whose CLOSE path our shell depends on: every
 * capability dialog (tool detail, skill file preview, catalog docs, search
 * metadata, adopt confirmation) can be dismissed while its read is still in
 * flight, and the shell promises a late reply cannot re-open it. A stub that
 * dropped `onClose` made that promise untestable — the close button and the mask
 * now call the caller's `onClose`, mirroring the real component (portal, mask
 * click, labelled close button), so "close, then let the promise settle" is a
 * real interaction instead of a private ref poke.
 */
import { createElement, Fragment, type ReactNode } from 'react'

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

/**
 * Real API: {open, onClose, title, closeLabel, description, children, footer,
 * className, contentClassName, onKeyDownCapture, headless, backdropBlur,
 * shortcutModal}.
 *
 * Mirrored contract:
 * - `open !== true` renders nothing (the real component returns null);
 * - the dialog carries `role="dialog"`, `aria-modal="true"` and `aria-label={title}`;
 * - the mask is `aria-hidden` and closes on click;
 * - the header carries a `<button aria-label={closeLabel}>` that closes;
 * - `headless` renders the children alone, with no header/close/body chrome
 *   (the mask, card and Escape remain in the real one).
 *
 * Deliberately NOT reproduced: the portal into `document.body`, focus return,
 * Escape handling, the CSS-module chrome. Tests therefore query
 * `document.body`, which is correct under both this stub and the real portal.
 */
export function Modal(props: BasicProps) {
  const {
    open,
    onClose,
    title,
    closeLabel,
    description,
    children,
    footer,
    className,
    headless = false,
    backdropBlur: _backdropBlur,
    contentClassName: _contentClassName,
    shortcutModal: _shortcutModal,
    onKeyDownCapture,
  } = props as unknown as {
    open?: boolean
    onClose?: () => void
    title?: ReactNode
    closeLabel?: string
    description?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    className?: string
    headless?: boolean
    backdropBlur?: boolean
    contentClassName?: string
    shortcutModal?: string
    onKeyDownCapture?: (event: unknown) => void
  }
  if (open !== true) return null
  const close = (): void => { onClose?.() }
  const chrome = headless
    ? children
    : createElement(Fragment, null,
        createElement('div', { className: 'stub-modal-header' },
          createElement('h2', null, title),
          createElement('button', { type: 'button', 'aria-label': closeLabel ?? '', onClick: close }),
        ),
        description !== undefined && description !== ''
          ? createElement('p', null, description)
          : null,
        createElement('div', { className: 'stub-modal-body' }, children),
        footer !== undefined ? createElement('div', { className: 'stub-modal-footer' }, footer) : null,
      )
  return createElement('div',
    { className: 'stub-modal-root', role: 'presentation', onKeyDownCapture },
    createElement('div', { className: 'stub-modal-mask', 'aria-hidden': 'true', onClick: close }),
    createElement('div',
      {
        className: className === undefined ? 'stub-modal' : `stub-modal ${className}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': typeof title === 'string' ? title : undefined,
        tabIndex: -1,
        'data-stub-modal': 'true',
      },
      chrome,
    ),
  )
}

/**
 * Real API: a `memo` component taking {text, streaming, labels, fileMentions,
 * pathImages, variant, omitHtml, textInteractionSource}. It renders dsh's safe
 * Markdown (code blocks, KaTeX, footnotes) — none of which is this repo's
 * contract. The stub renders the source text so a test can assert WHICH text
 * reached the renderer (the dialog's content), and nothing about how it is
 * painted.
 */
export function MarkdownText(props: BasicProps) {
  const { text, labels: _labels, streaming: _s, fileMentions: _f, pathImages: _p, variant: _v, omitHtml: _o, textInteractionSource: _t } = props
  return createElement('div', { 'data-stub-markdown': 'true' }, typeof text === 'string' ? text : null)
}

/** Real API: {size, className} → the skill-tree chevron glyph. */
export function IconTriangleRightFillMedium(props: { size?: number | undefined; className?: string | undefined }) {
  const { size = 16, className } = props
  return createElement(
    'svg',
    { width: size, height: size, className, 'data-icon': 'dsw-icon-triangle-right-fill-medium', 'aria-hidden': 'true' },
    createElement('use', { href: '#dsw-icon-triangle-right-fill-medium' }),
  )
}

/** Real API: {size, className}; the fallback the shell looks up first. */
export function IconTriangleRightFillRegular(props: { size?: number | undefined; className?: string | undefined }) {
  const { size = 16, className } = props
  return createElement(
    'svg',
    { width: size, height: size, className, 'data-icon': 'dsw-icon-triangle-right-fill-regular', 'aria-hidden': 'true' },
    createElement('use', { href: '#dsw-icon-triangle-right-fill-regular' }),
  )
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

/**
 * Real API: `(props: IconProps) => React.JSX.Element` where `IconProps` is
 * `{size?: number, className?: string}`. The production component is built by
 * the package's private `productIcon(glyph, weight)` helper, so its exact
 * output is: an `<svg>` with `width`/`height` from `size` (default = the
 * glyph's own drawn size, 16), `className` forwarded, `data-icon` carrying
 * `dsw-icon-<glyph>-<weight>`, `aria-hidden="true"`, and a single `<use>`
 * child pointing at that sprite symbol id — the artwork itself lives in the
 * document icon sprite that `ui-theme` maintains, which is why colour rides
 * `currentColor` and why no `viewBox`/`fill`/`stroke` appears on the root.
 *
 * Mirrored here at contract level only; the artwork is deliberately not
 * reproduced, and tests must never assert glyph path data.
 */
export function IconFlatListOutlineMedium(props: { size?: number | undefined; className?: string | undefined }) {
  const { size = 16, className } = props
  return createElement(
    'svg',
    { width: size, height: size, className, 'data-icon': 'dsw-icon-flat-list-outline-medium', 'aria-hidden': 'true' },
    createElement('use', { href: '#dsw-icon-flat-list-outline-medium' }),
  )
}
