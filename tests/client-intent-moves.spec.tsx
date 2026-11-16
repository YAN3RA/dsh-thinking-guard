/**
 * TG-05 mounted client coverage.
 *
 * Mounts the REAL CapabilitySection under jsdom and clicks a class tag, proving
 * the section calls the intent-level moveCapabilities and NEVER the legacy
 * whole-table updateConfig. A Host without the new interface degrades to a
 * read-only notice instead of falling back to a whole-table write.
 *
 * @vitest-environment jsdom
 */
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilitySection } from '../src/client/CapabilitySection.tsx'
import type { CapabilityPolicyRemote } from '../src/client/store.ts'
import type { CapabilityRow } from '../src/client/remote.ts'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const labels: Record<string, string> = {
  builtInGroup: 'Built-in',
  residentShort: 'Resident',
  onDemandShort: 'On-demand',
  disabledShort: 'Disabled',
  cycleHint: 'Click to cycle',
  cycleOverridden: 'Overridden: {count}',
  cycleReadOnly: 'READ-ONLY: this Host has no intent interface',
  mandatory: 'Mandatory',
}
const t = (key: string): string => labels[key] ?? key

const rows: CapabilityRow[] = [{
  id: 'toolA', kind: 'tool', name: 'toolA', server: 'built-in',
  class: 'resident', classLabel: 'Resident', mandatory: false,
}]

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  if (root !== undefined) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  host?.remove()
  host = undefined
})

function baseRemote(overrides: Record<string, unknown>): CapabilityPolicyRemote {
  return {
    classifyAll: async () => ({ ok: true as const, value: rows }),
    catalogVersion: async () => ({ ok: true as const, value: 0 }),
    refresh: async () => ({ ok: true as const, value: undefined }),
    checkSelfUpdate: async () => ({
      ok: true as const,
      value: { current: '1.0.0', latest: '1.0.0', updateAvailable: false, updatable: false },
    }),
    ...overrides,
  } as unknown as CapabilityPolicyRemote
}

async function mount(remote: CapabilityPolicyRemote): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(CapabilitySection, {
      remote,
      t: t as never,
      subscribeSignals: () => () => {},
    }))
  })
  return host
}

function classTag(el: HTMLElement): HTMLButtonElement {
  const button = el.querySelector('.v3-catgrid button.v3-tag[data-tone]')
  expect(button).not.toBeNull()
  return button as HTMLButtonElement
}

describe('TG-05 mounted cycle → intent move', () => {
  it('calls moveCapabilities with kind/ids/target and never updateConfig', async () => {
    const moves: unknown[] = []
    let updateConfigCalls = 0
    const el = await mount(baseRemote({
      moveCapabilities: async (request: unknown) => {
        moves.push(request)
        return { ok: true as const, value: undefined }
      },
      updateConfig: async () => { updateConfigCalls += 1; return { ok: true as const, value: undefined } },
    }))

    await act(async () => {
      classTag(el).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(moves).toEqual([{ kind: 'tool', ids: ['toolA'], target: 'on-demand' }])
    expect(updateConfigCalls).toBe(0)
  })

  it('is read-only on an old Host (no moveCapabilities) and never writes the whole table', async () => {
    let updateConfigCalls = 0
    const el = await mount(baseRemote({
      updateConfig: async () => { updateConfigCalls += 1; return { ok: true as const, value: undefined } },
    }))

    await act(async () => {
      classTag(el).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(updateConfigCalls).toBe(0)
    const toast = el.querySelector('[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('READ-ONLY')
  })

  it('is read-only when the proxy HAS moveCapabilities but the endpoint is definition-unavailable', async () => {
    let updateConfigCalls = 0
    const el = await mount(baseRemote({
      moveCapabilities: async () => ({
        ok: false as const,
        error: { code: 'definition-unavailable', message: 'its strict definition was withdrawn' },
      }),
      updateConfig: async () => { updateConfigCalls += 1; return { ok: true as const, value: undefined } },
    }))

    await act(async () => {
      classTag(el).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Never a whole-table write, and never a fatal error pane.
    expect(updateConfigCalls).toBe(0)
    expect(el.querySelector('.mc-error')).toBeNull()
    const toast = el.querySelector('[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('READ-ONLY')
    // The optimistic flip is reconciled back from the authoritative list.
    expect(el.querySelector('.v3-catgrid')).not.toBeNull()
  })

  it('is read-only when the proxy call THROWS a 404 transport error', async () => {
    let updateConfigCalls = 0
    const el = await mount(baseRemote({
      moveCapabilities: async () => { throw new Error('transport failure for /api/capabilityPolicy/moveCapabilities: HTTP 404') },
      updateConfig: async () => { updateConfigCalls += 1; return { ok: true as const, value: undefined } },
    }))

    await act(async () => {
      classTag(el).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(updateConfigCalls).toBe(0)
    const toast = el.querySelector('[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('READ-ONLY')
  })
})
