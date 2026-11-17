/**
 * 思考节流 — 一个设置入口，内部三个子页：总览 / 思考限制 / 能力菜单。
 *
 * WHY: 0.3.1 把三个页面注册成三个独立的 settings.section，设置左栏因此多了三条
 * 并列入口，看起来不像一个整体功能，也和旧版的「一个页面里切页签」不一致。
 * 这里只注册一个入口，外壳负责 v3 标题条 + 页签条，内容区切换复用已有的三个
 * 页面组件（各自的数据与交互不变）。
 */
import { useState, type ReactElement } from 'react'
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
  '.tt-tab[data-active=true]{color:var(--v3-t1);font-weight:600}',
  '.tt-tab[data-active=true]:after{content:\'\';position:absolute;left:10px;right:10px;bottom:-1px;'
    + 'height:2px;border-radius:2px 2px 0 0;background:var(--v3-info)}',
  '.tt-tab:focus-visible{outline:2px solid var(--v3-info);outline-offset:2px}',
  '.tt-body{min-width:0;display:flex;flex-direction:column;gap:12px}',
].join('')

export function ThinkingThrottleSection(props: ThinkingThrottleInjected): ReactElement {
  const [active, setActive] = useState<ThinkingThrottleTab>('overview')
  const { t } = props
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
              className="tt-tab"
              data-tab={tab}
              data-active={active === tab ? 'true' : 'false'}
              aria-selected={active === tab}
              onClick={() => setActive(tab)}
            >{t(TAB_LABEL[tab])}</button>
          ))}
        </div>
      </div>
      <div className="tt-body" role="tabpanel" data-active-tab={active}>
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
