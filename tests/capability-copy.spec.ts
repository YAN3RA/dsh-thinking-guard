/**
 * 阶段 A 最小补救（用户 2026-11-18 授权范围）的文案回归：
 *
 *   1. 英文 `mandatory` 键此前是中文「控制面」，而工具行会真实渲染它（V4「无中文残留」）；
 *   2. 英文搜索占位 `Filter by name, group, or regex…` 在 220px 的搜索框里被裁切（V4「无截断」）。
 *
 * 做法与既有 UI 测试一致：没有 jsdom / react-dom，也不新增依赖，
 *   - 字典：跑真实的 `apply()`，从 `locale.register` 的入参取真实 zh/en，
 *     不复制一份文案进测试（复制出来的副本永远会「通过」）；
 *   - 视图：直接调用真实的 `ToolGroupsView` / `CapabilitySection`，摊平返回的
 *     element tree 后断言真实属性，宿主原语（Input/Button/…）用字符串宿主元素替身，
 *     React hook 用受控替身（同 `tests/guard-threshold-conflict.spec.ts` 的手法）。
 *
 * 产品承诺：占位只是提示，可访问名称（aria-label）仍完整表达「按名称 / 分组 / 正则」
 * 语义；占位文案必须短到不会在 220px 输入框里被裁切。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

/** 受控 hook 槽位：一次渲染内按调用顺序编号（见 guard-threshold-conflict.spec.ts）。 */
const H = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  const slot = <T,>(index: number, init: () => T): T => {
    if (!(index in H.slots)) H.slots[index] = init()
    return H.slots[index] as T
  }
  return {
    ...actual,
    useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
      const index = H.cursor++
      const value = slot<T>(index, () => (typeof initial === 'function' ? (initial as () => T)() : initial))
      return [value, (next: T | ((previous: T) => T)): void => {
        const previous = H.slots[index] as T
        H.slots[index] = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      }]
    },
    useRef<T>(initial: T): { current: T } {
      const index = H.cursor++
      return slot<{ current: T }>(index, () => ({ current: initial }))
    },
    // 不执行 effect：本页的 effect 会发起 RPC，测试只断言首帧渲染。
    useEffect(): void { H.cursor++ },
    useCallback<T>(callback: T): T {
      H.cursor++
      return callback
    },
  }
})

/**
 * 宿主 UI 原语替身。
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 的构建产物 import 了 `clsx`，而 `clsx`
 * 只在宿主运行时提供（本包不依赖它，也不新增依赖），所以这里替身成宿主元素，
 * 让真实视图模块能被加载；断言读的是视图传给原语的 props，不是替身的行为。
 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Input: 'input',
  Button: 'button',
  SegmentedTabs: 'div',
  Modal: 'div',
  StateDot: 'span',
  Toast: () => null,
  MarkdownText: () => null,
  IconTriangleRightFillMedium: 'svg',
  IconTriangleRightFill14: 'svg',
}))

vi.mock('../src/client/settings-nav-icon.ts', () => ({
  installSettingsNavIcon: (ctx: Context) => ctx.effect(() => () => {}, 'nav icon'),
}))

import { apply } from '../src/client/index.ts'
import { CapabilitySection, ToolGroupsView } from '../src/client/capability-v3/section.tsx'
import { rememberSnapshot } from '../src/client/store.ts'
import type { CapabilityRow } from '../src/client/store.ts'

interface FlatElement {
  readonly type: string
  readonly props: Record<string, unknown>
}

/**
 * 摊平 element tree。
 *
 * 普通函数组件**不调用**（宿主原语、Modal 之类没有可断言的结构），只记录它们收到
 * 的 props；页面正文 `ReadyBody` 和 `SkillList`（未导出，按名字识别）会真实展开，
 * 分别验证搜索框与技能档位提示。
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
    const name = (element.type as { name?: string }).name
    if (name === 'ReadyBody' || name === 'SkillList') {
      flatten((element.type as (props: Record<string, unknown>) => ReactNode)(element.props), out)
      return out
    }
    out.push({ type: 'component:' + (name ?? 'anonymous'), props: element.props })
    return out
  }
  out.push({ type: element.type as string, props: element.props })
  flatten(element.props.children as ReactNode, out)
  return out
}

/** 真实字典：跑一次 `apply()`，从 `locale.register` 的入参里取。 */
function capabilityDictionaries(): { zh: Record<string, string>; en: Record<string, string> } {
  const registered = new Map<string, { zh: Record<string, string>; en: Record<string, string> }>()
  const ctx = {
    effect: (callback: () => unknown) => { callback() },
    locale: {
      register: (namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }) => {
        registered.set(namespace, dictionaries)
        return () => {}
      },
      bind: () => (key: string) => key,
    },
    remote: { $mount: async () => async () => {} },
    get: () => ({}),
    slots: {
      inject: (_: string, callback: () => void) => { callback() },
      register: () => () => {},
    },
    on: () => () => {},
  }
  apply(ctx as unknown as Context)
  const dictionaries = registered.get('settings.capability')
  if (dictionaries === undefined) throw new Error('settings.capability dictionaries were not registered')
  return dictionaries
}

const { zh, en } = capabilityDictionaries()

/** 渲染一次真实视图；hook 游标在每次渲染前归零（与 React 的单次渲染一致）。 */
function render(node: () => ReactNode): FlatElement[] {
  H.cursor = 0
  return flatten(node())
}

function row(overrides: Partial<CapabilityRow> & Pick<CapabilityRow, 'id' | 'kind'>): CapabilityRow {
  return { name: overrides.id, class: 'resident', mandatory: false, ...overrides }
}

const MANDATORY_TOOL = row({
  id: 'meta_search',
  kind: 'tool',
  name: 'meta_search',
  server: 'built-in',
  mandatory: true,
  classLabel: 'resident: bundled with every turn',
})

describe('English capability copy', () => {
  it('translates the mandatory label instead of leaving the Chinese one', () => {
    expect(zh.mandatory).toBe('控制面')
    expect(en.mandatory).toBe('Control plane')
    expect(/[\u4e00-\u9fff]/.test(en.mandatory)).toBe(false)
  })

  it('keeps both dictionaries on the same key set', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('shortens the search placeholder but keeps the full filter semantics in the name', () => {
    // 提示语短到 220px（max-width）/ 12.5px 字号下不会被裁切；zh 每字 12.5px。
    for (const text of [zh.filterPlaceholder, en.filterPlaceholder]) {
      expect(text.length).toBeLessThanOrEqual(22)
    }
    expect(zh.filterPlaceholder).toBe('搜索名称或分组…')
    expect(en.filterPlaceholder).toBe('Search name or group…')
    expect(/[\u4e00-\u9fff]/.test(en.filterPlaceholder)).toBe(false)
    // 可访问名称仍完整表达「名称 / 分组 / 正则」，不靠占位承载语义。
    expect(zh.filterByName).toContain('名字')
    expect(zh.filterByName).toContain('分组')
    expect(zh.filterByName).toContain('正则')
    expect(en.filterByName).toContain('name')
    expect(en.filterByName).toContain('group')
    expect(en.filterByName).toContain('regex')
    expect(en.filterPlaceholder).not.toBe(en.filterByName)
    expect(zh.filterPlaceholder).not.toBe(zh.filterByName)
  })
})

describe('mandatory chip in the tool list', () => {
  const groups = [{ server: 'built-in', tools: [MANDATORY_TOOL] }]
  const props = {
    groups,
    openServers: new Set(['built-in']),
    busy: false,
    onToggle: () => {},
    onCycle: () => {},
    onOpenDetail: () => {},
    onEditServer: () => {},
    onEditSearch: () => {},
  }

  it('renders the English label on an open group row', () => {
    const enT = (key: keyof typeof en): string => en[key]!
    const nodes = render(() => ToolGroupsView({ ...props, t: enT as never }))
    const texts = nodes.map(node => node.props.children).filter((child): child is string => typeof child === 'string')
    expect(texts).toContain('Control plane')
    expect(texts).not.toContain('控制面')
  })

  it('still renders the Chinese label in the Chinese UI', () => {
    const zhT = (key: keyof typeof zh): string => zh[key]!
    const nodes = render(() => ToolGroupsView({ ...props, t: zhT as never }))
    const texts = nodes.map(node => node.props.children).filter((child): child is string => typeof child === 'string')
    expect(texts).toContain('控制面')
  })
})

describe('registration and localized tier copy', () => {
  it('translates registration fields while preserving the Chinese dictionary', () => {
    expect(en.serverName).toBe('Server name')
    expect(en.url).toBe('URL')
    expect(zh.serverName).toBe('服务器名称')
    expect(zh.url).toBe('地址')
  })

  it.each(['resident', 'on-demand', 'disabled'] as const)('localizes %s row names and hints without using the server label', tier => {
    const fixture = { ...MANDATORY_TOOL, class: tier, mandatory: false, classLabel: '后端中文说明' }
    const nodes = render(() => ToolGroupsView({
      groups: [{ server: 'built-in', tools: [fixture] }], openServers: new Set(['built-in']), busy: false,
      t: ((key: string) => en[key]!) as never, onToggle: () => {}, onCycle: () => {},
      onOpenDetail: () => {}, onEditServer: () => {}, onEditSearch: () => {},
    }))
    const rowNode = nodes.find(node => node.props.className === 'v3-trow')!
    const chip = nodes.find(node => node.type === 'button' && node.props.className === 'v3-tag' && node.props['aria-label'] !== undefined)!
    const shortKeys = { resident: 'residentShort', 'on-demand': 'onDemandShort', disabled: 'disabledShort' }
    expect(rowNode.props.title).toBe(en[shortKeys[tier]])
    expect(chip.props['aria-label']).toBe(en[shortKeys[tier]])
    expect(chip.props.title).toBe(en.cycleHint)
    expect(chip.props.disabled).toBe(false)
    for (const name of [rowNode.props.title, chip.props.title, chip.props['aria-label']]) {
      expect(typeof name).toBe('string')
      expect(/[\u3400-\u9fff]/.test(name as string)).toBe(false)
    }
    expect(fixture.classLabel).toBe('后端中文说明')
  })

  it('renders the skill tier hint from the client dictionary', () => {
    H.slots = []
    rememberSnapshot({ rows: [row({ id: 'fixture-skill', kind: 'skill', name: 'Fixture skill', source: 'user-agents', classLabel: '后端中文说明' })] })
    const nodes = render(() => CapabilitySection({ remote: {} as never, t: ((key: string) => en[key]!) as never, subscribeSignals: () => () => {} }))
    const skill = nodes.find(node => node.props['data-v3-skill'] === 'fixture-skill')
    expect(skill).toBeDefined()
    const chip = nodes.find(node => node.type === 'button' && node.props.className === 'v3-tag' && node.props.children === en.residentShort)
    expect(chip).toBeDefined()
    expect(chip!.props.title).toBe(en.cycleHint)
    expect(/[\u3400-\u9fff]/.test(chip!.props.title as string)).toBe(false)
    H.slots = []
    rememberSnapshot({ rows: [MANDATORY_TOOL, row({ id: 'meta_search_alt', kind: 'tool', server: 'built-in' })] })
  })
})

describe('search field in the capability catalog', () => {
  const snapshot = rememberSnapshot({ rows: [MANDATORY_TOOL, row({ id: 'meta_search_alt', kind: 'tool', server: 'built-in' })] })
  const remote = {} as never

  function searchField(language: 'en' | 'zh'): FlatElement {
    const dictionary = language === 'en' ? en : zh
    const t = (key: string): string => dictionary[key]!
    const nodes = render(() => CapabilitySection({
      remote,
      t: t as never,
      subscribeSignals: () => () => {},
    }))
    const field = nodes.find(node => node.type === 'input' && node.props.type === 'search')
    if (field === undefined) throw new Error('the catalog search field was not rendered')
    expect(snapshot.rows.length).toBeGreaterThan(0)
    return field
  }

  it('shows the short hint as placeholder and keeps the full filter name as aria-label', () => {
    const field = searchField('en')
    expect(field.props.placeholder).toBe('Search name or group…')
    // 可访问名称完整表达「名称 / 分组 / 正则」，且不依赖 placeholder。
    expect(field.props['aria-label']).toBe('Filter by name, group, or regex…')
    expect(field.props['aria-label']).not.toBe(field.props.placeholder)
    expect(field.props.title).toBe(en.filterHint)
  })

  it('uses the Chinese hint and name in the Chinese UI', () => {
    const field = searchField('zh')
    expect(field.props.placeholder).toBe('搜索名称或分组…')
    expect(field.props['aria-label']).toBe('按名字、分组或正则过滤…')
    expect(field.props.title).toBe(zh.filterHint)
  })
})

describe('B-2: resident row dot uses the blue adapter (StateDot has no info state)', () => {
  it('keeps the business data-tone and adds v3-dot--info only for resident rows', () => {
    const nodes = render(() => ToolGroupsView({
      groups: [{ server: 'built-in', tools: [{ ...MANDATORY_TOOL, class: 'resident' }] }],
      openServers: new Set(['built-in']),
      busy: false,
      t: ((key: string) => en[key]!) as never,
      onToggle: () => {}, onCycle: () => {}, onOpenDetail: () => {}, onEditServer: () => {}, onEditSearch: () => {},
    }))
    // 外壳仍带业务 data-tone='info'。
    expect(nodes.some(node => node.props.className === 'v3-dot' && node.props['data-tone'] === 'info')).toBe(true)
    // 常驻用 idle + 蓝色 className，不擅自改成绿色（done）。
    const dot = nodes.find(node => node.type === 'span' && node.props.state === 'idle' && node.props.className === 'v3-dot--info')
    expect(dot).toBeDefined()
    expect(nodes.some(node => node.props['data-state'] === 'done')).toBe(false)
  })
})
