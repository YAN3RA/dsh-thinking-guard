/**
 * 注册能力弹窗的壳（用户 2026-11-18 授权的 A 最小 UI 修复）。
 *
 * 修的是什么：这个弹窗原来自己写了一个 mc-preview-mask 裸 div 当遮罩，而那套
 * mc-preview-* 样式只存在于冻结的 CapabilitySection.tsx 样式表里（运行时不注入），
 * 于是弹窗以普通文档流排在设置页里、还带横向溢出。
 *
 * 现在改成官方 Modal（headless：遮罩 / 卡片 / Escape / 焦点都归它）自建 header，
 * 保留原来的标题、关闭按钮与表单；onClose 统一做 busy guard，所以遮罩点击、
 * Escape、关闭按钮三条关闭路径在一次变更进行中都不会把弹窗关掉。
 *
 * 断言方式与既有 UI 测试一致：node 环境没有 jsdom / react-dom，也不新增依赖，
 * 用受控 React hook 替身 + 宿主原语替身渲染真实组件，再摊平 element tree 断言。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

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
    useEffect(): void { H.cursor++ },
    useCallback<T>(callback: T): T {
      H.cursor++
      return callback
    },
    useMemo<T>(factory: () => T): T {
      H.cursor++
      return factory()
    },
  }
})

/**
 * 官方原语替身：Modal 保留它的公开契约形状（open / headless / title / onClose /
 * className + children），但把 children 原样渲染出来，好让测试看到我们自己的壳。
 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Modal: function Modal(props: Record<string, unknown> & { children?: ReactNode }): ReactElement {
      return createElement('div', { 'data-testid': 'host-modal' }, props.children)
    },
    Button: 'button',
    Input: 'input',
    MarkdownText: () => null,
  }
})

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocationModal } from '../src/client/LocationModal.tsx'
import type { CapabilityPolicyRemote, McpLocation, SkillLocation } from '../src/client/store.ts'

/** 英文文案：够判断「本地化 accessible name」，又不引入中文常量。 */
const EN: Record<string, string> = {
  registerCapability: 'Register',
  previewClose: 'Close',
  mcpServers: 'MCP servers',
  skillDirs: 'Skill directories',
  transport: 'Transport',
  transportStdio: 'stdio (local subprocess)',
  transportHttp: 'Streamable HTTP',
  serverName: 'Server name',
  serverNameImmutable: 'The name is locked after registration.',
  url: 'URL',
  headers: 'Headers',
  timeout: 'Timeout (seconds)',
  register: 'Register',
  save: 'Save',
  remove: 'Remove',
  cancel: 'Cancel',
  editMcp: 'Edit MCP server',
  editSkillNamed: 'Edit skill directory: {name}',
}
const t = (key: string, params?: Record<string, unknown>): string => {
  const template = EN[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

interface FlatElement {
  readonly type: string
  readonly props: Record<string, unknown>
}

/** 摊平 element tree；只展开本文件的 Modal 替身，其余函数组件记录 props 即可。 */
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
    if (name === 'Modal') {
      // 保留壳本身的契约 props（open / headless / title / onClose），再展开它渲染的内容。
      out.push({ type: 'component:Modal', props: element.props })
      flatten(element.props.children as ReactNode, out)
      return out
    }
    out.push({ type: 'component:' + (name ?? 'anonymous'), props: element.props })
    return out
  }
  out.push({ type: element.type as string, props: element.props })
  flatten(element.props.children as ReactNode, out)
  return out
}

function render(props: Parameters<typeof LocationModal>[0]): FlatElement[] {
  H.cursor = 0
  return flatten(LocationModal(props))
}

/** className 里带某个 token 的节点。 */
function byClassToken(nodes: readonly FlatElement[], token: string): FlatElement[] {
  return nodes.filter(node => typeof node.props.className === 'string'
    && (node.props.className as string).split(/\s+/).includes(token))
}

/** 一个元素的直接文本子节点（按钮文案这类）。 */
function directText(node: FlatElement | undefined): string | undefined {
  const children = node?.props.children
  return typeof children === 'string' ? children : undefined
}

function buttonByText(nodes: readonly FlatElement[], text: string): FlatElement | undefined {
  return nodes.find(node => node.type === 'button' && directText(node) === text)
}

/** 永不落定的远端：让 busy 停在「变更进行中」。 */
const pending = (): Promise<never> => new Promise<never>(() => {})
const busyRemote = {
  addLocation: () => pending(),
  updateLocation: () => pending(),
  removeLocation: () => pending(),
} as unknown as CapabilityPolicyRemote

const EDIT_MCP = {
  id: 'mcp:gongfeng',
  serverName: 'gongfeng',
  transport: 'streamable-http',
  url: 'https://example.invalid/mcp',
} as McpLocation

/** 平台安全路径：项目规则禁止在测试里硬编码 POSIX /tmp。 */
const SKILL_DIR = join(tmpdir(), 'phase-a-skill')

const EDIT_SKILL = {
  name: 'phase-a-skill',
  skillName: 'Phase A Skill',
  target: SKILL_DIR,
  root: 'user',
  linked: true,
} as SkillLocation

beforeEach(() => { H.slots = [] })

describe('register dialog shell', () => {
  const props = {
    remote: busyRemote,
    t,
    onClose: () => {},
    onChanged: () => {},
  }

  it('renders the official Modal shell instead of the unstyled preview markup', () => {
    const nodes = render({ ...props, onClose: vi.fn(), onChanged: vi.fn() })
    const modal = nodes.find(node => node.type === 'component:Modal')
    expect(modal).toBeDefined()
    expect(modal!.props.open).toBe(true)
    // headless 才能自建 header，关闭按钮因此在忙碌时能 disabled。
    expect(modal!.props.headless).toBe(true)
    expect(modal!.props.title).toBe(EN.registerCapability)
    expect(modal!.props.className).toBe('lm-modal')
    // 老壳的两条线索都不在了：遮罩类与内层面板类。
    for (const node of nodes) {
      expect(String(node.props.className ?? '')).not.toContain('mc-preview')
    }
    expect(byClassToken(nodes, 'lm-shell')).toHaveLength(1)
  })

  it('names the dialog and keeps a localized, labelled close button', () => {
    const nodes = render({ ...props, onClose: vi.fn(), onChanged: vi.fn() })
    const close = buttonByText(nodes, EN.previewClose)
    expect(close).toBeDefined()
    expect(close!.props['aria-label']).toBe(EN.previewClose)
    expect(close!.props.disabled).toBe(false)
    // 标题是可见的 h2，与 Modal 的 aria-label（title）同一句。
    const heading = nodes.find(node => node.type === 'h2')
    expect(directText(heading)).toBe(EN.registerCapability)
  })

  it('keeps the register form content unchanged', () => {
    const nodes = render({ ...props, onClose: vi.fn(), onChanged: vi.fn() })
    // 两个子页签（注册模式才有）。
    expect(nodes.filter(node => node.props.role === 'tab')).toHaveLength(2)
    // 默认 transport = streamable-http，所以显示 url + headers，而不是 stdio 三件套。
    const select = nodes.find(node => node.type === 'select')
    expect(select!.props.value).toBe('streamable-http')
    const inputs = nodes.filter(node => node.type === 'input')
    expect(inputs.length).toBeGreaterThanOrEqual(2) // serverName + url
    expect(nodes.filter(node => node.type === 'textarea')).toHaveLength(1) // headers
    expect(inputs.some(node => node.props.placeholder === '60')).toBe(true) // timeout
    const labels = nodes.map(directText).filter((text): text is string => typeof text === 'string')
    expect(labels).toContain(EN.serverName)
    expect(labels).toContain(EN.url)
    expect(labels).toContain(EN.timeout)
    expect(buttonByText(nodes, EN.register)).toBeDefined()
    // 注册模式没有移除按钮。
    expect(buttonByText(nodes, EN.remove)).toBeUndefined()
  })

  it('guards every close path while a mutation is in flight', () => {
    const onClose = vi.fn()
    const first = render({ ...props, onClose, onChanged: vi.fn() })
    // 走真实提交路径：点「注册」→ submit 置 busy，远端永不落定。
    const register = buttonByText(first, EN.register)!
    ;(register.props.onClick as () => void)()
    // React 会重渲染；替身按槽位复用状态，这里手动再来一次。
    const busyTree = render({ ...props, onClose, onChanged: vi.fn() })
    const modal = busyTree.find(node => node.type === 'component:Modal')!
    // 遮罩点击与 Escape 都走这个回调。
    ;(modal.props.onClose as () => void)()
    expect(onClose).not.toHaveBeenCalled()
    // 可见的关闭按钮同样不可用。
    const close = buttonByText(busyTree, EN.previewClose)!
    expect(close.props.disabled).toBe(true)
    // 进行中时提交按钮也禁用（原行为）。
    const registerBusy = buttonByText(busyTree, EN.register)!
    expect(registerBusy.props.disabled).toBe(true)
  })

  it('closes through the same path when nothing is in flight', () => {
    const onClose = vi.fn()
    const nodes = render({ ...props, onClose, onChanged: vi.fn() })
    const modal = nodes.find(node => node.type === 'component:Modal')!
    ;(modal.props.onClose as () => void)()
    expect(onClose).toHaveBeenCalledTimes(1)
    ;(buttonByText(nodes, EN.previewClose)!.props.onClick as () => void)()
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('edit dialog', () => {
  it('keeps the MCP edit title, the fixed server name and the removal action', () => {
    const nodes = render({
      remote: busyRemote,
      t,
      editMcp: EDIT_MCP,
      onClose: () => {},
      onChanged: () => {},
    })
    expect(nodes.find(node => node.type === 'component:Modal')!.props.title).toBe(EN.editMcp)
    // 编辑模式没有子页签。
    expect(nodes.filter(node => node.props.role === 'tab')).toHaveLength(0)
    expect(buttonByText(nodes, EN.remove)).toBeDefined()
    expect(buttonByText(nodes, EN.save)).toBeDefined()
    // 名称注册后不可改：字段存在但禁用，值仍是原服务器名。
    const serverNameInput = nodes.find(node => node.type === 'input' && node.props.value === EDIT_MCP.serverName)
    expect(serverNameInput!.props.disabled).toBe(true)
  })

  it('keeps the skill edit title and its prefilled directory', () => {
    const nodes = render({
      remote: busyRemote,
      t,
      editSkill: EDIT_SKILL,
      onClose: () => {},
      onChanged: () => {},
    })
    expect(nodes.find(node => node.type === 'component:Modal')!.props.title)
      .toBe('Edit skill directory: Phase A Skill')
    const dirInput = nodes.find(node => node.type === 'input' && node.props.value === EDIT_SKILL.target)
    expect(dirInput).toBeDefined()
  })
})
