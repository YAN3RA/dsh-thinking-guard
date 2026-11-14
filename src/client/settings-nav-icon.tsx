/**
 * The settings-navigation glyph for this plugin's section, as an official
 * `settings.section.icon` registrant.
 *
 * WHY THIS FILE REPLACED `settings-nav-icon.ts` — the previous module could not
 * receive an icon from the shell, so it recreated one by DOM surgery: it
 * scanned `[role="dialog"] nav button`, matched the row whose *localized text*
 * equalled our own `nav` label, set a marker attribute, injected a stylesheet
 * and painted a CSS-`mask` pseudo-element over the shell's fallback gear, then
 * watched the document with a `MutationObserver` to survive locale switches.
 * Every one of those steps depended on shell internals we do not own: the nav
 * element shape, the label's exact text, and the gear's DOM position.
 *
 * dsh 0.2.2 declares a real seat instead (`settings.section.icon`, see
 * `@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`):
 * a root-scoped `list` slot, `inline: true`, addressed by the id of the
 * `settings.section` entry it decorates, whose owner props are
 * `SettingsSectionIconOwnerProps = { size: number; active: boolean }`. The
 * shell keeps owning the button and the label, and keeps its default glyph
 * when no icon is registered — so registering here is purely additive.
 *
 * COLOUR is not ours to decide: the shell's nav row supplies `currentColor`,
 * which is how every product icon in `dsh-client-ui-primitives` is painted
 * (`stroke="currentColor"` / `currentColor` inheritance). A selected row
 * therefore recolours the glyph with no work from us, and no `active` branch
 * needs to invent a token name that the host never published. `active` is
 * still consumed — as a class modifier on the SVG root, the one styling hook
 * `IconProps` actually declares — so a future host that wants a distinct
 * selected state has a stable selector without us guessing its palette.
 */
import { createElement, type ReactElement } from 'react'
import { IconFlatListOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * The registration id, which the contract requires to equal the targeted
 * `settings.section` id ("unmatched ids never render"). Kept next to the icon
 * so the two cannot drift.
 */
export const SETTINGS_NAV_ICON_ID = 'capability'

/**
 * Owner props of a `settings.section.icon` registrant, plus the defaults that
 * make an older host harmless: `SettingsSectionIconOwnerProps` declares
 * `size: number` and `active: boolean`, but a host that predates the seat
 * projects nothing at all, and a host that adds a prop later must not blank
 * the settings dialog. Both fields are optional here for that reason, mirroring
 * how `dsh-better-sidebar` and `dsh-market` defend their own icon components.
 */
export interface SettingsNavIconProps {
  /** Requested square edge in pixels; the shell asks for 16. */
  readonly size?: number | undefined
  /** Whether our section is the selected one. */
  readonly active?: boolean | undefined
}

/** Stable hook for the root SVG, so host CSS can target this icon by name. */
const ICON_CLASS = 'cm-settings-nav-icon'
/** Modifier applied only while the shell reports this section as selected. */
const ICON_ACTIVE_CLASS = `${ICON_CLASS}--active`
/** The shell's nav row asks for 16px; also dsh's own default icon edge. */
const DEFAULT_SIZE = 16

/**
 * The plugin's settings-nav glyph: dsh's shared flat-list mark, at whatever
 * edge the shell asks for, marked when our row is the selected one.
 *
 * The artwork is the host's own (`IconFlatListOutlineMedium`, the "medium"
 * 1.3px-stroke weight) rather than a private SVG. That is the same glyph the
 * hand-rolled CSS mask used to trace by hand, so the visible result is
 * unchanged — only the delivery path is now the supported one.
 */
export function SettingsNavIcon({ size = DEFAULT_SIZE, active = false }: SettingsNavIconProps): ReactElement {
  return createElement(IconFlatListOutlineMedium, {
    size,
    className: active ? `${ICON_CLASS} ${ICON_ACTIVE_CLASS}` : ICON_CLASS,
  })
}
