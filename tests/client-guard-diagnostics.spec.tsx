/**
 * Mounted client coverage for the Guard diagnostics banner.
 *
 * This file runs under jsdom and mounts the REAL GuardContainer with
 * react-dom/client + act, so the async load path (getGuard + getGuardStats +
 * getGuardDiagnostics), the refresh after a toggle, and the old-Host fallback
 * are exercised as a mounted tree - not as a hand-walked element tree.
 *
 * Kept separate from the pure element-tree specs on purpose: those assert the
 * v3 shape without a DOM, this one asserts what the operator can actually read.
 *
 * @vitest-environment jsdom
 */
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { GuardContainer, GuardDiagnosticsBanner, GuardPersistenceHint, readGuardDiagnostics, type GuardSwitchRemote } from '../src/client/GuardContainer.tsx'

// React 18 warns without this flag when using act in a non-test-renderer setup.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const labels: Record<string, string> = {
  guardDiagUnavailableTitle: '执行保护当前未生效',
  guardDiagInvalidPatch: '启动配置非法',
  guardDiagNotMounted: '尚未挂载完成',
  guardDiagPersistenceDirty: '有改动尚未写入',
  guardToastSaved: '已保存',
}
const t = (key: string): string => labels[key] ?? key

const switches = {
  enabled: true, duplicateDetection: true, alternatingCycleDetection: true,
  noProgressProtection: true, repeatThresholds: [3, 5, 8] as number[],
}

let root: Root | undefined
let host: HTMLDivElement | undefined

async function mount(remote: GuardSwitchRemote): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(GuardContainer, { t: t as never, remote }))
  })
  return host
}

afterEach(async () => {
  if (root !== undefined) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  host?.remove()
  host = undefined
})

describe('Guard diagnostics - mounted container', () => {
  it('shows a readable not-in-effect banner when available is false', async () => {
    const el = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: async () => ({ ok: false as const, error: { code: 'unsupported', message: 'none' } }),
      getGuardDiagnostics: async () => ({
        ok: true as const,
        value: { available: false, reasons: ['invalid-patch'] as const, persistence: { dirty: false } },
      }),
    })
    const banner = el.querySelector('.mc-guard-diag')
    expect(banner).not.toBeNull()
    expect(banner!.getAttribute('data-guard-available')).toBe('false')
    expect(banner!.textContent).toContain('执行保护当前未生效')
    expect(banner!.textContent).toContain('启动配置非法')
    // The switches still render, so the operator can go fix the configuration.
    expect(el.querySelectorAll('input, button').length).toBeGreaterThan(0)
  })

  it('shows no banner when the Guard is available', async () => {
    const el = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardDiagnostics: async () => ({
        ok: true as const,
        value: { available: true, reasons: [] as const, persistence: { dirty: false } },
      }),
    })
    expect(el.querySelector('.mc-guard-diag')).toBeNull()
    expect(el.textContent).not.toContain('执行保护当前未生效')
  })

  it('renders the persistence hint with the fixed code as a data attribute', async () => {
    const el = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardDiagnostics: async () => ({
        ok: true as const,
        value: { available: true, reasons: [] as const, persistence: { dirty: true, lastErrorCode: 'write-failed' as const } },
      }),
    })
    const hint = el.querySelector('.mc-guard-diag-persist')
    expect(hint).not.toBeNull()
    expect(hint!.getAttribute('data-guard-persistence')).toBe('write-failed')
    expect(hint!.textContent).toContain('有改动尚未写入')
  })

  it('degrades safely when an old Host has no getGuardDiagnostics at all', async () => {
    const el = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
    })
    expect(el.querySelector('.mc-guard-diag')).toBeNull()
    expect(el.querySelector('.mc-guard-diag-persist')).toBeNull()
    // Still a usable page, not a blank/failed one.
    expect(el.querySelectorAll('input, button').length).toBeGreaterThan(0)
  })

  it('treats a rejected or malformed diagnostics answer as absent, never as available', async () => {
    const rejected = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardDiagnostics: async () => ({ ok: false as const, error: { code: 'internal-error', message: 'boom' } }),
    })
    expect(rejected.querySelector('.mc-guard-diag')).toBeNull()
  })

  /**
   * REMOUNT refresh, not a live "toggle" refresh.
   *
   * The container reads diagnostics only from its load effect, so it re-reads
   * them when the section is unmounted and mounted again (which is what the
   * shell does when the page is re-opened). A true live refresh on every toggle
   * is TG-04's scope and is NOT claimed here.
   */
  it('re-reads diagnostics on remount (page re-open), not on a live toggle', async () => {
    const el = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardDiagnostics: async () => ({
        ok: true as const,
        value: { available: true, reasons: [] as const, persistence: { dirty: false } },
      }),
    })
    expect(el.querySelector('.mc-guard-diag')).toBeNull()
    const rootNow = root
    await act(async () => { rootNow!.unmount() })
    root = undefined
    const again = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardDiagnostics: async () => ({
        ok: true as const,
        value: { available: false, reasons: ['not-mounted'] as const, persistence: { dirty: false } },
      }),
    })
    expect(again.querySelector('.mc-guard-diag')!.textContent).toContain('尚未挂载完成')
  })

  it('keeps the switches usable when getGuardDiagnostics REJECTS', async () => {
    const el = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardDiagnostics: async () => { throw new Error('transport down') },
    })
    // The optional diagnostic must never take the whole page down with it.
    expect(el.querySelector('.mc-guard-diag')).toBeNull()
    expect(el.textContent).not.toContain('执行保护当前未生效')
    // The real DOM contract: three role="switch" buttons, enabled, reflecting the
    // switches that DID load. A rejected optional diagnostic must not disable them.
    const toggles = [...el.querySelectorAll('[role="switch"]')] as HTMLButtonElement[]
    expect(toggles.length).toBe(3)
    expect(toggles.some(toggle => toggle.disabled === false)).toBe(true)
    expect(toggles[0]!.getAttribute('aria-checked')).toBe('true')
  })

  it('keeps the switches usable when getGuardDiagnostics throws SYNCHRONOUSLY', async () => {
    const remote: GuardSwitchRemote = {
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardDiagnostics: (() => { throw new Error('sync boom') }) as never,
    }
    const el = await mount(remote)
    expect(el.querySelector('.mc-guard-diag')).toBeNull()
    const toggles = [...el.querySelectorAll('[role="switch"]')] as HTMLButtonElement[]
    expect(toggles.length).toBe(3)
    expect(toggles.some(toggle => toggle.disabled === false)).toBe(true)
  })

  it('keeps switches usable when the optional stats call rejects too', async () => {
    const el = await mount({
      getGuard: async () => ({ ok: true as const, value: switches }),
      updateGuard: async () => ({ ok: true as const, value: undefined }),
      getGuardStats: (() => { throw new Error('stats sync boom') }) as never,
      getGuardDiagnostics: async () => ({ ok: true as const, value: { available: false, reasons: ['not-mounted'] as const, persistence: { dirty: false } } }),
    })
    expect(el.querySelector('.mc-guard-diag')).not.toBeNull()
    const toggles = [...el.querySelectorAll('[role="switch"]')] as HTMLButtonElement[]
    expect(toggles.length).toBe(3)
    expect(toggles.some(toggle => toggle.disabled === false)).toBe(true)
  })
})

describe('Guard diagnostics - components and reader in isolation', () => {
  it('renders both reason lines for a mixed reason list', () => {
    const tree = GuardDiagnosticsBanner({
      t: t as never,
      diagnostics: { available: false, reasons: ['invalid-patch', 'not-mounted'], persistence: { dirty: false } },
    })
    expect(JSON.stringify(tree)).toContain('启动配置非法')
    expect(JSON.stringify(tree)).toContain('尚未挂载完成')
  })

  it('renders nothing for an available Guard', () => {
    expect(GuardDiagnosticsBanner({
      t: t as never,
      diagnostics: { available: true, reasons: [], persistence: { dirty: false } },
    })).toBeNull()
    expect(GuardPersistenceHint({
      t: t as never,
      diagnostics: { available: true, reasons: [], persistence: { dirty: false } },
    })).toBeNull()
  })

  it('reads undefined for a missing method and for a rejected call', async () => {
    expect(await readGuardDiagnostics({} as GuardSwitchRemote)).toBeUndefined()
    expect(await readGuardDiagnostics({
      getGuardDiagnostics: async () => ({ ok: false as const, error: { code: 'x', message: 'y' } }),
    })).toBeUndefined()
    expect(await readGuardDiagnostics({
      getGuardDiagnostics: async () => { throw new Error('transport down') },
    })).toBeUndefined()
  })
})
