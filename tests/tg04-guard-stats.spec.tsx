/**
 * TG-04 mounted coverage — Guard counters survive every save path, refresh
 * while the 执行保护 page is active, and never let a late response win.
 *
 * These cases mount the REAL GuardContainer with react-dom/client + act under
 * jsdom. They are the "real React container" evidence TG-04 asks for; the pure
 * element-tree specs elsewhere cannot observe async generations or timers.
 *
 * Behaviour under test (see 插件功能与实现报告.md · TG-04):
 *  - a successful / rejected / throwing save must not blank the counters or the
 *    diagnostics already on screen, and must never fabricate a zero;
 *  - after a successful save the container re-reads the accepted config from the
 *    Host instead of trusting the optimistic closure;
 *  - a required getGuard() that throws shows an error and recovers busy (never
 *    hangs the page);
 *  - while active it refreshes on a bounded single-flight timer; hiding the page
 *    or unmounting cancels the timer and ignores late responses;
 *  - replacing the remote / out-of-order responses must not cross (generation
 *    guards), and an older write's finally must not clear a newer write's busy.
 *
 * @vitest-environment jsdom
 */
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuardContainer, type GuardSwitchRemote } from '../src/client/GuardContainer.tsx'
import type { GuardDiagnostics, GuardSwitches } from '../src/client/remote.ts'
import type { GuardStatsSnapshotView } from '../src/client/GuardPanel.tsx'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => key

const switches = {
  enabled: true,
  duplicateDetection: true,
  alternatingCycleDetection: true,
  noProgressProtection: true,
  repeatThresholds: [3, 5, 8] as number[],
}

const stats: GuardStatsSnapshotView = {
  observations: 5,
  reminders: { repeat: 2, cycle: 1 },
  denials: 1,
  outcomes: { success: 4, error: 1, cancelled: 0 },
  since: 1,
}

const available: GuardDiagnostics = { available: true, reasons: [], persistence: { dirty: false } }
const unavailable: GuardDiagnostics = { available: false, reasons: ['not-mounted'], persistence: { dirty: false } }

let root: Root | undefined
let host: HTMLDivElement | undefined

interface MountExtra {
  readonly active?: boolean
}

async function mount(remote: GuardSwitchRemote, extra: MountExtra = {}): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(GuardContainer, { t: t as never, remote, ...extra }))
  })
  return host
}

async function rerender(remote: GuardSwitchRemote, extra: MountExtra = {}): Promise<void> {
  await act(async () => {
    root!.render(createElement(GuardContainer, { t: t as never, remote, ...extra }))
  })
}

afterEach(async () => {
  vi.useRealTimers()
  if (root !== undefined) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  host?.remove()
  host = undefined
})

/** The observations cell's text, which reads '5' when counted and '—' when absent. */
function observationsText(el: HTMLElement): string {
  return el.querySelector('[data-guard-stat="guardStatObservations"]')?.textContent ?? ''
}

function switchButtons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll('[role="switch"]')] as HTMLButtonElement[]
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('TG-04 · counters survive every save path', () => {
  it('keeps the counters after a successful save and re-reads the accepted config', async () => {
    let guardCalls = 0
    const remote: GuardSwitchRemote = {
      getGuard: async () => { guardCalls += 1; return { ok: true as const, value: switches } },
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: unavailable }),
    }
    const el = await mount(remote)
    expect(observationsText(el)).toContain('5')
    expect(el.querySelector('.mc-guard-diag')).not.toBeNull()

    const before = guardCalls
    await act(async () => { switchButtons(el)[0]!.click() })

    // The counters and the banner are still there — a save must not blank them.
    expect(observationsText(el)).toContain('5')
    expect(observationsText(el)).not.toContain('—')
    expect(el.querySelector('.mc-guard-diag')).not.toBeNull()
    // Authoritative re-read: the container asked the Host for the accepted config.
    expect(guardCalls).toBeGreaterThan(before)
    // busy cleared.
    expect(switchButtons(el).some(button => button.disabled === false)).toBe(true)
  })

  it('keeps the counters when the save is REJECTED, and shows the reason', async () => {
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: false as const, error: { code: 'nope', message: '保存被拒绝' } }),
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remote)
    await act(async () => { switchButtons(el)[0]!.click() })

    expect(observationsText(el)).toContain('5')
    expect(el.querySelector('.mc-error-hint')?.textContent).toContain('保存被拒绝')
    expect(switchButtons(el).some(button => button.disabled === false)).toBe(true)
  })

  it('keeps the counters when the save THROWS, recovers busy, and shows the reason', async () => {
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: (() => { throw new Error('transport boom') }) as never,
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remote)
    await act(async () => { switchButtons(el)[0]!.click() })

    // A throwing write must not blank the board…
    expect(observationsText(el)).toContain('5')
    expect(observationsText(el)).not.toContain('—')
    // …must surface the failure…
    expect(el.querySelector('.mc-error-hint')?.textContent).toContain('transport boom')
    // …and must release busy so the switches are usable again.
    expect(switchButtons(el).some(button => button.disabled === false)).toBe(true)
  })

  it('keeps last-known counters/diagnostics across a transient SAME-remote failure (no fake zero)', async () => {
    let fail = false
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => {
        if (fail) throw new Error('stats down')
        return { ok: true as const, value: { ...stats, observations: 5 } }
      },
      getGuardDiagnostics: async () => {
        if (fail) throw new Error('diag down')
        return { ok: true as const, value: unavailable }
      },
    }
    const el = await mount(remote)
    expect(observationsText(el)).toContain('5')
    expect(el.querySelector('.mc-guard-diag')).not.toBeNull()

    // Same remote, transient failure: the last-known values must survive rather
    // than collapsing to a fabricated zero / disappearing banner.
    fail = true
    await act(async () => { (el.querySelector('[data-guard-refresh="true"]') as HTMLButtonElement).click() })
    expect(observationsText(el)).toContain('5')
    expect(observationsText(el)).not.toContain('—')
    expect(el.querySelector('.mc-guard-diag')).not.toBeNull()
  })

  it('recovers busy and shows an error when the REQUIRED getGuard throws', async () => {
    const remote: GuardSwitchRemote = {
      getGuard: (async () => { throw new Error('guard read down') }) as never,
      updateGuard: async () => ({ ok: true as const, value: undefined }),
    }
    const el = await mount(remote)
    // The required read failing is a real error, not an endless "loading".
    expect(el.querySelector('.mc-error-hint')?.textContent).toContain('guard read down')
  })
})

describe('TG-04 · bounded single-flight refresh while active', () => {
  it('refreshes the counters on a timer while active, and stops when hidden', async () => {
    vi.useFakeTimers()
    let statsCalls = 0
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => {
        statsCalls += 1
        return { ok: true as const, value: { ...stats, observations: 5 + statsCalls } }
      },
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remote)   // active defaults to true
    const initialCalls = statsCalls

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(statsCalls).toBeGreaterThan(initialCalls)
    // The newer counter is actually painted, not just fetched.
    expect(observationsText(el)).toContain(String(5 + statsCalls))

    // Hidden: the timer is cancelled and no further reads happen.
    const afterActive = statsCalls
    await rerender(remote, { active: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(statsCalls).toBe(afterActive)
  })

  it('re-reads the counters from the 刷新 button, reusing the existing label key', async () => {
    let statsCalls = 0
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => {
        statsCalls += 1
        return { ok: true as const, value: { ...stats, observations: 5 + statsCalls } }
      },
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remote)
    const button = el.querySelector('[data-guard-refresh="true"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    // The manual refresh reuses the existing 'overviewRefresh' copy; no new key.
    expect(button!.textContent).toBe('overviewRefresh')
    expect(button!.disabled).toBe(false)

    const before = statsCalls
    await act(async () => { button!.click() })
    expect(statsCalls).toBeGreaterThan(before)
    expect(observationsText(el)).toContain(String(5 + statsCalls))
  })

  it('cancels the timer on unmount and ignores any late response', async () => {
    vi.useFakeTimers()
    let statsCalls = 0
    const first = deferred<{ ok: true; value: GuardStatsSnapshotView }>()
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: () => {
        statsCalls += 1
        // First (mount) read resolves; the poll read stays pending so we can
        // resolve it AFTER unmount and prove it is ignored.
        return statsCalls === 1 ? Promise.resolve({ ok: true as const, value: stats }) : first.promise
      },
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    await mount(remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(statsCalls).toBeGreaterThan(1)

    const current = root!
    root = undefined
    await act(async () => { current.unmount() })
    // Resolve the orphaned poll response: no throw, no state write on a dead tree.
    await act(async () => { first.resolve({ ok: true, value: { ...stats, observations: 999 } }) })
    expect(host!.isConnected).toBe(true)
  })
})

describe('TG-04 · source identity never mixes, and writes serialize', () => {
  it('drops the previous remote counters/diagnostics when a new remote lacks them', async () => {
    const remoteA: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: { ...stats, observations: 5 } }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: unavailable }),
    }
    const el = await mount(remoteA)
    expect(observationsText(el)).toContain('5')
    expect(el.querySelector('.mc-guard-diag')).not.toBeNull()

    // Remote B exposes neither optional channel. A's counters/diagnostics must
    // NOT be presented as if they described B.
    const remoteB: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
    }
    await rerender(remoteB)
    expect(observationsText(el)).toContain('—')
    expect(observationsText(el)).not.toContain('5')
    expect(el.querySelector('.mc-guard-diag')).toBeNull()
  })

  it('ignores a late counters/diagnostics answer from the replaced remote', async () => {
    const lateGuard = deferred<{ ok: true; value: typeof switches }>()
    const remoteA: GuardSwitchRemote = {
      getGuard: () => lateGuard.promise,
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: { ...stats, observations: 999 } }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: unavailable }),
    }
    await mount(remoteA)

    const remoteB: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: { ...stats, observations: 7 } }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    await rerender(remoteB)
    expect(observationsText(host!)).toContain('7')
    expect(host!.querySelector('.mc-guard-diag')).toBeNull()

    // A answers late with 999 + a not-mounted reason; neither may reach the page.
    await act(async () => { lateGuard.resolve({ ok: true, value: switches }) })
    expect(observationsText(host!)).toContain('7')
    expect(observationsText(host!)).not.toContain('999')
    expect(host!.querySelector('.mc-guard-diag')).toBeNull()
  })

  it('serializes two same-tick writes: a later rejection must not roll back an earlier accepted field', async () => {
    let hostSwitches: GuardSwitches = { ...switches }
    const first = deferred<{ ok: true; value: undefined }>()
    const second = deferred<{ ok: false; error: { code: string; message: string } }>()
    let calls = 0
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: { ...hostSwitches } }),
      updateGuard: (change) => {
        calls += 1
        if (calls === 1) {
          return first.promise.then(result => {
            if (result.ok) hostSwitches = { ...hostSwitches, ...change }
            return result
          })
        }
        return second.promise
      },
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remote)

    // Two clicks in one batch. Writes serialize, so only the first is dispatched.
    await act(async () => { switchButtons(el)[0]!.click(); switchButtons(el)[1]!.click() })
    expect(calls).toBe(1)
    expect(switchButtons(el).every(button => button.disabled)).toBe(true)

    // First (duplicateDetection) is accepted by the Host.
    await act(async () => { first.resolve({ ok: true, value: undefined }) })
    expect(calls).toBe(2)
    expect(switchButtons(el)[0]!.getAttribute('aria-checked')).toBe('false')

    // Second (alternatingCycle) is rejected. It must revert only ITSELF.
    await act(async () => { second.resolve({ ok: false, error: { code: 'x', message: '拒绝 Y' } }) })
    expect(el.querySelector('.mc-error-hint')?.textContent).toContain('拒绝 Y')
    const checked = switchButtons(el).map(button => button.getAttribute('aria-checked'))
    expect(checked).toEqual(['false', 'true', 'true'])
    expect(switchButtons(el).some(button => button.disabled === false)).toBe(true)
  })

  it('isolates an in-flight write from a replaced remote', async () => {
    const pending = deferred<{ ok: true; value: undefined }>()
    const remoteA: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: () => pending.promise,
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remoteA)
    await act(async () => { switchButtons(el)[0]!.click() })
    expect(switchButtons(el).every(button => button.disabled)).toBe(true)

    const remoteB: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: { ...stats, observations: 3 } }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    await rerender(remoteB)
    expect(observationsText(el)).toContain('3')

    // The old write settles late: it must not resurrect A's optimistic toggle and
    // must not leave busy stuck on B's page.
    await act(async () => { pending.resolve({ ok: true, value: undefined }) })
    expect(switchButtons(el).map(button => button.getAttribute('aria-checked')))
      .toEqual(['true', 'true', 'true'])
    expect(switchButtons(el).some(button => button.disabled === false)).toBe(true)
  })
})

describe('TG-04 · per-source epoch isolation (R1/R2)', () => {
  it('B writes and polls without waiting for A\'s never-settling write', async () => {
    vi.useFakeTimers()
    const never = deferred<{ ok: true; value: undefined }>()
    let aCalls = 0
    const remoteA: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: () => { aCalls += 1; return never.promise },
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remoteA)
    await act(async () => { switchButtons(el)[0]!.click() })
    expect(aCalls).toBe(1)

    let bCalls = 0
    let bStats = 0
    const remoteB: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => { bCalls += 1; return { ok: true as const, value: undefined } },
      getGuardStats: async () => { bStats += 1; return { ok: true as const, value: { ...stats, observations: 3 } } },
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    await rerender(remoteB)
    expect(observationsText(el)).toContain('3')

    // B writes on its own although A's write is still pending forever.
    await act(async () => { switchButtons(el)[0]!.click() })
    expect(bCalls).toBe(1)

    // B polls on its own: A's pending write must not pause B's timer.
    const before = bStats
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(bStats).toBeGreaterThan(before)
  })

  it('A→B→A gets a fresh epoch; the old queued action does not run', async () => {
    const first = deferred<{ ok: true; value: undefined }>()
    let aCalls = 0
    const remoteA: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: () => { aCalls += 1; return first.promise },
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remoteA)
    // Two same-tick clicks: the first write runs, the second queues behind it.
    await act(async () => { switchButtons(el)[0]!.click(); switchButtons(el)[1]!.click() })
    expect(aCalls).toBe(1)

    const remoteB: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: { ...stats, observations: 3 } }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    await rerender(remoteB)
    expect(observationsText(el)).toContain('3')

    // Back to the very same A object: this must still be a NEW epoch.
    await rerender(remoteA)
    expect(observationsText(el)).toContain('5')

    // Resolving the OLD A write must not revive the OLD queued second action.
    await act(async () => { first.resolve({ ok: true, value: undefined }) })
    expect(aCalls).toBe(1)

    // The NEW A epoch writes independently.
    await act(async () => { switchButtons(el)[0]!.click() })
    expect(aCalls).toBe(2)
  })

  it('does not show or edit A config when B getGuard THROWS', async () => {
    const remoteA: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: { ...switches, noProgressProtection: false } }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remoteA)
    expect(switchButtons(el).map(button => button.getAttribute('aria-checked'))).toEqual(['true', 'true', 'false'])

    let bCalls = 0
    const remoteB: GuardSwitchRemote = {
      getGuard: (async () => { throw new Error('b down') }) as never,
      updateGuard: async () => { bCalls += 1; return { ok: true as const, value: undefined } },
    }
    await rerender(remoteB)
    const buttons = switchButtons(el)
    // A's configuration must NOT masquerade as B's; editing stays disabled.
    expect(buttons.map(button => button.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
    expect(buttons.every(button => button.disabled)).toBe(true)
    expect(el.querySelector('.mc-error-hint')?.textContent).toContain('b down')
    await act(async () => { buttons[0]!.click() })
    expect(bCalls).toBe(0)
  })

  it('disables editing when B has no getGuard at all', async () => {
    const remoteA: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remoteA)
    expect(switchButtons(el).some(button => button.disabled === false)).toBe(true)

    await rerender({})
    const buttons = switchButtons(el)
    expect(buttons.every(button => button.disabled)).toBe(true)
    expect(el.querySelector('.mc-error-hint')?.textContent).toContain('does not expose Guard switches')
  })

  it('keeps last-known switches and shows an error on a same-source required-read failure', async () => {
    let fail = false
    const remote: GuardSwitchRemote = {
      getGuard: async () => {
        if (fail) throw new Error('guard transient')
        return { ok: true as const, value: switches }
      },
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: true as const, value: stats }),
      getGuardDiagnostics: async () => ({ ok: true as const, value: available }),
    }
    const el = await mount(remote)
    expect(switchButtons(el).map(button => button.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])

    fail = true
    await act(async () => { (el.querySelector('[data-guard-refresh="true"]') as HTMLButtonElement).click() })
    expect(el.querySelector('.mc-error-hint')?.textContent).toContain('guard transient')
    // Same source: the last-known switches survive and stay editable.
    expect(switchButtons(el).map(button => button.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
    expect(switchButtons(el).some(button => button.disabled === false)).toBe(true)
  })
})
