/**
 * 思考限制 container — wires `GuardPanel` to the real Guard switches.
 *
 * `GuardPanel` is the pure view (hook-free, walkable by the test suite). This
 * container owns the two things that need a hook: reading the switches from the
 * Host and writing a toggle back.
 *
 * Failure handling is deliberate:
 * - A failed read renders the switches as unavailable, not as "off"; an unknown
 *   switch state must never look like a deliberate choice.
 * - A failed write restores the previous value and shows the reason, so the
 *   switch never claims a state the Host did not accept.
 * - Only one write is in flight at a time; the panel disables itself meanwhile.
 * - A successful write is no longer silent: the switch moving optimistically is
 *   not proof the Host accepted it, so a short `Toast` confirms the save.
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { GuardPanel, type GuardSectionId, type GuardStatsSnapshotView } from './GuardPanel.tsx'
import type { PluginSectionKey } from './PluginSection.tsx'
import type { GuardSwitches } from './remote.ts'

/**
 * Keys this container resolves.
 *
 * `guardToastSaved` is registered in `index.ts` under the namespace the shell
 * binds (`settings.capability`), but it is not part of the tab/panel copy union
 * that `PluginSectionKey` enumerates — and that union is owned by the shell — so
 * it is widened here instead of there.
 */
export type GuardContainerKey = PluginSectionKey | 'guardToastSaved'

/** The remote face this container reads; a subset of `CapabilityPolicyRemote`. */
export interface GuardSwitchRemote {
  getGuard?(): Promise<{ ok: true; value: GuardSwitches } | { ok: false; error: { code: string; message: string } }>
  updateGuard?(change: Partial<GuardSwitches>): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>
  /**
   * Real Guard counters. Optional so an older Host degrades to 「—」 instead of
   * failing the whole page — the board is diagnostic, not load-bearing.
   */
  getGuardStats?(): Promise<{ ok: true; value: GuardStatsSnapshotView } | { ok: false; error: { code: string; message: string } }>
  /** Used by 总览 for the tier split; declared here so one object serves both. */
  classifyAll?(): Promise<
    { ok: true; value: readonly { class: 'resident' | 'on-demand' | 'disabled' }[] }
    | { ok: false; error: { code: string; message: string } }
  >
}

export interface GuardContainerProps {
  readonly t: (key: PluginSectionKey) => string
  readonly remote: GuardSwitchRemote
  /** Fixed thresholds; the implementation does not expose per-level edits. */
  readonly duplicateThresholds?: readonly number[]
}

/** Section id → Guard switch it controls. */
const SECTION_FIELD: Readonly<Record<GuardSectionId, keyof GuardSwitches>> = {
  duplicate_call: 'duplicateDetection',
  alternating_cycle: 'alternatingCycleDetection',
  no_progress: 'noProgressProtection',
}

interface State {
  readonly switches?: GuardSwitches
  readonly stats?: GuardStatsSnapshotView
  readonly error?: string
  readonly busy: boolean
}

/** A confirmation on screen; `seq` restarts the hold when the same text repeats. */
interface ToastState {
  readonly text: string
  readonly seq: number
}

export function GuardContainer(props: GuardContainerProps): ReactElement {
  const { t, remote, duplicateThresholds } = props
  const [state, setState] = useState<State>({ busy: false })
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  /**
   * Confirm an accepted write. The switch already moved optimistically, so this
   * only reports the Host's answer; a rejection keeps using the error line, which
   * stays on screen because it names what broke.
   */
  const showSaved = useCallback((): void => {
    const translate = t as (key: GuardContainerKey) => string
    toastSeq.current += 1
    setToast({ text: translate('guardToastSaved'), seq: toastSeq.current })
  }, [t])

  const load = useCallback(async (): Promise<void> => {
    if (remote.getGuard === undefined) {
      setState({ busy: false, error: 'Host does not expose Guard switches.' })
      return
    }
    // Read the switches and the counters together: the board answers 「它是否在
    // 工作」, and showing it empty while the switches loaded would read as
    // "the Guard has never done anything".
    const [result, statsResult] = await Promise.all([
      remote.getGuard(),
      remote.getGuardStats === undefined ? Promise.resolve(undefined) : remote.getGuardStats(),
    ])
    if (!alive.current) return
    const stats = statsResult !== undefined && statsResult.ok ? statsResult.value : undefined
    if (result.ok) setState({ switches: result.value, busy: false, ...(stats === undefined ? {} : { stats }) })
    else setState({ busy: false, error: result.error.message })
  }, [remote])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback(async (id: GuardSectionId, next: boolean): Promise<void> => {
    const field = SECTION_FIELD[id]
    const previous = state.switches
    if (previous === undefined) return
    // Optimistic: the switch moves immediately, and a rejection restores it.
    setState({ switches: { ...previous, [field]: next }, busy: true })
    if (remote.updateGuard === undefined) {
      setState({ switches: previous, busy: false, error: 'Host does not accept Guard changes.' })
      return
    }
    const result = await remote.updateGuard({ [field]: next })
    if (!alive.current) return
    if (result.ok) {
      setState({ switches: { ...previous, [field]: next }, busy: false })
      showSaved()
    } else setState({ switches: previous, busy: false, error: result.error.message })
  }, [remote, state.switches, showSaved])

  /**
   * Persist an edited threshold list.
   *
   * No optimistic update: the Host validates the list and may refuse it, and a
   * field that first shows a value the detector rejected is worse than one that
   * waits. The previous value stays on screen until the write is accepted.
   */
  const changeThresholds = useCallback(async (next: readonly number[]): Promise<void> => {
    const previous = state.switches
    if (previous === undefined || remote.updateGuard === undefined) return
    setState(current => ({ ...current, busy: true }))
    const result = await remote.updateGuard({ repeatThresholds: next })
    if (!alive.current) return
    if (result.ok) {
      setState({ switches: { ...previous, repeatThresholds: next }, busy: false })
      showSaved()
    } else setState({ switches: previous, busy: false, error: result.error.message })
  }, [remote, state.switches, showSaved])

  const reset = useCallback(async (): Promise<void> => {
    const previous = state.switches
    if (previous === undefined || remote.updateGuard === undefined) return
    const defaults: GuardSwitches = {
      enabled: true,
      duplicateDetection: true,
      alternatingCycleDetection: true,
      noProgressProtection: true,
      repeatThresholds: [3, 5, 8],
    }
    setState({ switches: defaults, busy: true })
    const result = await remote.updateGuard(defaults)
    if (!alive.current) return
    if (result.ok) {
      setState({ switches: defaults, busy: false })
      showSaved()
    } else setState({ switches: previous, busy: false, error: result.error.message })
  }, [remote, state.switches, showSaved])

  const switches = state.switches
  return createElement('div', { className: 'mc-guard-container' },
    // Keyed by sequence: re-saving the same switch would otherwise reuse the
    // mounted toast and never restart its hold.
    toast !== null && createElement(Toast, {
      key: toast.seq,
      text: toast.text,
      tone: 'success',
      holdMs: 4000,
      onDone: () => setToast(current => (current !== null && current.seq === toast.seq ? null : current)),
    }),
    state.error !== undefined && createElement('p', { className: 'mc-error-hint' }, state.error),
    createElement(GuardPanel, {
      t,
      // Prefer the LIVE thresholds from the Host over the shell's constant: the
      // operator can now edit them, so the prop is only the first-paint fallback.
      duplicateThresholds: switches?.repeatThresholds ?? duplicateThresholds,
      ...(switches === undefined || state.busy ? {} : { onThresholdsChange: (next: readonly number[]) => { void changeThresholds(next) } }),
      ...(state.stats === undefined ? {} : { stats: state.stats }),
      // Undefined while loading or after a failed read: the panel then renders
      // the switches disabled rather than as a false "off".
      enabled: switches === undefined
        ? undefined
        : {
            duplicate_call: switches.duplicateDetection,
            alternating_cycle: switches.alternatingCycleDetection,
            no_progress: switches.noProgressProtection,
          },
      onToggle: switches === undefined || state.busy ? undefined : (id: GuardSectionId, next: boolean) => { void toggle(id, next) },
      onReset: switches === undefined || state.busy ? undefined : () => { void reset() },
    }),
  )
}
