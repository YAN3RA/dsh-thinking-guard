/**
 * 思考限制 — the Guard configuration surface (v3 · 数据看板, D-044).
 *
 * Three sections, in the order the product specified: repeated identical calls,
 * alternating cycles, no-progress protection. Each carries a model-side
 * identifier ('duplicate_call' / 'alternating_cycle' / 'no_progress') shown as
 * plain text, because the reminder text injected into the conversation is
 * English while the label a user reads here is Chinese. The identifier is what
 * ties the two together, so it is displayed rather than hidden.
 *
 * v3 SHAPE: the switches are no longer a single-column stack of .mc-guard-card.
 * They become a two-column grid of .v3-gitem cards (>900px two columns, auto
 * single column via the container query already in v3-ui.ts). Each card has a
 * StateDot + title + model id + switch head, a compact body, and a thin
 * supplementary foot. The fourth grid cell is the 「生效范围」 explanation, not
 * a switch, so the grid fills evenly.
 *
 * DOM CONTRACT kept for the shared test suite: nine <li class="mc-guard-point">
 * whose text still comes from t(); the three data-guard-section values in order;
 * exactly one threshold <input> (value '3, 5, 8', readOnly tracks onChange); the
 * four data-guard-stat cells and data-guard-stats / data-guard-stats-since; and
 * three role="switch" buttons whose aria-checked follows the props. No Chinese
 * colon ('：') is introduced by this file — spacing and full-width spaces do
 * the separating instead.
 *
 * Kept hook-free and prop-driven so the settings test suite (no DOM harness) can
 * walk the returned tree.
 */
import { createElement, type ReactElement } from 'react'
import type { PluginSectionKey } from './PluginSection.tsx'
import { V3Styles } from './v3-ui.ts'

/** The three Guard capabilities, in display order. */
export type GuardSectionId = 'duplicate_call' | 'alternating_cycle' | 'no_progress'

export interface GuardPanelProps {
  readonly t: (key: PluginSectionKey) => string
  /** Which sections are currently enabled, keyed by section id. */
  readonly enabled?: Readonly<Record<GuardSectionId, boolean>>
  /** Reminder thresholds, in the order they fire. Editable since 0.1.20. */
  readonly duplicateThresholds?: readonly number[]
  /** Toggle one section. Omitted = read-only surface. */
  readonly onToggle?: (id: GuardSectionId, next: boolean) => void
  /**
   * Commit an edited threshold list. Omitted = the thresholds are read-only,
   * which is what an older Host (no 'repeatThresholds' on the wire) gets.
   */
  readonly onThresholdsChange?: (next: readonly number[]) => void
  /**
   * Real counters from the Host Guard.
   *
   * Present is the whole point: without it the page can only describe what the
   * Guard WOULD do, never whether it has actually observed, reminded or denied
   * anything — the "black box" the operator reported.
   */
  readonly stats?: GuardStatsSnapshotView
  /** Restore the shipped defaults. */
  readonly onReset?: () => void
}

/**
 * What the panel renders for the Guard counters.
 *
 * Structural mirror of the wire type: 'undefined' fields mean "the Host did not
 * report it", which the panel prints as 「—」 rather than a fabricated zero.
 */
export interface GuardStatsSnapshotView {
  readonly observations?: number
  readonly reminders?: { readonly repeat?: number; readonly cycle?: number }
  readonly denials?: number
  readonly outcomes?: { readonly success?: number; readonly error?: number; readonly cancelled?: number }
  readonly lastReminderAt?: number
  readonly lastDenialAt?: number
  readonly since?: number
}

/**
 * Section id → localized title plus the lines that explain what the switch does.
 *
 * The descriptions are part of the contract, not decoration: a bare switch does
 * not tell a reader whether turning it off stops reminders only or also stops
 * local denials. Each bullet states the real behaviour the detector implements.
 *
 * v3 keeps all three bullets (nine <li class="mc-guard-point"> in total, as the
 * shared suite asserts) but lays them out as one compact wrapped row per card,
 * so the paragraph reads like a sentence rather than a three-line list.
 */
const SECTIONS: readonly {
  id: GuardSectionId
  titleKey: PluginSectionKey
  bodyKeys: readonly PluginSectionKey[]
}[] = [
  { id: 'duplicate_call', titleKey: 'guardSectionA', bodyKeys: ['guardABody1', 'guardABody2', 'guardABody3'] },
  { id: 'alternating_cycle', titleKey: 'guardSectionB', bodyKeys: ['guardBBody1', 'guardBBody2', 'guardBBody3'] },
  { id: 'no_progress', titleKey: 'guardSectionC', bodyKeys: ['guardCBody1', 'guardCBody2', 'guardCBody3'] },
]

/**
 * Page-specific rules for the v3 Guard grid. Everything else comes from
 * v3-ui.ts; the only local vocabulary here is the compact bullet row and the
 * threshold editor chrome. Colours are always v3 semantic variables — nothing
 * is hard-coded, so light and dark themes both track the host.
 */
const GUARD_CSS = [
  '.mc-section.v3-root{display:flex;flex-direction:column;gap:12px}',
  '.v3-gpoints{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 5px}',
  '.v3-gpoints>.mc-guard-point{font-size:11.5px;line-height:18px;color:var(--v3-t3)}',
  '.v3-gpoints>.mc-guard-point+.mc-guard-point::before{content:\'·\';margin-right:5px;color:var(--v3-t4)}',
  '.v3-gitem--info{background:var(--v3-panel-2)}',
  // The switch sits at the right of the card head (v3-ui leaves this to the page).
  '.v3-gitem .v3-gh .v3-sw{margin-left:auto}',
  '.v3-gfoot-edit{margin-top:9px}',
  '.v3-guard-stats{margin:12px 0}',
  '.mc-guard-threshold-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.mc-guard-threshold-edit-label{font-size:11.5px;color:var(--v3-t3)}',
  '.mc-guard-threshold-edit-input{width:150px;padding:3px 7px;border-radius:var(--v3-r-sm);font-size:12px;'
    + 'font-family:var(--v3-font-code);color:var(--v3-t1);background:var(--v3-panel-2);border:1px solid var(--v3-line)}',
  '.mc-guard-threshold-edit-input:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}',
  '.mc-guard-threshold-edit-input:disabled{opacity:.6}',
  '.mc-guard-threshold-edit-hint{font-size:10.5px;color:var(--v3-t4)}',
].join('')

/** '—' for a counter the Host did not report; never a fabricated 0. */
function statText(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : String(value)
}

/**
 * The Guard's real activity board, restyled as a v3 stat strip.
 *
 * Answers the two questions the page previously could not: 「它是否在工作」
 * (observations / since) and 「调用成功还是失败」 (outcome split). Every number
 * comes from the Host; a missing counter renders '—', so an older Host reads as
 * "unknown" rather than "zero". The four data-guard-stat cells and the
 * data-guard-stats / data-guard-stats-since hooks are the published contract.
 */
function GuardStatsBoard(props: { readonly t: (key: PluginSectionKey) => string; readonly stats?: GuardStatsSnapshotView }): ReactElement {
  const { t, stats } = props
  const outcomes = stats?.outcomes
  const reminders = stats?.reminders
  const cell = (label: string, value: string, hint?: string): ReactElement => createElement('div', {
    className: 'v3-stat',
    'data-guard-stat': label,
  },
  createElement('div', { className: 'v3-stat-l' }, label),
  createElement('div', { className: 'v3-stat-v' }, value),
  hint === undefined ? null : createElement('div', { className: 'v3-stat-d' }, hint),
  )
  return createElement('div', { className: 'v3-guard-stats' },
    createElement('div', { className: 'v3-ph' }, createElement('h3', { className: 'v3-pt' }, t('guardStatsTitle'))),
    createElement('div', { className: 'v3-stats', 'data-guard-stats': 'true', role: 'group', 'aria-label': t('guardStatsTitle') },
      cell(t('guardStatObservations'), statText(stats?.observations), t('guardStatObservationsHint')),
      cell(t('guardStatOutcomes'), statText(outcomes?.success) + ' / ' + statText(outcomes?.error), t('guardStatOutcomesHint')),
      cell(t('guardStatReminders'), statText(reminders?.repeat) + ' / ' + statText(reminders?.cycle), t('guardStatRemindersHint')),
      cell(t('guardStatDenials'), statText(stats?.denials), t('guardStatDenialsHint')),
    ),
    stats?.since === undefined
      ? null
      : createElement('p', { className: 'v3-src-note', 'data-guard-stats-since': 'true' },
          t('guardStatsSince') + ' ' + formatGuardTime(stats.since)),
  )
}

/** 'YYYY-MM-DD HH:mm' in the browser zone; '—' when unknown. */
function formatGuardTime(time: number | undefined): string {
  if (time === undefined || !Number.isFinite(time)) return '—'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/**
 * Editable reminder thresholds.
 *
 * The thresholds were a hard-coded 3/5/8 the operator could read but not change,
 * which made the section look decorative. They are now one comma-separated
 * field: the list is short, order matters, and a number-per-input row would be
 * more chrome than content. Invalid input is refused by the Host and reported
 * back, so this input never claims a value the detector rejected.
 *
 * Kept as its own component so the shared suite's expanding walk can reach the
 * single <input> (data-guard-thresholds marks the wrapper).
 */
function GuardThresholdEditor(props: {
  readonly t: (key: PluginSectionKey) => string
  readonly thresholds?: readonly number[]
  readonly onChange?: (next: readonly number[]) => void
}): ReactElement | null {
  const { t, thresholds, onChange } = props
  if (thresholds === undefined) return null
  const editable = onChange !== undefined
  return createElement('div', { className: 'mc-guard-threshold-edit', 'data-guard-thresholds': 'true' },
    createElement('label', { className: 'mc-guard-threshold-edit-label', htmlFor: 'mc-guard-thresholds-input' }, t('guardThresholds')),
    createElement('input', {
      id: 'mc-guard-thresholds-input',
      className: 'mc-guard-threshold-edit-input',
      type: 'text',
      inputMode: 'numeric',
      // The current value is always the Host's: a rejected edit must not leave
      // the field showing what the user typed.
      value: thresholds.join(', '),
      readOnly: !editable,
      disabled: !editable,
      'aria-label': t('guardThresholds'),
      onChange: (event: { target: { value: string } }) => {
        if (!editable) return
        const parsed = parseGuardThresholds(event.target.value)
        if (parsed === undefined) return
        onChange(parsed)
      },
    }),
    createElement('span', { className: 'mc-guard-threshold-edit-hint' },
      editable ? t('guardThresholdsEditableHint') : t('guardThresholdsFixedHint')),
  )
}

/**
 * Parse '3, 5, 8' into a threshold list.
 *
 * Returns 'undefined' for anything the Host would reject (empty, non-integer,
 * out of range, not strictly increasing). Parsing here as well as on the Host is
 * deliberate: it keeps an invalid keystroke from round-tripping through the
 * remote and flickering the field.
 */
export function parseGuardThresholds(text: string): readonly number[] | undefined {
  const parts = text.split(',').map(part => part.trim()).filter(part => part !== '')
  if (parts.length === 0 || parts.length > 5) return undefined
  const parsed: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined
    const value = Number(part)
    if (!Number.isSafeInteger(value) || value < 2 || value > 50) return undefined
    if (parsed.length > 0 && value <= parsed[parsed.length - 1]) return undefined
    parsed.push(value)
  }
  return parsed
}

/** The supplementary foot line for a section, per the v3 design copy. */
function sectionFoot(id: GuardSectionId, t: (key: PluginSectionKey) => string): ReactElement {
  if (id === 'alternating_cycle') {
    return createElement('div', { className: 'v3-gfoot' }, createElement('span', null, t('guardFootCycle')))
  }
  if (id === 'no_progress') {
    return createElement('div', { className: 'v3-gfoot' },
      createElement('span', null, t('guardFootNoProgress')))
  }
  return createElement('div', { className: 'v3-gfoot' })
}

export function GuardPanel(props: GuardPanelProps): ReactElement {
  const { t, enabled, duplicateThresholds, onToggle, onThresholdsChange, stats, onReset } = props

  const section = (entry: typeof SECTIONS[number]): ReactElement => {
    const isOn = enabled?.[entry.id] ?? false
    const canToggle = onToggle !== undefined
    const dot = isOn
      ? createElement('span', { className: 'v3-dot', 'data-tone': 'ok', 'aria-hidden': 'true' })
      : createElement('span', { className: 'v3-dot', 'aria-hidden': 'true' })
    return createElement('div', { key: entry.id, className: 'v3-gitem', 'data-guard-section': entry.id },
      createElement('div', { className: 'v3-gh' },
        dot,
        createElement('span', { className: 'v3-gnm' }, t(entry.titleKey)),
        // Model-side identifier: the injected reminder is English, this label is
        // Chinese, and this is the string that ties them together.
        createElement('span', { className: 'v3-gid' }, entry.id),
        createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': isOn ? 'true' : 'false',
          'aria-label': t(entry.titleKey),
          className: 'v3-sw',
          disabled: !canToggle,
          onClick: () => canToggle && onToggle(entry.id, !isOn),
        }),
      ),
      createElement('ul', { className: 'v3-gpoints' },
        ...entry.bodyKeys.map(key => createElement('li', { key, className: 'mc-guard-point' }, t(key)))),
      // Section A owns the thresholds: the kbd chips mirror the current values,
      // and the editable field (when the Host accepts a write) sits below them.
      // Label and value are separate nodes rather than one interpolated string:
      // the separator must not be a literal punctuation mark ('：' is
      // Chinese-only), so layout does the job in both locales.
      entry.id === 'duplicate_call'
        ? createElement('div', { className: 'v3-gfoot' },
            createElement('span', null, t('guardThresholds')),
            ...(duplicateThresholds ?? []).map((value, index) =>
              createElement('span', { key: index, className: 'v3-kbd' }, String(value))),
          )
        : sectionFoot(entry.id, t),
      entry.id === 'duplicate_call' && duplicateThresholds !== undefined
        ? createElement('div', { className: 'v3-gfoot-edit' },
            createElement(GuardThresholdEditor, {
              t,
              thresholds: duplicateThresholds,
              ...(onThresholdsChange === undefined ? {} : { onChange: onThresholdsChange }),
            }))
        : null,
    )
  }

  // Fourth cell: the scope note, not a switch. It fills the two-column grid and
  // states the isolation semantics the product requires.
  const scopeCell = createElement('div', { key: 'scope', className: 'v3-gitem v3-gitem--info' },
    createElement('div', { className: 'v3-gh' },
      createElement('span', { className: 'v3-gnm' }, t('guardScopeTitle'))),
    createElement('p', null, t('guardScopeBody')),
    createElement('div', { className: 'v3-gfoot' },
      createElement('span', null, t('guardScopeFoot'))),
  )

  return createElement('section', { className: 'mc-section v3-root' },
    V3Styles(),
    createElement('style', { 'data-guard-style': 'true' }, GUARD_CSS),
    createElement('header', { className: 'mc-heading-row' },
      createElement('h2', { className: 'mc-heading' }, t('guardTitle')),
      createElement('div', { className: 'mc-heading-actions' },
        onReset !== undefined && createElement('button', {
          type: 'button',
          className: 'mc-count mc-count--action',
          onClick: onReset,
        }, t('guardReset'))),
    ),
    // Boundary note becomes a v3 notebox: one restrained block instead of five
    // lines of body copy.
    createElement('p', { className: 'v3-notebox' },
      createElement('b', null, t('guardBoundaryLabel')), '　', t('guardBoundary')),
    // The activity board sits ABOVE the switches: the first thing an operator
    // wants to know is whether this thing is doing anything at all.
    createElement(GuardStatsBoard, { t, ...(stats === undefined ? {} : { stats }) }),
    createElement('div', { className: 'v3-gpanel' },
      ...SECTIONS.map(section),
      scopeCell,
    ),
  )
}
