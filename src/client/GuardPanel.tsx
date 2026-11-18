/**
 * 思考限制 — A / B / C 三项机制的配置面（v3，UI 优化任务书 2026-11-18 §4）。
 *
 * 每张卡按同一顺序展示六件事：名称 + 状态 + 开关 → 一句话说明 → 触发条件 →
 * 处理方式 → 执行边界 → 相关参数。原来那段密集的连续说明被拆成独立的行，核心
 * 执行逻辑默认可见，技术细节才需要往下看。
 *
 * 三条文案纪律：
 *   1. 只写代码真的在做的事（guard-loop-core.ts 是唯一事实来源）；
 *   2. A→B→A→B 只作为「示意」，不冒充完整检测算法；
 *   3. C 的关键前提必须写在显眼处：不是达到次数就拒绝，而是要有无进展证据。
 *
 * 状态表达不再只靠一个绿点：标题行里同时有圆点 + 文字状态（已启用 / 已关闭 /
 * 状态未知）。读不到开关时显示「状态未知」并把开关禁用，绝不默认成「关」。
 *
 * DOM 契约（供测试与目视断言）：三张卡各自带 data-guard-section；每张卡的四块说明
 * 带 data-guard-block=trigger|action|boundary|params；阈值编辑器仍在
 * data-guard-thresholds 里（三个 number 输入 + 保存按钮）；开关仍是
 * role="switch" 且 aria-checked 跟随 props。
 *
 * 本文件不读会话历史，也不改任何检测逻辑：它只把配置读出来、把改动交回去。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'

/** The three Guard capabilities, in display order. */
export type GuardSectionId = 'duplicate_call' | 'alternating_cycle' | 'no_progress'

/**
 * 本面板用到的全部文案键。
 *
 * 与旧插件同名键逐一对齐的部分（阈值编辑器、生效范围）保留原措辞；三张机制卡的
 * 说明改成结构化的「触发条件 / 处理方式 / 执行边界 / 参数」四块。
 */
export type GuardPanelKey =
  // 卡头状态
  | 'guardSectionStatusOn'
  | 'guardSectionStatusOff'
  | 'guardSectionStatusUnknown'
  // 开关被禁用时的可见原因（B-1）
  | 'guardSwitchReasonUnknown'
  | 'guardSwitchReasonReadonly'
  // 四块说明的标题
  | 'guardBlockTrigger'
  | 'guardBlockAction'
  | 'guardBlockBoundary'
  | 'guardBlockParams'
  // 阈值编辑器
  | 'guardThresholds'
  | 'guardThresholdSave'
  | 'guardThresholdDraftHint'
  | 'guardThresholdConflictHint'
  | 'guardThresholdHint'
  | 'guardStageAt'
  | 'guardStageOnly'
  | 'guardStageFirst'
  | 'guardStageAgain'
  | 'guardStageTop'
  // 生效范围
  | 'guardScopeTitle'
  | 'guardScopeBody'
  | 'guardScopeFoot'
  // A · 重复调用提醒
  | 'guardSectionA'
  | 'guardASummary'
  | 'guardATrigger'
  | 'guardAAction'
  | 'guardABoundary'
  // B · 交替循环识别
  | 'guardSectionB'
  | 'guardBSummary'
  | 'guardBTrigger'
  | 'guardBAction'
  | 'guardBBoundary'
  | 'guardBFlowNodeA'
  | 'guardBFlowNodeB'
  | 'guardBFlowNote'
  // C · 无进展保护
  | 'guardSectionC'
  | 'guardCSummary'
  | 'guardCTrigger'
  | 'guardCAction'
  | 'guardCBoundary'

export interface GuardPanelProps {
  readonly t: (key: GuardPanelKey) => string
  /** Which sections are currently enabled, keyed by section id. */
  readonly enabled?: Readonly<Record<GuardSectionId, boolean>>
  /** Reminder thresholds, in the order they fire. */
  readonly duplicateThresholds?: readonly number[]
  /** Toggle one section. Omitted = read-only surface. */
  readonly onToggle?: (id: GuardSectionId, next: boolean) => void
  /**
   * Commit an edited threshold list. Omitted = the thresholds are read-only, which
   * is what a Host that does not accept writes gets.
   */
  readonly onThresholdsChange?: (next: readonly number[]) => void
}

/** 一个开关的三种可见状态；undefined 表示还没读到。 */
type SectionState = 'on' | 'off' | 'unknown'

/**
 * Section id → 文案键。顺序即展示顺序。
 *
 * trigger / action / boundary 的措辞逐条对应 guard-loop-core.ts：
 *   - A：thresholds.includes(repeatCount) 才提醒（第 N 次各触发一次）；
 *   - B：cycleLength > 0 即交替序列，warning 不看证据；
 *   - C：noProgressProtection 打开 + 最高阈值（或交替循环）+ 指纹证据，才成为
 *       局部拒绝候选，且每个 Turn 对同一签名只拒绝一次。
 */
const SECTIONS: readonly {
  readonly id: GuardSectionId
  readonly titleKey: GuardPanelKey
  readonly summaryKey: GuardPanelKey
  readonly triggerKey: GuardPanelKey
  readonly actionKey: GuardPanelKey
  readonly boundaryKey: GuardPanelKey
}[] = [
  {
    id: 'duplicate_call',
    titleKey: 'guardSectionA',
    summaryKey: 'guardASummary',
    triggerKey: 'guardATrigger',
    actionKey: 'guardAAction',
    boundaryKey: 'guardABoundary',
  },
  {
    id: 'alternating_cycle',
    titleKey: 'guardSectionB',
    summaryKey: 'guardBSummary',
    triggerKey: 'guardBTrigger',
    actionKey: 'guardBAction',
    boundaryKey: 'guardBBoundary',
  },
  {
    id: 'no_progress',
    titleKey: 'guardSectionC',
    summaryKey: 'guardCSummary',
    triggerKey: 'guardCTrigger',
    actionKey: 'guardCAction',
    boundaryKey: 'guardCBoundary',
  },
]

/**
 * Page-specific rules. Everything else comes from v3-ui.ts; the only local
 * vocabulary here is the three mechanism cards, the flow strip, the stage chips and
 * the threshold editor chrome. Colours are always v3 semantic variables.
 */
const GUARD_CSS = [
  '.mc-section.v3-root{display:flex;flex-direction:column;gap:12px}',
  // 三张机制卡单列排布：内容宽度只有 564px，双列会把「触发条件 / 处理方式」压成
  // 一行行窄字，正是本任务要消掉的阅读负担。
  '.gd-list{display:flex;flex-direction:column;gap:10px;min-width:0}',
  '.gd-card{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);'
    + 'padding:13px 15px;min-width:0;display:flex;flex-direction:column;gap:9px}',
  '.gd-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
  '.gd-head .gd-nm{font-size:13px;font-weight:600;color:var(--v3-t1)}',
  '.gd-head .gd-id{font-family:var(--v3-font-code);font-size:10.5px;color:var(--v3-t4)}',
  '.gd-head .gd-sw{margin-left:auto}',
  '.gd-sw{display:inline-flex;flex:none}',
  '.gd-sw-reason{margin:0;font-size:11px;line-height:16px;color:var(--v3-t4)}',
  '.gd-status{display:inline-flex;align-items:center;flex:none}',
  '.gd-sum{margin:0;font-size:12px;line-height:18px;color:var(--v3-t2)}',
  '.gd-blocks{display:flex;flex-direction:column;gap:6px;margin:0}',
  '.gd-row{display:grid;grid-template-columns:52px minmax(0,1fr);gap:9px;align-items:start;min-width:0}',
  '.gd-k{font-size:10.5px;line-height:17px;color:var(--v3-t4);letter-spacing:.02em}',
  '.gd-v{margin:0;font-size:11.5px;line-height:17px;color:var(--v3-t3);overflow-wrap:anywhere}',
  '.gd-v b{color:var(--v3-t1);font-weight:600}',
  '.gd-flow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;border-radius:var(--v3-r-sm);'
    + 'background:var(--v3-panel-2);font-size:11px;color:var(--v3-t2)}',
  '.gd-node{padding:1px 7px;border-radius:4px;background:var(--v3-panel);border:1px solid var(--v3-line);'
    + 'font-family:var(--v3-font-code);font-size:10.5px;color:var(--v3-t2)}',
  '.gd-arrow{color:var(--v3-t4)}',
  '.gd-flownote{margin:0;font-size:10.5px;line-height:15px;color:var(--v3-t4)}',
  '.gd-stages{display:flex;flex-wrap:wrap;gap:6px;margin:0}',
  '.gd-stage{padding:2px 8px;border-radius:999px;font-size:10.5px;line-height:16px;color:var(--v3-t2);'
    + 'background:var(--v3-panel-2);border:1px solid var(--v3-line)}',
  '.gd-stage[data-stage=\'top\']{border-color:color-mix(in srgb,var(--v3-info) 42%,transparent);color:var(--v3-t1)}',
  '.gd-params{display:flex;flex-direction:column;gap:6px;min-width:0}',
  '.mc-guard-threshold-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.mc-guard-threshold-body{display:contents}',
  '.mc-guard-threshold-edit-label{font-size:11.5px;color:var(--v3-t3)}',
  '.mc-guard-threshold-num{width:56px;padding:3px 6px;border-radius:var(--v3-r-sm);font-size:12px;text-align:center;'
    + 'font-family:var(--v3-font-code);color:var(--v3-t1);background:var(--v3-panel-2);border:1px solid var(--v3-line)}',
  '.mc-guard-threshold-num:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}',
  '.mc-guard-threshold-num:disabled{opacity:.6}',
  '.mc-guard-threshold-hint{margin:0}',
  // 常驻但空时隐藏（不用 hidden / display:none，否则读屏会丢掉整个区域）。
  '.mc-guard-threshold-hints:empty{position:absolute;width:1px;height:1px;overflow:hidden}',
  '.mc-guard-threshold-save{padding:3px 10px;border-radius:var(--v3-r-sm);font-size:11.5px;color:var(--v3-t1);'
    + 'background:var(--v3-panel-2);border:1px solid var(--v3-line);cursor:pointer}',
  '.mc-guard-threshold-save:disabled{opacity:.5;cursor:default}',
  '.mc-guard-threshold-save:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}',
  '.mc-guard-threshold-hint[data-guard-threshold-invalid=\'true\']{color:var(--v3-bad)}',
].join('')

/** Strictly ascending, 1..5 entries, each an integer in 2..50. */
export function isGuardThresholdListValid(list: readonly number[]): boolean {
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
 * 一个阈值在列表里的角色。
 *
 * 角色名必须与真实行为一致：列表里每一个值都会在「连续重复第 N 次」时提醒一次
 * （guard-loop-core.ts: thresholds.includes(repeatCount)），最高值同时是 C 的候选
 * 门槛（repeatCount >= 最高阈值 才可能成为局部拒绝候选）。只有一项时它既是首次
 * 提醒也是最高阈值，所以单列成 only，不硬套三段式。
 */
export type ThresholdStage = 'only' | 'first' | 'again' | 'top'

export interface ThresholdStageView {
  readonly value: number
  readonly stage: ThresholdStage
}

/** 把阈值列表映射成展示用的阶段序列（纯函数，可单测）。 */
export function thresholdStages(list: readonly number[] | undefined): readonly ThresholdStageView[] {
  if (list === undefined || list.length === 0) return []
  if (list.length === 1) return [{ value: list[0]!, stage: 'only' }]
  return list.map((value, index) => ({
    value,
    stage: index === 0 ? 'first' : index === list.length - 1 ? 'top' : 'again',
  }))
}

/** '{n}' 占位替换；文案里只有一个数字占位，所以不需要通用模板引擎。 */
function fillCount(template: string, value: number): string {
  return template.split('{n}').join(String(value))
}

/** 阶段名 → 文案键。 */
const STAGE_KEY: Readonly<Record<ThresholdStage, GuardPanelKey>> = {
  only: 'guardStageOnly',
  first: 'guardStageFirst',
  again: 'guardStageAgain',
  top: 'guardStageTop',
}

/** 三张卡的状态文字与色调。 */
const SECTION_STATE: Readonly<Record<SectionState, {
  readonly tone: 'ok' | 'warn' | undefined
  readonly dot: 'ok' | 'warn' | undefined
  readonly key: GuardPanelKey
}>> = {
  on: { tone: 'ok', dot: 'ok', key: 'guardSectionStatusOn' },
  off: { tone: undefined, dot: undefined, key: 'guardSectionStatusOff' },
  unknown: { tone: 'warn', dot: 'warn', key: 'guardSectionStatusUnknown' },
}

/**
 * 业务状态 → 官方 StateDot 视觉状态（B-2：只折叠视觉，业务状态与文案不变）。
 * ok→done、warn→warning；off 的圆点本来就是中性灰，折叠为 idle。
 */
const SECTION_DOT_STATE: Readonly<Record<'ok' | 'warn', 'done' | 'warning'>> = {
  ok: 'done',
  warn: 'warning',
}

/**
 * 业务状态 → 官方 Tag 色调（B-3），ok/warn 与 success/warning 名字不同，这里显式映射；
 * off 没有状态色，用中性 neutral。
 */
const SECTION_TAG_TONE: Readonly<Record<'ok' | 'warn', 'success' | 'warning'>> = {
  ok: 'success',
  warn: 'warning',
}

/**
 * The boxes' raw text, exactly as the operator typed it.
 *
 * Strings, not numbers: '' (a cleared box) and '2' half-way through typing '20' are
 * legitimate intermediate states that must survive until a commit, so they can never
 * be normalized to a number here.
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
  return isGuardThresholdListValid(parsed) ? parsed : undefined
}

/** Cheap, unambiguous equality key for a row list. */
function rowsKey(rows: DraftRows): string {
  return rows.join('\u0000')
}

/**
 * Marks a component whose body calls hooks.
 *
 * A walker that expands function components by CALLING them is valid for a hook-free
 * view and fatal for one with hooks — React throws "Invalid hook call" outside a
 * render. Such a component carries this symbol so a walker skips exactly it and keeps
 * expanding every other component.
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
   * The draft is kept — throwing away what the operator typed mid-edit is worse than
   * showing that the baseline moved — and the editor says so instead of silently
   * adopting (or silently ignoring) the new value.
   */
  readonly conflict: boolean
  /** A commit is possible at all (the Host accepts writes). */
  readonly editable: boolean
  readonly setRow: (index: number, text: string) => void
  /** Enter / blur / 保存. Returns true only when a list was handed to the Host. */
  readonly commit: () => boolean
}

/**
 * The draft state behind the threshold editor.
 *
 * Typing NEVER writes. A keystroke only moves the draft, so '' (a cleared box) and '2'
 * on the way to '20' survive as ordinary intermediate states instead of being rejected
 * or, worse, sent as a half-edited list. A commit — Enter, blur, or the explicit 保存
 * button — hands over the WHOLE list and only when it is a complete, valid, strictly
 * ascending 2..50 array.
 *
 * Sync rules, spelled out because they are the part that silently rots:
 *  - external (Host) value changed → the draft is reset to it and dirty clears, UNLESS
 *    the draft is dirty and the Host's value is unchanged from the last one this editor
 *    saw (a poll re-delivering the same list must not wipe what the operator types);
 *  - dirty is a pure comparison with the Host list, so an edit that returns the text to
 *    the committed values stops being dirty;
 *  - a rejected submit keeps the draft, so the operator can fix it instead of
 *    retyping; the draft only stops being dirty when the Host actually adopts it;
 *  - onChange omitted (Host rejects writes, or the page is busy) ⇒ read-only; the draft
 *    is KEPT across that window rather than reset to the Host's values.
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
    // Clean draft, or a draft the Host has just caught up with: adopt the new baseline.
    // The second case is a commit that succeeded — the draft already equals the new
    // value, so nothing is lost and the conflict flag clears.
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
    // An unchanged, still-valid list is not a write: Enter on an untouched field must
    // not burn a Host round-trip (or a "saved" toast).
    if (rowsKey(current) === rowsKey(committed)) return false
    onChange(list)
    return true
  }, [editable, onChange, rowsKey(committed)])

  return { rows, dirty, invalid, conflict, editable, setRow, commit }
}

/**
 * Editable reminder thresholds — the independent draft editor.
 *
 * One plain number input per firing point: the operator sees one box per reminder and
 * never has to learn a syntax. This component owns ONLY the draft; it renders it and
 * forwards intents. The Host's values are the props, so the page above stays a pure view.
 *
 * data-guard-thresholds marks the wrapper (owned by the hook-free view); a Host that
 * rejects writes gets disabled boxes. 保存 is disabled while the draft is invalid as
 * well as while it is clean: an invalid list can never be sent, so offering a click
 * that silently does nothing would only mislead.
 *
 * 冲突（草稿脏而宿主列表变了）用一行可见文案说明；aria-live 容器常驻、空时不可见，
 * 非法草稿只显示格式错误。
 */
export function GuardThresholdEditor(props: {
  readonly t: (key: GuardPanelKey) => string
  readonly thresholds?: readonly number[]
  readonly onChange?: (next: readonly number[]) => void
}): ReactElement | null {
  const { t, thresholds } = props
  const draft = useGuardThresholdDraft(props)
  if (thresholds === undefined) return null
  const { editable, rows, invalid } = draft
  // 草稿脏、宿主基线动过、且草稿合法时才出提示；非法态由格式错误独占用。
  const conflictNotice = draft.conflict && draft.dirty && !invalid
  // Inner content only: the WRAPPER (data-guard-thresholds) belongs to the hook-free
  // view above, so element-tree walkers can still assert it without calling this
  // hook-owned component.
  return (
    <div className="mc-guard-threshold-body" data-guard-threshold-conflict={draft.conflict ? 'true' : 'false'}>
      <label className="mc-guard-threshold-edit-label">{t('guardThresholds')}</label>
      {rows.map((text, index) => (
        <input
          key={index}
          type="number"
          min={2}
          max={50}
          step={1}
          className="mc-guard-threshold-num"
          // The DRAFT is what the operator sees; the Host's committed list is what the
          // commit compares against.
          value={text}
          readOnly={!editable}
          disabled={!editable}
          aria-label={t('guardThresholds') + ' ' + String(index + 1)}
          aria-invalid={invalid ? 'true' : 'false'}
          data-guard-threshold-dirty={draft.dirty ? 'true' : 'false'}
          onChange={event => { draft.setRow(index, event.target.value) }}
          onKeyDown={event => {
            if (!editable || event.key !== 'Enter') return
            event.preventDefault()
            draft.commit()
          }}
          // Blur attempts the same commit; an invalid draft is KEPT (never silently reset
          // to the Host's values) so the operator can correct it.
          onBlur={() => { if (editable) draft.commit() }}
        />
      ))}
      {editable
        ? (
          <button
            type="button"
            className="mc-guard-threshold-save"
            data-guard-threshold-save="true"
            // 非法草稿不发请求，按钮也就没有可点的理由：把「保存」置灰比让它静默失败更好懂。
            disabled={!draft.dirty || invalid}
            onClick={() => { draft.commit() }}
          >{t('guardThresholdSave')}</button>
        )
        : null}
      {/* Invalid draft: say WHY it cannot be sent, and keep it. A Host that REFUSES the
          write needs no extra line of its own: the boxes still show the draft and the
          page above prints the error. */}
      {editable && invalid
        ? <p className="mc-guard-threshold-hint" role="alert" data-guard-threshold-invalid="true">{t('guardThresholdDraftHint')}</p>
        : null}
      {/* 宿主列表在草稿脏时变了：草稿保留，但要让这条变化看得见。 */}
      {editable
        ? (
          <div
            className="mc-guard-threshold-hints"
            aria-live="polite"
            data-guard-threshold-notice={invalid ? 'invalid' : conflictNotice ? 'conflict' : 'none'}
          >
            {conflictNotice
              ? (
                <p className="mc-guard-threshold-hint" data-guard-threshold-conflict="true">
                  {t('guardThresholdConflictHint')}
                </p>
              )
              : null}
          </div>
        )
        : null}
    </div>
  )
}

/** Tagged after declaration: walkers must not CALL this one (it has hooks). */
(GuardThresholdEditor as unknown as Record<symbol, boolean>)[HOOK_COMPONENT] = true

/**
 * Parse '3, 5, 8' into a threshold list.
 *
 * Kept (and exported) as the wire-level parser. Returns 'undefined' for anything the
 * Host would reject (empty, non-integer, out of range, not strictly increasing).
 */
export function parseGuardThresholds(text: string): readonly number[] | undefined {
  const parts = text.split(',').map(part => part.trim()).filter(part => part !== '')
  if (parts.length === 0 || parts.length > 5) return undefined
  const parsed: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined
    const value = Number(part)
    if (!Number.isSafeInteger(value) || value < 2 || value > 50) return undefined
    if (parsed.length > 0 && value <= parsed[parsed.length - 1]!) return undefined
    parsed.push(value)
  }
  return parsed
}

/** 一条「标题 + 内容」说明行。 */
function Block(props: {
  readonly kind: 'trigger' | 'action' | 'boundary' | 'params'
  readonly label: string
  readonly children: ReactNode
}): ReactElement {
  return (
    <div className="gd-row" data-guard-block={props.kind}>
      <span className="gd-k">{props.label}</span>
      <div className="gd-v">{props.children}</div>
    </div>
  )
}

export function GuardPanel(props: GuardPanelProps): ReactElement {
  const { t, enabled, duplicateThresholds, onToggle, onThresholdsChange } = props

  const stages = thresholdStages(duplicateThresholds)

  const section = (entry: (typeof SECTIONS)[number]): ReactElement => {
    const raw = enabled === undefined ? undefined : enabled[entry.id]
    const state: SectionState = raw === undefined ? 'unknown' : raw ? 'on' : 'off'
    const look = SECTION_STATE[state]
    // Captured as locals so the handlers stay undefined when the surface is read-only,
    // without re-reading the optional props inside a closure.
    const toggle = onToggle
    const commitThresholds = onThresholdsChange
    // B-1/B-2/B-3：只把既有业务状态映射成官方原语参数，不改任何判定/文案推导。
    const dotState = look.dot === undefined ? 'idle' : SECTION_DOT_STATE[look.dot]
    const tagTone = look.tone === undefined ? 'neutral' : SECTION_TAG_TONE[look.tone]
    const switchDisabled = toggle === undefined || state === 'unknown'
    const switchReasonKey: GuardPanelKey | undefined =
      state === 'unknown'
        ? 'guardSwitchReasonUnknown'
        : toggle === undefined
          ? 'guardSwitchReasonReadonly'
          : undefined
    const switchReasonId = 'guard-switch-reason-' + entry.id
    const params = entry.id === 'duplicate_call'
      ? (
        <div className="gd-params">
          <div
            className="mc-guard-threshold-edit"
            data-guard-thresholds="true"
            data-guard-thresholds-count={String(duplicateThresholds?.length ?? 0)}
            data-guard-thresholds-values={duplicateThresholds?.join(',') ?? ''}
            data-guard-thresholds-editable={commitThresholds === undefined ? 'false' : 'true'}
          >
            <GuardThresholdEditor
              t={t}
              {...(duplicateThresholds === undefined ? {} : { thresholds: duplicateThresholds })}
              {...(commitThresholds === undefined ? {} : { onChange: commitThresholds })}
            />
          </div>
          {stages.length === 0 ? null : (
            <div className="gd-stages" data-guard-stages={String(stages.length)}>
              {stages.map(stage => (
                <span key={stage.value} className="gd-stage" data-stage={stage.stage} data-guard-stage-value={String(stage.value)}>
                  {fillCount(t('guardStageAt'), stage.value) + ' · ' + t(STAGE_KEY[stage.stage])}
                </span>
              ))}
            </div>
          )}
          <p className="v3-hint mc-guard-threshold-hint">{t('guardThresholdHint')}</p>
        </div>
      )
      : null

    return (
      <div key={entry.id} className="gd-card" data-guard-section={entry.id} data-guard-state={state}>
        <div className="gd-head">
          <span className="v3-dot" data-tone={look.dot} aria-hidden="true">
            <StateDot state={dotState} size={7} />
          </span>
          <span className="gd-nm">{t(entry.titleKey)}</span>
          <span className="gd-id">{entry.id}</span>
          <span className="gd-status" data-tone={look.tone} data-guard-status={state}>
            <Tag tone={tagTone}>{t(look.key)}</Tag>
          </span>
          <span
            className="gd-sw"
            role="group"
            aria-label={t(entry.titleKey)}
            {...(switchReasonKey === undefined ? {} : { 'aria-describedby': switchReasonId })}
          >
            <Switch
              checked={state === 'on'}
              onChange={(next: boolean) => { if (toggle !== undefined && state !== 'unknown') toggle(entry.id, next) }}
              label={t(entry.titleKey)}
              disabled={switchDisabled}
              {...(switchReasonKey === undefined ? {} : { title: t(switchReasonKey) })}
              className="gd-sw-ctl"
            />
          </span>
        </div>
        {switchReasonKey === undefined ? null : (
          <p className="gd-sw-reason" id={switchReasonId} data-guard-switch-reason={state === 'unknown' ? 'unknown' : 'readonly'}>
            {t(switchReasonKey)}
          </p>
        )}
        <p className="gd-sum" data-guard-summary={entry.id}>{t(entry.summaryKey)}</p>
        {entry.id === 'alternating_cycle'
          ? (
            <>
              <div className="gd-flow" data-guard-flow="alternating" aria-hidden="true">
                <span className="gd-node">{t('guardBFlowNodeA')}</span>
                <span className="gd-arrow">{'→'}</span>
                <span className="gd-node">{t('guardBFlowNodeB')}</span>
                <span className="gd-arrow">{'→'}</span>
                <span className="gd-node">{t('guardBFlowNodeA')}</span>
                <span className="gd-arrow">{'→'}</span>
                <span className="gd-node">{t('guardBFlowNodeB')}</span>
              </div>
              <p className="gd-flownote" data-guard-flow-note="alternating">{t('guardBFlowNote')}</p>
            </>
          )
          : null}
        <div className="gd-blocks">
          <Block kind="trigger" label={t('guardBlockTrigger')}>{t(entry.triggerKey)}</Block>
          <Block kind="action" label={t('guardBlockAction')}>{t(entry.actionKey)}</Block>
          <Block kind="boundary" label={t('guardBlockBoundary')}>{t(entry.boundaryKey)}</Block>
          {params === null ? null : <Block kind="params" label={t('guardBlockParams')}>{params}</Block>}
        </div>
      </div>
    )
  }

  return (
    <section className="mc-section v3-root">
      <style data-guard-style="true">{GUARD_CSS}</style>
      <div className="gd-list">
        {SECTIONS.map(section)}
        {/* 生效范围：不是开关，而是一条必须与开关同屏的边界说明。 */}
        <div className="v3-notebox" data-guard-scope="true">
          <b>{t('guardScopeTitle')}</b>
          {' '}
          {t('guardScopeBody')}
          {' '}
          <span className="v3-hint">{t('guardScopeFoot')}</span>
        </div>
      </div>
    </section>
  )
}
