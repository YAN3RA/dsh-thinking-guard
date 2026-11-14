/**
 * Rendering rules for the standalone usage panel.
 *
 * There is no DOM harness in this package (no react-dom/jsdom dependency) and
 * the panel is not mounted yet, so these tests call the pure view directly and
 * walk the returned React element tree. That covers labels, totals, coverage
 * caveats and filters without adding a browser test dependency.
 */
import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  UsagePanel,
  UsagePanelView,
  formatUsageCount,
  formatUsageTime,
  type UsagePanelApi,
  type UsagePanelViewProps,
  type UsagePanelSnapshot,
} from '../src/client/usage.tsx'

const GENERATED_AT = new Date(2026, 10, 4, 20, 0).getTime()
const LAST_USED_AT = new Date(2026, 10, 4, 12, 30).getTime()
const WINDOW_FROM = new Date(2026, 9, 6, 0, 0).getTime()

function collectText(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (!isValidElement(node)) return out

  const element = node as ReactElement<{ children?: ReactNode }>
  if (typeof element.type === 'function') {
    // The view only nests hook-free function components (CoverageNotice).
    const render = element.type as unknown as (props: unknown) => ReactNode
    collectText(render(element.props), out)
    return out
  }
  collectText(element.props.children, out)
  return out
}

function renderText(props: UsagePanelViewProps): string {
  return collectText(UsagePanelView(props)).join('\n')
}

const emptySnapshot: UsagePanelSnapshot = {
  generatedAt: GENERATED_AT,
  coverage: {
    status: 'complete',
    from: WINDOW_FROM,
    through: GENERATED_AT,
    workspaceAttribution: 'event-time',
  },
  totals: {
    calls: 0,
    succeeded: 0,
    failed: 0,
    distinctCapabilities: 0,
    mcpCalls: 0,
    activeMcpServers: 0,
    skillCalls: 0,
    pluginToolCalls: 0,
    nativeCalls: 0,
    unknownCalls: 0,
  },
  capabilities: [],
}

const partialSnapshot: UsagePanelSnapshot = {
  generatedAt: GENERATED_AT,
  coverage: {
    status: 'partial',
    from: WINDOW_FROM,
    through: GENERATED_AT,
    reasons: ['缺少 2026-10-20 之前的历史'],
    reasonsTruncated: true,
    skippedSessions: 2,
    skippedEvents: 9,
    workspaceAttribution: 'current-mapping',
  },
  totals: {
    calls: 12,
    succeeded: 10,
    failed: 2,
    distinctCapabilities: 1,
    mcpCalls: 12,
    activeMcpServers: 1,
    skillCalls: 0,
    pluginToolCalls: 0,
    nativeCalls: 0,
    unknownCalls: 0,
    idleCandidates: 4,
  },
  capabilities: [
    {
      id: 'mcp__github__search_repositories',
      name: 'mcp__github__search_repositories',
      kind: 'mcp',
      source: 'GitHub',
      calls: 12,
      succeeded: 10,
      failed: 2,
      lastUsedAt: LAST_USED_AT,
      status: 'on-demand',
      suggestion: 'low',
    },
  ],
  filters: {
    ranges: [7, 15, 30],
    workspaces: [],
    kinds: ['mcp'],
  },
}

const unknownSnapshot: UsagePanelSnapshot = {
  generatedAt: GENERATED_AT,
  coverage: {
    status: 'unknown',
    reasons: ['历史接口不可用'],
    workspaceAttribution: 'unknown',
  },
  totals: {
    calls: 4,
    unknownCalls: 4,
  },
  capabilities: [],
}

const richSnapshot: UsagePanelSnapshot = {
  generatedAt: GENERATED_AT,
  coverage: {
    status: 'complete',
    from: WINDOW_FROM,
    through: GENERATED_AT,
    workspaceAttribution: 'event-time',
  },
  totals: {
    calls: 1234,
    succeeded: 1100,
    failed: 120,
    denied: 8,
    cancelled: 6,
    distinctCapabilities: 5,
    mcpCalls: 800,
    activeMcpServers: 2,
    skillCalls: 300,
    pluginToolCalls: 100,
    nativeCalls: 25,
    unknownCalls: 9,
    idleCandidates: 2,
  },
  capabilities: [
    {
      id: 'mcp__github__search_repositories',
      name: 'mcp__github__search_repositories',
      kind: 'mcp',
      source: 'GitHub',
      calls: 700,
      succeeded: 690,
      failed: 10,
      lastUsedAt: LAST_USED_AT,
      status: 'resident',
      suggestion: 'normal',
    },
    {
      id: 'skill:pdf',
      name: 'pdf',
      kind: 'skill',
      source: '全局技能',
      calls: 300,
      succeeded: 280,
      failed: 20,
      lastUsedAt: LAST_USED_AT,
      status: 'on-demand',
      suggestion: 'on-demand',
    },
    {
      id: 'tool:local-tool',
      name: 'local_tool',
      kind: 'plugin-tool',
      source: 'dsh-tools',
      calls: 100,
      succeeded: 98,
      failed: 2,
      lastUsedAt: LAST_USED_AT,
      status: 'resident',
      suggestion: 'normal',
    },
    {
      id: 'native:read',
      name: 'read',
      kind: 'native',
      calls: 25,
      succeeded: 25,
      failed: 0,
      lastUsedAt: LAST_USED_AT,
      status: 'resident',
      suggestion: 'normal',
    },
    {
      id: 'unknown:unowned-tool',
      name: 'unowned_tool',
      kind: 'unknown',
      calls: 9,
      status: 'unknown',
      suggestion: 'insufficient-data',
    },
  ],
  filters: {
    ranges: [7, 15, 30],
    workspaces: [
      { id: 'ws-1', label: 'dsh-thinking-guard' },
      { id: 'ws-2', label: '另一个工作区' },
    ],
    kinds: ['mcp', 'skill', 'plugin-tool', 'native', 'unknown'],
  },
  notes: ['Skill 仅统计显式加载入口。'],
}

describe('usage panel exports', () => {
  it('keeps a mountable container and a pure view for the future remote face', () => {
    const api: UsagePanelApi = {
      getSnapshot: async query => ({ ok: true, value: { ...emptySnapshot, generatedAt: query.days } }),
    }

    expect(typeof UsagePanel).toBe('function')
    expect(typeof UsagePanelView).toBe('function')
    expect(Object.keys(api)).toEqual(['getSnapshot'])
  })
})

describe('usage panel empty and unknown states', () => {
  it('renders an explicit empty state with real zero totals', () => {
    const text = renderText({ query: { days: 7 }, snapshot: emptySnapshot })

    expect(text).toContain('更新于 2026-11-04 20:00')
    expect(text).toContain('覆盖：完整')
    expect(text).toContain('调用总数\n0')
    expect(text).toContain('成功 / 失败\n0 / 0')
    expect(text).toContain('所选范围内没有调用记录')
    expect(text).not.toContain('覆盖不完整')
    expect(text).not.toContain('全部工作区')
    expect(text).not.toContain('全部类型')
  })

  it('treats unknown coverage as unknown, not as zero calls', () => {
    const text = renderText({ query: { days: 7 }, snapshot: unknownSnapshot })

    expect(text).toContain('覆盖：未知')
    expect(text).toContain('覆盖未知')
    expect(text).toContain('0 不代表未使用')
    expect(text).toContain('历史接口不可用')
    expect(text).toContain('工作区归属未知')
    expect(text).toContain('不能据此判断能力未使用')
    expect(text).toContain('来源未解析\n4')
    expect(text).not.toContain('覆盖：完整')
  })

  it('renders missing totals as unknown instead of inventing zeroes', () => {
    const text = renderText({
      query: { days: 7 },
      snapshot: { generatedAt: GENERATED_AT, coverage: { status: 'unknown' } },
    })

    expect(text).toContain('调用总数\n—')
    expect(text).toContain('成功 / 失败\n— / —')
    expect(text).toContain('成功率\n—')
    expect(text).toContain('MCP 调用 / 活跃 Server\n— / —')
    expect(text).toContain('来源未解析\n—')
    expect(text).toContain('数据尚未完整返回')
  })

  it('does not call a complete window empty when totals were not returned', () => {
    const text = renderText({
      query: { days: 7 },
      snapshot: { generatedAt: GENERATED_AT, coverage: { status: 'complete' }, capabilities: [] },
    })

    expect(text).toContain('不能据此判断能力未使用')
    expect(text).not.toContain('所选范围内没有调用记录')
  })
})

describe('usage panel partial coverage', () => {
  it('keeps the gap visible and labels counts as a lower bound', () => {
    const text = renderText({ query: { days: 30 }, snapshot: partialSnapshot })

    expect(text).toContain('覆盖：部分')
    expect(text).toContain('覆盖不完整')
    expect(text).toContain('下限')
    expect(text).toContain('原因：缺少 2026-10-20 之前的历史；另有原因未列出')
    expect(text).toContain('跳过 2 个会话')
    expect(text).toContain('跳过 9 个事件')
    expect(text).toContain('按当前映射推断')
    expect(text).toContain('调用总数\n12')
    expect(text).toContain('mcp__github__search_repositories')
    expect(text).toContain('GitHub')
    // A partial 30-day window cannot justify a zero-call candidate, even if a
    // caller mistakenly puts the number in the snapshot.
    expect(text).not.toContain('30 天 0 调用候选')
  })

  it('does not render a workspace filter when the snapshot supplies none', () => {
    const text = renderText({ query: { days: 30 }, snapshot: partialSnapshot })

    expect(text).toContain('7 天')
    expect(text).toContain('15 天')
    expect(text).toContain('30 天')
    expect(text).toContain('全部类型')
    expect(text).not.toContain('全部工作区')
  })
})

describe('usage panel real data', () => {
  it('renders totals, kind breakdowns, filters and capability rows', () => {
    const text = renderText({
      query: { days: 30, workspaceId: 'ws-1', kind: 'mcp' },
      snapshot: richSnapshot,
    })

    expect(text).toContain('调用总数\n1,234')
    expect(text).toContain('成功 / 失败\n1,100 / 120')
    expect(text).toContain('成功率\n90%')
    expect(text).toContain('独立能力\n5')
    expect(text).toContain('MCP 调用 / 活跃 Server\n800 / 2')
    expect(text).toContain('技能调用\n300')
    expect(text).toContain('插件工具\n100')
    expect(text).toContain('原生与其他\n25')
    expect(text).toContain('来源未解析\n9')
    expect(text).toContain('拒绝\n8')
    expect(text).toContain('取消\n6')
    expect(text).toContain('30 天 0 调用候选\n2')

    expect(text).toContain('全部工作区')
    expect(text).toContain('dsh-thinking-guard')
    expect(text).toContain('全部类型')
    expect(text).toContain('类型：MCP')

    expect(text).toContain('mcp__github__search_repositories')
    expect(text).toContain('成功 690 · 失败 10')
    expect(text).toContain('最近 2026-11-04 12:30')
    expect(text).toContain('常驻')
    expect(text).toContain('按需')
    expect(text).toContain('建议按需')
    expect(text).toContain('数据不足')
    expect(text).toContain('说明：Skill 仅统计显式加载入口。')
  })

  it('keeps an unknown source distinct from the known capability kinds', () => {
    const text = renderText({
      query: { days: 7 },
      snapshot: {
        generatedAt: GENERATED_AT,
        coverage: { status: 'partial', reasons: ['owner 未确认'] },
        totals: { calls: 3, unknownCalls: 3 },
        capabilities: [
          {
            id: 'unknown:mystery',
            name: 'mystery',
            kind: 'unknown',
            calls: 3,
            status: 'unknown',
            suggestion: 'insufficient-data',
          },
        ],
      },
    })

    expect(text).toContain('mystery\n未知\n来源未确认')
    expect(text).toContain('状态未知')
    expect(text).toContain('数据不足')
    expect(text).toContain('来源未解析\n3')
    expect(text).not.toContain('插件工具\n3')
  })
})

describe('usage panel loading and failure states', () => {
  it('shows a loading placeholder before any snapshot exists', () => {
    const text = renderText({ query: { days: 7 }, loading: true })

    expect(text).toContain('正在读取…')
    expect(text).toContain('正在读取调用统计…')
    expect(text).not.toContain('调用总数')
  })

  it('reports a failed refresh without hiding the last successful snapshot', () => {
    const text = renderText({
      query: { days: 30 },
      snapshot: richSnapshot,
      loading: false,
      error: 'usage/getSnapshot failed: transport failure',
      onRefresh: () => {},
    })

    expect(text).toContain('usage/getSnapshot failed: transport failure')
    expect(text).toContain('显示的是上一次成功读取的数据')
    expect(text).toContain('重试')
    expect(text).toContain('调用总数\n1,234')
  })

  it('says when the visible numbers are still from the previous snapshot', () => {
    const text = renderText({ query: { days: 30 }, snapshot: richSnapshot, loading: true })

    expect(text).toContain('正在刷新…')
    expect(text).toContain('下面仍是上一次成功读取的数据')
    expect(text).toContain('调用总数\n1,234')
  })
})

describe('usage formatting helpers', () => {
  it('formats counts and timestamps without turning missing data into zero', () => {
    expect(formatUsageCount(1234)).toBe('1,234')
    expect(formatUsageCount(0)).toBe('0')
    expect(formatUsageCount(undefined)).toBe('—')
    expect(formatUsageCount(-1)).toBe('—')
    expect(formatUsageCount(Number.NaN)).toBe('—')

    expect(formatUsageTime(LAST_USED_AT)).toBe('2026-11-04 12:30')
    expect(formatUsageTime(undefined)).toBe('—')
    expect(formatUsageTime(Number.NaN)).toBe('—')
    expect(formatUsageTime(new Date('not-a-date').getTime())).toBe('—')
  })
})
