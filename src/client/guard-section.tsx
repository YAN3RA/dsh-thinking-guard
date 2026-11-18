/**
 * 执行保护 — the single-page shell that wires {@link GuardPanel} to the real
 * Guard switches (v3, D-044).
 *
 * 旧插件的执行保护页是「四页签外壳 + GuardContainer + GuardPanel」三层：外壳管
 * 页签，container 管远端读写与轮询，panel 是纯视图。本插件只有一个设置页，外壳
 * 不存在了，所以这一层只做 container 的活：读取开关 / 诊断 / 计数，写回开关与阈值，
 * 失败给出可见错误行。页面本身仍然是「无标题、直接给看板」的 v3 风格。
 *
 * Failure handling is deliberate:
 * - 读取开关失败 → 错误行 + 开关显示为不可用（disabled），绝不显示成「关」；
 *   一个未知的开关状态不能看起来像用户的选择。
 * - 写失败 → 错误行写明原因，并且重新读回 Host 的真相，不让开关声称 Host 没接受的状态。
 * - 诊断 / 计数读取失败降级为「未知」（计数格显示「—」），不阻断整页。
 * - 同一时刻只允许一次写入；写入期间开关与阈值编辑器都禁用。
 * - 非法阈值列表（非升序 / 越界 / 超过 5 个）在本地就拦住，不发请求。
 * - 写成功后不猜：必须重读 Host 并确认「读回值 = 期望值」才显示「已保存」；确认
 *   不上就按错误处理，绝不与错误行同屏出现一句乐观的成功提示。
 *
 * 本文件只读 Guard 的四个远端方法，不碰会话历史、事件、调用索引或 usage。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { GuardRemote, GuardSwitches } from './guard-remote.ts'
import { GuardPanel, isGuardThresholdListValid, type GuardPanelKey, type GuardSectionId } from './GuardPanel.tsx'
import { V3_ROOT_CLASS } from './v3-ui.ts'

/**
 * 本页文案键：页面级（nav / title / desc 与状态行）+ 面板自己的键。
 *
 * 面板键直接复用 `GuardPanelKey`，因此 locale 字典里 guard* 的中文说明与旧插件
 * 逐字一致。
 */
export type GuardSectionKey =
  | 'nav'
  | 'title'
  | 'desc'
  // 顶部状态行
  | 'guardStatusLoading'
  | 'guardStatusAvailable'
  | 'guardStatusUnavailable'
  | 'guardStatusUnknown'
  | 'guardDiagInvalidPatch'
  | 'guardDiagNotMounted'
  | 'guardDiagPersistenceDirty'
  | 'guardDiagWriteFailed'
  // 错误行
  | 'guardReadFailed'
  | 'guardWriteFailed'
  | 'guardSaveUnconfirmed'
  // 保存反馈（读回确认之后才出现）
  | 'guardSavedSwitch'
  | 'guardSavedThresholds'
  | 'guardSwitchOn'
  | 'guardSwitchOff'
  | GuardPanelKey

/** Props injected by the `settings.section` registration (see index.ts). */
export interface GuardSectionInjected {
  remote: GuardRemote
  t: (key: GuardSectionKey) => string
}

export type GuardSectionProps = GuardSectionInjected

/** What kind of failure the error line is reporting (it picks the heading). */
export type GuardSectionErrorKind = 'read' | 'write' | 'threshold' | 'unconfirmed'

export interface GuardSectionError {
  readonly kind: GuardSectionErrorKind
  /** Raw detail from the wire or the transport; may be empty (local rejection). */
  readonly detail: string
}

/**
 * What the page just confirmed it saved, as it is rendered.
 *
 * `seq` restarts the hold when the same change is saved twice, so re-saving one
 * switch does not reuse a node that is already fading out.
 */
export type GuardSavedNotice =
  | { readonly kind: 'thresholds'; readonly seq: number }
  | { readonly kind: 'switch'; readonly id: GuardSectionId; readonly next: boolean; readonly seq: number }

/** The same notice without its sequence, as the writer builds it. */
export type GuardSavedIntent =
  | { readonly kind: 'thresholds' }
  | { readonly kind: 'switch'; readonly id: GuardSectionId; readonly next: boolean }

/**
 * Whether the values the Host read back are the ones this page just wrote.
 *
 * `repeatThresholds` is an array, so it is compared element by element; every
 * other switch field is a boolean. This is the ONLY gate that turns a write into
 * a 「已保存」 — a value that came back different is not a success, whatever the
 * RPC answered.
 */
export function matchesGuardExpectation(switches: GuardSwitches, expect: Partial<GuardSwitches>): boolean {
  return Object.entries(expect).every(([key, want]) => {
    const actual = (switches as unknown as Record<string, unknown>)[key]
    if (Array.isArray(want)) {
      return Array.isArray(actual) && actual.length === want.length && actual.every((value, index) => value === want[index])
    }
    return actual === want
  })
}

/** Copy for one 已保存 tag; the new value is named so the reader sees WHAT landed. */
export function savedText(notice: GuardSavedNotice, t: (key: GuardSectionKey) => string): string {
  if (notice.kind === 'thresholds') return t('guardSavedThresholds')
  return t('guardSavedSwitch') + ' · ' + t(SECTION_TITLE[notice.id]) + ' → '
    + t(notice.next ? 'guardSwitchOn' : 'guardSwitchOff')
}

/**
 * The 已保存 tag, as a hook-free element.
 *
 * Hook-free on purpose: the page owns the timer and the confirmation, so the exact
 * DOM (attribute names, tone, sequence) can be asserted without a DOM harness.
 * `data-guard-saved` names WHAT was saved ('thresholds' or the section id), and
 * `data-guard-saved-seq` lets a re-save be told apart from the previous tag.
 */
export function GuardSavedTag(props: {
  readonly t: (key: GuardSectionKey) => string
  readonly notice: GuardSavedNotice
}): ReactElement {
  const { t, notice } = props
  return (
    <span
      className="v3-tag mc-guard-saved"
      data-tone="ok"
      data-guard-saved={notice.kind === 'thresholds' ? 'thresholds' : notice.id}
      data-guard-saved-seq={String(notice.seq)}
      aria-live="polite"
    >{savedText(notice, t)}</span>
  )
}

interface ViewState {
  readonly switches?: GuardSwitches
  readonly error?: GuardSectionError
  readonly busy: boolean
}

const INITIAL_STATE: ViewState = { busy: false }

/** Section id → the Guard switch it controls. */
const SECTION_FIELD: Readonly<Record<GuardSectionId, keyof GuardSwitches>> = {
  duplicate_call: 'duplicateDetection',
  alternating_cycle: 'alternatingCycleDetection',
  no_progress: 'noProgressProtection',
}

/** Section id → the card title, so a 已保存 tag can name what landed. */
const SECTION_TITLE: Readonly<Record<GuardSectionId, GuardPanelKey>> = {
  duplicate_call: 'guardSectionA',
  alternating_cycle: 'guardSectionB',
  no_progress: 'guardSectionC',
}

/** How long a 已保存 confirmation stays on screen before it is removed. */
const SAVED_HOLD_MS = 4000

/** Page-level rules; every colour comes from the v3 token layer. */
const SECTION_CSS = [
  '.mc-guard-section.v3-root{display:flex;flex-direction:column;gap:12px}',
  '.mc-guard-statusline{flex-wrap:wrap;row-gap:2px}',
  '.mc-guard-statusline .mc-guard-status-why{color:var(--v3-t4)}',
  '.mc-guard-statusline .mc-guard-status-why+.mc-guard-status-why::before{content:\'·\';margin-right:6px}',
  '.mc-guard-statusline .mc-guard-status-why[data-guard-write-failed=\'true\']{color:var(--v3-bad)}',
  '.mc-guard-section .mc-guard-error{margin:0}',
  '.mc-guard-section .mc-guard-error span{font-family:var(--v3-font-code);font-size:11px;'
    + 'color:var(--v3-t3);word-break:break-word}',
  // 保存反馈与状态行并排；淡出动画跑完时 JS 才移除节点，两者同一个 4 秒。
  '.mc-guard-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.mc-guard-top .v3-statusline{flex:1 1 auto;min-width:0}',
  '.mc-guard-saved{animation:mc-guard-saved-fade 4000ms ease forwards}',
  '@keyframes mc-guard-saved-fade{0%,85%{opacity:1}100%{opacity:0}}',
  '@media (prefers-reduced-motion:reduce){.mc-guard-saved{animation:none}}',
].join('')

/**
 * Turn an unknown thrown value into a message safe to render.
 *
 * A rejected call carries a fixed code on the wire, but a THROWN transport error
 * has no code — its message is the only reason worth showing the user.
 */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

/** 'code: message' for a rejected remote result; the code names what broke. */
function failureText(error: { readonly code: string; readonly message: string }): string {
  return error.code + ': ' + error.message
}

/** Read the switches, keeping the failure reason instead of throwing. */
async function readSwitches(
  remote: GuardRemote,
): Promise<{ readonly ok: true; readonly value: GuardSwitches } | { readonly ok: false; readonly detail: string }> {
  try {
    const result = await remote.getGuard()
    return result.ok ? { ok: true, value: result.value } : { ok: false, detail: failureText(result.error) }
  } catch (error) {
    return { ok: false, detail: errorText(error) }
  }
}

/**
 * The 执行保护 page.
 *
 * Mounts → reads switches + diagnostics + counters in parallel; a switch click
 * writes one field and re-reads the accepted configuration; a threshold commit
 * validates locally, then writes the whole list. Every write ends by reading the
 * Host back, so the page never presents an optimistic value as the truth.
 */
export function GuardSection(props: GuardSectionProps): ReactElement {
  const { remote, t } = props
  const [state, setState] = useState<ViewState>(INITIAL_STATE)
  const alive = useRef(true)
  /** Monotonic request generation: only the newest request may commit. */
  const gen = useRef(0)
  /** Latest committed state, read synchronously by a queued write. */
  const stateRef = useRef<ViewState>(INITIAL_STATE)
  /** The 已保存 tag currently on screen (null = none). */
  const [saved, setSaved] = useState<GuardSavedNotice | null>(null)
  /** Its auto-dismiss timer; one at a time, re-armed by every new save. */
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedSeq = useRef(0)

  const nextGen = useCallback((): number => {
    gen.current += 1
    return gen.current
  }, [])

  /**
   * Apply a state change only while this generation is still the newest.
   *
   * The updater runs against `stateRef` (the latest committed state), so a write
   * that follows a read sees that read's result instead of a stale render closure.
   */
  const commit = useCallback((at: number, patch: (current: ViewState) => ViewState): void => {
    if (!alive.current || at !== gen.current) return
    const next = patch(stateRef.current)
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
  }, [])

  /**
   * Read switches, then the two optional surfaces, and publish the result.
   *
   * Returns the accepted switch values so a caller can decide whether the write
   * it just issued really landed; `undefined` means the read itself failed, and
   * that failure is already published on the error line.
   */
  const readAll = useCallback(async (at: number): Promise<GuardSwitches | undefined> => {
    const switches = await readSwitches(remote)
    if (!alive.current || at !== gen.current) return undefined
    if (!switches.ok) {
      commit(at, current => ({ ...current, busy: false, error: { kind: 'read', detail: switches.detail } }))
      return undefined
    }
    if (!alive.current || at !== gen.current) return undefined
    commit(at, () => ({ switches: switches.value, busy: false }))
    return switches.value
  }, [remote, commit])

  // Load on mount, and reload when a different remote is injected.
  useEffect(() => {
    alive.current = true
    const at = nextGen()
    void readAll(at)
    return () => {
      alive.current = false
      // Invalidate whatever is still in flight for this mount.
      gen.current += 1
      // The 已保存 hold is a plain timer: clear it so an unmount cannot set state
      // on a dead component, and a remount never inherits the old countdown.
      if (savedTimer.current !== undefined) {
        clearTimeout(savedTimer.current)
        savedTimer.current = undefined
      }
    }
  }, [readAll, nextGen])

  /** Drop any 已保存 tag (and its timer) before a new write starts. */
  const clearSaved = useCallback((): void => {
    if (savedTimer.current !== undefined) {
      clearTimeout(savedTimer.current)
      savedTimer.current = undefined
    }
    setSaved(null)
  }, [])

  /**
   * Show a 已保存 confirmation for {@link SAVED_HOLD_MS}.
   *
   * The sequence number is stored WITH the notice, so an older tag's dismissal can
   * never remove a newer one, and re-saving the same value restarts the hold
   * instead of quietly extending a node that is already fading out.
   */
  const showSaved = useCallback((intent: GuardSavedIntent): void => {
    if (savedTimer.current !== undefined) clearTimeout(savedTimer.current)
    savedSeq.current += 1
    const seq = savedSeq.current
    setSaved({ ...intent, seq } as GuardSavedNotice)
    savedTimer.current = setTimeout(() => {
      savedTimer.current = undefined
      setSaved(current => (current !== null && current.seq === seq ? null : current))
    }, SAVED_HOLD_MS)
  }, [])

  /**
   * One write, then an authoritative re-read, then — ONLY if that read-back
   * matches what was asked for — a visible 「已保存」.
   *
   * No optimistic switch movement and no optimistic confirmation: the panel keeps
   * showing the Host's value until the Host accepted the change, and a write whose
   * read-back disagrees is reported as unconfirmed instead of celebrated.
   */
  const write = useCallback(async (
    change: Partial<GuardSwitches>,
    expect: Partial<GuardSwitches>,
    intent: GuardSavedIntent,
  ): Promise<void> => {
    if (stateRef.current.busy) return
    clearSaved()
    const at = nextGen()
    commit(at, current => ({ ...current, busy: true, error: undefined }))
    let result: RemoteResult<void>
    try {
      result = await remote.updateGuard(change)
    } catch (error) {
      if (!alive.current || at !== gen.current) return
      commit(at, current => ({ ...current, busy: false, error: { kind: 'write', detail: errorText(error) } }))
      return
    }
    if (!alive.current || at !== gen.current) return
    if (!result.ok) {
      const detail = failureText(result.error)
      commit(at, current => ({ ...current, busy: false, error: { kind: 'write', detail } }))
      return
    }
    const confirmed = await readAll(at)
    if (!alive.current || at !== gen.current) return
    // The read failed: readAll already published why, and an unproven save must
    // not wear a success tag.
    if (confirmed === undefined) return
    if (!matchesGuardExpectation(confirmed, expect)) {
      commit(at, current => ({ ...current, busy: false, error: { kind: 'unconfirmed', detail: '' } }))
      return
    }
    showSaved(intent)
  }, [remote, commit, nextGen, readAll, clearSaved, showSaved])

  /** Switch click → one field write, confirmed by the read-back. */
  const toggle = useCallback((id: GuardSectionId, next: boolean): void => {
    const field = SECTION_FIELD[id]
    const change = { [field]: next } as Partial<GuardSwitches>
    void write(change, change, { kind: 'switch', id, next })
  }, [write])

  /**
   * Threshold commit.
   *
   * The panel's draft already refuses an invalid list, but the list is checked
   * again here: this is the only place that can turn an edit into a wire write,
   * and an out-of-range / non-ascending list would be rejected by the Host with
   * a code that says nothing useful to the person who typed it.
   */
  const changeThresholds = useCallback((next: readonly number[]): void => {
    if (!isGuardThresholdListValid(next)) {
      clearSaved()
      const at = nextGen()
      commit(at, current => ({ ...current, error: { kind: 'threshold', detail: '' } }))
      return
    }
    const change: Partial<GuardSwitches> = { repeatThresholds: next }
    void write(change, change, { kind: 'thresholds' })
  }, [write, commit, nextGen, clearSaved])

  const { switches, error, busy } = state
  const enabled = switches === undefined
    ? undefined
    : {
        duplicate_call: switches.duplicateDetection,
        alternating_cycle: switches.alternatingCycleDetection,
        no_progress: switches.noProgressProtection,
      }
  const interactive = switches !== undefined && !busy
  const errorTitle = error === undefined
    ? undefined
    : error.kind === 'read'
      ? t('guardReadFailed')
      : error.kind === 'threshold'
        ? t('guardThresholdDraftHint')
        : error.kind === 'unconfirmed'
          ? t('guardSaveUnconfirmed')
          : t('guardWriteFailed')

  return (
    <section className={V3_ROOT_CLASS + ' mc-guard-section'} data-guard-busy={busy ? 'true' : 'false'}>
      <style data-guard-section-style="true">{SECTION_CSS}</style>
      {/* 顶部状态栏已按需求移除；保存反馈仍保留，只在读回确认后出现。 */}
      {saved === null ? null : (
        <div className="mc-guard-top">
          <GuardSavedTag key={saved.seq} t={t} notice={saved} />
        </div>
      )}
      {error === undefined
        ? null
        : (
          <div className="v3-banner mc-guard-error" role="alert" data-guard-error={error.kind}>
            <b>{errorTitle}</b>
            {error.detail === '' ? null : <span>{error.detail}</span>}
          </div>
        )}
      <GuardPanel
        t={t}
        {...(enabled === undefined ? {} : { enabled })}
        // Prefer the LIVE thresholds from the Host: the operator can edit them,
        // so a constant fallback would show a value the detector does not use.
        {...(switches === undefined ? {} : { duplicateThresholds: switches.repeatThresholds })}
         {...(interactive ? { onToggle: toggle, onThresholdsChange: changeThresholds } : {})}
      />
    </section>
  )
}

/**
 * 本页文案（zh / en），键与 {@link GuardSectionKey} 一一对应。
 *
 * 三张机制卡的说明按「触发条件 / 处理方式 / 执行边界 / 参数」拆开，每一条都对着
 * guard-loop-core.ts 的真实行为写：A 的每个阈值各提醒一次、B 只看调用序列、
 * C 必须有无进展指纹证据才可能局部拒绝。由 index.ts 注册进 locale，本文件不自己
 * 持有命名空间。
 */
export function guardDictionaries(): {
  zh: Record<GuardSectionKey, string>
  en: Record<GuardSectionKey, string>
} {
  const zh: Record<GuardSectionKey, string> = {
    nav: '思考限制',
    title: '思考限制',
    desc: '只针对有证据的重复与无进展拦截具体操作；不因总步数、工具总次数或任务时长终止任务。',
    // 状态行
    guardStatusLoading: '正在读取思考限制状态…',
    guardStatusAvailable: '思考限制已生效',
    guardStatusUnavailable: '思考限制当前未生效',
    guardStatusUnknown: '思考限制状态未知',
    guardDiagInvalidPatch: '配置非法，执行保护未注册任何钩子',
    guardDiagNotMounted: '本进程未挂载执行保护',
    guardDiagPersistenceDirty: '有未落盘改动，下次保存成功后会自动补写',
    guardDiagWriteFailed: '状态文件写入失败，改动只保留在内存中',
    // 错误行
    guardReadFailed: '读取思考限制设置失败',
    guardWriteFailed: '保存思考限制设置失败',
    guardSaveUnconfirmed: '已提交，但读回值不同，未确认生效',
    // 保存反馈
    guardSavedSwitch: '已保存',
    guardSavedThresholds: '阈值已保存',
    guardSwitchOn: '开',
    guardSwitchOff: '关',
    // 卡头状态
    guardSectionStatusOn: '已启用',
    guardSectionStatusOff: '已关闭',
    guardSectionStatusUnknown: '状态未知',
    // 四块说明的标题
    guardBlockTrigger: '触发条件',
    guardBlockAction: '处理方式',
    guardBlockBoundary: '执行边界',
    guardBlockParams: '参数',
    // 阈值编辑器
    guardThresholds: '重复提醒阈值',
    guardThresholdSave: '保存',
    guardThresholdDraftHint: '需为 2–50 的递增整数、最多 5 个；未合法前不会提交。',
    guardThresholdConflictHint: '宿主值已变化，当前草稿保留。',
    guardThresholdHint: '每个值都在「连续重复第 N 次」时提醒一次；最高值同时是 C 的无进展候选门槛，是否局部拒绝由 C 与证据决定。',
    guardStageAt: '第 {n} 次',
    guardStageOnly: '唯一阈值 · 提醒与门槛',
    guardStageFirst: '首次提醒',
    guardStageAgain: '再次提醒',
    guardStageTop: '最高阈值 · 也是拒绝候选门槛',
    // A · 重复调用提醒
    guardSectionA: 'A · 重复调用提醒',
    guardASummary: '识别 Agent 连续重复调用同一工具，避免反复执行相同操作。',
    guardATrigger: '同一工具 + 相同参数的连续重复调用达到阈值（默认第 3 / 5 / 8 次，每个阈值各提醒一次）。',
    guardAAction: '向 Agent 注入一条提醒，要求它检查是否陷入重复操作。',
    guardABoundary: '提醒本身不会终止整个任务；是否真的重复由结果 / 错误指纹佐证，不只看调用次数。',
    // B · 交替循环识别
    guardSectionB: 'B · 交替循环识别',
    guardBSummary: '识别 A → B → A → B 这类工具交替调用序列。',
    guardBTrigger: '调用序列出现固定长度的交替重复，并连续多轮没有产生新结果。',
    guardBAction: '向 Agent 发送提醒，促使其检查调用结果是否产生新进展。',
    guardBBoundary: '只提醒，不阻断调用；与重复检测是两个独立开关，互不压制。',
    guardBFlowNodeA: '工具 A',
    guardBFlowNodeB: '工具 B',
    guardBFlowNote: '示意：实际检测窗口、匹配规则与判断条件以代码为准，图示不代表完整算法。',
    // C · 无进展保护
    guardSectionC: 'C · 无进展保护',
    guardCSummary: '在有充分证据证明重复操作没有进展时，局部拒绝一次调用。',
    guardCTrigger: '达到最高阈值（或识别到交替循环），并且结果 / 错误指纹能够证明没有进展。',
    guardCAction: '通过 DSH 的工具执行保护接口局部拒绝这一次调用。',
    guardCBoundary: '不是达到次数就直接拒绝：没有无进展证据时降级为提醒。每个 Turn 对同一已证实重复只拒绝一次，任务不结束，Agent 仍可换方法。',
    // 生效范围
    guardScopeTitle: '生效范围',
    guardScopeBody: '三个开关按智能体 / 回合隔离，不跨会话继承；关闭只停止对应的提醒与局部拒绝，不改动任何配置或历史。',
    guardScopeFoot: '恢复默认只写回开关值，不重写其他配置。',
  }
  const en: Record<GuardSectionKey, string> = {
    nav: 'Thinking Limit',
    title: 'Thinking Limit',
    desc: 'Blocks specific operations only when there is evidence of repetition or no progress; never stops a task for step count, tool count or duration.',
    guardStatusLoading: 'Reading guard status…',
    guardStatusAvailable: 'Execution guard is active',
    guardStatusUnavailable: 'Execution guard is not in effect',
    guardStatusUnknown: 'Guard status unknown',
    guardDiagInvalidPatch: 'Invalid configuration; no Guard hook is registered',
    guardDiagNotMounted: 'The Guard is not mounted in this process',
    guardDiagPersistenceDirty: 'Unsaved changes; they are written after the next successful save',
    guardDiagWriteFailed: 'Writing the state file failed; the change is kept in memory only',
    guardReadFailed: 'Failed to read the guard settings',
    guardWriteFailed: 'Failed to save the guard settings',
    guardSaveUnconfirmed: 'Submitted, but the read-back differs; not confirmed',
    guardSavedSwitch: 'Saved',
    guardSavedThresholds: 'Thresholds saved',
    guardSwitchOn: 'On',
    guardSwitchOff: 'Off',
    guardSectionStatusOn: 'Enabled',
    guardSectionStatusOff: 'Disabled',
    guardSectionStatusUnknown: 'Status unknown',
    guardBlockTrigger: 'Trigger',
    guardBlockAction: 'Action',
    guardBlockBoundary: 'Boundary',
    guardBlockParams: 'Parameters',
    guardThresholds: 'Repeat reminder thresholds',
    guardThresholdSave: 'Save',
    guardThresholdDraftHint: 'Needs 2–50 ascending integers, at most 5; nothing is submitted until it is valid.',
    guardThresholdConflictHint: 'The host value changed; your draft is kept.',
    guardThresholdHint: 'Each value reminds once, on the Nth consecutive repeat; the highest value also gates the no-progress candidate, and C decides with the evidence whether to deny locally.',
    guardStageAt: '#{n}',
    guardStageOnly: 'only threshold · reminder and gate',
    guardStageFirst: 'first reminder',
    guardStageAgain: 'another reminder',
    guardStageTop: 'highest threshold · also the denial candidate gate',
    guardSectionA: 'A · Repeated call reminder',
    guardASummary: 'Detects the agent calling the same tool again and again, so the same operation is not repeated forever.',
    guardATrigger: 'Consecutive identical calls (same tool, same arguments) reach a threshold — 3 / 5 / 8 by default, one reminder per threshold.',
    guardAAction: 'Injects a reminder asking the agent to check whether it is stuck in a repeated operation.',
    guardABoundary: 'The reminder alone never ends the task; real repetition is confirmed by result / error fingerprints, not by the count alone.',
    guardSectionB: 'B · Alternating cycle detection',
    guardBSummary: 'Detects alternating tool sequences such as A -> B -> A -> B.',
    guardBTrigger: 'The call sequence shows a fixed-length alternating repetition that keeps producing no new result.',
    guardBAction: 'Sends a reminder prompting the agent to check whether the calls produce any new progress.',
    guardBBoundary: 'Reminds only and never blocks a call; repeat and cycle detection are independent switches that never suppress each other.',
    guardBFlowNodeA: 'tool A',
    guardBFlowNodeB: 'tool B',
    guardBFlowNote: 'Illustration only: the real detection window, matching rules and conditions live in the code; this picture is not the whole algorithm.',
    guardSectionC: 'C · No-progress protection',
    guardCSummary: 'Denies one call locally when there is clear evidence that a repeated operation makes no progress.',
    guardCTrigger: 'The highest threshold is reached (or an alternating cycle is detected) AND the result / error fingerprints prove there is no progress.',
    guardCAction: 'Denies this single call locally through the DSH tool execution guard.',
    guardCBoundary: 'Reaching a count alone never denies: without no-progress evidence it degrades to a reminder. A given confirmed repeat is denied at most once per turn; the task is never ended and the agent can still change approach.',
    guardScopeTitle: 'Scope',
    guardScopeBody: 'The three switches are isolated per agent / turn and never inherited across Sessions; turning one off stops only its reminders and local denials, and changes no configuration or history.',
    guardScopeFoot: 'Restoring defaults writes only the switch values; no other configuration is rewritten.',
  }
  return { zh, en }
}
