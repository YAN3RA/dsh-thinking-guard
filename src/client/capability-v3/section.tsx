/**
 * 能力菜单 v3 —— 独立视图（移植自本项目 0.1.27 的 CapabilitySection.tsx）。
 *
 * WHY A SEPARATE PAGE: 上游 `src/client/CapabilitySection.tsx` 是本分支的硬
 * 约束（一字不改），所以 v3 页面不覆盖它，而是在 `capability-v3/` 里独立成页，
 * 由 `src/client/index.ts` 单独注册。数据面仍是上游的 `capabilityPolicy` 远程
 * 面：类型来自 `../store.ts`，Typert 定义来自 `../remote.ts`。
 *
 * 与 0.1.27 的差异恰好三处，都在移植时逐条改过：
 *   1. 档位切换改走 `./view-model.ts`（上游没有 `moveCapabilities` 意图接口，
 *      用 `getConfig`/`updateConfig` 整表实现，语义与上游同名逻辑一致）；
 *   2. 删除调用统计子系统（已移除），连同「N 次 / 失败 N」单元格
 *      与四档计数条里的「零调用」格；
 *   3. `t` 的键集裁到本页真正用到的部分，不再携带 0.1.27 四页签外壳的键。
 *
 * 另外新增一处行为：档位切换在**回读确认**后给出可见反馈（`cycleSaved`：已保存
 * 某某 → 某档），失败或被规则覆盖时仍走原有的「分类未生效」提示，二者共用同一个
 * Toast 槽位，连点不会堆叠。
 *
 * 原 0.1.27 文件头（保留历史语境）：
 * React section for the Capability Menu settings tab. Tools and Skills share
 * one heading; each capability has a clickable exposure tier.
 *
 * Layout:
 *   - tier counts     → counts for the active Tools or Skills source tab
 *   - tabs            → Tools | Skills (plugins-tab chrome)
 *   - Tools tab       → grouped by server, collapsible disclosure rows; the
 *                       per-class count chip and each tool's class chip are
 *                       clickable to cycle Resident → On-demand → Disabled.
 *                       Harness-native tools (no real MCP server) share the
 *                       reserved `built-in` group, shown as 「系统内置」.
 *   - Skills tab      → sub-tabs 全局技能 / 项目技能 / 预设技能, each
 *                       with flat skill rows carrying the same clickable class
 *                       chip plus a directory tree / file preview
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import * as ClientUiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import { Button, Input, Modal, SegmentedTabs, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  CapabilityPolicyRemote,
  CapabilitySnapshot,
  CapabilityRow,
  CatalogDocs,
  McpLocation,
  SkillFileEntry,
  SkillLocation,
  ToolDetail,
  SearchMetadata,
} from '../store.ts'
import { cachedSnapshot, loadSnapshot, rememberSnapshot, unwrap, waitForMcpTools, withTransientRetry } from '../store.ts'

type ChevronIcon = (props: { size?: number; className?: string }) => ReactElement
const chevronIcons = ClientUiPrimitives as unknown as {
  IconTriangleRightFillMedium?: ChevronIcon
  IconTriangleRightFill14?: ChevronIcon
}
const IconTriangleRightFill: ChevronIcon = (chevronIcons.IconTriangleRightFillMedium ?? chevronIcons.IconTriangleRightFill14)!
import { LocationModal } from '../LocationModal.tsx'
import { ADOPTABLE_SKILL_SOURCES, BUILT_IN_SERVER, PROJECT_SKILL_SOURCES } from '../../constants.ts'
import {
  compileNameFilter,
  countByClass,
  filterRows,
  groupRows,
  splitSkillGroups,
  type SkillTab,
} from '../skillGroups.ts'
import {
  POLL_SAMPLE_TIMEOUT_MS,
  canRevalidate,
  pollDelayMs,
  versionChanged,
  withDeadline,
  type RevalidateGate,
} from '../revalidate.ts'
import { moveCapabilities, nextTier, overriddenIds } from './view-model.ts'

/** Props injected by the settings.section registration (see index.ts). */
export interface CapabilitySectionInjected {
  remote: CapabilityPolicyRemote
  t(key: CapabilityKey, params?: Record<string, unknown>): string
  /** Diagnostic: `$mount` failure surfaced instead of crashing the section. */
  mountError?: string
  /**
   * Subscribe to signals that the host catalog may have moved without this page
   * asking: a settings document edit (registering a source, editing a
   * composition file outside the browser) or a carrier reconnect. Returns a
   * disposer.
   */
  subscribeSignals: (listener: () => void) => () => void
}

export type CapabilitySectionProps = CapabilitySectionInjected

/**
 * 本页用到的 `t` 键。
 *
 * WHY TRIMMED: 0.1.27 的四页签外壳把 Catalog / 概览 / 执行保护三页的键塞进同一个
 * 联合类型，并在 `index.ts` 的字典里一起维护。现在本包改成「一个页面一个视图」，
 * 这一页只保留它真正渲染的 96 个键（档位、过滤、诊断、检索摘要、位置注册、目录
 * 文档、自更新）；概览与 Guard 的键归各自的 section，调用统计的键已随统计
 * 子系统删除。少一个键在这里，`t` 的调用点就少一处能让字典漂移的地方。
 */
export type CapabilityKey =
  | 'title'
  | 'desc'
  | 'mandatory'
  | 'toolsGroup'
  | 'skillsGroup'
  | 'builtInGroup'
  | 'globalSkills'
  | 'projectSkills'
  | 'presetSkills'
  | 'emptyTools'
  | 'emptySkills'
  | 'emptyGlobalSkills'
  | 'emptyProjectSkills'
  | 'emptyPresetSkills'
  | 'toolCount'
  | 'filterByName'
  | 'filterPlaceholder'
  | 'filterHint'
  | 'filterNoMatch'
  | 'residentShort'
  | 'onDemandShort'
  | 'disabledShort'
  | 'cycleHint'
  | 'cycleSaved'
  | 'notPreviewable'
  | 'previewClose'
  | 'markdownCode'
  | 'markdownWrap'
  | 'markdownUnwrap'
  | 'markdownCopy'
  | 'markdownCopied'
  | 'markdownFootnotes'
  | 'detailNotFound'
  | 'cycleOverridden'
  | 'refreshFailed'
  | 'mcpToolsPending'
  | 'feedback'
  | 'retry'
  | 'carrierFailureHint'
  | 'registerCapability'
  | 'edit'
  | 'cancel'
  | 'notEditable'
  | 'skillAdopted'
  | 'skillSource'
  | 'skillSourceHint'
  | 'skillFromPreset'
  | 'skillFromPresetHint'
  | 'skillUnmanaged'
  | 'adoptSkill'
  | 'adoptSkillHint'
  | 'adoptSkillTitle'
  | 'sourceCustom'
  | 'sourceBundled'
  | 'viewCatalog'
  | 'catalogPolicy'
  | 'catalogOnDemand'
  | 'catalogPolicyNote'
  | 'catalogSearchNote'
  | 'catalogEmpty'
  | 'diagnosticTitle'
  | 'diagnosticUnavailable'
  | 'diagnosticShadowed'
  | 'diagnosticBroken'
  | 'diagnosticUnbrowseable'
  | 'diagnosticUndocumented'
  | 'editSearchMetadata'
  | 'searchMetadataButton'
  | 'searchDescription'
  | 'searchMetadataNote'
  | 'searchMetadataSave'
  | 'searchMetadataRestore'
  | 'searchMetadataRestoreHint'
  | 'searchMetadataSaved'
  | 'summaryLimit'
  | 'summaryLimitUnit'
  | 'summaryLimitInvalid'
  | 'summaryLimitDisabled'
  | 'summaryLimitSaved'
  | 'projectRootLabel'
  | 'skillBrowseUnavailable'
  | 'updateAvailable'
  | 'newVersion'
  | 'updateDialogTitle'
  | 'updateVersionComparison'
  | 'updateNpmNote'
  | 'updateLocalNote'
  | 'updateSourceSteps'
  | 'updateSourceStepsHide'
  | 'updateSourceStepsIntro'
  | 'updateSourceStepsRestart'
  | 'installUpdate'
  | 'switchAndInstall'
  | 'updatingPlugin'
  | 'pluginUpdated'
  | 'pluginSwitched'
  | 'pluginNonRegistrySource'
  | 'pluginProfileUnavailable'
  | 'pluginUpdateFailed'

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: CapabilitySnapshot }

const CLASS_KEYS = ['resident', 'on-demand', 'disabled'] as const
type CapabilityClass = (typeof CLASS_KEYS)[number]

/* 点击循环顺序（NEXT_TIER）已随档位切换一起移到 `./view-model.ts`：上游没有
   intent-move 远程方法，切换要靠 `getConfig`/`updateConfig` 整表重建，因此把
   「下一档」和「写回」放在同一处维护。 */
/** i18n keys for the short display labels, keyed by the machine class value. */
const CLASS_SHORT_KEYS: Record<CapabilityClass, CapabilityKey> = {
  resident: 'residentShort',
  'on-demand': 'onDemandShort',
  disabled: 'disabledShort',
}

/** Scoped stylesheet: injected once at module scope, like every official bundle.
 *  A-6：id 必须独立 —— 与上游冻结的 CapabilitySection.tsx 同 id 时，先注入的那个
 *  会让对方在幂等检查处被跳过，两套 mc-* 规则互相吃掉。 */
const CSS_ID = 'capability-menu-v3-css'
const CSS = `
.mc-section{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
/* One settings page with category tabs on top (PluginSection). The reused
   views keep .mc-section; only the chrome wrapping them is new. */
.mc-plugin-section{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary)}
.mc-plugin-section>.mc-tabs{padding-bottom:0}
.mc-plugin-section>.mc-panel{padding-top:0}
.mc-heading{margin:0;font-size:18px;font-weight:600}
.mc-heading-row{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}
.mc-heading-meta{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.mc-heading-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-left:auto;min-width:0}
.mc-feedback-link{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;white-space:nowrap;text-decoration:none}
.mc-feedback-link:hover,.mc-feedback-link:focus-visible{color:#527a9c;text-decoration:underline;text-underline-offset:3px}
.mc-feedback-link:focus-visible{outline:2px solid #527a9c;outline-offset:2px;border-radius:2px}
body[data-ds-dark-theme] .mc-feedback-link:hover,body[data-ds-dark-theme] .mc-feedback-link:focus-visible{color:#96b6d1}
body[data-ds-dark-theme] .mc-feedback-link:focus-visible{outline-color:#96b6d1}
.mc-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px}
@media(max-width:640px){.mc-heading-actions{width:100%;justify-content:flex-start;margin-left:0}}
.mc-version{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap}
.mc-update-check{flex:none;white-space:nowrap}
.mc-update-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.mc-update-dialog{width:min(500px,calc(100vw - 48px))}
.mc-update-actions{flex-wrap:wrap}
.mc-update-actions .mc-update-cancel{margin-right:auto}
.mc-update-steps{display:flex;flex-direction:column;gap:8px}
.mc-update-steps pre{margin:0;padding:10px 12px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;white-space:pre-wrap;word-break:break-all}
.mc-summary{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding-bottom:8px}
/* 忙碌态靠变淡表示，而不是换文案：换文案会改按钮宽度，把这行挤到第二行。 */
.mc-catalog-tabs{padding:8px 16px 0}
.mc-catalog-toolbar{display:flex;align-items:center;gap:12px;padding:8px 16px 0;min-width:0}
.mc-catalog-toolbar .mc-catalog-path{flex:1 1 auto;min-width:0;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-summary-setting{display:flex;align-items:center;gap:8px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mc-summary-setting input{box-sizing:border-box;width:76px;padding:4px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.mc-catalog-limit-error{padding:4px 16px 0;margin:0;font-size:12px}
@media(max-width:600px){.mc-catalog-toolbar{flex-wrap:wrap}.mc-catalog-toolbar .mc-catalog-path{flex-basis:100%}.mc-summary-setting{flex-wrap:wrap;justify-content:flex-end;margin-left:auto}}
.mc-catalog-path{padding:8px 16px 0;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.mc-search-result{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mc-search-result:first-child{padding-top:0}
.mc-search-result:last-child{border-bottom:0}
.mc-search-result-head{display:flex;align-items:center;gap:8px;font-size:12px;line-height:20px}
.mc-search-result-id{font-family:var(--dsw-font-markdown-code-block-font-family);overflow-wrap:anywhere}
.mc-search-result-summary{margin:4px 0 0;font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.mc-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:20px;white-space:nowrap}
/* 三态圆点：常驻=实心、按需=半实心、禁用=圆环+斜杠（禁行标志）。
   形状区分之外仍保留色盲友好（蓝-黄轴）：冷蓝=常驻、暖琥珀=按需、中性灰=禁用。
   三个状态都用内联 SVG 做 mask 绘制，保证 10px 下也是矢量正圆（避免 CSS
   border-radius 小尺寸的方圆变形）；禁用不用空心圆：在「禁用 · 0」这类计数旁，
   空心圆容易被误读成数字 0。 */
.mc-dot{position:relative;width:13px;height:13px;border-radius:50%;flex:none;box-sizing:border-box}
.mc-dot--resident{--mc-dot:#527a9c;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='5.3' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='5.3' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat}
.mc-dot--on-demand{--mc-dot:#a57c33;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cpath d='M1.4 6 A4.6 4.6 0 0 1 10.6 6 Z' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cpath d='M1.4 6 A4.6 4.6 0 0 1 10.6 6 Z' fill='%23000'/%3E%3C/svg%3E") center/contain no-repeat}
.mc-dot--disabled{--mc-dot:#7e7477;background:var(--mc-dot);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='4.6' fill='none' stroke='%23000' stroke-width='1.4'/%3E%3Cline x1='3' y1='9' x2='9' y2='3' stroke='%23000' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat}
body[data-ds-dark-theme] .mc-dot--resident{--mc-dot:#96b6d1}
body[data-ds-dark-theme] .mc-dot--on-demand{--mc-dot:#d4b26b}
body[data-ds-dark-theme] .mc-dot--disabled{--mc-dot:#b8abad}
/* 同上色系（低饱和灰调）：仅文字着色，不加背景，浅/深主题各一档。 */
.mc-chip--resident{color:#527a9c}
.mc-chip--on-demand{color:#a57c33}
.mc-chip--disabled{color:#7e7477}
body[data-ds-dark-theme] .mc-chip--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-chip--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-chip--disabled{color:#b8abad}
.mc-tabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;justify-content:space-between;gap:22px}
/* 名字过滤框：两个 tab 共用一条，宽度占满，与下方列表左对齐。
   它属于上面的主 tab 栏，不属于下面的列表，所以两侧都把 .mc-section 的 12px
   栏距收掉一部分：下划线—6px—输入框—8px—全局/项目 子页签文字（后者里的 4px
   是子页签自己的 padding-top）。改之前是 12+12=24px 和 12+4=16px，读起来像
   两个不相干的块。 */
.mc-filter{display:flex;padding-top:0;margin-top:-6px;margin-bottom:-8px}
.mc-filter input{box-sizing:border-box;width:100%;min-width:0;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px;line-height:18px}
.mc-filter input:hover{border-color:var(--dsw-alias-border-l3)}
.mc-filter input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
/* Skills source tabs (global/project/preset): same underline chrome, no right-side summary. */
.mc-subtabs{border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;align-items:flex-end;gap:22px}
.mc-tab-group{display:flex;align-items:flex-end;gap:22px}
.mc-tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}
.mc-tab:hover,.mc-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.mc-tab[data-active=true]:after,.mc-tab:focus-visible:after{background:var(--dsw-alias-label-primary);content:"";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}
.mc-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;color:var(--dsw-alias-label-primary);border-radius:2px}
/* 面板的第一行必须和另一个 tab 的第一行从过滤框下沿出发走同样远，否则切 tab 时
   首行会跳一下。这里留 4px，加上 .mc-section 的 4px 栏距（过滤框那侧被 -8px 收
   掉后剩 4px）= 8px，正好是 Skills 面板子页签文字的位置（4px 栏距 + 子页签自己
   的 4px padding-top）。原来这里是 12px，Tools 的首个分组因此落在过滤框下 16px
   处，比「全局技能」那行低一半。 */
.mc-panel{min-width:0;padding-top:4px}
/* Skills panel: its first row is the source sub-tab bar, and that bar
   belongs to the header stack above it (rule → name filter → sub-tabs) rather
   than to the list below. So the panel adds no padding of its own, and the
   sub-tab labels keep a 4px top padding instead of the 7px they share with the
   primary tabs. */
.mc-panel--tight{padding-top:0}
.mc-panel--tight .mc-subtabs .mc-tab{padding-top:4px}
.mc-panel-inner{display:flex;flex-direction:column;gap:14px}
.mc-group{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.mc-group-header{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mc-group-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-group-header:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.mc-chevron{color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;flex:none}
.mc-chevron--open{transform:rotate(90deg)}
.mc-server-name{font-weight:600;font-size:14px;line-height:20px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-server-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none}
.mc-server-meta{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none;min-width:0}
.mc-counts{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.mc-count{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid transparent;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.mc-count:hover{border-color:var(--dsw-alias-border-l3)}
.mc-count:disabled{cursor:default;opacity:.6}
.mc-count--resident{color:#527a9c}
.mc-count--on-demand{color:#a57c33}
.mc-count--disabled{color:#7e7477}
body[data-ds-dark-theme] .mc-count--resident{color:#96b6d1}
body[data-ds-dark-theme] .mc-count--on-demand{color:#d4b26b}
body[data-ds-dark-theme] .mc-count--disabled{color:#b8abad}
/* 「编辑」是动作，不是分类计数：沿用 chip 的尺寸以对齐，但用次要文字色、hover
   才变蓝加下划线。裸用 .mc-count 时会继承 .mc-section 的 label-primary（浅色
   主题下近黑），夹在着色的计数 chip 旁会读成一枚没有圆点的黑色 chip。 */
.mc-count--action{color:var(--dsw-alias-label-secondary)}
.mc-count--action:hover{color:var(--dsw-alias-state-business-primary);text-decoration:underline}
.mc-tools{border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.mc-tool{box-sizing:border-box;display:flex;align-items:center;flex-wrap:wrap;gap:10px;width:100%;min-width:0;padding:7px 12px 7px 26px;font-size:13px;line-height:20px;cursor:pointer}
.mc-tool:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-tool-name{font-family:var(--dsw-font-markdown-code-block-font-family);font-size:12px;color:var(--dsw-alias-label-primary);flex:1 1 0;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-tool-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.mc-dot-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:1px solid transparent;border-radius:999px;background:0 0;cursor:pointer}
.mc-dot-btn:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.mc-dot-btn:disabled{cursor:default;opacity:.6;border-color:transparent;background:0 0}
.mc-empty{padding:16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px}
.mc-error{padding:12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.mc-error p{margin:0}
.mc-error p.mc-error-hint{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.mc-error-actions{display:flex;justify-content:flex-end;margin-top:10px}
.mc-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:13px}
.mc-skill{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.mc-skill-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;background:0 0;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mc-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-skill-name{font-weight:600;font-size:14px;line-height:20px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-skill-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}
/* A row has no room for prose: let a long source label truncate instead of
   pushing the row's buttons past the right edge. */
.mc-source{font-size:11px;line-height:18px;color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
/* One sentence to confirm a row action: the shared modal chrome, sized down. */
.mc-confirm-dialog{width:min(420px,calc(100vw - 48px))}
.mc-search-dialog{width:min(520px,calc(100vw - 48px))}
.mc-confirm-body{display:flex;flex-direction:column;gap:12px;padding:14px 16px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.mc-confirm-body p{margin:0}
.mc-search-field{display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-primary)}
.mc-search-label-row{display:flex;align-items:baseline;justify-content:space-between;gap:4px 8px;flex-wrap:wrap}
.mc-search-label-row span{flex:1 1 260px;text-align:right;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.mc-search-field input,.mc-search-field textarea{box-sizing:border-box;width:100%;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px}
.mc-search-field textarea{min-height:116px;resize:vertical}
.mc-search-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* A directory has no spaces to break at, and the modal is where it can show in
   full: wrap it instead of truncating it the way a row's 来源 slot must. */
.mc-confirm-path{font-family:var(--dsw-font-markdown-code-block-font-family);word-break:break-all}
.mc-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.mc-skill-body{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 12px 12px}
/* 预设技能组：预设 id 是页签之下的分组小标题，不是新一级页签。 */
.mc-skill-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.mc-skill-group-title{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 2px}
.mc-tree{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:20px}
.mc-tree-row{display:flex;align-items:center;gap:8px;padding:3px 4px;border-radius:6px;cursor:pointer;min-width:0}
.mc-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mc-tree-indent{flex:none;width:16px}
.mc-tree-icon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}
.mc-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-tree-file:hover .mc-tree-name{color:var(--dsw-alias-label-primary)}
.mc-preview{width:min(720px,calc(100vw - 48px));max-height:min(560px,calc(100vh - 96px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-alias-bg-mask-drop)}
.mc-preview-body{overflow:auto;flex:1 1 auto;min-height:0;padding:14px 16px;color:var(--dsw-alias-label-primary)}
.mc-preview-body>pre,.mc-preview-plain{margin:0;font-family:var(--dsw-font-markdown-code-block-font-family);font-size:12px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.mc-tool-description{padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
/* C-3：表格外层滚动容器具名 region，键盘可进入并横向滚动；table 保最小宽度，
   窄容器里才会真的 scrollWidth > clientWidth，而外层 overflow:auto 保证页面根不横溢。 */
.mc-frontmatter-region{overflow:auto;max-inline-size:100%;container-type:inline-size}
.mc-frontmatter-region:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px}
.mc-frontmatter{width:100%;min-inline-size:320px;margin:0 0 20px;border-collapse:collapse;table-layout:fixed;font-size:13px;line-height:20px}
.mc-frontmatter th,.mc-frontmatter td{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;text-align:left}
/* C-3：表头定宽 130px + table-layout:fixed 时，超长不可断词会压进 td；
   允许表头任意换行并把最小宽度归零，长词在 130px 列内断行而不越界。 */
.mc-frontmatter th{width:130px;min-width:0;font-weight:500;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;white-space:normal}
.mc-frontmatter td{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
.mc-preview-hint{padding:16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
/* ---- 总览（OverviewPanel） ---- */
/* ---- 思考限制（GuardPanel） ---- */
/* v3 数据看板：真实计数板 + 可编辑阈值 */
.mc-guard-threshold-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mc-guard-threshold-edit-label{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
/* ---- v3 工具与技能（V3-c）：仅新增，不改动上面任何 .mc-* / .mc-guard-* ---- */
/* 常驻=中性 idle 圆点 + 蓝色 class 适配（官方 StateDot 无 info 状态） */
.v3-root .v3-dot--info[data-state='idle']{color:var(--v3-info)}
.v3-trow{cursor:pointer}
.v3-trow:focus-visible{outline:2px solid var(--v3-info);outline-offset:-2px}
.v3-racts{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}
button.v3-tag.v3-tag--act{color:var(--v3-t3);background:transparent}
button.v3-tag.v3-tag--act:hover{color:var(--v3-t1);background:var(--v3-panel-2)}
button.v3-tag{border:0;cursor:pointer;font-family:inherit}
button.v3-tag:disabled{opacity:.55;cursor:default}
.v3-group>summary:focus-visible{outline:2px solid var(--v3-info);outline-offset:-2px}
.v3-tools{display:flex;flex-direction:column}
/* ---- v3 catalog rework: 一行工具栏 / 能力诊断卡片 / 卡片向总览看齐 ---- */
.mc-cat-root{display:flex;flex-direction:column;gap:12px;min-width:0}
.mc-cat-root .v3-catstat{margin-bottom:0}
.mc-cat-bar{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0}
.mc-cat-bar>.mc-cat-actions{flex:none}
.mc-cat-bar .mc-cat-actions button{font-size:11px;white-space:nowrap}
.mc-cat-tabs{display:flex;align-items:center;flex:none;min-width:0}
.mc-cat-tabs .mc-main-tabs{border-bottom:0}
.mc-cat-search{flex:1 1 auto;width:auto;min-width:96px;max-width:220px;display:flex}
.mc-cat-search input{box-sizing:border-box;width:100%;height:28px;padding:0 9px;border:1px solid var(--v3-line-2);border-radius:var(--v3-r-sm);background:var(--v3-panel);color:var(--v3-t1);font:inherit;font-size:12.5px}
.mc-cat-search input:hover{border-color:var(--v3-line-2)}
.mc-cat-search input:focus-visible{outline:2px solid var(--v3-info);outline-offset:1px;border-color:transparent}
.mc-cat-actions{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto;flex-wrap:nowrap}
.mc-cat-diag{background:var(--v3-panel);border:1px solid var(--v3-line);border-radius:var(--v3-r-lg);overflow:hidden}
.mc-cat-diag>summary{display:flex;align-items:center;gap:8px;padding:11px 15px;min-height:38px;cursor:pointer;list-style:none;font-size:12.5px;font-weight:600;color:var(--v3-t2)}
.mc-cat-diag>summary::-webkit-details-marker{display:none}
.mc-cat-diag>summary:hover{background:var(--v3-panel-2)}
.mc-cat-diag[open]>summary{border-bottom:1px solid var(--v3-line)}
.mc-cat-diag-body{display:flex;flex-direction:column;gap:4px;padding:11px 15px;font-size:11.5px;line-height:18px;color:var(--v3-t3)}
.v3-root .v3-catgrid{gap:14px}
.v3-root .v3-group{border-radius:var(--v3-r-lg);margin-bottom:0}
.v3-root .v3-group>summary{padding:11px 15px;min-height:38px}
.v3-root .v3-tag{font-size:11px;height:19px;line-height:19px;padding:0 7px}
.v3-root .v3-trow{min-height:34px;font-size:12.5px}
/* 窄窗口（容器 <=520px）工具栏折行：页签+搜索一行、操作按钮换到下一行并允许
   自身折行。宽屏不触发，保持原来的单行 nowrap 布局。断点沿用 v3 容器语义
   （.v3-root 上的 container: v3 / inline-size），按内容宽度而非视口判断。 */
@container v3 (max-width:520px){
  .mc-cat-bar{flex-wrap:wrap}
  .mc-cat-bar>.mc-cat-tabs{flex:0 1 auto}
  .mc-cat-search{flex:1 1 120px;min-width:0;max-width:220px}
  .mc-cat-bar>.mc-cat-actions{flex:1 1 100%;flex-wrap:wrap;justify-content:flex-start;margin-left:0}
}
`
if (typeof document !== 'undefined' && document.querySelector(`style[data-css-id="${CSS_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.cssId = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** Reuse dsh's safe Markdown renderer in tool descriptions and skill files. */
function MarkdownPreview(props: {
  text: string
  t(key: CapabilityKey, params?: Record<string, unknown>): string
}): ReactElement {
  const { text, t } = props
  return (
    <MarkdownText
      text={text}
      labels={{
        code: {
          copyLabel: t('markdownCopy'),
          copiedLabel: t('markdownCopied'),
          toolbarLabels: {
            codeLabel: t('markdownCode'),
            wrapLabel: t('markdownWrap'),
            unwrapLabel: t('markdownUnwrap'),
          },
        },
        footnotes: t('markdownFootnotes'),
      }}
    />
  )
}

interface FrontmatterProperty {
  readonly name: string
  readonly value: string
}

/** Parse the simple property lines shown by GitHub above a Markdown document. */
function parseFrontmatterProperties(source: string): FrontmatterProperty[] {
  const properties: Array<{ name: string; value: string }> = []
  for (const line of source.split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_.-]+):(?:[ \t]*(.*))?$/.exec(line)
    if (field !== null) {
      properties.push({ name: field[1]!, value: field[2] ?? '' })
      continue
    }
    const continuation = /^\s+(.+)$/.exec(line)
    if (continuation !== null && properties.length > 0) {
      const last = properties[properties.length - 1]!
      last.value = last.value.length === 0 ? continuation[1]! : `${last.value}\n${continuation[1]}`
    }
  }
  return properties.map(property => ({ ...property, value: property.value.trimEnd() }))
}

/** Split YAML properties from the Markdown body. */
function splitMarkdownFrontmatter(text: string): { frontmatter?: FrontmatterProperty[]; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (match === null) return { body: text }
  return {
    frontmatter: parseFrontmatterProperties(match[1] ?? ''),
    body: text.slice(match[0].length),
  }
}

export function MarkdownFilePreview(props: {
  text: string
  t(key: CapabilityKey, params?: Record<string, unknown>): string
  /** 已有本地化标题/文件名（如预览文件的 relPath），用作表格滚动 region 的可访问名。 */
  label?: string
}): ReactElement {
  const { frontmatter, body } = splitMarkdownFrontmatter(props.text)
  return (
    <>
      {frontmatter !== undefined && frontmatter.length > 0 && (
        <div
          className="mc-frontmatter-region"
          role="region"
          tabIndex={0}
          aria-label={props.label ?? props.t('title')}
        >
          <table className="mc-frontmatter">
            <tbody>
              {frontmatter.map(property => (
                <tr key={property.name}>
                  <th scope="row">{property.name}</th>
                  <td>{property.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MarkdownPreview text={body} t={props.t} />
    </>
  )
}



/**
 * dsh's skill source labels, shown on rows this plugin cannot edit — so "why is
 * there no 编辑 button" has a visible answer. Labels that name one directory are
 * shown as that path; the rest name a category and go through the dictionary, so
 * none of dsh's internal labels (`custom`, `bundled`, …) reach the operator raw.
 */
const SOURCE_PATHS: Record<string, string> = {
  'user-dsh': '~/.dsh/skills',
  'user-agents': '~/.agents/skills',
  'project-dsh': '<project>/.dsh/skills',
  'project-agents': '<project>/.agents/skills',
}

/** Source labels that name no single directory; shown via `t`. */
const SOURCE_LABEL_KEYS: Partial<Record<string, CapabilityKey>> = {
  'custom': 'sourceCustom',
  'bundled': 'sourceBundled',
}

/** How to name a skill's source root on a row we cannot manage. */
function sourceLabel(
  source: string | undefined,
  t: (key: CapabilityKey, params?: Record<string, unknown>) => string,
): string {
  if (source === undefined) return t('skillUnmanaged')
  const path = SOURCE_PATHS[source]
  if (path !== undefined) return path
  const key = SOURCE_LABEL_KEYS[source]
  return key === undefined ? source : t(key)
}

// ── v3 catalog presentation (V3-c) ────────────────────────────────
//
// These two components are the v3 skin over the catalog data. They are pure and
// prop-driven (no hooks), deliberately mirroring `GuardPanel` / `PluginSectionView`
// so the settings suite — which has no DOM harness — can call them directly and
// walk the returned tree.

/** Tone of a class chip / state dot, mapped to the v3 `data-tone` palette. */
const CLASS_TONE: Record<CapabilityClass, 'info' | 'warn' | 'bad'> = {
  resident: 'info',
  'on-demand': 'warn',
  disabled: 'bad',
}
/** State-dot tone inside a row: resident=info, on-demand=warn, disabled=neutral. */
const CLASS_DOT_TONE: Record<CapabilityClass, string> = {
  resident: 'info',
  'on-demand': 'warn',
  disabled: '',
}

/**
 * 官方 StateDot 无 info 状态（B-2）：常驻=中性 idle + 蓝色 class 适配，按需=warning，
 * 禁用=idle（中性灰），不把常驻擅自改成绿色。业务 data-tone 仍由 CLASS_DOT_TONE 保留在外壳。
 */
const CLASS_DOT_STATE: Record<CapabilityClass, 'idle' | 'warning'> = {
  resident: 'idle',
  'on-demand': 'warning',
  disabled: 'idle',
}

export interface CatalogStatCell {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly hint?: ReactNode
}

/** The four-cell `.v3-catstat` strip at the top of the catalog page. */
export function CatalogStatStrip(props: { readonly cells: readonly CatalogStatCell[] }): ReactElement {
  return (
    <div className="v3-catstat" data-v3-catstat="true">
      {props.cells.map((cell, index) => (
        <div key={index}>
          <div className="v3-l">{cell.label}</div>
          <div className="v3-v">{cell.value}{cell.hint !== undefined ? <small>{cell.hint}</small> : null}</div>
        </div>
      ))}
    </div>
  )
}

/** One MCP-server group as the Tools tab shows it. */
export interface CatalogToolGroup {
  readonly server: string
  readonly tools: readonly CapabilityRow[]
}

export interface ToolGroupsViewProps {
  readonly t: CapabilitySectionInjected['t']
  readonly groups: readonly CatalogToolGroup[]
  readonly openServers: ReadonlySet<string>
  readonly busy: boolean
  readonly onToggle: (server: string) => void
  readonly onCycle: (ids: readonly string[], kind: 'tool') => void
  readonly onOpenDetail: (id: string) => void
  readonly onEditServer: (server: string) => void
  readonly onEditSearch: (id: string) => void
}

/** Strip a tool’s mcp__<server>__ prefix for display, like the old row did. */
function displayToolName(server: string, name: string): string {
  const prefix = 'mcp__' + server + '__'
  return server !== BUILT_IN_SERVER && name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/**
 * 保存反馈里怎么称呼这次被移动的能力。
 *
 * 单个用行上的显示名（工具去掉 `mcp__<server>__` 前缀，技能用自己的名字）；
 * 多个只报项数，复用 `toolCount` 的「N 个工具」——一条横幅讲一件事，逐条罗列
 * 在分组里点一下就能看到。批量移动只出现在 Tools 的服务器分组徽标上（技能的
 * 行徽标每次只带一个 id），所以这里按工具计数即可。
 */
function movedSubject(
  rows: readonly CapabilityRow[],
  ids: readonly string[],
  t: (key: CapabilityKey, params?: Record<string, unknown>) => string,
): string {
  if (ids.length > 1) return t('toolCount', { count: ids.length })
  const id = ids[0]!
  const row = rows.find(entry => entry.id === id)
  if (row === undefined) return id
  return row.server === undefined ? row.name : displayToolName(row.server, row.name)
}

/**
 * Two-column `.v3-catgrid` of native `<details>` server groups, each summary
 * carrying the chevron and the class-count tags, each row a 30px `.v3-trow`.
 * Pure: every interaction is a callback.
 */
export function ToolGroupsView(props: ToolGroupsViewProps): ReactElement {
  const { t, groups, openServers, busy } = props
  return (
    <div className="v3-catgrid" data-v3-catgrid="true">
      {groups.map(({ server, tools }) => {
        const open = openServers.has(server)
        const counts = CLASS_KEYS.map(cls => ({ cls, count: countByClass(tools, cls) }))
        return (
          <details key={server} className="v3-group" open={open} data-v3-group={server}>
            <summary onClick={(e: { preventDefault(): void }) => { e.preventDefault(); props.onToggle(server) }}>
              <svg className="v3-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="v3-gnm">{server === BUILT_IN_SERVER ? t('builtInGroup') : server}</span>
              <span className="v3-cnt">{tools.length}</span>
              <span className="v3-right">
                {counts.filter(({ count }) => count > 0).map(({ cls, count }) => (
                  <button
                    key={cls}
                    type="button"
                    className="v3-tag"
                    data-tone={CLASS_TONE[cls]}
                    disabled={busy}
                    title={t('cycleHint')}
                    onClick={(e: { stopPropagation(): void }) => {
                      e.stopPropagation()
                      props.onCycle(tools.filter(tool => tool.class === cls).map(tool => tool.id), 'tool')
                    }}
                  >
                    {t(CLASS_SHORT_KEYS[cls])} {count}
                  </button>
                ))}
                {server !== BUILT_IN_SERVER && (
                  <button
                    type="button"
                    className="v3-tag v3-tag--act"
                    disabled={busy}
                    onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); props.onEditServer(server) }}
                  >
                    {t('edit')}
                  </button>
                )}
              </span>
            </summary>
            {open && (
              <div className="v3-tools">
                {tools.map(tool => {
                  return (
                    <div
                      key={tool.id}
                      className="v3-trow"
                      title={t(CLASS_SHORT_KEYS[tool.class])}
                      role="button"
                      tabIndex={0}
                      aria-label={tool.name}
                      onClick={() => props.onOpenDetail(tool.id)}
                      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                        // Only the row itself responds. A key press on a child
                        // control (检索 / 档位 chips) must not bubble up and open
                        // the detail pane, nor have its own activation cancelled
                        // (Space would otherwise scroll the page).
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          props.onOpenDetail(tool.id)
                        }
                      }}
                    >
                      <span className="v3-dot" data-tone={CLASS_DOT_TONE[tool.class]} aria-hidden="true"><StateDot state={CLASS_DOT_STATE[tool.class]} size={9} {...(tool.class === 'resident' ? { className: 'v3-dot--info' } : {})} /></span>
                      <span className="v3-nm" title={tool.name}>{displayToolName(server, tool.name)}</span>
                      <span className="v3-racts">
                        {tool.mandatory && <span className="v3-tag">{t('mandatory')}</span>}
                        {tool.class === 'on-demand' && (
                          <button
                            type="button"
                            className="v3-tag v3-tag--act"
                            title={t('editSearchMetadata')}
                            onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); props.onEditSearch(tool.id) }}
                          >
                            {t('searchMetadataButton')}
                          </button>
                        )}
                        <button
                          type="button"
                          className="v3-tag"
                          data-tone={CLASS_TONE[tool.class]}
                          disabled={busy || tool.mandatory}
                          title={t('cycleHint')}
                          aria-label={t(CLASS_SHORT_KEYS[tool.class])}
                          onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); props.onCycle([tool.id], 'tool') }}
                        >
                          {t(CLASS_SHORT_KEYS[tool.class])}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </details>
        )
      })}
    </div>
  )
}

/**
 * Whether the document is visible. A hidden settings tab does no polling and
 * takes no re-reads; coming back is itself a revalidation trigger.
 */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState !== 'hidden')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

export function CapabilitySection(props: CapabilitySectionProps): JSX.Element {
  const { remote, t, mountError, subscribeSignals } = props
  // Paint a previous snapshot immediately when this page session has one; the
  // mount effect below still revalidates. `mountError` is the registration-time
  // diagnostic: when the mount itself failed there is no remote call to attempt,
  // so the page opens straight on the error with the retry path.
  const [state, setState] = useState<ViewState>(() => {
    if (mountError !== undefined) return { status: 'error', message: mountError }
    const cached = cachedSnapshot()
    return cached === undefined ? { status: 'loading' } : { status: 'ready', snapshot: cached }
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * 一次可见反馈（Toast）。只保留一个槽位：连点档位徽标时后来的反馈直接覆盖前
   * 一条，不排队、不叠成多条——一秒钟点三下不该留下三条横幅。
   *
   * `ok` 决定外观：成功保存带 `tone="success"` 的对勾；「分类未生效」沿用默认
   * 警示态（primitive 只有 success 一种 tone，省略即警示座）。
   * `seq` 用作 key：Toast 只在重新挂载时重播动画，同一句话连说两次也要动一次。
   */
  const [toast, setToast] = useState<{ text: string; ok: boolean; seq: number } | null>(null)
  const toastSeq = useRef(0)
  /**
   * 显示一条反馈并占用唯一的槽位。
   *
   * 覆盖面广、成功/失败都走这里：避免出现「状态已更新但屏幕上什么都没说」的
   * 空档（验收要求「看到保存反馈」），也保证同时只有一条横幅。
   */
  const showFeedback = useCallback((text: string, ok: boolean) => {
    toastSeq.current += 1
    setToast({ text, ok, seq: toastSeq.current })
  }, [])
  const [diagnostics, setDiagnostics] = useState<import('../store.ts').CapabilityDiagnostics | null>(null)
  const [retryMcp, setRetryMcp] = useState<string | null>(null)
  const queuedMcpRefresh = useRef<string | null>(null)
  const [openServers, setOpenServers] = useState<ReadonlySet<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'tools' | 'skills'>('tools')

  const reload = useCallback(async () => {
    if (mountError !== undefined) {
      // 注册阶段就没挂上：重试一次也只会在同一条路径上失败，保留诊断信息更诚实。
      setState({ status: 'error', message: mountError })
      return
    }
    try {
      setState(await loadSnapshot(remote).then(snapshot => ({ status: 'ready' as const, snapshot })))
    } catch (e) {
      // A stale list beats a blank panel: if rows are already on screen, keep
      // them and report the failed revalidate instead of replacing everything
      // with an error (the most common cause is the carrier dying, which the
      // reconnect signal and the version poll both recover from).
      setState(prev => prev.status === 'ready' ? prev : { status: 'error', message: String(e) })
      setNotice(String(e))
    }
  }, [remote, mountError])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (remote.getDiagnostics === undefined) return
    let cancelled = false
    void remote.getDiagnostics().then(result => {
      if (!cancelled && result.ok) setDiagnostics(result.value)
    }).catch(error => {
      console.warn('[capability-menu] diagnostics unavailable:', error)
    })
    return () => { cancelled = true }
  }, [remote])

  const [refreshing, setRefreshing] = useState(false)

  /**
   * Rebuild the host catalog, then re-read the classification list. Used after
   * registering a new source so the list reflects it without waiting for the
   * scheduler's debounce window.
   */
  const refreshCatalog = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setRetryMcp(null)
    try {
      await withTransientRetry(async () => unwrap(await remote.refresh(), 'capabilityPolicy.refresh'))
      await reload()
      if (remote.getDiagnostics !== undefined) {
        const result = unwrap(await remote.getDiagnostics(), 'capabilityPolicy.getDiagnostics')
        setDiagnostics(result)
      }
      setNotice(null)
    } catch (e) {
      console.error('[capability-menu] refresh failed:', e)
      setNotice(t('refreshFailed'))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, remote, reload, t])

  /**
   * A new MCP row is persisted before dsh applies it and registers its tools.
   * Wait for that asynchronous host reload instead of taking one snapshot too
   * early and requiring the operator to leave and reopen this settings page.
   */
  const refreshRegisteredMcp = useCallback(async (serverName: string) => {
    if (refreshing) {
      queuedMcpRefresh.current = serverName
      return
    }
    setRefreshing(true)
    setRetryMcp(null)
    try {
      await withTransientRetry(async () => unwrap(await remote.refresh(), 'capabilityPolicy.refresh'))
      const delays = [250, 500, 750, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000]
      const snapshot = await waitForMcpTools(remote, serverName, delays)
      if (snapshot !== undefined) {
        setState({ status: 'ready', snapshot: rememberSnapshot(snapshot) })
        setNotice(null)
        setRetryMcp(null)
      } else {
        // Keep the last known-good list and cache while the newly registered
        // server is still connecting; a later tools/change signal can refresh it.
        setNotice(t('mcpToolsPending', { name: serverName }))
        setRetryMcp(serverName)
      }
    } catch (e) {
      console.error('[capability-menu] MCP refresh failed:', e)
      setNotice(t('refreshFailed'))
      setRetryMcp(serverName)
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, remote, t])

  useEffect(() => {
    if (refreshing || queuedMcpRefresh.current === null) return
    const serverName = queuedMcpRefresh.current
    queuedMcpRefresh.current = null
    void refreshRegisteredMcp(serverName)
  }, [refreshing, refreshRegisteredMcp])

  const toggleServer = useCallback((server: string) => {
    setOpenServers(prev => {
      const next = new Set(prev)
      if (next.has(server)) next.delete(server)
      else next.add(server)
      return next
    })
  }, [])

  // ── Keeping the list fresh without a 刷新 button ─────────────────────────
  //
  // Four things can make what is on screen stale, and they are not the same
  // kind of event. A settings edit or a reconnect means the *host* may not have
  // reindexed yet, so those go through `refreshCatalog()` (rebuild, wait for it
  // to converge, then re-read) — the scheduler debounces `tools/change` /
  // `skills/change` by 200ms, so a bare re-read on the signal would read the
  // pre-rebuild catalog. A moved version number means the rebuild already
  // finished, so a plain `reload()` is enough.
  const visible = useDocumentVisible()
  const [pendingSignal, setPendingSignal] = useState(false)
  const seenVersion = useRef<number | undefined>(undefined)
  const pollFailures = useRef(0)
  // Read by the subscription callback, which is created once and must not be
  // re-created (that would re-subscribe on every keystroke in the filter box).
  const gate = useRef<RevalidateGate>({ visible: true, ready: false, busy: false, rebuilding: false })
  useEffect(() => {
    gate.current = { visible, ready: state.status === 'ready', busy, rebuilding: refreshing }
  })

  /**
   * A signal that the host catalog may have moved. Runs now when the page is
   * idle; otherwise parks until it is, so a signal that lands mid-click is
   * never dropped (and never repaints the row under the cursor).
   */
  const onExternalSignal = useCallback(() => {
    if (canRevalidate(gate.current)) void refreshCatalog()
    else setPendingSignal(true)
  }, [refreshCatalog])

  useEffect(() => {
    const dispose = subscribeSignals(onExternalSignal)
    return dispose
  }, [subscribeSignals, onExternalSignal])

  // The parked signal, flushed as soon as the page can take it.
  useEffect(() => {
    if (!pendingSignal) return
    if (!canRevalidate({ visible, ready: state.status === 'ready', busy, rebuilding: refreshing })) return
    setPendingSignal(false)
    void refreshCatalog()
  }, [pendingSignal, visible, state.status, busy, refreshing, refreshCatalog])

  // The one change nothing on the wire announces: a file dropped into an
  // already-registered skill directory reindexes the host through `skills/change`,
  // which is not in the forwarded-event allowlist. So ask for a cheap version
  // number and only re-read when it moves. Sampling restarts whenever this
  // effect does — mount, becoming visible, and going idle again — which is
  // exactly when a fresh answer is worth having.
  useEffect(() => {
    if (!visible || state.status !== 'ready' || busy || refreshing) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        // Bounded: a carrier that accepts the call and then goes quiet must end
        // up on the same retry path as one that refuses it, or the poll simply
        // stops for as long as the page stays visible and idle.
        const sampled = withDeadline(remote.catalogVersion(), POLL_SAMPLE_TIMEOUT_MS)
        const version = unwrap(await sampled, 'capabilityPolicy.catalogVersion')
        pollFailures.current = 0
        if (versionChanged(seenVersion.current, version)) {
          seenVersion.current = version
          await reload()
        }
      } catch {
        // A dead carrier is the expected failure here; reload() already keeps
        // the stale list and reports it. Back off instead of hammering.
        pollFailures.current += 1
      }
      if (!stopped) timer = setTimeout(() => void tick(), pollDelayMs(pollFailures.current))
    }
    timer = setTimeout(() => void tick(), 0)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [visible, state.status, busy, refreshing, remote, reload])

/**
   * 把一组 id 切到下一档：常驻 → 按需 → 禁用 → 常驻。
   *
   * 上游远程面没有 intent-level 的 `moveCapabilities`，因此写回走
   * `./view-model.ts` 的 `moveCapabilities`（`getConfig` 读出该 kind 的三档 →
   * 只动这几个 id → `updateConfig` 回写这一个 kind）。代价是读-改-写之间有一个
   * 极短窗口，另一个窗口的并发移动可能被覆盖；收益是上游一字不改，且行为与上游
   * 页面自己的整表写回完全一致。写入失败原样抛出（服务端先校验再提交）。
   */
  const cycleClass = useCallback(async (ids: readonly string[], kind: 'tool' | 'skill') => {
    if (ids.length === 0 || busy) return
    setBusy(true)
    // The move is decided from the rows already on screen, so the dot flips on
    // the click frame rather than after a round trip: how fast this feels must
    // not depend on how busy the server happens to be. The round trip below
    // only reconciles.
    const first = ids.map(id => state.status === 'ready' ? state.snapshot.rows.find(r => r.id === id)?.class : undefined)
      .find((c): c is CapabilityClass => c !== undefined)
    const from: CapabilityClass = first ?? 'on-demand'
    const to = nextTier(from)
    const moved = new Set(ids)
    setState(prev => prev.status === 'ready'
      ? {
          status: 'ready',
          snapshot: {
            rows: prev.snapshot.rows.map(row => moved.has(row.id)
              ? { ...row, class: to, classLabel: undefined }
              : row),
          },
        }
      : prev)
    try {
      await moveCapabilities(remote, { kind, ids, target: to })
      const next = await loadSnapshot(remote)
      setState({ status: 'ready', snapshot: next })
      // 通配规则（`mcp__x__*`）与 `server:<name>` 规则在分类器里排在刚写入的
      // 精确规则之前，所以「写了却没动」是可能发生的。回读后逐个核对，把被覆盖
      // 的条数说出来，而不是让一次点击静默失效。
      const overridden = overriddenIds(ids, to, next.rows)
      if (overridden.length > 0) {
        // 回读确认没过：说明更高优先级的规则赢了，不能报「已保存」。
        showFeedback(t('cycleOverridden', { count: overridden.length }), false)
      } else {
        // 回读确认过了才算保存成功——写入返回 ok 只代表服务端收下了，档位真正
        // 落在目标上是回读出来的。
        setNotice(null)
        showFeedback(t('cycleSaved', { name: movedSubject(next.rows, ids, t), tier: t(CLASS_SHORT_KEYS[to]) }), true)
      }
    } catch (e) {
      // 写入被拒（例如把 `meta_search` 移出常驻会被服务端 fail-loud 拒绝）不该把
      // 整页替换成错误：先回读真实档位撤掉上面的乐观翻转，再把原因报在页头，
      // 列表继续可用。
      setNotice(String(e))
      await reload()
    } finally {
      setBusy(false)
    }
  }, [remote, busy, state, t, reload, showFeedback])

  // v3 容器：`v3-root` 让 `v3-ui.ts` 的 @container 断点生效，深浅色 token 与
  // 执行保护页同一套。v3 样式表由外壳 thinking-throttle.tsx 单实例渲染（A-3），
  // 本页只提供容器类，加载/错误态因此也走同一套 token。
  return (
    <section className="v3-root mc-section">
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          {...(toast.ok ? { tone: 'success' as const } : {})}
          holdMs={4000}
          onDone={() => setToast(current => (current === toast ? null : current))}
        />
      )}
      {state.status === 'loading' && <p className="mc-empty">{t('desc')}…</p>}
      {state.status === 'error' && (
        <div className="mc-error">
          <p>{state.message}</p>
          {/* `gateway/internal: … failed: Failed to fetch` means the request never
              reached the server — the browser's carrier died, typically a tab
              still holding the dsh process that has since restarted. Say so,
              because "Failed to fetch" alone reads like a plugin bug. */}
          {state.message.includes('Failed to fetch') && <p className="mc-error-hint">{t('carrierFailureHint')}</p>}
          {/* The one recovery path: the automatic signals all need a snapshot to
              be on screen first, so a page that never got one has to be able to
              ask again. */}
          <div className="mc-error-actions">
            <Button size="sm" variant="outline" onClick={() => void reload()}>{t('retry')}</Button>
          </div>
        </div>
      )}
      {notice !== null && (
        <div className="mc-notice">
          <span>{notice}</span>
          {retryMcp !== null && (
            <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refreshRegisteredMcp(retryMcp)}>
              {t('retry')}
            </Button>
          )}
        </div>
      )}
      {state.status === 'ready' && <ReadyBody
        remote={remote}
        snapshot={state.snapshot}
        diagnostics={diagnostics}
        openServers={openServers}
        busy={busy}
        activeTab={activeTab}
        t={t}
        onTabChange={setActiveTab}
        onToggleServer={toggleServer}
        onCycle={cycleClass}
        onRefresh={() => void refreshCatalog()}
        onRefreshMcp={serverName => void refreshRegisteredMcp(serverName)}
        onNotice={setNotice}
      />}
    </section>
  )
}

function ReadyBody(props: {
  remote: CapabilityPolicyRemote
  snapshot: CapabilitySnapshot
  diagnostics: import('../store.ts').CapabilityDiagnostics | null
  openServers: ReadonlySet<string>
  busy: boolean
  activeTab: 'tools' | 'skills'
  t: CapabilitySectionInjected['t']
  onTabChange: (tab: 'tools' | 'skills') => void
  onToggleServer: (server: string) => void
  onCycle: (ids: readonly string[], kind: 'tool' | 'skill') => void
  /** Rebuild the host catalog and re-read it now. */
  onRefresh: () => void
  /** Wait for tools from a newly registered MCP server to appear. */
  onRefreshMcp: (serverName: string) => void
  /** Surface a one-line message in the section header. */
  onNotice: (message: string | null) => void
}): JSX.Element {
  const { remote, snapshot, diagnostics, openServers, busy, activeTab, t, onTabChange, onToggleServer, onCycle, onRefresh, onRefreshMcp, onNotice } = props
  const [updateStatus, setUpdateStatus] = useState<import('../store.ts').SelfUpdateStatus | null>(null)
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const [updateError, setUpdateError] = useState('')
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [sourceStepsOpen, setSourceStepsOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    const check = async (): Promise<void> => {
      try {
        const status = unwrap(await remote.checkSelfUpdate(), 'capabilityPolicy.checkSelfUpdate')
        if (!cancelled) setUpdateStatus(status)
      } catch (error) {
        if (!cancelled) console.warn('[capability-menu] update check failed:', error)
      }
    }
    const checkWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void check()
    }
    void check()
    document.addEventListener('visibilitychange', checkWhenVisible)
    const interval = window.setInterval(checkWhenVisible, 15 * 60_000)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', checkWhenVisible)
      window.clearInterval(interval)
    }
  }, [remote])
  const installUpdate = useCallback(async (source: 'registry' | 'local') => {
    if (updateStatus === null || !updateStatus.updateAvailable) return
    if (source === 'registry' ? !updateStatus.updatable : updateStatus.reason !== 'local') return
    setUpdatePhase('installing')
    setUpdateError('')
    try {
      if (source === 'local') {
        unwrap(await remote.switchSelfToNpm(updateStatus.latest), 'capabilityPolicy.switchSelfToNpm')
      } else {
        unwrap(await remote.installSelfUpdate(updateStatus.latest), 'capabilityPolicy.installSelfUpdate')
      }
      setUpdatePhase('done')
      setUpdateDialogOpen(false)
    } catch (error) {
      setUpdateError(String(error))
      setUpdatePhase('error')
    }
  }, [remote, updateStatus])
  const closeUpdateDialog = (): void => {
    if (updatePhase === 'installing') return
    setUpdateDialogOpen(false)
    setSourceStepsOpen(false)
    if (updatePhase === 'error') setUpdatePhase('idle')
  }
  /** Name filter, shared by both tabs: it narrows whichever list is shown. */
  const [filter, setFilter] = useState('')
  // Distinguishes "nothing to show" from "the filter matched nothing".
  const nameFilter = compileNameFilter(filter)
  const needle = nameFilter.needle
  // The two labels only the client can supply: both are localized or rendered,
  // and both are what an operator actually reads off the screen.
  const shownRows = filterRows(snapshot.rows, nameFilter, {
    builtIn: t('builtInGroup'),
    source: source => sourceLabel(source, t),
  })
  const { servers, skills } = groupRows(shownRows)
  // Grouping rules live in `skillGroups.ts` so they are testable; see that
  // module for why the preset split keys off `preset` and not `source`.
  const { presetSkills, presetGroups, projectSkills, globalSkills } = splitSkillGroups(skills)
  // Which sub-tab the Skills panel shows. Persists across top-tab switches.
  const [skillTab, setSkillTab] = useState<SkillTab>('global')
  // Per-tab statistics: the Tools tab counts tool rows; the Skills tab counts
  // the currently active global/project/preset sub-tab.
  const statRows = activeTab === 'tools'
    ? shownRows.filter(r => r.kind === 'tool')
    : skillTab === 'project' ? projectSkills : skillTab === 'preset' ? presetSkills : globalSkills
  const summary = CLASS_KEYS.map(cls => ({ cls, count: countByClass(statRows, cls) }))

  /** Tool-detail modal: one schema popup at a time. */
  const [toolDetail, setToolDetail] = useState<{
    id: string
    status: 'loading' | 'ready' | 'error'
    detail?: ToolDetail
    message?: string
  } | null>(null)
  /** Token for the open tool-detail request: closing/opening advances it so a
   *  late reply cannot re-open a pane the operator already dismissed. */
  const toolDetailRequest = useRef(0)

  /** Fetch and show the model-facing tool definition (name/description/parameters). */
  const openToolDetail = useCallback(async (id: string) => {
    const request = toolDetailRequest.current + 1
    toolDetailRequest.current = request
    setToolDetail({ id, status: 'loading' })
    try {
      const detail = unwrap(await remote.getDetail(id), 'capabilityPolicy.getDetail')
      // The modal may have been closed (or another tool opened) while this was
      // in flight; that reply is stale and must be discarded, not applied.
      if (toolDetailRequest.current !== request) return
      setToolDetail(detail === undefined
        ? { id, status: 'error', message: t('detailNotFound') }
        : { id, status: 'ready', detail })
    } catch (error) {
      if (toolDetailRequest.current !== request) return
      setToolDetail({ id, status: 'error', message: String(error) })
    }
  }, [remote, t])

  /** Current exposure rules and summaries from the live search index. */
  const [catalogDocs, setCatalogDocs] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; docs: CatalogDocs }
    | null
  >(null)
  const [catalogTab, setCatalogTab] = useState<'policy' | 'catalog'>('policy')
  const [summaryLimitDraft, setSummaryLimitDraft] = useState('')
  const [summaryLimitSaving, setSummaryLimitSaving] = useState(false)
  const [summaryLimitError, setSummaryLimitError] = useState<string | undefined>(undefined)
  const [searchEdit, setSearchEdit] = useState<{ status: 'loading' | 'ready' | 'error'; id: string; kind: 'tool' | 'skill'; metadata?: SearchMetadata; message?: string } | null>(null)
  const [searchDescription, setSearchDescription] = useState('')
  const [searchSaving, setSearchSaving] = useState(false)
  /** Token for the search-metadata read: closing advances it so a late reply
   *  cannot re-open a dialog the operator already dismissed (same guard the
   *  tool detail and the skill file preview use). */
  const searchEditRequest = useRef(0)
  const openSearchEdit = useCallback(async (id: string, kind: 'tool' | 'skill') => {
    const request = searchEditRequest.current + 1
    searchEditRequest.current = request
    setSearchEdit({ status: 'loading', id, kind })
    try {
      const metadata = unwrap(await remote.getSearchMetadata(id, kind), 'capabilityPolicy.getSearchMetadata')
      if (searchEditRequest.current !== request) return
      if (metadata === undefined) throw new Error(t('detailNotFound'))
      setSearchDescription(metadata.description ?? metadata.defaultDescription)
      setSearchEdit({ status: 'ready', id, kind, metadata })
    } catch (error) {
      if (searchEditRequest.current !== request) return
      setSearchEdit({ status: 'error', id, kind, message: String(error) })
    }
  }, [remote, t])
  const saveSearchEdit = useCallback(async () => {
    if (searchEdit === null || searchEdit.status !== 'ready') return
    setSearchSaving(true)
    try {
      unwrap(await remote.updateSearchMetadata({
        id: searchEdit.id,
        kind: searchEdit.kind,
        description: searchDescription,
      }), 'capabilityPolicy.updateSearchMetadata')
      setSearchEdit(null)
      onNotice(t('searchMetadataSaved'))
    } catch (error) {
      setSearchEdit({ ...searchEdit, message: String(error) })
    } finally {
      setSearchSaving(false)
    }
  }, [searchEdit, searchDescription, remote, onNotice, t])
  /** 注册能力 modal; its default sub-tab follows `activeTab`. */
  const [registerOpen, setRegisterOpen] = useState(false)
  /** 编辑 target; at most one is set. */
  const [editMcp, setEditMcp] = useState<McpLocation | undefined>(undefined)
  const [editSkill, setEditSkill] = useState<SkillLocation | undefined>(undefined)
  /**
   * Skill directories registered under the skill root. Only those can be
   * edited: a project or bundled skill has no row to repoint, so its row gets
   * no 编辑 button rather than a button that always fails.
   */
  const [editableSkills, setEditableSkills] = useState<ReadonlySet<string>>(new Set())

  // Reloaded when a skill's identity or root changes, so a skill registered or
  // removed elsewhere — and one just adopted — updates its own button. The
  // source is part of the key because 纳入管理 is exactly that: it flips
  // `user-agents`/`custom` to `user-dsh` without touching the id, and a
  // source flip is when a row must trade its 来源 label back for an 编辑 button.
  // Keyed on these two fields rather than the whole snapshot: every tier click
  // replaces the snapshot twice (optimistic, then reconcile) without touching
  // either, and depending on it would re-list the skill roots each time for no
  // reason.
  const skillSignature = skills.map(skill => `${skill.id}\u0000${skill.source ?? ''}`).join('\u0001')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = unwrap(await remote.listSkillLocations(), 'capabilityPolicy.listSkillLocations')
        // Matched on the name the skill declares, not the entry's own name: a
        // row is keyed by the former, and an entry whose symlink is named after
        // its source directory rather than the skill would otherwise never
        // match — leaving it without an 编辑 button though it is editable.
        if (!cancelled) setEditableSkills(new Set(rows.map(row => row.skillName ?? row.name)))
      } catch {
        // Leave the set empty.
      }
    })()
    return () => { cancelled = true }
  }, [remote, skillSignature])

  /** Open the 编辑 form for the MCP server behind a Tools-tab group header. */
  const openMcpEdit = useCallback(async (serverName: string) => {
    try {
      const rows = unwrap(await remote.listLocations(), 'capabilityPolicy.listLocations')
      const found = rows.find(row => row.serverName === serverName)
      if (found === undefined) {
        onNotice(t('notEditable'))
        return
      }
      setEditMcp(found)
    } catch (e) {
      onNotice(String(e))
    }
  }, [remote, t, onNotice])

  /**
   * Adopt a skill that dsh discovered from a user-level root this plugin reads
   * but does not manage: link its own directory into the user root so it becomes
   * an editable entry. The content is untouched.
   */
  const adoptSkill = useCallback(async (name: string) => {
    try {
      const entry = unwrap(await remote.adoptSkillLocation(name), 'capabilityPolicy.adoptSkillLocation')
      onNotice(t('skillAdopted', { path: entry }))
      onRefresh()
    } catch (e) {
      onNotice(String(e))
    }
  }, [remote, t, onNotice, onRefresh])

  /**
   * Open the 编辑 form for a managed skill entry. `name` is the skill's declared
   * name, which is what the row and the panel address it by — an entry is
   * matched on that rather than on its own, possibly different, name. A bare
   * name can exist in both the user root and a project root, so the row's source
   * decides which entry the click meant; without it we fall back to the first
   * match.
   */
  const openSkillEdit = useCallback(async (name: string, source?: string) => {
    try {
      const rows = unwrap(await remote.listSkillLocations(), 'capabilityPolicy.listSkillLocations')
      const wanted: 'project' | 'user' = PROJECT_SKILL_SOURCES.has(source ?? '') ? 'project' : 'user'
      const named = rows.filter(row => (row.skillName ?? row.name) === name)
      const found = named.find(row => row.root === wanted) ?? named[0]
      if (found === undefined) {
        onNotice(t('notEditable'))
        return
      }
      setEditSkill(found)
    } catch (e) {
      onNotice(String(e))
    }
  }, [remote, t, onNotice])

  /** Token for the catalog-docs read: closing advances it so a late reply
   *  cannot re-open the dialog the operator already dismissed. */
  const catalogDocsRequest = useRef(0)
  /** Fetch exposure rules, searchable summaries, and the description limit. */
  const openCatalogDocs = useCallback(async () => {
    const request = catalogDocsRequest.current + 1
    catalogDocsRequest.current = request
    setCatalogDocs({ status: 'loading' })
    try {
      const docs = unwrap(await remote.getCatalogDocs(), 'capabilityPolicy.getCatalogDocs')
      if (catalogDocsRequest.current !== request) return
      setSummaryLimitDraft(String(docs.summaryMaxChars))
      setSummaryLimitError(undefined)
      setCatalogDocs({ status: 'ready', docs })
    } catch (error) {
      if (catalogDocsRequest.current !== request) return
      setCatalogDocs({ status: 'error', message: String(error) })
    }
  }, [remote])

  const saveSummaryLimit = useCallback(async () => {
    if (catalogDocs?.status !== 'ready') return
    const value = Number(summaryLimitDraft)
    if (!/^\d+$/.test(summaryLimitDraft) || !Number.isSafeInteger(value) || value < 20) {
      setSummaryLimitError(t('summaryLimitInvalid'))
      return
    }
    setSummaryLimitSaving(true)
    setSummaryLimitError(undefined)
    try {
      unwrap(await remote.updateSummaryMaxChars(value), 'capabilityPolicy.updateSummaryMaxChars')
      const docs = unwrap(await remote.getCatalogDocs(), 'capabilityPolicy.getCatalogDocs')
      setCatalogDocs({ status: 'ready', docs })
      setSummaryLimitDraft(String(docs.summaryMaxChars))
      onNotice(t('summaryLimitSaved'))
    } catch (error) {
      setSummaryLimitError(String(error))
    } finally {
      setSummaryLimitSaving(false)
    }
  }, [catalogDocs, summaryLimitDraft, remote, onNotice, t])

  const skillDiagnosticCount = diagnostics === null ? 0
    : diagnostics.unavailableSkills.length + diagnostics.shadowedSkills.length + diagnostics.brokenPresets.length + diagnostics.unbrowseableSkills.length + diagnostics.undocumentedSkills.length

  // 三档分布就是这一屏的主结论：计数跟当前页签（Tools / Skills 子页签）一致。
  const classCount = (cls: CapabilityClass): number => summary.find(entry => entry.cls === cls)?.count ?? 0
  const statCells: CatalogStatCell[] = [
    { label: t('residentShort'), value: classCount('resident') },
    { label: t('onDemandShort'), value: classCount('on-demand') },
    { label: t('disabledShort'), value: classCount('disabled') },
  ]

  return (
    <div className="mc-cat-root">
      <div className="mc-cat-bar" data-v3-catalog-bar="true">
        <div className="mc-cat-tabs">
          <SegmentedTabs
            className="mc-main-tabs"
            items={[
              { value: 'tools', id: 'mc-tab-tools', panelId: 'mc-panel-tools', label: t('toolsGroup') },
              { value: 'skills', id: 'mc-tab-skills', panelId: 'mc-panel-skills', label: t('skillsGroup') },
            ]}
            value={activeTab}
            onChange={onTabChange}
            label={t('title')}
          />
        </div>
        {/* 一个搜索框同时服务两个页签：匹配行名，也匹配行所在分组（服务器 /
            来源目录 / 预设），输入「系统」能找到「系统内置」，输入 cordis 能找到
            该预设下的技能。什么都不需要筛选时不显示。 */}
        {snapshot.rows.length > 0 && (
          <div className="mc-cat-search">
            <Input
              type="search"
              value={filter}
              placeholder={t('filterPlaceholder')}
              aria-label={t('filterByName')}
              title={t('filterHint')}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
        )}
        <div className="mc-cat-actions">
          <Button size="sm" variant="outline" onClick={() => setRegisterOpen(true)}>
            {t('registerCapability')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openCatalogDocs()}>
            {t('viewCatalog')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => window.open('https://github.com/YAN3RA/dsh-thinking-guard', '_blank', 'noopener,noreferrer')}
          >
            {t('feedback')}
          </Button>
          {updateStatus?.updateAvailable && (updateStatus.updatable || updateStatus.reason === 'local') && updatePhase !== 'done' && (
            <Button type="button" variant="primary" size="sm" className="mc-update-check" title={t('updateAvailable', { version: updateStatus.latest })} disabled={updatePhase === 'installing'} onClick={() => setUpdateDialogOpen(true)}>
              {t('newVersion')}
            </Button>
          )}
        </div>
      </div>
      {(updatePhase === 'done' || (updateStatus?.updateAvailable && !updateStatus.updatable && updateStatus.reason !== 'local')) && (
        <div className="mc-update-status" role="status">
          <span>{updatePhase === 'done'
            ? t(updateStatus?.reason === 'local' ? 'pluginSwitched' : 'pluginUpdated')
            : t('updateAvailable', { version: updateStatus?.latest ?? '' })}</span>
          {updatePhase !== 'done' && updateStatus?.updateAvailable && !updateStatus.updatable && (
            <span>{t(updateStatus.reason === 'non-registry' ? 'pluginNonRegistrySource' : 'pluginProfileUnavailable')}</span>
          )}
        </div>
      )}
      <CatalogStatStrip cells={statCells} />
      {diagnostics !== null && skillDiagnosticCount > 0 && (
        <details className="mc-cat-diag" data-v3-catalog-diagnostics="true">
          <summary>
            {t('diagnosticTitle', { count: skillDiagnosticCount })}
          </summary>
          <div className="mc-cat-diag-body">
            {diagnostics.unavailableSkills.map((item, index) => <div key={`unavailable-${item.name}-${item.preset ?? ''}-${index}`}>{t('diagnosticUnavailable', { name: item.name, source: item.source, preset: item.preset ?? '' })}</div>)}
            {diagnostics.shadowedSkills.map((item, index) => <div key={`shadowed-${item.name}-${item.shadowedFrom}-${index}`}>{t('diagnosticShadowed', { name: item.name, winner: item.selectedFrom, hidden: item.shadowedFrom })}</div>)}
            {diagnostics.brokenPresets.map(item => <div key={`broken-${item.id}`}>{t('diagnosticBroken', { id: item.id, reason: item.reason })}</div>)}
            {diagnostics.unbrowseableSkills.map(item => <div key={`browse-${item.name}`}>{t('diagnosticUnbrowseable', { name: item.name, reason: item.reason })}</div>)}
            {diagnostics.undocumentedSkills.map(item => <div key={`undocumented-${item.name}`}>{t('diagnosticUndocumented', { name: item.name, summary: item.summary })}</div>)}
          </div>
        </details>
      )}

      <div role="tabpanel" id="mc-panel-tools" aria-labelledby="mc-tab-tools" hidden={activeTab !== 'tools'} className="mc-panel">
        <div className="mc-panel-inner">
          {servers.length === 0 ? (
            <p className="mc-empty">{needle === '' ? t('emptyTools') : t('filterNoMatch')}</p>
          ) : (
            <ToolGroupsView
              t={t}
              groups={servers}
              openServers={openServers}
              busy={busy}
              onToggle={onToggleServer}
              onCycle={onCycle}
              onOpenDetail={id => void openToolDetail(id)}
              onEditServer={server => void openMcpEdit(server)}
              onEditSearch={id => void openSearchEdit(id, 'tool')}
            />
          )}
        </div>
      </div>

      <div
        role="tabpanel"
        id="mc-panel-skills"
        aria-labelledby="mc-tab-skills"
        hidden={activeTab !== 'skills'}
        className={`mc-panel${skills.length > 0 ? ' mc-panel--tight' : ''}`}
      >
        <div className="mc-panel-inner">
          {skills.length === 0 ? (
            <p className="mc-empty">{needle === '' ? t('emptySkills') : t('filterNoMatch')}</p>
          ) : (
            <>
              <div className="mc-subtabs">
                <SegmentedTabs
                  items={[
                    { value: 'global', id: 'mc-skill-tab-global', panelId: 'mc-skill-panel-global', label: t('globalSkills') },
                    { value: 'project', id: 'mc-skill-tab-project', panelId: 'mc-skill-panel-project', label: t('projectSkills') },
                    { value: 'preset', id: 'mc-skill-tab-preset', panelId: 'mc-skill-panel-preset', label: t('presetSkills') },
                  ]}
                  value={skillTab}
                  onChange={setSkillTab}
                  label={t('skillsGroup')}
                />
              </div>
              {skillTab === 'global' ? (
                globalSkills.length > 0 ? (
                  <SkillList
                    skills={globalSkills}
                    remote={remote}
                    busy={busy}
                    t={t}
                    onCycle={onCycle}
                    editableSkills={editableSkills}
                    onEditSkill={openSkillEdit}
                    onAdoptSkill={adoptSkill}
                    onEditSearch={id => void openSearchEdit(id, 'skill')}
                  />
                ) : (
                  <p className="mc-empty">{t('emptyGlobalSkills')}</p>
                )
              ) : skillTab === 'project' ? (
                projectSkills.length > 0 ? (
                  <SkillList
                    skills={projectSkills}
                    remote={remote}
                    busy={busy}
                    t={t}
                    onCycle={onCycle}
                    editableSkills={editableSkills}
                    onEditSkill={openSkillEdit}
                    onAdoptSkill={adoptSkill}
                    onEditSearch={id => void openSearchEdit(id, 'skill')}
                  />
                ) : (
                  <p className="mc-empty">{t('emptyProjectSkills')}</p>
                )
              ) : (
                /* One section per preset (preset id as a heading) rather than a
                   fourth level of tabs: the id is provenance, not navigation. */
                presetGroups.length > 0 ? presetGroups.map(([preset, group]) => (
                  <div key={preset} className="mc-skill-group">
                    <div className="mc-skill-group-title">{preset}</div>
                    <SkillList
                      skills={group}
                      remote={remote}
                      busy={busy}
                      t={t}
                      onCycle={onCycle}
                      editableSkills={editableSkills}
                      onEditSkill={openSkillEdit}
                      onAdoptSkill={adoptSkill}
                      onEditSearch={id => void openSearchEdit(id, 'skill')}
                    />
                  </div>
                )) : <p className="mc-empty">{t('emptyPresetSkills')}</p>
              )}
            </>
          )}
        </div>
      </div>

      {toolDetail !== null && (
        <Modal
          open
          onClose={() => { toolDetailRequest.current += 1; setToolDetail(null) }}
          title={toolDetail.detail?.name ?? toolDetail.id}
          closeLabel={t('previewClose')}
        >
            {toolDetail.status === 'loading' && <div className="mc-preview-hint">…</div>}
            {toolDetail.status === 'error' && <div className="mc-preview-hint">{toolDetail.message}</div>}
            {toolDetail.status === 'ready' && toolDetail.detail !== undefined && (
              <div className="mc-preview-body">
                {toolDetail.detail.description.length > 0 && (
                  <div className="mc-tool-description">
                    <MarkdownPreview text={toolDetail.detail.description} t={t} />
                  </div>
                )}
                <pre className="mc-preview-plain">{JSON.stringify({
                  type: 'function',
                  function: {
                    name: toolDetail.detail.name,
                    parameters: toolDetail.detail.parameters,
                  },
                }, null, 2)}</pre>
              </div>
            )}
        </Modal>
      )}

      {updateDialogOpen && updateStatus?.updateAvailable && (
        <Modal
          open
          onClose={closeUpdateDialog}
          title={t('updateDialogTitle')}
          closeLabel={t('previewClose')}
          className="mc-update-dialog"
          footer={(
            <div className="mc-confirm-actions mc-update-actions">
                <Button type="button" variant="outline" size="sm" className="mc-update-cancel" disabled={updatePhase === 'installing'} onClick={closeUpdateDialog}>{t('cancel')}</Button>
                {updateStatus.reason === 'local' && (
                  <Button type="button" variant="outline" size="sm" disabled={updatePhase === 'installing'} onClick={() => setSourceStepsOpen(value => !value)}>
                    {t(sourceStepsOpen ? 'updateSourceStepsHide' : 'updateSourceSteps')}
                  </Button>
                )}
                <Button type="button" variant="primary" size="sm" disabled={updatePhase === 'installing'} onClick={() => void installUpdate(updateStatus.reason === 'local' ? 'local' : 'registry')}>
                  {t(updateStatus.reason === 'local' ? 'switchAndInstall' : 'installUpdate')}
                </Button>
            </div>
          )}
        >
          <p>{t('updateVersionComparison', { current: updateStatus.current, latest: updateStatus.latest })}</p>
          <p>{t(updateStatus.reason === 'local' ? 'updateLocalNote' : 'updateNpmNote')}</p>
          {updateStatus.reason === 'local' && sourceStepsOpen && (
            <div className="mc-update-steps">
              <p>{t('updateSourceStepsIntro')}</p>
              {updateStatus.sourcePath && <p className="mc-confirm-path">{updateStatus.sourcePath}</p>}
              <pre>{'git pull\npnpm install\npnpm run build'}</pre>
              <p>{t('updateSourceStepsRestart')}</p>
            </div>
          )}
          {updatePhase === 'installing' && <p role="status">{t('updatingPlugin')}</p>}
          {updatePhase === 'error' && <p className="mc-error" role="alert">{t('pluginUpdateFailed')} {updateError}</p>}
        </Modal>
      )}

      {searchEdit !== null && (
        <Modal
          open
          onClose={() => { searchEditRequest.current += 1; setSearchEdit(null) }}
          title={`${t('editSearchMetadata')} · ${searchEdit.id}`}
          closeLabel={t('previewClose')}
          className="mc-search-dialog"
        >
            {searchEdit.status === 'loading' && <div className="mc-preview-hint">…</div>}
            {searchEdit.status === 'error' && <div className="mc-preview-hint">{searchEdit.message}</div>}
            {searchEdit.status === 'ready' && (
              <div className="mc-confirm-body">
                <div className="mc-search-field">
                  <div className="mc-search-label-row">
                    <label htmlFor="mc-search-description">{t('searchDescription')}</label>
                    <span id="mc-search-description-note">{t('searchMetadataNote')}</span>
                  </div>
                  <textarea id="mc-search-description" aria-describedby="mc-search-description-note" value={searchDescription} maxLength={searchEdit.metadata?.maxChars} disabled={searchSaving} onChange={e => setSearchDescription(e.target.value)} />
                </div>
                <span className="mc-search-hint">{searchDescription.length}/{searchEdit.metadata?.maxChars}</span>
                {searchEdit.message !== undefined && <p className="mc-error">{searchEdit.message}</p>}
                <div className="mc-confirm-actions">
                  {searchDescription !== searchEdit.metadata?.defaultDescription && (
                    <Button size="sm" variant="ghost" disabled={searchSaving} title={t('searchMetadataRestoreHint')} onClick={() => setSearchDescription(searchEdit.metadata?.defaultDescription ?? '')}>{t('searchMetadataRestore')}</Button>
                  )}
                  <Button size="sm" variant="primary" disabled={searchSaving} onClick={() => void saveSearchEdit()}>{t('searchMetadataSave')}</Button>
                </div>
              </div>
            )}
        </Modal>
      )}

      {(registerOpen || editMcp !== undefined || editSkill !== undefined) && (
        /* LocationModal 保留上游表单行为，弹窗壳独立复用宿主 Modal；它的 `t` 收上游那份键全集；
           本页的 `t` 只声明自己用到的键，所以这里显式放宽一次：运行期是同一个宿主
           函数，上游组件只会取它自己那份字典里确实存在的键。 */
        <LocationModal
          remote={remote}
          t={(key, params) => t(key as CapabilityKey, params)}
          defaultKind={activeTab === 'skills' ? 'skill' : 'mcp'}
          {...editMcp !== undefined ? { editMcp } : {}}
          {...editSkill !== undefined ? { editSkill } : {}}
          onClose={() => {
            setRegisterOpen(false)
            setEditMcp(undefined)
            setEditSkill(undefined)
          }}
          onChanged={(notice, refreshMcpServer) => {
            if (refreshMcpServer !== undefined) onRefreshMcp(refreshMcpServer)
            else onRefresh()
            // A registration that lands in a project root is worth reporting:
            // whether it is visible depends on which project the session runs in.
            if (notice !== undefined) onNotice(notice)
          }}
        />
      )}

      {catalogDocs !== null && (
        <Modal
          open
          onClose={() => { catalogDocsRequest.current += 1; setCatalogDocs(null) }}
          title={t('viewCatalog')}
          closeLabel={t('previewClose')}
        >
            {catalogDocs.status === 'loading' && <div className="mc-preview-hint">…</div>}
            {catalogDocs.status === 'error' && <div className="mc-preview-hint">{catalogDocs.message}</div>}
            {catalogDocs.status === 'ready' && (
              <>
                <div className="mc-subtabs mc-catalog-tabs">
                  <SegmentedTabs
                    items={[
                      { value: 'policy', id: 'mc-cat-tab-policy', panelId: 'mc-cat-panel-policy', label: t('catalogPolicy') },
                      { value: 'catalog', id: 'mc-cat-tab-catalog', panelId: 'mc-cat-panel-catalog', label: t('catalogOnDemand') },
                    ]}
                    value={catalogTab}
                    onChange={setCatalogTab}
                    label={t('viewCatalog')}
                  />
                </div>
                {catalogTab === 'policy' ? (
                  <>
                    <p className="mc-catalog-path">{t('catalogPolicyNote')}</p>
                    <pre className="mc-preview-body">{catalogDocs.docs.policyYaml}</pre>
                  </>
                ) : (
                  <>
                    <div className="mc-catalog-toolbar">
                      <p className="mc-catalog-path">{t('catalogSearchNote', { count: catalogDocs.docs.onDemand.length })}</p>
                      <div className="mc-summary-setting">
                        <label htmlFor="mc-summary-limit">{t('summaryLimit')}</label>
                        <input
                          id="mc-summary-limit"
                          type="number"
                          min={20}
                          step={1}
                          value={summaryLimitDraft}
                          disabled={!catalogDocs.docs.searchSettingsEnabled || summaryLimitSaving}
                          onChange={e => { setSummaryLimitDraft(e.target.value); setSummaryLimitError(undefined) }}
                        />
                        <span>{t('summaryLimitUnit')}</span>
                        {catalogDocs.docs.searchSettingsEnabled && summaryLimitDraft !== String(catalogDocs.docs.summaryMaxChars) && (
                          <Button size="sm" variant="primary" disabled={summaryLimitSaving} onClick={() => void saveSummaryLimit()}>{t('searchMetadataSave')}</Button>
                        )}
                        {!catalogDocs.docs.searchSettingsEnabled && <span>{t('summaryLimitDisabled')}</span>}
                      </div>
                    </div>
                    {summaryLimitError !== undefined && <p className="mc-error mc-catalog-limit-error">{summaryLimitError}</p>}
                    <div className="mc-preview-body">
                      {catalogDocs.docs.onDemand.length === 0 && <p className="mc-preview-hint">{t('catalogEmpty')}</p>}
                      {catalogDocs.docs.onDemand.map(row => (
                        <div className="mc-search-result" key={`${row.kind}:${row.id}`}>
                          <div className="mc-search-result-head">
                            <span>{row.kind === 'tool' ? 'Tool' : 'Skill'}</span>
                            <span className="mc-search-result-id">{row.id}</span>
                          </div>
                          <p className="mc-search-result-summary">{row.summary}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
        </Modal>
      )}
    </div>
  )
}

/** One directory entry in a skill's file tree. */
interface SkillTreeState {
  /** Open directories keyed by `skillId` then joined relPath. */
  open: Record<string, boolean>
  /** Cached directory listings: `${skillId}:${relPath}` → entries. */
  dirs: Record<string, SkillFileEntry[]>
}

function projectRootForSkill(path: string): string {
  const marker = path.match(/^(.*)\/(?:\.dsh|\.agents)\/skills(?:\/.*)?$/)
  return marker?.[1] ?? path
}

function SkillList(props: {
  skills: CapabilityRow[]
  remote: CapabilityPolicyRemote
  busy: boolean
  t: CapabilitySectionInjected['t']
  onCycle: (ids: readonly string[], kind: 'skill') => void
  /** Names registered under the skill root; only those show a 编辑 button. */
  editableSkills: ReadonlySet<string>
  onEditSkill: (name: string, source?: string) => void
  onAdoptSkill: (name: string) => void
  onEditSearch: (id: string) => void
}): JSX.Element {
  const { skills, remote, busy, t, onCycle, editableSkills, onEditSkill, onAdoptSkill, onEditSearch } = props
  /** Skill id whose 纳入管理 is waiting for a confirmation click. */
  const [confirmAdopt, setConfirmAdopt] = useState<string | null>(null)
  const [openSkill, setOpenSkill] = useState<string | null>(null)
  const [tree, setTree] = useState<SkillTreeState>({ open: {}, dirs: {} })
  const [browseErrors, setBrowseErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ id: string; relPath: string; content?: string; error?: string } | null>(null)
  /** Token for the file-preview read: closing/switching advances it so a late
   *  read cannot re-open a preview the operator already closed. */
  const previewRequest = useRef(0)

  const toggleSkill = useCallback(async (id: string) => {
    if (openSkill === id) {
      setOpenSkill(null)
      return
    }
    setOpenSkill(id)
    const key = `${id}:`
    if (tree.dirs[key] === undefined) {
      try {
        const entries = unwrap(await remote.listSkillDir(id, ''), 'capabilityPolicy.listSkillDir')
        if (entries === undefined) setBrowseErrors(prev => ({ ...prev, [key]: t('skillBrowseUnavailable') }))
        else setTree(prev => ({ ...prev, dirs: { ...prev.dirs, [key]: entries } }))
      } catch (error) {
        console.error('[capability-menu] listSkillDir failed:', error)
        setBrowseErrors(prev => ({ ...prev, [key]: String(error) }))
      }
    }
  }, [openSkill, remote, t, tree.dirs])

  const toggleDir = useCallback(async (id: string, relPath: string) => {
    const openKey = `${id}:${relPath}`
    const nextOpen = !tree.open[openKey]
    setTree(prev => ({ ...prev, open: { ...prev.open, [openKey]: nextOpen } }))
    if (nextOpen) {
      const key = `${id}:${relPath}`
      if (tree.dirs[key] === undefined) {
        try {
          const entries = unwrap(await remote.listSkillDir(id, relPath), 'capabilityPolicy.listSkillDir')
          if (entries === undefined) setBrowseErrors(prev => ({ ...prev, [key]: t('skillBrowseUnavailable') }))
          else setTree(prev => ({ ...prev, dirs: { ...prev.dirs, [key]: entries } }))
        } catch (error) {
          console.error(`[capability-menu] listSkillDir ${key} failed:`, error)
          setBrowseErrors(prev => ({ ...prev, [key]: String(error) }))
        }
      }
    }
  }, [remote, t, tree.dirs, tree.open])

  const openPreview = useCallback(async (id: string, relPath: string) => {
    const request = previewRequest.current + 1
    previewRequest.current = request
    setPreview({ id, relPath })
    try {
      const content = unwrap(await remote.readSkillFile(id, relPath), 'capabilityPolicy.readSkillFile')
      // Closed or switched file while in flight: drop the stale content.
      if (previewRequest.current !== request) return
      if (content === undefined) {
        setPreview({ id, relPath, error: t('notPreviewable') })
      } else {
        setPreview({ id, relPath, content })
      }
    } catch (error) {
      if (previewRequest.current !== request) return
      setPreview({ id, relPath, error: String(error) })
    }
  }, [remote, t])

  const renderEntries = (entries: SkillFileEntry[] | undefined, id: string, base: string): JSX.Element[] | undefined => {
    if (entries === undefined) return undefined
    const indent = base.length === 0 ? 0 : base.split('/').length
    return entries.map(entry => {
      const relPath = base.length === 0 ? entry.name : `${base}/${entry.name}`
      if (entry.type === 'directory') {
        const openKey = `${id}:${relPath}`
        const open = tree.open[openKey] ?? false
        return (
          <div key={relPath}>
            <div
              className="mc-tree-row"
              role="button"
              tabIndex={0}
              onClick={() => void toggleDir(id, relPath)}
              onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void toggleDir(id, relPath)
                }
              }}
            >
              <span className="mc-tree-indent" style={{ width: 8 + indent * 16 }} />
              <span className="mc-tree-icon">
                <IconTriangleRightFill size={10} className={`mc-chevron${open ? ' mc-chevron--open' : ''}`} />
              </span>
              <span className="mc-tree-name">{entry.name}/</span>
            </div>
            {open && (
              <div style={{ marginTop: 2 }}>
                {renderEntries(tree.dirs[`${id}:${relPath}`], id, relPath) ?? (
                  <div className="mc-tree-row"><span className="mc-tree-indent" style={{ width: 20 + indent * 16 }} />…</div>
                )}
              </div>
            )}
          </div>
        )
      }
      return (
        <div
          key={relPath}
          className="mc-tree-row mc-tree-file"
          role="button"
          tabIndex={0}
          title={relPath}
          onClick={() => void openPreview(id, relPath)}
          onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              void openPreview(id, relPath)
            }
          }}
        >
          <span className="mc-tree-indent" style={{ width: 8 + indent * 16 }} />
          <span className="mc-tree-name">{entry.name}</span>
        </div>
      )
    })
  }

  /** The row the 纳入管理 confirmation is for, so the dialog can name it and
      show the directory the click will link. */
  const confirmAdoptRow = confirmAdopt === null ? undefined : skills.find(row => row.id === confirmAdopt)

  return (
    <>
      <div className="v3-catgrid">
        {skills.map(skill => {
          const open = openSkill === skill.id
          return (
            <details key={skill.id} className="v3-group" open={open} data-v3-skill={skill.id}>
              <summary onClick={(e: { preventDefault(): void }) => { e.preventDefault(); void toggleSkill(skill.id) }}>
                <svg className="v3-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="v3-gnm" title={skill.name}>{skill.name}</span>
                {PROJECT_SKILL_SOURCES.has(skill.source ?? '') && skill.path !== undefined && (
                  <span className="v3-cnt" title={skill.path}>{t('projectRootLabel', { path: projectRootForSkill(skill.path) })}</span>
                )}
                <span className="v3-right">
                  {skill.mandatory && <span className="v3-tag">{t('mandatory')}</span>}
                  {skill.class === 'on-demand' && (
                    <button type="button" className="v3-tag v3-tag--act" title={t('editSearchMetadata')} onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); onEditSearch(skill.id) }}>{t('searchMetadataButton')}</button>
                  )}
                  <button
                    type="button"
                    className="v3-tag"
                    data-tone={CLASS_TONE[skill.class as CapabilityClass]}
                    disabled={busy || skill.mandatory}
                    title={t('cycleHint')}
                    onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); onCycle([skill.id], 'skill') }}
                  >
                    {t(CLASS_SHORT_KEYS[skill.class as CapabilityClass])}
                  </button>
                  {!editableSkills.has(skill.id) && (skill.preset !== undefined
                    ? (
                      <span className="v3-tag" title={t('skillFromPresetHint')}>{t('skillFromPreset', { preset: skill.preset })}</span>
                    )
                    : ADOPTABLE_SKILL_SOURCES.has(skill.source ?? '')
                      ? (
                        <button type="button" className="v3-tag v3-tag--act" disabled={busy} title={t('adoptSkillHint')} onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); setConfirmAdopt(skill.id) }}>{t('adoptSkill')}</button>
                      )
                      : (
                        <span className="v3-tag" title={t('skillSourceHint')}>{t('skillSource', { source: sourceLabel(skill.source, t) })}</span>
                      ))}
                  {editableSkills.has(skill.id) && (
                    <button type="button" className="v3-tag v3-tag--act" disabled={busy} onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); onEditSkill(skill.id, skill.source) }}>{t('edit')}</button>
                  )}
                </span>
              </summary>
              {open && (
                <div className="mc-skill-body">
                  <div className="mc-tree">
                    {browseErrors[`${skill.id}:`] !== undefined && <div className="mc-preview-hint">{browseErrors[`${skill.id}:`]}</div>}
                    {renderEntries(tree.dirs[`${skill.id}:`], skill.id, '') ?? (
                      <div className="mc-tree-row">…</div>
                    )}
                  </div>
                </div>
              )}
            </details>
          )
        })}
      </div>
      {confirmAdopt !== null && (
        <Modal
          open
          onClose={() => setConfirmAdopt(null)}
          title={t('adoptSkillTitle', { name: confirmAdoptRow?.name ?? confirmAdopt })}
          closeLabel={t('previewClose')}
          className="mc-confirm-dialog"
        >
            <div className="mc-confirm-body">
              <p>{t('adoptSkillHint')}</p>
              {/* The row gave its 来源 slot to the 纳入管理 button, so the
                  directory is named here instead — the click needs a target. */}
              {confirmAdoptRow !== undefined && (
                <p className="mc-confirm-path">
                  {t('skillSource', { source: confirmAdoptRow.path ?? sourceLabel(confirmAdoptRow.source, t) })}
                </p>
              )}
              <div className="mc-confirm-actions">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const id = confirmAdopt
                    setConfirmAdopt(null)
                    onAdoptSkill(id)
                  }}
                >
                  {t('adoptSkill')}
                </Button>
              </div>
            </div>
        </Modal>
      )}

      {preview !== null && (
        <Modal
          open
          onClose={() => { previewRequest.current += 1; setPreview(null) }}
          title={preview.relPath}
          closeLabel={t('previewClose')}
        >
            {preview.content !== undefined ? (
              <div className="mc-preview-body">
                {/\.md$/i.test(preview.relPath) ? (
                  <MarkdownFilePreview text={preview.content} t={t} label={preview.relPath} />
                ) : (
                  <pre className="mc-preview-plain">{preview.content}</pre>
                )}
              </div>
            ) : (
              <div className="mc-preview-hint">{preview.error ?? '…'}</div>
            )}
        </Modal>
      )}
    </>
  )
}
