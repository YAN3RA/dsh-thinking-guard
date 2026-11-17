/**
 * 思考限制 — the Guard configuration surface (v3 · 数据看板, D-044).
 *
 * Three sections, in product order: repeated identical calls, alternating
 * cycles, no-progress protection. Each carries a model-side identifier
 * ('duplicate_call' / 'alternating_cycle' / 'no_progress') shown as plain text,
 * because the reminder injected into the conversation is English while the label
 * a user reads here is Chinese. The identifier ties the two together.
 *
 * v3 SHAPE: a two-column grid of .v3-gitem cards (>900px two columns, auto single
 * column via the container query in v3-ui.ts). The Guard counters sit at the very
 * top as a four-cell .v3-stats strip, followed by one short boundary hint. No page
 * title, no "activity" sub-title, no "counting since" line — the tab already says
 * what this page is.
 *
 * DOM CONTRACT kept for the shared test suite: nine <li class="mc-guard-point">
 * whose text still comes from t(); the three data-guard-section values in order;
 * the threshold editor wrapped in data-guard-thresholds (now three number inputs,
 * values from the Host); the four data-guard-stat cells and data-guard-stats; and
 * three role="switch" buttons whose aria-checked follows the props. No Chinese
 * colon ('：') is introduced by this file — spacing does the separating instead.
 *
 * Hook-free and prop-driven EXCEPT the threshold editor, which owns a real draft
 * (`useGuardThresholdDraft`): typing only moves local state, and a commit —
 * Enter, blur or the explicit 保存 button — sends the whole list only when it is
 * a complete valid ascending 2..50 array. That component is tagged with
 * `HOOK_COMPONENT` so element-tree walkers skip exactly it instead of calling it
 * outside a render; its behaviour is covered by real jsdom mounts.
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
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
 * the descriptions are part of the contract, not decoration: a bare switch does
 * not tell a reader whether turning it off stops reminders only or also stops
 * local denials. Each bullet states the real behaviour the detector implements.
 *
 * v3 keeps all three bullets (nine <li class="mc-guard-point"> in total, as the
 * shared suite asserts) but lays them out as one compact wrapped row per card.
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
 * v3-ui.ts; the only local vocabulary here is the compact bullet row, the
 * threshold editor chrome and the per-card "fired" foot. Colours are always v3
 * semantic variables — nothing is hard-coded, so light and dark themes both
 * track the host.
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
  '.v3-guard-stats{margin:0}',
  '.v3-gfoot-note{color:var(--v3-t4)}',
  '.mc-guard-threshold-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  // The draft body adds one element between the flex wrapper and the boxes; with
  // display:contents the layout is byte-for-byte the previous one.
  '.mc-guard-threshold-body{display:contents}',
  '.mc-guard-threshold-edit-label{font-size:11.5px;color:var(--v3-t3)}',
  '.mc-guard-threshold-num{width:56px;padding:3px 6px;border-radius:var(--v3-r-sm);font-size:12px;text-align:center;'
    + 'font-family:var(--v3-font-code);color:var(--v3-t1);background:var(--v3-panel-2);border:1px solid var(--v3-line)}',
  '.mc-guard-threshold-num:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}',
  '.mc-guard-threshold-num:disabled{opacity:.6}',
  '.mc-guard-threshold-hint{margin:6px 0 0}',
  '.mc-guard-threshold-save{padding:3px 10px;border-radius:var(--v3-r-sm);font-size:11.5px;color:var(--v3-t1);'
    + 'background:var(--v3-panel-2);border:1px solid var(--v3-line);cursor:pointer}',
  '.mc-guard-threshold-save:disabled{opacity:.5;cursor:default}',
  '.mc-guard-threshold-save:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}',
  '.mc-guard-threshold-hint[data-guard-threshold-invalid=\'true\']{color:var(--v3-bad)}',
].join('')

/** '—' for a counter the Host did not report; never a fabricated 0. */
function statText(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : String(value)
}

/**
 * The Guard's real activity board, restyled as a v3 stat strip.
 *
 * Answers the two questions the page previously could not: 「它是否在工作」
 * (observations) and 「调用成功还是失败」 (outcome split). Every number comes
 * from the Host; a missing counter renders '—', so an older Host reads as
 * "unknown" rather than "zero". The four data-guard-stat cells and the
 * data-guard-stats hook are the published contract. No sub-title and no
 * "counting since" line: the strip is the first thing on the page.
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
    createElement('div', { className: 'v3-stats', 'data-guard-stats': 'true', role: 'group', 'aria-label': t('guardStatsTitle') },
      cell(t('guardStatObservations'), statText(stats?.observations), t('guardStatObservationsHint')),
      cell(t('guardStatOutcomes'), statText(outcomes?.success) + ' / ' + statText(outcomes?.error), t('guardStatOutcomesHint')),
      cell(t('guardStatReminders'), statText(reminders?.repeat) + ' / ' + statText(reminders?.cycle), t('guardStatRemindersHint')),
      cell(t('guardStatDenials'), statText(stats?.denials), t('guardStatDenialsHint')),
    ),
  )
}

/** Strictly ascending, 1..5 entries, each an integer in 2..50. */
function isThresholdListValid(list: readonly number[]): boolean {
  if (list.length === 0 || list.length > 5) return false
  let previous = 1
  for (const value of list) {
    if (!Number.isInteger(value) || value < 2 || value > 50) return false
    if (value <= previous) return false
    previous = value
  }
  return true
}

/**
 * The boxes' raw text, exactly as the operator typed it.
 *
 * Strings, not numbers: '' (a cleared box) and '2' half-way through typing '20'
 * are legitimate intermediate states that must survive until a commit, so they
 * can never be normalized to a number here.
 */
type DraftRows = readonly string[]

/** Parse the raw boxes into a committable list, or undefined when not valid yet. */
export function parseThresholdDraft(rows: DraftRows): readonly number[] | undefined {
  if (rows.length === 0 || rows.length > 5) return undefined
  const parsed: number[] = []
  for (const row of rows) {
    const text = row.trim()
    if (!/^\d+$/.test(text)) return undefined
    const value = Number(text)
    if (!Number.isSafeInteger(value)) return undefined
    parsed.push(value)
  }
  // ONE validator for the wire and for the draft: 2..50, strictly ascending.
  return isThresholdListValid(parsed) ? parsed : undefined
}

/** Cheap, unambiguous equality key for a row list. */
function rowsKey(rows: DraftRows): string {
  return rows.join('\u0000')
}

/**
 * Marks a component whose body calls hooks.
 *
 * The shared suites walk the static element tree by CALLING function components
 * (`element.type(props)`). That is valid for a hook-free view and fatal for one
 * with hooks — React throws "Invalid hook call" outside a render. Such a
 * component is tagged with this symbol so a walker skips exactly it and keeps
 * expanding every other component, instead of the walk being weakened wholesale.
 */
export const HOOK_COMPONENT = Symbol.for('dsh-thinking-guard.hook-component')

/** What a caller sees of the editor's draft state. */
export interface GuardThresholdDraft {
  /** Raw box text; '' and partial numbers are expected intermediate values. */
  readonly rows: DraftRows
  /** The draft differs from the Host's committed list. */
  readonly dirty: boolean
  /** Dirty AND not yet a valid ascending 2..50 list. */
  readonly invalid: boolean
  /**
   * The Host's committed list changed underneath a DIRTY draft.
   *
   * The draft is kept — throwing away what the operator typed mid-edit is worse
   * than showing that the baseline moved — and the editor says so instead of
   * silently adopting (or silently ignoring) the new value.
   */
  readonly conflict: boolean
  /** A commit is possible at all (the Host accepts writes). */
  readonly editable: boolean
  readonly setRow: (index: number, text: string) => void
  /** Enter / blur / 保存. Returns true only when a list was handed to the Host. */
  readonly commit: () => boolean
}

/**
 * The draft state behind the threshold editor (TG-14 #5 · 完整草稿模型).
 *
 * Typing NEVER writes. A keystroke only moves the draft, so '' (a cleared box)
 * and '2' on the way to '20' survive as ordinary intermediate states instead of
 * being rejected or, worse, sent as a half-edited list. A commit — Enter, blur,
 * or the explicit 保存 button — hands over the WHOLE list and only when it is a
 * complete, valid, strictly ascending 2..50 array.
 *
 * Sync rules, spelled out because they are the part that silently rots:
 *  - external (Host) value changed → the draft is reset to it and `dirty`
 *    clears, UNLESS the draft is dirty and the Host's value is unchanged from
 *    the last one this editor saw (a poll re-delivering the same list must not
 *    wipe what the operator is typing);
 *  - dirty is a pure comparison with the Host list, so an edit that returns the
 *    text to the committed values stops being dirty;
 *  - a rejected submit keeps the draft, so the operator can fix it instead of
 *    retyping; the draft only stops being dirty when the Host actually adopts it;
 *  - `onChange` omitted (older Host, or the container is busy) ⇒ read-only; the
 *    draft is KEPT across that window rather than reset to the Host's values.
 */
export function useGuardThresholdDraft(props: {
  readonly thresholds?: readonly number[]
  readonly onChange?: (next: readonly number[]) => void
}): GuardThresholdDraft {
  const { thresholds, onChange } = props
  const editable = thresholds !== undefined && onChange !== undefined
  const committed: DraftRows = thresholds === undefined ? [] : thresholds.map(value => String(value))
  const [rows, setRows] = useState<DraftRows>(committed)
  const [conflict, setConflict] = useState(false)
  /** The Host list this draft was last synchronized against. */
  const synced = useRef<DraftRows>(committed)
  const draftRef = useRef<DraftRows>(committed)
  draftRef.current = rows

  useEffect(() => {
    const nextKey = rowsKey(committed)
    const syncedKey = rowsKey(synced.current)
    if (nextKey === syncedKey) return
    synced.current = committed
    const draftKey = rowsKey(draftRef.current)
    // Clean draft, or a draft the Host has just caught up with: adopt the new
    // baseline. The second case is a commit that succeeded — the draft already
    // equals the new value, so nothing is lost and the conflict flag clears.
    if (draftKey === syncedKey || draftKey === nextKey) {
      draftRef.current = committed
      setRows(committed)
      setConflict(false)
      return
    }
    // Dirty draft + a genuinely new Host value: keep the typing, flag it.
    setConflict(true)
  }, [rowsKey(committed)])

  const dirty = rowsKey(rows) !== rowsKey(committed)
  const parsed = parseThresholdDraft(rows)
  const invalid = dirty && parsed === undefined

  const setRow = useCallback((index: number, text: string): void => {
    if (!editable) return
    setRows(current => {
      const next = current.slice()
      next[index] = text
      return next
    })
  }, [editable])

  const commit = useCallback((): boolean => {
    if (!editable) return false
    const current = draftRef.current
    const list = parseThresholdDraft(current)
    if (list === undefined) return false
    // An unchanged, still-valid list is not a write: Enter on an untouched field
    // must not burn a Host round-trip (or a "saved" toast).
    if (rowsKey(current) === rowsKey(committed)) return false
    onChange(list)
    return true
  }, [editable, onChange, rowsKey(committed)])

  return { rows, dirty, invalid, conflict, editable, setRow, commit }
}

/**
 * Editable reminder thresholds — the independent draft editor.
 *
 * Three plain number inputs instead of one comma-separated text field: the
 * operator sees one box per firing point and never has to learn a syntax. This
 * component owns ONLY the draft; it renders it and forwards intents. The Host's
 * values are the props, so the page above stays a pure view.
 *
 * data-guard-thresholds marks the wrapper; an older Host that rejects writes
 * gets disabled boxes.
 */
export function GuardThresholdEditor(props: {
  readonly t: (key: PluginSectionKey) => string
  readonly thresholds?: readonly number[]
  readonly onChange?: (next: readonly number[]) => void
}): ReactElement | null {
  const { t, thresholds } = props
  const draft = useGuardThresholdDraft(props)
  if (thresholds === undefined) return null
  const { editable, rows, invalid } = draft
  // Inner content only: the WRAPPER (data-guard-thresholds) belongs to the
  // hook-free view above, so element-tree walkers can still assert it without
  // calling this hook-owned component.
  return createElement('div', {
    className: 'mc-guard-threshold-body',
    'data-guard-threshold-conflict': draft.conflict ? 'true' : 'false',
  },
    createElement('label', { className: 'mc-guard-threshold-edit-label' }, t('guardThresholds')),
    ...rows.map((text, index) => createElement('input', {
      key: index,
      type: 'number',
      min: 2,
      max: 50,
      step: 1,
      className: 'mc-guard-threshold-num',
      // The DRAFT is what the operator sees; the Host's committed list is what
      // the commit compares against.
      value: text,
      readOnly: !editable,
      disabled: !editable,
      'aria-label': t('guardThresholds') + ' ' + String(index + 1),
      'aria-invalid': invalid ? 'true' : 'false',
      'data-guard-threshold-dirty': draft.dirty ? 'true' : 'false',
      onChange: (event: { target: { value: string } }) => { draft.setRow(index, event.target.value) },
      onKeyDown: (event: { readonly key: string; readonly preventDefault?: () => void }) => {
        if (!editable || event.key !== 'Enter') return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        draft.commit()
      },
      // Blur attempts the same commit; an invalid draft is KEPT (never silently
      // reset to the Host's values) so the operator can correct it in place.
      onBlur: () => { if (editable) draft.commit() },
    })),
    editable
      ? createElement('button', {
          type: 'button',
          className: 'mc-guard-threshold-save',
          'data-guard-threshold-save': 'true',
          disabled: !draft.dirty,
          onClick: () => { draft.commit() },
        }, t('guardThresholdSave'))
      : null,
    // Invalid draft: say WHY it cannot be sent, and keep it. A Host that REFUSES
    // the write needs no extra line of its own: the boxes still show the draft
    // (the Host's value never changed) and the container prints the error.
    editable && invalid
      ? createElement('p', { className: 'mc-guard-threshold-hint', role: 'alert', 'data-guard-threshold-invalid': 'true' }, t('guardThresholdDraftHint'))
      : null,
  )
}

/** Tagged after declaration: walkers must not CALL this one (it has hooks). */
(GuardThresholdEditor as unknown as Record<symbol, boolean>)[HOOK_COMPONENT] = true

/**
 * Parse '3, 5, 8' into a threshold list.
 *
 * Kept (and exported) as the wire-level parser used by older callers/tests.
 * Returns 'undefined' for anything the Host would reject (empty, non-integer,
 * out of range, not strictly increasing).
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

/** The counter a card reports as "fired", per the product mapping. */
function firedValue(id: GuardSectionId, stats: GuardStatsSnapshotView | undefined): number | undefined {
  if (id === 'duplicate_call') return stats?.reminders?.repeat
  if (id === 'alternating_cycle') return stats?.reminders?.cycle
  return stats?.denials
}

export function GuardPanel(props: GuardPanelProps): ReactElement {
  const { t, enabled, duplicateThresholds, onToggle, onThresholdsChange, stats } = props

  const section = (entry: typeof SECTIONS[number]): ReactElement => {
    const isOn = enabled?.[entry.id] ?? false
    const canToggle = onToggle !== undefined
    const dot = isOn
      ? createElement('span', { className: 'v3-dot', 'data-tone': 'ok', 'aria-hidden': 'true' })
      : createElement('span', { className: 'v3-dot', 'aria-hidden': 'true' })
    // Section A owns the threshold editor; B and C state their purpose.
    const belowBullets = entry.id === 'duplicate_call'
      ? createElement('div', { className: 'v3-gfoot-edit' },
          createElement('div', {
            className: 'mc-guard-threshold-edit',
            'data-guard-thresholds': 'true',
            'data-guard-thresholds-count': String(duplicateThresholds?.length ?? 0),
            'data-guard-thresholds-values': duplicateThresholds?.join(',') ?? '',
            'data-guard-thresholds-editable': onThresholdsChange === undefined ? 'false' : 'true',
          },
            createElement(GuardThresholdEditor, {
              t,
              thresholds: duplicateThresholds,
              ...(onThresholdsChange === undefined ? {} : { onChange: onThresholdsChange }),
            }),
          ),
          createElement('p', { className: 'v3-hint mc-guard-threshold-hint' }, t('guardThresholdHint')),
        )
      : createElement('p', { className: 'v3-hint' }, t(entry.id === 'alternating_cycle' ? 'guardPurposeB' : 'guardPurposeC'))
    // Foot note kept from the previous design for B and C.
    const footNote = entry.id === 'alternating_cycle'
      ? createElement('span', { className: 'v3-gfoot-note' }, t('guardFootCycle'))
      : entry.id === 'no_progress'
        ? createElement('span', { className: 'v3-gfoot-note' }, t('guardFootNoProgress'))
        : null
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
      belowBullets,
      createElement('div', { className: 'v3-gfoot' },
        createElement('span', null, t('guardFired')),
        createElement('span', { className: 'v3-kbd' }, statText(firedValue(entry.id, stats))),
        footNote,
      ),
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
    // No action row, no page title, no activity sub-title, no "counting since":
    // the counters come first. The switches keep whatever the operator set, so a
    // "restore defaults" button would only be a way to lose that by accident.
    createElement(GuardStatsBoard, { t, ...(stats === undefined ? {} : { stats }) }),
    createElement('p', { className: 'v3-hint' }, t('guardBoundaryShort')),
    createElement('div', { className: 'v3-gpanel' },
      ...SECTIONS.map(section),
      scopeCell,
    ),
  )
}
