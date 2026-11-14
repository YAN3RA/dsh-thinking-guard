/**
 * Rules for the settings-navigation glyph.
 *
 * This package has no DOM harness (no react-dom/jsdom), so like
 * `client-usage.spec.tsx` the component is rendered by walking its React
 * element tree: call the component, then recursively call any function-type
 * element with its own props until only host elements remain.
 *
 * What is asserted here is the `settings.section.icon` contract, not artwork:
 *
 * 1. the registrant renders an SVG whose square edge equals the `size` the
 *    shell asks for (and the host's own 16px default when it asks for none);
 * 2. `active` changes only the styling hook on that SVG (a class modifier) and
 *    never the geometry — colour is the nav row's `currentColor` to supply;
 * 3. NOTHING from the deleted DOM hack comes back: no marker attribute, no
 *    injected stylesheet, no masked pseudo-element, and the module source
 *    contains no `MutationObserver`, `querySelector` or CSS `mask`.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { SettingsSectionIconOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SETTINGS_NAV_ICON_ID, SettingsNavIcon } from '../src/client/settings-nav-icon.tsx'

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')

/** One flattened host element, after every function component was invoked. */
interface HostElement {
  readonly type: unknown
  readonly props: Record<string, unknown>
}

/**
 * Collapse a rendered tree to host elements.
 *
 * Only hook-free function components appear below the root (the icon itself),
 * so invoking `type(props)` mirrors what React would do without needing a
 * renderer. A component that grew state would make this throw rather than
 * silently pass — the right failure for a test with no renderer.
 */
function hostElements(node: ReactNode, out: HostElement[] = []): HostElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) {
    for (const child of node) hostElements(child, out)
    return out
  }
  if (!isValidElement(node)) return out

  const element = node as ReactElement<Record<string, unknown>>
  if (typeof element.type === 'function') {
    const render = element.type as unknown as (props: unknown) => ReactNode
    hostElements(render(element.props), out)
    return out
  }
  out.push({ type: element.type, props: element.props })
  hostElements(element.props.children as ReactNode, out)
  return out
}

function renderIcon(props: { size?: number; active?: boolean } = {}): HostElement[] {
  return hostElements(SettingsNavIcon(props))
}

function onlySvg(props: { size?: number; active?: boolean } = {}): HostElement {
  const elements = renderIcon(props)
  const svgs = elements.filter(element => element.type === 'svg')
  expect(svgs).toHaveLength(1)
  return svgs[0]!
}

/** Every attribute name and class token anywhere in the rendered tree. */
function allNames(elements: readonly HostElement[]): string[] {
  const names: string[] = []
  for (const element of elements) {
    for (const [key, value] of Object.entries(element.props)) {
      names.push(key)
      if (key === 'className' && typeof value === 'string') names.push(...value.split(/\s+/))
    }
  }
  return names
}

describe('SettingsNavIcon geometry', () => {
  it('renders the SVG as the root, with no wrapper element', () => {
    const elements = renderIcon({ size: 16, active: false })
    // The seat is `inline: true`, so the registrant must be the SVG itself —
    // a wrapper would put a div/span inside the nav label.
    expect(elements[0]!.type).toBe('svg')
    expect(elements.filter(element => ['div', 'span', 'p', 'a', 'button'].includes(String(element.type)))).toEqual([])
    expect(elements.filter(element => element.type === 'svg')).toHaveLength(1)
  })

  it('uses the shell-requested edge for both width and height', () => {
    for (const size of [16, 20, 32]) {
      const svg = onlySvg({ size, active: false })
      expect(svg.props.width).toBe(size)
      expect(svg.props.height).toBe(size)
    }
  })

  it('falls back to the host default edge when the owner passes no size', () => {
    const svg = onlySvg({})
    expect(svg.props.width).toBe(16)
    expect(svg.props.height).toBe(16)
  })

  it('keeps width and height square for every requested edge', () => {
    for (const size of [12, 16, 18, 24]) {
      const svg = onlySvg({ size, active: true })
      expect(svg.props.width).toBe(svg.props.height)
    }
  })
})

describe('SettingsNavIcon active state', () => {
  it('marks the selected row with a class modifier', () => {
    const active = onlySvg({ size: 16, active: true })
    const inactive = onlySvg({ size: 16, active: false })
    const activeClass = String(active.props.className)
    const inactiveClass = String(inactive.props.className)

    expect(activeClass.split(/\s+/)).toContain('cm-settings-nav-icon--active')
    expect(inactiveClass.split(/\s+/)).not.toContain('cm-settings-nav-icon--active')
    // The base hook stays on both, so a host rule can target the icon either way.
    expect(activeClass.split(/\s+/)).toContain('cm-settings-nav-icon')
    expect(inactiveClass.split(/\s+/)).toContain('cm-settings-nav-icon')
  })

  it('does not change geometry when active', () => {
    const active = onlySvg({ size: 16, active: true })
    const inactive = onlySvg({ size: 16, active: false })
    expect(active.props.width).toBe(inactive.props.width)
    expect(active.props.height).toBe(inactive.props.height)
  })

  it('renders an inactive icon when the owner passes neither prop', () => {
    const svg = onlySvg({})
    expect(String(svg.props.className).split(/\s+/)).not.toContain('cm-settings-nav-icon--active')
  })

  it('leaves colour to the nav row instead of hard-coding a token', () => {
    // Every dsh product icon paints with currentColor; guessing a palette name
    // would break the moment the shell renames a token.
    const svg = onlySvg({ size: 16, active: true })
    for (const styleKey of ['color', 'fill', 'stroke', 'style']) {
      expect(svg.props[styleKey]).toBeUndefined()
    }
  })
})

describe('settings.section.icon contract', () => {
  it('accepts exactly the owner props the shell projects', () => {
    // Compile-time check: the registrant must be usable wherever the shell
    // renders a SettingsSectionIconOwnerProps-typed component. `size: number`
    // and `active: boolean` are both required there and both accepted here.
    const renderAsOwner = (
      Component: (props: SettingsSectionIconOwnerProps) => ReactElement,
      owner: SettingsSectionIconOwnerProps,
    ): ReactNode => Component(owner)

    const rendered = hostElements(renderAsOwner(SettingsNavIcon, { size: 16, active: true }))
    // The sprite `<use>` is the icon's child, so the root is the first element.
    expect(rendered[0]!.type).toBe('svg')
    expect(rendered.filter(element => element.type === 'svg')).toHaveLength(1)
  })

  it('addresses the section id it decorates', () => {
    // The contract: "The registration id must equal the target section's id;
    // unmatched ids never render." `capability` is the id index.ts registers.
    expect(SETTINGS_NAV_ICON_ID).toBe('capability')
  })

  it('registers into the real slot with the shape the shell validates', () => {
    // Type-level proof for the wiring index.ts still needs: this is exactly the
    // call that belongs there. Never invoked at runtime — the registry is a
    // live cordis service — but TypeScript checks the whole shape, so a renamed
    // slot, a missing `id`, or an icon whose props drifted fails here instead
    // of in the browser.
    const registerIcon = (slots: Pick<SlotRegistry, 'register'>) =>
      slots.register({ name: 'settings.section.icon', id: SETTINGS_NAV_ICON_ID }, SettingsNavIcon)

    expect(typeof registerIcon).toBe('function')
  })

  it('wires through ctx.slots.inject exactly as index.ts must', () => {
    // The precise call site index.ts still needs, checked against the real
    // `SlotRegistry` type: `inject` waits for the slot declaration and `register`
    // returns the disposer. Not invoked — the registry is a live cordis service.
    const mountIcon = (slots: Pick<SlotRegistry, 'inject' | 'register'>) =>
      slots.inject('settings.section.icon', () =>
        slots.register({ name: 'settings.section.icon', id: SETTINGS_NAV_ICON_ID }, SettingsNavIcon))

    expect(typeof mountIcon).toBe('function')
  })

  it('rejects a miswired registration at compile time (negative control)', () => {
    // `@ts-expect-error` inverts the check: if the line below ever STARTS
    // compiling, TypeScript reports the directive as unused and `tsc` fails.
    // That is what proves the previous test's shape check is not vacuous.
    const registerWrongSlot = (slots: Pick<SlotRegistry, 'register'>) =>
      // @ts-expect-error — `settings.section.icons` is not a declared slot key.
      slots.register({ name: 'settings.section.icons', id: SETTINGS_NAV_ICON_ID }, SettingsNavIcon)

    const registerMissingId = (slots: Pick<SlotRegistry, 'register'>) =>
      // @ts-expect-error — a `list` slot registration requires `id`.
      slots.register({ name: 'settings.section.icon' }, SettingsNavIcon)

    expect(typeof registerWrongSlot).toBe('function')
    expect(typeof registerMissingId).toBe('function')
  })

  it('is decorative to assistive tech, since the shell owns the label', () => {
    const svg = onlySvg({ size: 16, active: true })
    expect(svg.props['aria-hidden']).toBe('true')
  })

  it('exposes no DOM-hack marker anywhere in the rendered tree', () => {
    const names = allNames(renderIcon({ size: 16, active: true }))
    expect(names.some(name => name.startsWith('data-capability-menu'))).toBe(false)
    expect(names).not.toContain('data-capability-menu-nav-icon')
    // No injected <style> and no masked pseudo-element host.
    expect(names.some(name => name === 'style' || name === 'mask' || name === 'WebkitMask')).toBe(false)
  })
})

/**
 * Strip `//` and block comments so the prose explaining the removal does not
 * read as the removal having come back. The module under test has no template
 * literal or regex containing a comment delimiter; a future edit that adds one
 * should switch this to a parser rather than weaken the assertion.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the DOM hack is gone from the source', () => {
  const NEW_MODULE = join(CLIENT_DIR, 'settings-nav-icon.tsx')
  const OLD_MODULE = join(CLIENT_DIR, 'settings-nav-icon.ts')

  it('replaced the .ts module outright', () => {
    expect(existsSync(NEW_MODULE)).toBe(true)
    // Keeping both would let the deleted mutation observer be re-imported.
    expect(existsSync(OLD_MODULE)).toBe(false)
  })

  it('contains no mutation observer, DOM query, text matching or CSS mask', () => {
    const source = codeOnly(readFileSync(NEW_MODULE, 'utf8'))
    for (const forbidden of [
      'MutationObserver',
      'querySelector',
      'querySelectorAll',
      'createElement(\'style\'',
      'document.',
      'mask',
      'textContent',
      'role="dialog"',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('imports the glyph from the host primitives instead of tracing it', () => {
    const source = readFileSync(NEW_MODULE, 'utf8')
    expect(source).toContain('IconFlatListOutlineMedium')
    expect(source).toContain("from '@deepseek-ai/dsh-client-ui-primitives'")
    // The old module hand-encoded the artwork as an inline SVG mask.
    expect(source).not.toContain('data:image/svg+xml')
    expect(source).not.toContain('stroke-width')
  })
})

/**
 * Cross-file guard on the wiring, read from `src/client/index.ts` itself.
 *
 * `index.ts` is the Lead's exclusive file, so this file cannot assert the
 * wiring by importing it; the only way to catch drift is to read the source
 * text. That is worth doing because the two mistakes below are invisible to a
 * type check of THIS file alone and to the icon component's own tests:
 *
 * - `inline: true` — `inline` belongs to the SlotMap *declaration*
 *   (`SlotEntryDef.inline`), not to registration options. Passing it fails
 *   `tsc -p tsconfig.client.json` with "Object literal may only specify known
 *   properties, and 'inline' does not exist" — which is exactly what happened
 *   during this migration. This test names the mistake directly instead of
 *   leaving the next person to decode that overload dump.
 * - a section-icon id that drifted from the `settings.section` id — the
 *   contract says "unmatched ids never render", so the icon would silently
 *   vanish with no error at all.
 */
describe('index.ts wiring (read-only cross-file guard)', () => {
  const INDEX = join(CLIENT_DIR, 'index.ts')

  /** The `settings.section.icon` registration block, comments stripped. */
  function iconRegistration(source: string): string {
    const stripped = codeOnly(source)
    // Anchor on the `name:` key itself, not on the slot string: the string also
    // appears in prose and would cut the options object in half.
    const match = /name:\s*'settings\.section\.icon'/.exec(stripped)
    expect(match).not.toBeNull()
    const start = stripped.lastIndexOf('register(', match!.index)
    return stripped.slice(start >= 0 ? start : match!.index, match!.index + 400)
  }

  it('registers the glyph into settings.section.icon through ctx.slots.inject', () => {
    const source = codeOnly(readFileSync(INDEX, 'utf8'))
    // `inject` waits for the seat to be declared instead of throwing at load.
    expect(source).toMatch(/ctx\.slots\.inject\(\s*'settings\.section'\s*,\s*\(\)\s*=>/)
    const block = iconRegistration(source)
    expect(block).toContain('name:')
    expect(block).toContain("'settings.section.icon'")
    expect(block).toContain('SettingsNavIcon')
  })

  it('uses one id for the section and its icon', () => {
    const source = codeOnly(readFileSync(INDEX, 'utf8'))
    // The icon block must address the section by the shared constant, so the
    // two can never be edited apart.
    expect(iconRegistration(source)).toContain('id: SETTINGS_NAV_ICON_ID')

    const iconIds = [...source.matchAll(/name:\s*'settings\.section\.icon'[\s\S]{0,200}?id:\s*([^,\n}]+)/g)]
      .map(match => match[1]!.trim())
    expect(iconIds.length).toBeGreaterThan(0)
    for (const id of iconIds) expect(id).toBe('SETTINGS_NAV_ICON_ID')
  })

  it('passes no registration option the slot contract does not accept', () => {
    // `inline` is a declaration property; `children`/`store`/`locale` are
    // different seats. A list registration takes only id/order/label/priority.
    const block = iconRegistration(readFileSync(INDEX, 'utf8'))
    for (const forbidden of ['inline', 'children:', 'store:', 'locale:', 'key:']) {
      expect(block).not.toContain(forbidden)
    }
  })

  it('no longer calls the deleted DOM-hack installer', () => {
    const source = codeOnly(readFileSync(INDEX, 'utf8'))
    expect(source).not.toContain('installSettingsNavIcon')
    expect(source).not.toContain('settings-nav-icon.ts"')
    expect(source).not.toContain("settings-nav-icon.ts'")
    expect(source).toContain("from './settings-nav-icon.tsx'")
  })
})
