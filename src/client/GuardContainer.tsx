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
 *
 * TG-04 (counters survive / refresh / generations):
 * - A save (success, rejection or throw) never blanks the counters or the
 *   diagnostics already on screen; a missing fresh value keeps the old one.
 * - A successful save re-reads the accepted config from the Host instead of
 *   trusting the optimistic closure.
 * - While the page is active the counters refresh on a bounded single-flight
 *   timer; hiding the page or unmounting cancels it and ignores late responses.
 * - Every read/write carries a generation, so a slow older response can never
 *   overwrite a newer one and an older write's `finally` never clears a newer
 *   write's busy state.
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { GuardPanel, type GuardSectionId, type GuardStatsSnapshotView } from './GuardPanel.tsx'
import type { PluginSectionKey } from './PluginSection.tsx'
import type { GuardDiagnostics, GuardSwitches } from './remote.ts'

/**
 * Keys this container resolves.
 *
 * `guardToastSaved` is registered in `index.ts` under the namespace the shell
 * binds (`settings.capability`), but it is not part of the tab/panel copy union
 * that `PluginSectionKey` enumerates — and that union is owned by the shell — so
 * it is widened here instead of there.
 */
export type GuardContainerKey =
  | PluginSectionKey
  | 'guardToastSaved'
  // Diagnostics copy. Registered in index.ts beside the toast key, because the
  // tab/panel union is owned by the shell and must not grow here.
  | 'guardDiagUnavailableTitle'
  | 'guardDiagInvalidPatch'
  | 'guardDiagNotMounted'
  | 'guardDiagPersistenceDirty'

/** The remote face this container reads; a subset of `CapabilityPolicyRemote`. */
export interface GuardSwitchRemote {
  getGuard?(): Promise<{ ok: true; value: GuardSwitches } | { ok: false; error: { code: string; message: string } }>
  updateGuard?(change: Partial<GuardSwitches>): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>
  /**
   * Real Guard counters. Optional so an older Host degrades to 「—」 instead of
   * failing the whole page — the board is diagnostic, not load-bearing.
   */
  getGuardStats?(): Promise<{ ok: true; value: GuardStatsSnapshotView } | { ok: false; error: { code: string; message: string } }>
  /**
   * Whether the Guard is actually in effect. Optional so an older Host degrades
   * to "no banner" instead of failing the page — absence must never be read as
   * "available", and it must not blank the switches either.
   */
  getGuardDiagnostics?(): Promise<{ ok: true; value: GuardDiagnostics } | { ok: false; error: { code: string; message: string } }>
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
  /**
   * Whether the 执行保护 page is the visible tab.
   *
   * Only an active page polls its counters; a hidden page must not keep a timer
   * running. Defaults to `true` so a standalone mount (and older callers/tests
   * that predate the shell tab wiring) keep refreshing.
   */
  readonly active?: boolean
}

/** Section id → Guard switch it controls. */
const SECTION_FIELD: Readonly<Record<GuardSectionId, keyof GuardSwitches>> = {
  duplicate_call: 'duplicateDetection',
  alternating_cycle: 'alternatingCycleDetection',
  no_progress: 'noProgressProtection',
}

/** How often an active 执行保护 page re-reads the counters. */
const REFRESH_MS = 5000

interface State {
  readonly switches?: GuardSwitches
  /** The remote that produced `switches`; a different source must not reuse them. */
  readonly switchesSource?: GuardSwitchRemote
  readonly stats?: GuardStatsSnapshotView
  /**
   * The remote that produced `stats`. Optional diagnostic state is only reusable
   * while the SOURCE is unchanged: a replaced remote must never present the old
   * remote's counters as if they described it.
   */
  readonly statsSource?: GuardSwitchRemote
  /** Absent when the Host has no diagnostics method, or the read failed. */
  readonly diagnostics?: GuardDiagnostics
  /** The remote that produced `diagnostics` (see `statsSource`). */
  readonly diagSource?: GuardSwitchRemote
  readonly error?: string
  readonly busy: boolean
}

/**
 * Per-source runtime.
 *
 * One of these exists per source activation. It owns the write queue, the
 * in-flight write counter and a cancel flag, so a source that is replaced keeps
 * its own pending state: an unfinished write on A cannot block B's queue, pause
 * B's polling, or decrement B's counter, and A's queued actions see `cancelled`.
 */
interface EpochRuntime {
  readonly source: GuardSwitchRemote
  queue: Promise<unknown>
  writing: number
  cancelled: boolean
}

function newEpochRuntime(source: GuardSwitchRemote): EpochRuntime {
  return { source, queue: Promise.resolve(), writing: 0, cancelled: false }
}

/** A confirmation on screen; `seq` restarts the hold when the same text repeats. */
interface ToastState {
  readonly text: string
  readonly seq: number
}

/**
 * Run one optional remote call and collapse every failure to `undefined`.
 *
 * Covers a Host with no such method, a rejected promise, AND a synchronous
 * throw from a malformed stub: none of them may reject the page's load, because
 * these are diagnostics, not the data the page exists to show.
 */
export async function readOptional<T>(
  call: (() => Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>) | undefined,
): Promise<T | undefined> {
  if (call === undefined) return undefined
  try {
    const result = await call()
    return result.ok ? result.value : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the Guard diagnostics, treating every "cannot know" answer as absent.
 *
 * Four cases collapse to `undefined` on purpose: an older Host without the
 * method, a rejected call, a synchronous throw, and a malformed answer. Absence
 * must render as NO banner — showing "not available" because the Host is old
 * would be a false alarm, and showing "available" would be an unproven claim.
 */
export async function readGuardDiagnostics(
  remote: GuardSwitchRemote,
): Promise<GuardDiagnostics | undefined> {
  if (remote.getGuardDiagnostics === undefined) return undefined
  try {
    const result = await remote.getGuardDiagnostics()
    return result.ok ? result.value : undefined
  } catch {
    return undefined
  }
}

/**
 * Turn an unknown thrown value into a message safe to render.
 *
 * A rejected call carries a fixed code on the wire, but a THROWN transport
 * error has no code — its message is the only reason worth showing the user.
 */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

/**
 * The "not in effect" banner, as a hook-free element tree.
 *
 * Extracted so the copy and the data attributes can be asserted directly, and
 * so the container stays a thin wire-up. Returning `null` for an available Guard
 * is what keeps a healthy page clean.
 */
export function GuardDiagnosticsBanner(props: {
  readonly t: (key: GuardContainerKey) => string
  readonly diagnostics?: GuardDiagnostics
}): ReactElement | null {
  const { t, diagnostics } = props
  if (diagnostics === undefined || diagnostics.available) return null
  return createElement('div', {
    className: 'mc-guard-diag',
    'data-guard-available': 'false',
    role: 'status',
  },
    createElement('p', { className: 'mc-guard-diag-title' }, t('guardDiagUnavailableTitle')),
    diagnostics.reasons.includes('invalid-patch')
      && createElement('p', { className: 'mc-guard-diag-reason' }, t('guardDiagInvalidPatch')),
    diagnostics.reasons.includes('not-mounted')
      && createElement('p', { className: 'mc-guard-diag-reason' }, t('guardDiagNotMounted')),
  )
}

/**
 * The "pending write did not land" line, also hook-free.
 *
 * Only `dirty` is shown; the failure code never reaches the page, because the
 * wire carries a fixed code rather than an exception message.
 */
export function GuardPersistenceHint(props: {
  readonly t: (key: GuardContainerKey) => string
  readonly diagnostics?: GuardDiagnostics
}): ReactElement | null {
  const { t, diagnostics } = props
  if (diagnostics === undefined || !diagnostics.persistence.dirty) return null
  return createElement('p', {
    className: 'mc-guard-diag-persist',
    'data-guard-persistence': diagnostics.persistence.lastErrorCode ?? 'pending',
  }, t('guardDiagPersistenceDirty'))
}

export function GuardContainer(props: GuardContainerProps): ReactElement {
  const { t, remote, duplicateThresholds, active } = props
  const [state, setState] = useState<State>({ busy: false })
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
  const alive = useRef(true)
  /**
   * Monotonic request generation.
   *
   * Every read or write takes the next number and may only commit while it is
   * still the newest. A commit from a replaced source (or a superseded request)
   * finds `gen !== genRef.current` and is discarded.
   */
  const genRef = useRef(0)
  /**
   * Per-source runtime: queue + in-flight counter + cancel flag.
   *
   * A new remote gets a FRESH epoch (even A→B→A, where the object reference may
   * repeat): an unfinished write on the old source keeps its own queue/counter
   * and can never block, block polling for, or decrement the new source. Old
   * queued actions see `cancelled` and do not run.
   */
  const epochRef = useRef<EpochRuntime>(newEpochRuntime(remote))
  /** Latest committed state, read synchronously by a queued write. */
  const stateRef = useRef<State>({ busy: false })

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const nextGen = useCallback((): number => {
    genRef.current += 1
    return genRef.current
  }, [])

  /**
   * Apply a state change only if this generation is still the newest.
   *
   * The updater runs against `stateRef` (latest committed state) and writes the
   * result back synchronously, so a queued write running right after a commit
   * sees that commit rather than a stale render closure.
   */
  const commit = useCallback((gen: number, next: (current: State) => State): void => {
    if (!alive.current || gen !== genRef.current) return
    const updated = next(stateRef.current)
    if (updated === stateRef.current) return
    stateRef.current = updated
    setState(updated)
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

  /**
   * Commit a failed READ.
   *
   * A same-source transient failure keeps the last-known values and shows the
   * error (never a fake zero); a value recorded against a DIFFERENT source is
   * dropped so B can never present A's switches/counters/diagnostics.
   */
  const commitReadError = useCallback((gen: number, epoch: EpochRuntime, message: string): void => {
    commit(gen, current => {
      const source = epoch.source
      return {
        busy: false,
        error: message,
        ...(current.switchesSource === source && current.switches !== undefined ? { switches: current.switches } : {}),
        ...(current.statsSource === source && current.stats !== undefined ? { stats: current.stats, statsSource: current.statsSource } : {}),
        ...(current.diagSource === source && current.diagnostics !== undefined ? { diagnostics: current.diagnostics, diagSource: current.diagSource } : {}),
      }
    })
  }, [commit])

  /**
   * Read switches + counters + diagnostics for one generation of one epoch.
   *
   * The required `getGuard` is awaited on its own so a THROW becomes a visible
   * error with busy released. Optional channels are bound to `epoch.source`: a
   * value from a different source is dropped, a missing fresh value keeps the
   * last-known one only while the source is unchanged, and a superseded/unmounted
   * read stops before firing its optional side requests.
   */
  const readAll = useCallback(async (gen: number, epoch: EpochRuntime): Promise<void> => {
    if (epoch.cancelled) return
    const source = epoch.source
    const getGuard = source.getGuard
    if (getGuard === undefined) {
      commitReadError(gen, epoch, 'Host does not expose Guard switches.')
      return
    }
    let result: Awaited<ReturnType<NonNullable<GuardSwitchRemote['getGuard']>>>
    try {
      result = await getGuard()
    } catch (error) {
      commitReadError(gen, epoch, errorText(error))
      return
    }
    if (!alive.current || gen !== genRef.current || epoch.cancelled) return
    const [stats, diagnostics] = await Promise.all([
      readOptional(source.getGuardStats === undefined ? undefined : () => source.getGuardStats!()),
      readGuardDiagnostics(source),
    ])
    if (!alive.current || gen !== genRef.current || epoch.cancelled) return
    if (result.ok) {
      commit(gen, current => {
        const keepStats = stats === undefined && current.statsSource === source
        const keepDiag = diagnostics === undefined && current.diagSource === source
        const nextStats = stats !== undefined ? stats : (keepStats ? current.stats : undefined)
        const nextDiag = diagnostics !== undefined ? diagnostics : (keepDiag ? current.diagnostics : undefined)
        return {
          switches: result.value,
          switchesSource: source,
          busy: false,
          statsSource: source,
          diagSource: source,
          ...(nextStats === undefined ? {} : { stats: nextStats }),
          ...(nextDiag === undefined ? {} : { diagnostics: nextDiag }),
        }
      })
    } else {
      commitReadError(gen, epoch, result.error.message)
    }
  }, [commit, commitReadError])

  /**
   * Bind the current remote to a source epoch and load it.
   *
   * A changed remote cancels the previous epoch, installs a FRESH queue/counter,
   * clears all state (so B never shows A's switches/counters/diagnostics), and
   * loads. Only an active, uncancelled epoch may fill the page.
   */
  useEffect(() => {
    const previous = epochRef.current
    if (previous.source !== remote) {
      previous.cancelled = true
      const epoch = newEpochRuntime(remote)
      epochRef.current = epoch
      const gen = nextGen()
      commit(gen, () => ({ busy: false }))
      void readAll(gen, epoch)
    } else {
      void readAll(nextGen(), previous)
    }
  }, [remote, nextGen, commit, readAll])

  /** Queue a write on THIS epoch's queue, so another source cannot block it. */
  const enqueueWrite = useCallback((epoch: EpochRuntime, task: () => Promise<void>): void => {
    const run = epoch.queue.then(task, task)
    epoch.queue = run.then(() => undefined, () => undefined)
  }, [])

  /**
   * One write, with intent-level rollback, authoritative reconciliation and a
   * generation/epoch-safe `finally`.
   *
   * On failure only THIS intent is reverted, then the accepted truth is re-read.
   * `finally` decrements THIS epoch's counter and releases busy only when this
   * write is still the newest of an active epoch.
   */
  const runWrite = useCallback(async (
    gen: number,
    epoch: EpochRuntime,
    write: () => Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>,
    rollback: (current: State) => State,
  ): Promise<void> => {
    epoch.writing += 1
    try {
      const result = await write()
      if (!alive.current || gen !== genRef.current || epoch.cancelled) return
      if (result.ok) {
        await readAll(gen, epoch)
        if (gen === genRef.current && alive.current && !epoch.cancelled) showSaved()
      } else {
        commit(gen, current => ({ ...rollback(current), busy: true }))
        await readAll(gen, epoch)
        if (gen === genRef.current && alive.current && !epoch.cancelled) {
          commit(gen, current => ({ ...current, error: result.error.message }))
        }
      }
    } catch (error) {
      commit(gen, current => ({ ...rollback(current), busy: true }))
      await readAll(gen, epoch)
      if (gen === genRef.current && alive.current && !epoch.cancelled) {
        commit(gen, current => ({ ...current, error: errorText(error) }))
      }
    } finally {
      epoch.writing -= 1
      if (gen === genRef.current && alive.current && !epoch.cancelled) {
        commit(gen, current => (current.busy ? { ...current, busy: false } : current))
      }
    }
  }, [readAll, commit, showSaved])

  const toggle = useCallback((id: GuardSectionId, next: boolean): void => {
    const epoch = epochRef.current
    enqueueWrite(epoch, async () => {
      if (epoch.cancelled) return
      const previous = stateRef.current.switches
      if (previous === undefined) return
      const field = SECTION_FIELD[id]
      const gen = nextGen()
      if (epoch.source.updateGuard === undefined) {
        commit(gen, current => ({ ...current, switches: previous, busy: false, error: 'Host does not accept Guard changes.' }))
        return
      }
      const previousValue = previous[field]
      // Optimistic: the switch moves immediately, and a rejection reverts it.
      commit(gen, current => ({ ...current, switches: { ...previous, [field]: next }, busy: true, error: undefined }))
      await runWrite(gen, epoch, () => epoch.source.updateGuard!({ [field]: next }), current => {
        const sw = current.switches
        if (sw === undefined) return current
        return { ...current, switches: { ...sw, [field]: previousValue } }
      })
    })
  }, [nextGen, commit, runWrite, enqueueWrite])

  /**
   * Persist an edited threshold list.
   *
   * No optimistic update: the Host validates the list and may refuse it, and a
   * field that first shows a value the detector rejected is worse than one that
   * waits. The previous value stays on screen until the write is accepted.
   */
  const changeThresholds = useCallback((next: readonly number[]): void => {
    const epoch = epochRef.current
    enqueueWrite(epoch, async () => {
      if (epoch.cancelled) return
      const previous = stateRef.current.switches
      if (previous === undefined || epoch.source.updateGuard === undefined) return
      const gen = nextGen()
      commit(gen, current => ({ ...current, busy: true }))
      await runWrite(gen, epoch, () => epoch.source.updateGuard!({ repeatThresholds: next }), current => current)
    })
  }, [nextGen, commit, runWrite, enqueueWrite])

  /**
   * Bounded single-flight refresh, only while the page is visible.
   *
   * The timer belongs to the current epoch: a hidden page or a new source
   * cancels it. `running` prevents overlap, and `epoch.writing` (this source
   * only) pauses polling while THIS source is writing — another source's
   * unfinished write can never stall it.
   */
  const pollActive = active ?? true
  useEffect(() => {
    if (!pollActive || remote.getGuard === undefined) return
    const epoch = epochRef.current
    let cancelled = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      if (cancelled) return
      timer = setTimeout(() => { void run() }, REFRESH_MS)
    }
    const run = async (): Promise<void> => {
      if (cancelled || epoch.cancelled) return
      if (running || epoch.writing > 0) { schedule(); return }
      running = true
      try {
        await readAll(nextGen(), epoch)
      } finally {
        running = false
      }
      if (!cancelled) schedule()
    }
    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [pollActive, remote, readAll, nextGen])

  const switches = state.switches
  const diagnostics = state.diagnostics
  const translate = t as (key: GuardContainerKey) => string
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
    // Diagnostics render as an explicit "not in effect" banner. A Guard that is
    // off must never look like a Guard quietly working with defaults, and the
    // switches stay usable so the operator can fix the configuration.
    createElement(GuardDiagnosticsBanner, {
      t: translate,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    }),
    createElement(GuardPersistenceHint, {
      t: translate,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    }),
    // No manual refresh and no "restore defaults" control here: the counters
    // already refresh themselves on the bounded timer, and the three switches
    // keep the operator's own values. Two extra buttons only stole space from
    // the A/B/C cards and wrapped onto a second row.
    createElement(GuardPanel, {
      t,
      // Prefer the LIVE thresholds from the Host over the shell's constant: the
      // operator can now edit them, so the prop is only the first-paint fallback.
      duplicateThresholds: switches?.repeatThresholds ?? duplicateThresholds,
      ...(switches === undefined || state.busy ? {} : { onThresholdsChange: (next: readonly number[]) => { changeThresholds(next) } }),
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
      onToggle: switches === undefined || state.busy ? undefined : (id: GuardSectionId, next: boolean) => { toggle(id, next) },
    }),
  )
}
