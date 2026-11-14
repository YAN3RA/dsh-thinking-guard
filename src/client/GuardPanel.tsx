/**
 * 思考限制 — the Guard configuration surface.
 *
 * Three sections, in the order the product specified: repeated identical calls,
 * alternating cycles, no-progress protection. Each carries a model-side
 * identifier (`duplicate_call` / `alternating_cycle` / `no_progress`) shown as
 * plain text, because the reminder text injected into the conversation is
 * English while the label a user reads here is Chinese. The identifier is what
 * ties the two together, so it is displayed rather than hidden.
 *
 * NO summary panel: the current effective state is not repeated here. The
 * 总览 page owns "what is on right now"; duplicating it produced two places to
 * read the same thing and a second place to keep in sync.
 *
 * Kept hook-free and prop-driven so the settings test suite (no DOM harness) can
 * walk the returned tree.
 */
import { createElement, type ReactElement } from 'react'
import type { PluginSectionKey } from './PluginSection.tsx'

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
   * which is what an older Host (no `repeatThresholds` on the wire) gets.
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
 * Structural mirror of the wire type: `undefined` fields mean "the Host did not
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

/** `—` for a counter the Host did not report; never a fabricated 0. */
function statText(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : String(value)
}

/**
 * The Guard's real activity board.
 *
 * Answers the two questions the page previously could not: 「它是否在工作」
 * (observations / since) and 「调用成功还是失败」 (outcome split). Every number
 * comes from the Host; a missing counter renders `—`, so an older Host reads as
 * "unknown" rather than "zero".
 */
function GuardStatsBoard(props: { readonly t: (key: PluginSectionKey) => string; readonly stats?: GuardStatsSnapshotView }): ReactElement {
  const { t, stats } = props
  const outcomes = stats?.outcomes
  const reminders = stats?.reminders
  const cell = (label: string, value: string, hint?: string): ReactElement => createElement('div', {
    className: 'mc-guard-stat',
    'data-guard-stat': label,
  },
  createElement('div', { className: 'mc-guard-stat-label' }, label),
  createElement('div', { className: 'mc-guard-stat-value' }, value),
  hint === undefined ? null : createElement('div', { className: 'mc-guard-stat-hint' }, hint),
  )
  return createElement('div', { className: 'mc-guard-stats', 'data-guard-stats': 'true', role: 'group', 'aria-label': t('guardStatsTitle') },
    cell(t('guardStatObservations'), statText(stats?.observations), t('guardStatObservationsHint')),
    cell(t('guardStatOutcomes'), `${statText(outcomes?.success)} / ${statText(outcomes?.error)}`, t('guardStatOutcomesHint')),
    cell(t('guardStatReminders'), `${statText(reminders?.repeat)} / ${statText(reminders?.cycle)}`, t('guardStatRemindersHint')),
    cell(t('guardStatDenials'), statText(stats?.denials), t('guardStatDenialsHint')),
    stats?.since === undefined
      ? null
      : createElement('p', { className: 'mc-guard-stats-since', 'data-guard-stats-since': 'true' },
          `${t('guardStatsSince')} ${formatGuardTime(stats.since)}`),
  )
}

/** `YYYY-MM-DD HH:mm` in the browser zone; `—` when unknown. */
function formatGuardTime(time: number | undefined): string {
  if (time === undefined || !Number.isFinite(time)) return '—'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Editable reminder thresholds.
 *
 * The thresholds were a hard-coded 3/5/8 the operator could read but not change,
 * which made the section look decorative. They are now one comma-separated
 * field: the list is short, order matters, and a number-per-input row would be
 * more chrome than content. Invalid input is refused by the Host and reported
 * back, so this input never claims a value the detector rejected.
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
 * Parse `3, 5, 8` into a threshold list.
 *
 * Returns `undefined` for anything the Host would reject (empty, non-integer,
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

export function GuardPanel(props: GuardPanelProps): ReactElement {
  const { t, enabled, duplicateThresholds, onToggle, onThresholdsChange, stats, onReset } = props

  const section = (entry: typeof SECTIONS[number]): ReactElement => {
    const isOn = enabled?.[entry.id] ?? false
    const canToggle = onToggle !== undefined
    return createElement('div', { key: entry.id, className: 'mc-guard-card', 'data-guard-section': entry.id },
      createElement('div', { className: 'mc-guard-head' },
        createElement('span', { className: 'mc-guard-title' }, t(entry.titleKey)),
        // Model-side identifier: the injected reminder is English, this label is
        // Chinese, and this is the string that ties them together.
        createElement('span', { className: 'mc-guard-model' },
          `${t('guardModelLabel')} ${entry.id}`),
        createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': isOn ? 'true' : 'false',
          'aria-label': t(entry.titleKey),
          className: `mc-guard-switch${isOn ? ' mc-guard-switch--on' : ''}`,
          disabled: !canToggle,
          onClick: () => canToggle && onToggle(entry.id, !isOn),
        }),
      ),
      createElement('div', { className: 'mc-guard-body' },
        createElement('ul', { className: 'mc-guard-points' },
          ...entry.bodyKeys.map(key => createElement('li', { key, className: 'mc-guard-point' }, t(key)))),
        // The fixed thresholds belong to section A only; they are numbers the
        // implementation owns, so they are read from the prop rather than copy.
        // Label and value are separate elements rather than one interpolated
        // string: the separator between them must not be a literal punctuation
        // mark (`：` is Chinese-only), so spacing does the job in both locales.
        entry.id === 'duplicate_call' && duplicateThresholds !== undefined &&
          createElement('div', { className: 'mc-guard-thresholds' },
            createElement(GuardThresholdEditor, {
              t,
              thresholds: duplicateThresholds,
              ...(onThresholdsChange === undefined ? {} : { onChange: onThresholdsChange }),
            })),
      ),
    )
  }

  return createElement('section', { className: 'mc-section' },
    createElement('header', { className: 'mc-heading-row' },
      createElement('h2', { className: 'mc-heading' }, t('guardTitle')),
      createElement('div', { className: 'mc-heading-actions' },
        onReset !== undefined && createElement('button', {
          type: 'button',
          className: 'mc-count mc-count--action',
          onClick: onReset,
        }, t('guardReset'))),
    ),
    createElement('p', { className: 'mc-desc' }, t('guardDesc')),
    createElement('p', { className: 'mc-guard-boundary' }, t('guardBoundary')),
    // The activity board sits ABOVE the switches: the first thing an operator
    // wants to know is whether this thing is doing anything at all.
    createElement(GuardStatsBoard, { t, ...(stats === undefined ? {} : { stats }) }),
    ...SECTIONS.map(section),
  )
}
