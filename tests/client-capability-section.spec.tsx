/**
 * TG-14 (P2) · Capability tool row — mounted jsdom keyboard coverage.
 *
 * The row is a role="button" container with real child controls (检索 / 档位).
 * Before TG-14 the parent keydown ran for events bubbling from those children,
 * so Enter/Space on a child opened the tool-detail pane and swallowed the child's
 * own default action. This mounts the REAL ToolGroupsView and sends real key
 * events to prove the boundary.
 *
 * @vitest-environment jsdom
 */
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilitySection, ToolGroupsView } from '../src/client/CapabilitySection.tsx'
import type { CapabilityRow } from '../src/client/remote.ts'
import type { CapabilityPolicyRemote } from '../src/client/store.ts'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string): string => key

const tool: CapabilityRow = {
  id: 'tool-1',
  kind: 'tool',
  name: 'mcp__srv__echo',
  server: 'srv',
  class: 'on-demand',
  classLabel: '按需',
  mandatory: false,
}

let root: Root | undefined
let host: HTMLDivElement | undefined

function makeSpies() {
  return {
    onOpenDetail: vi.fn<(id: string) => void>(),
    onEditSearch: vi.fn<(id: string) => void>(),
    onCycle: vi.fn<(ids: readonly string[], kind: 'tool') => void>(),
    onToggle: vi.fn<(server: string) => void>(),
    onEditServer: vi.fn<(server: string) => void>(),
  }
}

async function mount(): Promise<{ el: HTMLDivElement; spies: ReturnType<typeof makeSpies> }> {
  const spies = makeSpies()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ToolGroupsView, {
      t: t as never,
      groups: [{ server: 'srv', tools: [tool] }],
      openServers: new Set(['srv']),
      busy: false,
      onToggle: spies.onToggle,
      onCycle: spies.onCycle,
      onOpenDetail: spies.onOpenDetail,
      onEditServer: spies.onEditServer,
      onEditSearch: spies.onEditSearch,
    }))
  })
  return { el: host, spies }
}

function row(el: HTMLDivElement): HTMLElement {
  const node = el.querySelector('.v3-trow')
  if (node === null) throw new Error('tool row not found')
  return node as HTMLElement
}

function searchButton(el: HTMLDivElement): HTMLButtonElement {
  const node = el.querySelector('button[title="editSearchMetadata"]')
  if (node === null) throw new Error('search button not found')
  return node as HTMLButtonElement
}

function classButton(el: HTMLDivElement): HTMLButtonElement {
  const node = el.querySelector('.v3-racts button[aria-label="按需"]')
  if (node === null) throw new Error('class chip not found')
  return node as HTMLButtonElement
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

describe('TG-14 · tool row keyboard boundary (mounted)', () => {
  it('does not open the detail when Enter is pressed on the child 检索 button', async () => {
    const { el, spies } = await mount()
    await act(async () => {
      searchButton(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(spies.onOpenDetail).not.toHaveBeenCalled()
  })

  it('does not swallow Space on a child control (default not prevented, no detail)', async () => {
    const { el, spies } = await mount()
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    await act(async () => { classButton(el).dispatchEvent(event) })
    expect(spies.onOpenDetail).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('opens the detail when Enter is pressed on the row itself', async () => {
    const { el, spies } = await mount()
    await act(async () => {
      row(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(spies.onOpenDetail).toHaveBeenCalledWith('tool-1')
  })

  it('opens the detail on Space over the row and prevents page scroll', async () => {
    const { el, spies } = await mount()
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    await act(async () => { row(el).dispatchEvent(event) })
    expect(spies.onOpenDetail).toHaveBeenCalledWith('tool-1')
    expect(event.defaultPrevented).toBe(true)
  })

  it('runs the child action, not the row detail, when the 检索 button is clicked', async () => {
    const { el, spies } = await mount()
    await act(async () => { searchButton(el).click() })
    expect(spies.onEditSearch).toHaveBeenCalledWith('tool-1')
    expect(spies.onOpenDetail).not.toHaveBeenCalled()
  })

  it('opens the detail when the row background is clicked', async () => {
    const { el, spies } = await mount()
    await act(async () => { row(el).click() })
    expect(spies.onOpenDetail).toHaveBeenCalledWith('tool-1')
  })
})
// ---------------------------------------------------------------------------
// TG-18: a dialog closed while its read is in flight must stay closed.
//
// These mount the REAL CapabilitySection (not the pure views) because the guard
// being proven lives in refs owned by the container: closing advances a request
// token, and the late reply compares against it. The Modal stub now honours
// `onClose` and renders the real close button, so "click X, then let the read
// settle" is a genuine interaction rather than a private-state poke.
// ---------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function ok<T>(value: T) {
  return { ok: true as const, value }
}

const skillRow: CapabilityRow = {
  id: 'browse-me',
  kind: 'skill',
  name: 'browse-me',
  source: 'user-dsh',
  class: 'resident',
  classLabel: '常驻',
  mandatory: false,
}

const detailRow: CapabilityRow = {
  id: 'tool-1',
  kind: 'tool',
  name: 'mcp__srv__echo',
  server: 'srv',
  class: 'on-demand',
  classLabel: '按需',
  mandatory: false,
}

function catalogRemote(overrides: Record<string, unknown> = {}): CapabilityPolicyRemote {
  return {
    classifyAll: async () => ok([detailRow, skillRow]),
    catalogVersion: async () => ok(1),
    refresh: async () => ok(undefined),
    checkSelfUpdate: async () => ok({ current: '1.0.0', latest: '1.0.0', updateAvailable: false, updatable: false }),
    getDiagnostics: async () => ok({ unavailableSkills: [], shadowedSkills: [], brokenPresets: [], unbrowseableSkills: [], undocumentedSkills: [] }),
    listSkillLocations: async () => ok([]),
    listSkillDir: async () => ok([{ name: 'SKILL.md', type: 'file' }, { name: 'notes.txt', type: 'file' }]),
    readSkillFile: async () => ok('body'),
    getDetail: async () => ok(undefined),
    getCatalogDocs: async () => ok({ policyYaml: 'yaml', summaryMaxChars: 200, searchSettingsEnabled: false, onDemand: [] }),
    getSearchMetadata: async () => ok(undefined),
    ...overrides,
  } as unknown as CapabilityPolicyRemote
}

let dialogRoot: Root | undefined
let dialogHost: HTMLDivElement | undefined

async function mountCatalog(remote: CapabilityPolicyRemote): Promise<HTMLDivElement> {
  dialogHost = document.createElement('div')
  document.body.appendChild(dialogHost)
  dialogRoot = createRoot(dialogHost)
  await act(async () => {
    dialogRoot!.render(createElement(CapabilitySection, {
      remote,
      t: t as never,
      subscribeSignals: () => () => {},
    }))
  })
  await flush()
  return dialogHost
}

/** Server groups start collapsed; a row only exists once its group is open. */
async function openAllGroups(el: HTMLDivElement): Promise<void> {
  for (const summary of Array.from(el.querySelectorAll('details.v3-group > summary'))) {
    const details = summary.parentElement
    if (details !== null && !details.hasAttribute('open')) await click(summary)
  }
}

async function flush(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

/** Open the tool's server group, then click its row (the group starts closed). */
async function openToolRow(el: HTMLDivElement): Promise<void> {
  await openAllGroups(el)
  await click(el.querySelector('.v3-trow'))
}

/** Every open dialog, from `document.body`: the real Modal portals there. */
function openDialogs(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll('[role="dialog"]')) as HTMLElement[]
}

function dialogLabelled(label: string): HTMLElement | undefined {
  return openDialogs().find(dialog => dialog.getAttribute('aria-label') === label)
}

/** The dialog's own labelled close button (the stub mirrors the real header). */
function closeButton(dialog: HTMLElement): HTMLButtonElement {
  const button = dialog.querySelector('button[aria-label]')
  if (button === null) throw new Error('close button not found in dialog')
  return button as HTMLButtonElement
}

async function click(element: Element | null | undefined): Promise<void> {
  if (element === null || element === undefined) throw new Error('element not found')
  await act(async () => { (element as HTMLElement).click() })
  await flush()
}

afterEach(async () => {
  if (dialogRoot !== undefined) {
    const current = dialogRoot
    dialogRoot = undefined
    await act(async () => { current.unmount() })
  }
  dialogHost?.remove()
  dialogHost = undefined
})

describe('TG-18 · a late detail read cannot re-open the tool-detail dialog', () => {
  it('keeps the dialog closed after the operator closes it mid-read', async () => {
    const pending = deferred<{ ok: true; value: undefined }>()
    const el = await mountCatalog(catalogRemote({ getDetail: () => pending.promise }))

    await openToolRow(el)
    // The dialog is open in its loading state and is labelled by the tool id.
    expect(dialogLabelled('tool-1')).toBeDefined()

    await click(closeButton(dialogLabelled('tool-1')!))
    expect(openDialogs()).toHaveLength(0)

    // The read finally settles: the dismissed dialog must NOT come back.
    await act(async () => { pending.resolve(ok(undefined)) })
    await flush()
    expect(openDialogs()).toHaveLength(0)
  })

  it('still opens normally when the read settles before any close', async () => {
    const el = await mountCatalog(catalogRemote({
      getDetail: async () => ok({
        id: 'tool-1', kind: 'tool', actions: [], name: 'mcp__srv__echo', description: 'echoes',
        parameters: { type: 'object' }, origin: { provider: 'test' }, tags: [], stats: { uses: 0, successes: 0, failures: 0 },
      }),
    }))
    await openToolRow(el)
    await flush()
    const dialog = dialogLabelled('mcp__srv__echo')
    expect(dialog).toBeDefined()
    expect(dialog!.textContent).toContain('echoes')
  })
})

describe('TG-18 · a late skill-file read cannot re-open the file preview', () => {
  async function openSkillsTab(el: HTMLDivElement): Promise<void> {
    await click(el.querySelector('#mc-tab-skills'))
    await flush()
    // The Skills panel is a second, nested tab set; 全局技能 is its default.
    const skillGroup = el.querySelector('[data-v3-skill] summary')
    if (skillGroup === null) throw new Error('skill group not found: ' + String(el.textContent).slice(0, 400))
    await click(skillGroup)
    await flush()
  }

  function fileRow(el: HTMLDivElement, name: string): Element | null {
    return Array.from(el.querySelectorAll('.mc-tree-file')).find(row => (row.textContent ?? '').includes(name)) ?? null
  }

  it('keeps the preview closed when the read lands after the close', async () => {
    const pending = deferred<{ ok: true; value: string | undefined }>()
    const el = await mountCatalog(catalogRemote({ readSkillFile: () => pending.promise }))
    await openSkillsTab(el)

    await click(fileRow(el, 'SKILL.md'))
    expect(dialogLabelled('SKILL.md')).toBeDefined()

    await click(closeButton(dialogLabelled('SKILL.md')!))
    expect(openDialogs()).toHaveLength(0)

    await act(async () => { pending.resolve(ok('# late body')) })
    await flush()
    expect(openDialogs()).toHaveLength(0)
  })

  it('drops a late reply from the file the operator switched away from', async () => {
    const first = deferred<{ ok: true; value: string | undefined }>()
    const second = deferred<{ ok: true; value: string | undefined }>()
    let calls = 0
    const el = await mountCatalog(catalogRemote({
      readSkillFile: () => { calls += 1; return calls === 1 ? first.promise : second.promise },
    }))
    await openSkillsTab(el)

    await click(fileRow(el, 'SKILL.md'))
    await click(closeButton(dialogLabelled('SKILL.md')!))
    await click(fileRow(el, 'notes.txt'))
    expect(dialogLabelled('notes.txt')).toBeDefined()

    // A's reply arrives AFTER B was opened: it must not replace B's preview.
    await act(async () => { first.resolve(ok('# A body')) })
    await flush()
    expect(dialogLabelled('notes.txt')).toBeDefined()
    expect(dialogLabelled('SKILL.md')).toBeUndefined()

    await act(async () => { second.resolve(ok('# B body')) })
    await flush()
    expect(dialogLabelled('notes.txt')!.textContent).toContain('# B body')
    expect(dialogLabelled('notes.txt')!.textContent).not.toContain('# A body')
  })
})

describe('TG-18 · the catalog-docs dialog has the same close guard', () => {
  it('does not re-open after the docs read settles late', async () => {
    const pending = deferred<{ ok: true; value: unknown }>()
    const el = await mountCatalog(catalogRemote({ getCatalogDocs: () => pending.promise }))

    const button = Array.from(el.querySelectorAll('.mc-cat-actions button'))
      .find(node => (node.textContent ?? '') === 'viewCatalog')
    await click(button)
    expect(dialogLabelled('viewCatalog')).toBeDefined()

    await click(closeButton(dialogLabelled('viewCatalog')!))
    expect(openDialogs()).toHaveLength(0)

    await act(async () => {
      pending.resolve(ok({ policyYaml: 'late yaml', summaryMaxChars: 200, searchSettingsEnabled: false, onDemand: [] }))
    })
    await flush()
    expect(openDialogs()).toHaveLength(0)
  })
})

describe('TG-18 · the search-metadata dialog has the same close guard', () => {
  it('does not re-open after the metadata read settles late', async () => {
    const pending = deferred<{ ok: true; value: unknown }>()
    const el = await mountCatalog(catalogRemote({ getSearchMetadata: () => pending.promise }))

    await openAllGroups(el)
    await click(el.querySelector('button[title="editSearchMetadata"]'))
    expect(dialogLabelled('editSearchMetadata · tool-1')).toBeDefined()

    await click(closeButton(dialogLabelled('editSearchMetadata · tool-1')!))
    expect(openDialogs()).toHaveLength(0)

    await act(async () => {
      pending.resolve(ok({ description: 'late', defaultDescription: 'default', maxChars: 200 }))
    })
    await flush()
    expect(openDialogs()).toHaveLength(0)
  })
})
