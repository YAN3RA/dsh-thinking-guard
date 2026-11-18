/**
 * 思考节流 — 一个设置入口，内部三个子页：总览 / 思考限制 / 能力菜单。
 *
 * WHY: 0.3.1 把三个页面注册成三个独立的 settings.section，设置左栏因此多了三条
 * 并列入口，看起来不像一个整体功能，也和旧版的「一个页面里切页签」不一致。
 * 这里只注册一个入口，外壳负责 v3 标题条 + 页签条，内容区切换复用已有的三个
 * 页面组件（各自的数据与交互不变）。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { V3Styles, V3_ROOT_CLASS } from './v3-ui.ts'
import { CapabilitySection, type CapabilitySectionInjected } from './capability-v3/section.tsx'
import { OverviewSection, type OverviewSectionInjected } from './overview-section.tsx'
import { GuardSection, type GuardSectionInjected } from './guard-section.tsx'

/** 三个子页的稳定标识；顺序即展示顺序。 */
export type ThinkingThrottleTab = 'overview' | 'guard' | 'capability'

const TAB_ORDER: readonly ThinkingThrottleTab[] = ['overview', 'guard', 'capability']
const TAB_LABEL: Record<ThinkingThrottleTab, ThinkingThrottleKey> = {
  overview: 'tabOverview',
  guard: 'tabGuard',
  capability: 'tabCapability',
}

/** 外壳自身用到的文案键（页签与标题）。 */
export type ThinkingThrottleKey =
  | 'nav'
  | 'title'
  | 'tabOverview'
  | 'tabGuard'
  | 'tabCapability'

export interface ThinkingThrottleInjected {
  readonly capability: CapabilitySectionInjected
  readonly overview: OverviewSectionInjected
  readonly guard: GuardSectionInjected
  /** 仅供激活测试/诊断观察挂载生命周期；外壳本身不消费。 */
  readonly remoteMount?: unknown
  readonly t: (key: ThinkingThrottleKey) => string
}

const SHELL_CSS = [
  '.tt-root{display:flex;flex-direction:column;gap:12px;min-width:0}',
  '.tt-head{display:flex;flex-direction:column;gap:8px;min-width:0}',
  '.tt-title{margin:0;font-size:18px;font-weight:600;line-height:26px;color:var(--v3-t1)}',
  '.tt-tabs{display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--v3-line-2);min-width:0}',
  '.tt-tab{appearance:none;border:0;background:none;padding:7px 14px 9px;font:inherit;font-size:13px;'
    + 'line-height:20px;color:var(--v3-t3);cursor:pointer;position:relative;border-radius:var(--v3-r-sm) var(--v3-r-sm) 0 0}',
  '.tt-tab:hover{color:var(--v3-t1)}',
  // 选中视觉从 aria-selected 推导，且不改变尺寸/字重（避免 layout shift）；
  // 下划线用 border 而非 background，forced-colors 下仍可见（tabs 指南）。
  '.tt-tab[aria-selected=true]{color:var(--v3-t1)}',
  '.tt-tab[aria-selected=true]::after{content:\'\';position:absolute;left:10px;right:10px;bottom:-1px;'
    + 'height:0;border-block-end:2px solid var(--v3-info);border-radius:2px 2px 0 0}',
  '.tt-tab:focus-visible{outline:2px solid var(--v3-info);outline-offset:2px}',
  '.tt-body{min-width:0;display:flex;flex-direction:column;gap:12px}',
].join('')

/** 稳定的 tab / panel DOM id（设置面板单实例；不用 useId，避免波及 hook-free 视图测试）。 */
export function thinkingTabId(tab: ThinkingThrottleTab): string {
  return 'tt-tab-' + tab
}

/**
 * 手动激活：方向键 / Home / End 只决定「下一个焦点」，Enter / Space 才是「激活」。
 * 纯函数，便于在无 DOM 的测试里断言「移焦」与「激活」分离（不挂载、不发 RPC）。
 */
export function resolveTabKey(
  current: ThinkingThrottleTab,
  key: string,
): ThinkingThrottleTab | 'activate' | null {
  const index = TAB_ORDER.indexOf(current)
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return TAB_ORDER[(index + 1) % TAB_ORDER.length]!
    case 'ArrowLeft':
    case 'ArrowUp':
      return TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length]!
    case 'Home':
      return TAB_ORDER[0]!
    case 'End':
      return TAB_ORDER[TAB_ORDER.length - 1]!
    case 'Enter':
    case ' ':
      return 'activate'
    default:
      return null
  }
}

export function ThinkingThrottleSection(props: ThinkingThrottleInjected): ReactElement {
  const [active, setActive] = useState<ThinkingThrottleTab>('overview')
  // 焦点 tab（手动激活前可与 active 不同）：roving 焦点只移动，不改变 active。
  const [focusTab, setFocusTab] = useState<ThinkingThrottleTab>('overview')
  const tabRefs = useRef<Partial<Record<ThinkingThrottleTab, HTMLButtonElement | null>>>({})
  /**
   * 当前面板内是否有可聚焦（且未 disabled）的子控件。没有时（如 Guard 读不到开关、
   * 开关与输入都 disabled）面板自身需要成为 tab stop（tabIndex=0），否则键盘无法进入。
   * 不能按页面类型硬定：同一页在加载中/正常/只读下可聚焦控件数量会变，故 commit 后
   * 实际查询一次，并用 MutationObserver 跟随 disabled/tabindex/子节点变化，卸载时清理。
   */
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelTabbable, setPanelTabbable] = useState(false)
  const { t } = props

  useEffect(() => {
    const element = panelRef.current
    if (element === null || typeof document === 'undefined') return
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const update = (): void => {
      const hasFocusable = element.querySelector(selector) !== null
      setPanelTabbable(!hasFocusable)
    }
    update()
    const observer = typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(update)
    observer?.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'tabindex', 'href'],
    })
    return () => { observer?.disconnect() }
  }, [active])

  const onTabKeyDown = (tab: ThinkingThrottleTab) => (event: { key: string; preventDefault(): void }): void => {
    const target = resolveTabKey(tab, event.key)
    if (target === null) return
    event.preventDefault()
    if (target === 'activate') {
      setActive(tab)
      setFocusTab(tab)
      return
    }
    // 只移焦：不改 active、不挂载面板、不发 RPC。
    setFocusTab(target)
    tabRefs.current[target]?.focus()
  }

  return (
    <div className={V3_ROOT_CLASS + ' tt-root'} data-thinking-throttle="true">
      <V3Styles />
      <style data-thinking-throttle-style="true">{SHELL_CSS}</style>
      <div className="tt-head">
        <h2 className="tt-title">{t('title')}</h2>
        <div className="tt-tabs" role="tablist" aria-label={t('title')}>
          {TAB_ORDER.map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={thinkingTabId(tab)}
              className="tt-tab"
              data-tab={tab}
              data-active={active === tab ? 'true' : 'false'}
              data-focus={focusTab === tab ? 'true' : 'false'}
              aria-selected={active === tab}
              // roving：只有选中的 tab 是 tab stop，Tab 进入组时落在它上面。
              tabIndex={active === tab ? 0 : -1}
              ref={element => { tabRefs.current[tab] = element }}
              onClick={() => { setActive(tab); setFocusTab(tab) }}
              onKeyDown={onTabKeyDown(tab)}
            >{t(TAB_LABEL[tab])}</button>
          ))}
        </div>
      </div>
      <div
        className="tt-body"
        role="tabpanel"
        id="tt-panel"
        aria-labelledby={thinkingTabId(active)}
        data-active-tab={active}
        ref={panelRef}
        // 面板内无可聚焦控件时自身可 Tab 进入；有则把 tab stop 留给自然控件。
        tabIndex={panelTabbable ? 0 : undefined}
      >
        {active === 'overview'
          ? <OverviewSection {...props.overview} onOpenCapability={() => { setActive('capability') }} />
          : null}
        {active === 'guard' ? <GuardSection {...props.guard} /> : null}
        {active === 'capability' ? <CapabilitySection {...props.capability} /> : null}
      </div>
    </div>
  )
}

/** 外壳文案：zh / en。 */
export function thinkingThrottleDictionaries(): {
  zh: Record<ThinkingThrottleKey, string>
  en: Record<ThinkingThrottleKey, string>
} {
  return {
    zh: {
      nav: '思考节流',
      title: '思考节流',
      tabOverview: '总览',
      tabGuard: '思考限制',
      tabCapability: '能力菜单',
    },
    en: {
      nav: 'Thinking Throttle',
      title: 'Thinking Throttle',
      tabOverview: 'Overview',
      tabGuard: 'Thinking Limit',
      tabCapability: 'Capability Menu',
    },
  }
}
