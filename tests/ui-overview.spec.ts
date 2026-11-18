import { describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import {
  OverviewView,
  countRows,
  guardStatusCell,
  mountStatusCell,
  overviewDictionaries,
  persistenceStatusCell,
  tierDistribution,
} from '../src/client/overview-section.tsx'
import type { GuardDiagnostics, GuardSwitches } from '../src/client/guard-remote.ts'
import type { CapabilityRow } from '../src/client/store.ts'

/** OverviewSection 从宿主原语包导入 StateDot；本包无 clsx，故替身为 span[data-state]。 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Button: 'button',
    StateDot: (props: Record<string, unknown>): unknown => createElement('span', {
      'data-state': props.state,
      'aria-hidden': 'true',
      className: props.className,
    }),
  }
})

/**
 * 总览三层的可测内核。
 *
 * 视图是 hook-free 的纯函数，所以测试直接调用它、把返回的元素树摊平成
 * (type, props) 列表再断言 —— 与 client-panel.spec.ts 的做法一致，不需要 DOM。
 * 这里只锁三件产品承诺：状态不伪造、数字不伪造、比例在零值时不产生 NaN。
 */

const zh = overviewDictionaries().zh
const t = (key: keyof typeof zh): string => zh[key]

interface FlatElement {
  readonly type: string
  readonly props: Record<string, unknown>
}

/**
 * 摊平元素树。
 *
 * 函数组件在这里会被**调用**（总览页全是 hook-free 组件，这是安全的）；
 * 带 HOOK_COMPONENT 标记的组件不会被调用 —— 本页目前没有这类组件，标记检查
 * 保留是为了让后来者加 hook 组件时不会让这个 walker 直接崩掉。
 */
function flatten(node: ReactNode, out: FlatElement[] = []): FlatElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  const element = node as ReactElement<Record<string, unknown>>
  if (typeof element.type === 'function') {
    const tagged = (element.type as unknown as Record<symbol, unknown>)[Symbol.for('dsh-thinking-guard.hook-component')]
    if (tagged === true) {
      out.push({ type: 'hook-component', props: element.props })
      return out
    }
    flatten((element.type as (props: Record<string, unknown>) => ReactNode)(element.props), out)
    return out
  }
  out.push({ type: element.type as string, props: element.props })
  flatten(element.props.children as ReactNode, out)
  return out
}

/** Every element carrying the given data attribute, in document order. */
function byData(nodes: readonly FlatElement[], name: string): FlatElement[] {
  return nodes.filter(node => node.props[name] !== undefined)
}

const ALL_ON: GuardSwitches = {
  enabled: true,
  duplicateDetection: true,
  alternatingCycleDetection: true,
  noProgressProtection: true,
  repeatThresholds: [3, 5, 8],
}

const HEALTHY_DIAGNOSTICS: GuardDiagnostics = {
  available: true,
  reasons: [],
  persistence: { dirty: false },
}

function row(id: string, kind: 'tool' | 'skill', tier: 'resident' | 'on-demand' | 'disabled'): CapabilityRow {
  return { id, name: id, kind, class: tier, mandatory: false }
}

describe('guardStatusCell', () => {
  it('reports unknown when the switches were not read', () => {
    expect(guardStatusCell(undefined)).toEqual({ tone: 'unknown', code: 'overviewUnknown' })
  })

  it('counts the three mechanisms and is green only when all of them are on', () => {
    expect(guardStatusCell(ALL_ON)).toEqual({
      tone: 'ok',
      code: 'overviewStatusGuardsMasterOff',
      prefix: '3 / 3',
      suffix: true,
    })
    expect(guardStatusCell({ ...ALL_ON, noProgressProtection: false })).toMatchObject({
      tone: 'warn',
      prefix: '2 / 3',
      suffix: true,
    })
  })

  it('treats a closed master switch as its own state, not as "all off"', () => {
    expect(guardStatusCell({ ...ALL_ON, enabled: false })).toEqual({
      tone: 'warn',
      code: 'overviewStatusGuardsMasterOff',
      prefix: '3 / 3',
    })
    expect(guardStatusCell({ ...ALL_ON, enabled: false, duplicateDetection: false, alternatingCycleDetection: false, noProgressProtection: false }))
      .toEqual({ tone: 'off', code: 'overviewStatusGuardsMasterOff', prefix: '0 / 3' })
  })

  it('reports all-off when the master is on but every mechanism is off', () => {
    expect(guardStatusCell({
      ...ALL_ON,
      duplicateDetection: false,
      alternatingCycleDetection: false,
      noProgressProtection: false,
    })).toEqual({ tone: 'off', code: 'overviewStatusGuardsAllOff', prefix: '0 / 3' })
  })
})

describe('mountStatusCell', () => {
  it('is unknown without diagnostics and never assumes "mounted"', () => {
    expect(mountStatusCell(undefined)).toEqual({ tone: 'unknown', code: 'overviewUnknown' })
  })

  it('is green only for available diagnostics', () => {
    expect(mountStatusCell(HEALTHY_DIAGNOSTICS)).toEqual({ tone: 'ok', code: 'overviewStatusMounted' })
  })

  it('is red for both failure reasons and names which one', () => {
    expect(mountStatusCell({ ...HEALTHY_DIAGNOSTICS, available: false, reasons: ['not-mounted'] }))
      .toEqual({ tone: 'bad', code: 'overviewStatusNotMounted' })
    expect(mountStatusCell({ ...HEALTHY_DIAGNOSTICS, available: false, reasons: ['invalid-patch'] }))
      .toEqual({ tone: 'bad', code: 'overviewStatusInvalidPatch' })
  })

  it('stays unknown for an unavailable face without a reason code', () => {
    expect(mountStatusCell({ ...HEALTHY_DIAGNOSTICS, available: false, reasons: [] }))
      .toEqual({ tone: 'unknown', code: 'overviewUnknown' })
  })
})

describe('persistenceStatusCell', () => {
  it('is unknown without diagnostics', () => {
    expect(persistenceStatusCell(undefined)).toEqual({ tone: 'unknown', code: 'overviewUnknown' })
  })

  it('reports a write failure ahead of the dirty flag', () => {
    expect(persistenceStatusCell({
      ...HEALTHY_DIAGNOSTICS,
      persistence: { dirty: true, lastErrorCode: 'write-failed' },
    })).toEqual({ tone: 'bad', code: 'overviewStatusPersistFailed' })
  })

  it('warns about unsaved changes and is green when clean', () => {
    expect(persistenceStatusCell({ ...HEALTHY_DIAGNOSTICS, persistence: { dirty: true } }))
      .toEqual({ tone: 'warn', code: 'overviewStatusPersistDirty' })
    expect(persistenceStatusCell(HEALTHY_DIAGNOSTICS))
      .toEqual({ tone: 'ok', code: 'overviewStatusPersistOk' })
  })
})

describe('tierDistribution', () => {
  it('keeps zero-count tiers in the list and never divides by zero', () => {
    const result = tierDistribution({ resident: 50, onDemand: 0, disabled: 0 })
    expect(result.total).toBe(50)
    expect(result.empty).toBe(false)
    expect(result.slices.map(slice => [slice.key, slice.count, Math.round(slice.pct)]))
      .toEqual([['resident', 50, 100], ['on-demand', 0, 0], ['disabled', 0, 0]])
  })

  it('is empty — all zero, no NaN — when the catalog was not read or has no entries', () => {
    for (const counts of [{}, { resident: 0, onDemand: 0, disabled: 0 }, { resident: undefined }]) {
      const result = tierDistribution(counts)
      expect(result.empty).toBe(true)
      expect(result.total).toBe(0)
      expect(result.slices.every(slice => slice.pct === 0 && Number.isFinite(slice.pct))).toBe(true)
    }
  })

  it('splits the bar in proportion and always sums to the total', () => {
    const result = tierDistribution({ resident: 42, onDemand: 6, disabled: 2 })
    expect(result.total).toBe(50)
    expect(Math.round(result.slices[0]!.pct)).toBe(84)
    expect(Math.round(result.slices.reduce((sum, slice) => sum + slice.pct, 0))).toBe(100)
  })

  it('ignores negative and non-finite inputs instead of producing a negative width', () => {
    const result = tierDistribution({ resident: -5, onDemand: Number.NaN, disabled: 3 })
    expect(result.total).toBe(3)
    expect(result.slices[0]!.pct).toBe(0)
  })
})

describe('countRows', () => {
  it('returns undefined fields when the catalog was not read', () => {
    expect(countRows(undefined)).toEqual({
      resident: undefined,
      onDemand: undefined,
      disabled: undefined,
      total: undefined,
      tools: undefined,
      skills: undefined,
    })
  })

  it('tallies tiers and splits tools from skills', () => {
    expect(countRows([
      row('bash', 'tool', 'resident'),
      row('read', 'tool', 'on-demand'),
      row('skill-a', 'skill', 'resident'),
      row('skill-b', 'skill', 'disabled'),
    ])).toEqual({ resident: 2, onDemand: 1, disabled: 1, total: 4, tools: 2, skills: 2 })
  })
})

describe('OverviewView', () => {
  const stats = {
    observations: 12,
    reminders: { repeat: 3, cycle: 1 },
    denials: 2,
    outcomes: { success: 9, error: 3, cancelled: 0 },
    since: 1794900000000,
    lastReminderAt: 1794900600000,
  }

  const view = (overrides: {
    guard?: Record<string, unknown>
    catalog?: Record<string, unknown>
  } = {}) => flatten(OverviewView({
    t,
    busy: false,
    guard: { switches: ALL_ON, stats, diagnostics: HEALTHY_DIAGNOSTICS, ...overrides.guard },
    catalog: {
      rows: [row('bash', 'tool', 'resident'), row('read', 'tool', 'resident')],
      version: 18,
      observedAt: '20:04:18',
      ...overrides.catalog,
    },
  }))

  it('renders three status cells whose tone and text come from the real switches', () => {
    const nodes = view()
    const cells = byData(nodes, 'data-overview-status-cell')
    expect(cells.map(cell => cell.props['data-overview-status-cell'])).toEqual(['guards', 'mount', 'persist'])
    expect(cells.map(cell => cell.props['data-tone'])).toEqual(['ok', 'ok', 'ok'])
    const texts = byData(nodes, 'data-overview-status-text')
      .map(node => node.props['data-overview-status-text'])
    expect(texts).toEqual(['guards', 'mount', 'persist'])
    const text = (cell: string) => String(
      byData(nodes, 'data-overview-status-text').find(node => node.props['data-overview-status-text'] === cell)?.props.children,
    )
    expect(text('guards')).toBe('3 / 3 已启用')
    expect(text('mount')).toBe('已挂载')
    expect(text('persist')).toBe('正常')
  })

  it('shows 未知 — never a green status — when the Guard faces were not read', () => {
    const nodes = flatten(OverviewView({
      t,
      busy: false,
      guard: {},
      catalog: {},
    }))
    expect(byData(nodes, 'data-overview-status-cell').map(cell => cell.props['data-tone']))
      .toEqual(['unknown', 'unknown', 'unknown'])
    const stats = byData(nodes, 'data-overview-stat').map(node => node.props.children)
    expect(stats.length).toBe(4)
  })

  it('renders the four counters in a 2×2 grid with the cumulative caption', () => {
    const nodes = view()
    const grid = byData(nodes, 'data-overview-stats')[0]!
    expect(grid.props['data-overview-stats']).toBe('guard')
    expect(grid.props.className).toBe('ov-statgrid')
    const cells = byData(nodes, 'data-overview-stat').map(node => node.props['data-overview-stat'])
    expect(cells).toEqual(['observations', 'repeat', 'cycle', 'denials'])
    const note = byData(nodes, 'data-overview-note')[0]!
    expect(note.props.children).toBe('本机累计统计 · 重启后继续累加')
  })

  it('prints a real counting-since time and 暂无记录 for timestamps that do not exist', () => {
    const nodes = view({ guard: { stats: { ...stats, lastDenialAt: undefined } } })
    const since = String(byData(nodes, 'data-overview-since')[0]!.props.children)
    expect(since).not.toBe('未知')
    expect(since).toBe(new Date(stats.since).toLocaleString())
    expect(String(byData(nodes, 'data-overview-last-reminder')[0]!.props.children))
      .toBe(new Date(stats.lastReminderAt).toLocaleString())
    expect(String(byData(nodes, 'data-overview-last-denial')[0]!.props.children)).toBe('暂无记录')
  })

  it('draws the distribution bar in proportion and lists every tier', () => {
    const nodes = view({
      catalog: {
        rows: [row('a', 'tool', 'resident'), row('b', 'tool', 'on-demand'), row('c', 'skill', 'disabled'), row('d', 'skill', 'disabled')],
      },
    })
    const bar = byData(nodes, 'data-overview-bar')[0]!
    expect(bar.props['data-overview-bar-empty']).toBe('false')
    const segments = flatten(bar.props.children as ReactNode)
    expect(segments.map(segment => segment.props['data-tier'])).toEqual(['resident', 'on-demand', 'disabled'])
    expect(segments.map(segment => (segment.props.style as { width: string }).width)).toEqual(['25%', '25%', '50%'])
    const legend = byData(nodes, 'data-overview-tier').map(node => node.props['data-overview-tier'])
    expect(legend).toEqual(['resident', 'on-demand', 'disabled'])
    expect(byData(nodes, 'data-overview-catalog-total')[0]!.props.children)
      .toEqual(['总计', ' ', expect.anything()])
  })

  it('keeps the bar empty and the percentages unknown when the catalog is empty', () => {
    const nodes = view({ catalog: { rows: [] } })
    const bar = byData(nodes, 'data-overview-bar')[0]!
    expect(bar.props['data-overview-bar-empty']).toBe('true')
    const segments = flatten(bar.props.children as ReactNode)
    expect(segments.map(segment => (segment.props.style as { width: string }).width)).toEqual(['0%', '0%', '0%'])
    const pcts = byData(nodes, 'data-overview-tier-pct').map(node => node.props.children)
    expect(pcts).toEqual(['未知', '未知', '未知'])
  })

  it('only offers the capability jump when the shell wired one', () => {
    expect(byData(view(), 'data-overview-tier-jump').length).toBe(0)
    const withJump = flatten(OverviewView({
      t,
      busy: false,
      guard: {},
      catalog: { rows: [row('bash', 'tool', 'resident')] },
      onOpenCapability: () => {},
    }))
    expect(byData(withJump, 'data-overview-tier-jump').length).toBe(3)
  })

  it('folds the five status tones onto StateDot states (visual only)', () => {
    const states = (nodes: FlatElement[]): unknown[] =>
      nodes.filter(node => node.props['data-state'] !== undefined).map(node => node.props['data-state'])
    // 默认三格全 ok → done。
    expect(states(view())).toEqual(['done', 'done', 'done'])
    // 读不到任何 Guard 面 → 三格 unknown → idle（不是绿）。
    expect(states(flatten(OverviewView({ t, busy: false, guard: {}, catalog: {} })))).toEqual(['idle', 'idle', 'idle'])
    // 挂载失败（bad）→ error；另两格仍 ok → done。
    expect(states(flatten(OverviewView({
      t,
      busy: false,
      guard: { switches: ALL_ON, diagnostics: { ...HEALTHY_DIAGNOSTICS, available: false, reasons: ['not-mounted'] } },
      catalog: {},
    })))).toEqual(['done', 'error', 'done'])
  })

  it('renders the refresh action as an official Button (host button) with data attr + compact class', () => {
    const nodes = view()
    const refresh = nodes.filter(node => node.props['data-overview-refresh'] !== undefined)
    // 非空断言：forwardRef 对象若没被正确替身，会在这里被抓住（不是空集 every 假绿）。
    expect(refresh.length).toBeGreaterThan(0)
    expect(refresh[0]!.type).toBe('button')
    const cls = String(refresh[0]!.props.className)
    expect(cls).toContain('mc-overview-refresh')
    expect(cls).toContain('mc-btn-sm')
  })
})
