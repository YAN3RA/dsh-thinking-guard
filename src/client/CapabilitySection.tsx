/**
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
import { Button, Input, Modal, SegmentedTabs, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
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
} from './store.ts'
import { cachedSnapshot, loadSnapshot, rememberSnapshot, unwrap, waitForMcpTools, withTransientRetry } from './store.ts'

type ChevronIcon = (props: { size?: number; className?: string }) => ReactElement
const chevronIcons = ClientUiPrimitives as unknown as {
  IconTriangleRightFillMedium?: ChevronIcon
  IconTriangleRightFill14?: ChevronIcon
}
const IconTriangleRightFill: ChevronIcon = (chevronIcons.IconTriangleRightFillMedium ?? chevronIcons.IconTriangleRightFill14)!
import { LocationModal } from './LocationModal.tsx'
import { V3Styles } from './v3-ui.ts'
import { ADOPTABLE_SKILL_SOURCES, BUILT_IN_SERVER, PROJECT_SKILL_SOURCES } from '../constants.ts'
import {
  compileNameFilter,
  countByClass,
  filterRows,
  groupRows,
  splitSkillGroups,
  type SkillTab,
} from './skillGroups.ts'
import {
  POLL_SAMPLE_TIMEOUT_MS,
  canRevalidate,
  pollDelayMs,
  versionChanged,
  withDeadline,
  type RevalidateGate,
} from './revalidate.ts'

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
  /**
   * Per-capability call counts from the call index, keyed by `CapabilityRow.id`.
   *
   * Absent means "this caller has no corpus" — the page then shows `—` for the
   * zero-call cell and no per-row count. Never fabricate a zero (D-028).
   */
  usage?: ReadonlyMap<string, CatalogUsage> | undefined
}

export type CapabilitySectionProps = CapabilitySectionInjected

export type CapabilityKey =
  | 'nav'
  | 'title'
  | 'desc'
  | 'resident'
  | 'on-demand'
  | 'disabled'
  | 'tool'
  | 'skill'
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
  | 'filterByName'
  | 'filterHint'
  | 'filterNoMatch'
  | 'toolCount'
  | 'residentShort'
  | 'onDemandShort'
  | 'disabledShort'
  | 'catalogZeroCall'
  | 'catalogZeroCallHint'
  | 'cycleHint'
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
  | 'editMcp'
  | 'editSkillNamed'
  | 'edit'
  | 'save'
  | 'remove'
  | 'cancel'
  | 'confirmRemove'
  | 'confirmRemoveMcp'
  | 'confirmRemoveSkillLink'
  | 'confirmRemoveSkillDir'
  | 'confirmSaveAnyway'
  | 'saveConfirmRealDir'
  | 'register'
  | 'notEditable'
  | 'entryNotFound'
  | 'mcpServers'
  | 'skillDirs'
  | 'skillDirPath'
  | 'skillDirHint'
  | 'skillRoot'
  | 'skillRootUser'
  | 'skillRootProject'
  | 'skillRootHintUser'
  | 'skillRootHintProject'
  | 'skillProjectPath'
  | 'skillProjectPathHint'
  | 'skillRegisteredAt'
  | 'skillRepointed'
  | 'skillAdopted'
  | 'skillSource'
  | 'skillSourceHint'
  | 'skillFromPreset'
  | 'skillFromPresetHint'
  | 'githubImporting'
  | 'importing'
  | 'skillUnmanaged'
  | 'adoptSkill'
  | 'adoptSkillHint'
  | 'adoptSkillTitle'
  | 'sourceCustom'
  | 'sourceBundled'
  | 'serverName'
  | 'serverNameImmutable'
  | 'transport'
  | 'transportStdio'
  | 'transportHttp'
  | 'transportHintStdio'
  | 'transportHintHttp'
  | 'command'
  | 'args'
  | 'cwd'
  | 'env'
  | 'url'
  | 'headers'
  | 'headersHint'
  | 'timeout'
  | 'timeoutInvalid'
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
  | 'tabOverview'
  | 'tabGuard'
  | 'tabCatalog'
  | 'tabUsage'
  | 'overviewTitle'
  | 'overviewDesc'
  | 'overviewRefresh'
  | 'guardStateOn'
  | 'guardStateOff'
  | 'guardThresholds'
  | 'guardStatsTitle'
  | 'guardStatObservations'
  | 'guardStatObservationsHint'
  | 'guardStatOutcomes'
  | 'guardStatOutcomesHint'
  | 'guardStatReminders'
  | 'guardStatRemindersHint'
  | 'guardStatDenials'
  | 'guardStatDenialsHint'
  | 'guardStatsSince'
  | 'guardThresholdsEditableHint'
  | 'guardThresholdsFixedHint'
  | 'recentCalls'
  | 'tierSummary'
  | 'attention'
  | 'attentionNone'
  | 'attentionFailures'
  | 'attentionIdle'
  | 'attentionCoverage'
  | 'tierResident'
  | 'tierOnDemand'
  | 'tierDisabled'
  | 'guardTitle'
  | 'guardDesc'
  | 'guardBoundary'
  | 'guardReset'
  | 'guardScopeTitle'
  | 'guardScopeBody'
  | 'guardScopeFoot'
  | 'guardBoundaryLabel'
  | 'guardBoundaryShort'
  | 'guardThresholdHint'
  | 'guardFired'
  | 'guardPurposeB'
  | 'guardPurposeC'
  | 'guardFootCycle'
  | 'guardFootNoProgress'
  | 'guardSectionA'
  | 'guardSectionB'
  | 'guardSectionC'
  | 'guardModelLabel'
  | 'guardABody1'
  | 'guardABody2'
  | 'guardABody3'
  | 'guardBBody1'
  | 'guardBBody2'
  | 'guardBBody3'
  | 'guardCBody1'
  | 'guardCBody2'
  | 'guardCBody3'

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: CapabilitySnapshot }

const CLASS_KEYS = ['resident', 'on-demand', 'disabled'] as const
type CapabilityClass = (typeof CLASS_KEYS)[number]

/** Click-cycle order on machine values (displayed as On-demand → Disabled → Resident). */
const NEXT_CLASS: Record<CapabilityClass, CapabilityClass> = {
  'on-demand': 'disabled',
  disabled: 'resident',
  resident: 'on-demand',
}

/** i18n keys for the short display labels, keyed by the machine class value. */
const CLASS_SHORT_KEYS: Record<CapabilityClass, CapabilityKey> = {
  resident: 'residentShort',
  'on-demand': 'onDemandShort',
  disabled: 'disabledShort',
}

/** Scoped stylesheet: injected once at module scope, like every official bundle. */
const CSS_ID = 'capability-menu-section-css'
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
.mc-frontmatter{width:100%;margin:0 0 20px;border-collapse:collapse;table-layout:fixed;font-size:13px;line-height:20px}
.mc-frontmatter th,.mc-frontmatter td{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;text-align:left}
.mc-frontmatter th{width:130px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.mc-frontmatter td{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}
.mc-preview-hint{padding:16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
/* ---- 总览（OverviewPanel） ---- */
.mc-metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.mc-metric{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;min-width:0}
.mc-metric-label{font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.mc-metric-value{font-size:20px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums}
.mc-metric-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.mc-attention{margin-top:4px}
.mc-attention-title{margin:0 0 6px;font-size:13px;font-weight:600}
.mc-attention-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.mc-attention-item{font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.mc-attention-item--failures{color:var(--dsw-alias-state-warn-primary)}
.mc-attention-item--coverage{color:var(--dsw-alias-state-warn-primary)}
/* ---- 思考限制（GuardPanel） ---- */
.mc-guard-boundary{margin:0;padding:8px 12px;border-radius:8px;font-size:12px;line-height:18px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);
  color:var(--dsw-alias-label-secondary)}
/* v3 数据看板：真实计数板 + 可编辑阈值 */
.mc-guard-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;
  background:var(--dsw-alias-border-l2);border:1px solid var(--dsw-alias-border-l2);
  border-radius:8px;overflow:hidden;margin:10px 0}
.mc-guard-stat{background:var(--dsw-alias-bg-l1);padding:10px 12px}
.mc-guard-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}
.mc-guard-stat-value{font-size:19px;font-weight:600;line-height:1.15;
  font-variant-numeric:tabular-nums;font-family:var(--dsw-font-code)}
.mc-guard-stat-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-top:3px;line-height:1.35}
.mc-guard-stats-since{grid-column:1/-1;margin:0;padding:7px 12px;font-size:10.5px;
  color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-l2)}
.mc-guard-threshold-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mc-guard-threshold-edit-label{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.mc-guard-threshold-edit-input{width:150px;padding:3px 7px;border-radius:6px;font-size:12px;
  font-family:var(--dsw-font-code);color:inherit;background:transparent;
  border:1px solid var(--dsw-alias-border-l2)}
.mc-guard-threshold-edit-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.mc-guard-threshold-edit-input:disabled{opacity:.6}
.mc-guard-threshold-edit-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.mc-guard-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.mc-guard-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;
  background:var(--dsw-alias-bg-layer-2)}
.mc-guard-title{font-size:13px;font-weight:600}
.mc-guard-model{font-family:var(--dsw-font-code);font-size:11px;line-height:18px;
  color:var(--dsw-alias-label-tertiary);margin-left:auto}
.mc-guard-body{padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:8px}
.mc-guard-points{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.mc-guard-point{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mc-guard-thresholds{font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary);
  display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.mc-guard-thresholds-label{font-family:inherit}
.mc-guard-thresholds-value{font-family:var(--dsw-font-code);color:var(--dsw-alias-label-secondary)}
.mc-guard-switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;border:none;
  padding:0;cursor:pointer;background:var(--dsw-alias-state-idle-primary);transition:background .16s ease}
.mc-guard-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;
  border-radius:50%;background:#fff;transition:transform .16s ease}
.mc-guard-switch--on{background:var(--dsw-alias-state-business-primary)}
.mc-guard-switch--on::after{transform:translateX(14px)}
.mc-guard-switch:disabled{opacity:.5;cursor:not-allowed}
/* ---- v3 工具与技能（V3-c）：仅新增，不改动上面任何 .mc-* / .mc-guard-* ---- */
.v3-dot[data-tone='info']{background:var(--v3-info)}
.v3-trow{cursor:pointer}
.v3-trow:focus-visible{outline:2px solid var(--v3-info);outline-offset:-2px}
.v3-racts{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}
.v3-uses-bad{color:var(--v3-bad)}
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

function MarkdownFilePreview(props: {
  text: string
  t(key: CapabilityKey, params?: Record<string, unknown>): string
}): ReactElement {
  const { frontmatter, body } = splitMarkdownFrontmatter(props.text)
  return (
    <>
      {frontmatter !== undefined && frontmatter.length > 0 && (
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

/** Per-capability usage, when the caller has it (it lives in the call index). */
export interface CatalogUsage {
  readonly uses: number
  readonly failures?: number
}

/** Zero-call capability count when a usage map exists, else an honest dash. */
function zeroCallCount(
  usage: ReadonlyMap<string, CatalogUsage> | undefined,
  rows: readonly CapabilityRow[],
): number | string {
  if (usage === undefined) return '—'
  // A row absent from the aggregate simply had no calls inside the indexed corpus.
  // This is "zero observed", which is why the cell carries the 已索引 hint.
  return rows.filter(row => {
    const entry = usage.get(row.id)
    return entry === undefined || entry.uses === 0
  }).length
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
  /** Row-level call counts, when available. Absent = the row shows no count. */
  readonly usage?: ReadonlyMap<string, CatalogUsage> | undefined
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
 * Two-column `.v3-catgrid` of native `<details>` server groups, each summary
 * carrying the chevron and the class-count tags, each row a 30px `.v3-trow`.
 * Pure: every interaction is a callback.
 */
export function ToolGroupsView(props: ToolGroupsViewProps): ReactElement {
  const { t, groups, openServers, busy, usage } = props
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
                  const rowUsage = usage === undefined ? undefined : usage.get(tool.id)
                  return (
                    <div
                      key={tool.id}
                      className="v3-trow"
                      title={tool.classLabel}
                      role="button"
                      tabIndex={0}
                      aria-label={tool.name}
                      onClick={() => props.onOpenDetail(tool.id)}
                      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          props.onOpenDetail(tool.id)
                        }
                      }}
                    >
                      <span className="v3-dot" data-tone={CLASS_DOT_TONE[tool.class]} aria-hidden="true" />
                      <span className="v3-nm" title={tool.name}>{displayToolName(server, tool.name)}</span>
                      {rowUsage !== undefined && (
                        <span className="v3-uses">
                          {rowUsage.uses} 次
                          {rowUsage.failures !== undefined && rowUsage.failures > 0
                            ? <span className="v3-uses-bad"> · 失败 {rowUsage.failures}</span>
                            : null}
                        </span>
                      )}
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
                          title={tool.classLabel}
                          aria-label={tool.classLabel}
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
  const { remote, t, mountError, subscribeSignals, usage } = props
  // Paint a previous snapshot immediately when this page session has one; the
  // mount effect below still revalidates.
  const [state, setState] = useState<ViewState>(() => {
    const cached = cachedSnapshot()
    return cached === undefined ? { status: 'loading' } : { status: 'ready', snapshot: cached }
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** Transient confirmation text, shown through the official Toast primitive. */
  const [toast, setToast] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<import('./store.ts').CapabilityDiagnostics | null>(null)
  const [retryMcp, setRetryMcp] = useState<string | null>(null)
  const queuedMcpRefresh = useRef<string | null>(null)
  const [openServers, setOpenServers] = useState<ReadonlySet<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'tools' | 'skills'>('tools')

  const reload = useCallback(async () => {
    if (remote === undefined) {
      setState({ status: 'error', message: mountError ?? 'capabilityPolicy remote 未挂载' })
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
      if (remote !== undefined) await withTransientRetry(async () => unwrap(await remote.refresh(), 'capabilityPolicy.refresh'))
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
    if (remote === undefined) return
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

  /** Move one or more capability ids to the next class in the click cycle. */
  const cycleClass = useCallback(async (ids: readonly string[], kind: 'tool' | 'skill') => {
    if (ids.length === 0 || busy) return
    setBusy(true)
    // The move is decided from the rows already on screen, so the dot flips on
    // the click frame rather than after a round trip: how fast this feels must
    // not depend on how busy the server happens to be. The round trips below
    // only reconcile.
    const first = ids.map(id => state.status === 'ready' ? state.snapshot.rows.find(r => r.id === id)?.class : undefined)
      .find((c): c is CapabilityClass => c !== undefined)
    const from: CapabilityClass = first ?? 'on-demand'
    const to = NEXT_CLASS[from]
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
      const config = await withTransientRetry(async () => unwrap(await remote.getConfig(), 'capabilityPolicy.getConfig'))
      const key = kind === 'skill' ? 'skills' : 'tools'
      const set = config[key]
      const lists: Record<CapabilityClass, string[]> = {
        resident: [],
        'on-demand': [],
        disabled: [],
      }
      for (const cls of CLASS_KEYS) {
        const raw = set && typeof set === 'object' && !Array.isArray(set) ? (set as Record<string, unknown>)[cls] : undefined
        lists[cls] = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
      }
      // Remove moved ids from every list, then append to the destination list.
      for (const cls of CLASS_KEYS) {
        lists[cls] = lists[cls].filter(id => !ids.includes(id))
      }
      lists[to] = [...lists[to], ...ids]
      const nextLists: Record<string, string[]> = {}
      for (const cls of CLASS_KEYS) nextLists[cls] = lists[cls]
      // Unwrap like every other remote call: a rejected write (e.g. the
      // server's meta-tool fail-loud check) must surface as an error, not be
      // misread below as "overridden by a higher-priority rule".
      unwrap(await remote.updateConfig({ [key]: nextLists }), 'capabilityPolicy.updateConfig')
      const next = await loadSnapshot(remote)
      setState({ status: 'ready', snapshot: next })
      // Detect silently-overridden changes: a broader wildcard rule (or a hard
      // disabled rule) still wins over the exact id just pinned, so the class
      // did not move to `to`. Surface that instead of failing silently.
      const overridden = ids.filter(id => next.rows.find(r => r.id === id)?.class !== to)
      // Transient feedback: the user just clicked, and the outcome is only
      // readable for a moment. Keep the persistent notice slot for messages
      // that carry an action (the MCP retry below).
      setToast(overridden.length > 0 ? t('cycleOverridden', { count: overridden.length }) : null)
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    } finally {
      setBusy(false)
    }
  }, [remote, busy, state, t])

  return (
    <section className="mc-section">
      {toast !== null && (
        <Toast
          text={toast}
          tone="success"
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
        {...(usage === undefined ? {} : { usage })}
      />}
    </section>
  )
}

function ReadyBody(props: {
  remote: CapabilityPolicyRemote
  snapshot: CapabilitySnapshot
  diagnostics: import('./store.ts').CapabilityDiagnostics | null
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
  /** Per-capability call counts, when the shell could read the call index. */
  usage?: ReadonlyMap<string, CatalogUsage> | undefined
}): JSX.Element {
  const { remote, snapshot, diagnostics, openServers, busy, activeTab, t, onTabChange, onToggleServer, onCycle, onRefresh, onRefreshMcp, onNotice, usage } = props
  const [updateStatus, setUpdateStatus] = useState<import('./store.ts').SelfUpdateStatus | null>(null)
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

  /** Fetch and show the model-facing tool definition (name/description/parameters). */
  const openToolDetail = useCallback(async (id: string) => {
    setToolDetail({ id, status: 'loading' })
    try {
      const detail = unwrap(await remote.getDetail(id), 'capabilityPolicy.getDetail')
      setToolDetail(detail === undefined
        ? { id, status: 'error', message: t('detailNotFound') }
        : { id, status: 'ready', detail })
    } catch (error) {
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
  const openSearchEdit = useCallback(async (id: string, kind: 'tool' | 'skill') => {
    setSearchEdit({ status: 'loading', id, kind })
    try {
      const metadata = unwrap(await remote.getSearchMetadata(id, kind), 'capabilityPolicy.getSearchMetadata')
      if (metadata === undefined) throw new Error(t('detailNotFound'))
      setSearchDescription(metadata.description ?? metadata.defaultDescription)
      setSearchEdit({ status: 'ready', id, kind, metadata })
    } catch (error) {
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

  /** Fetch exposure rules, searchable summaries, and the description limit. */
  const openCatalogDocs = useCallback(async () => {
    setCatalogDocs({ status: 'loading' })
    try {
      const docs = unwrap(await remote.getCatalogDocs(), 'capabilityPolicy.getCatalogDocs')
      setSummaryLimitDraft(String(docs.summaryMaxChars))
      setSummaryLimitError(undefined)
      setCatalogDocs({ status: 'ready', docs })
    } catch (error) {
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

  // Per-capability call counts live in the call-index corpus. The settings shell
  // reads one page of calls and hands the aggregate down (see PluginSection), so
  // a row can show its real 调用次数 next to its policy. Absent = this caller has
  // no corpus: show `—` / no count rather than a fabricated zero (D-028).
  const catalogUsage = usage
  const classCount = (cls: CapabilityClass): number => summary.find(entry => entry.cls === cls)?.count ?? 0
  const statCells: CatalogStatCell[] = [
    { label: t('tierResident'), value: classCount('resident') },
    { label: t('tierOnDemand'), value: classCount('on-demand') },
    { label: t('tierDisabled'), value: classCount('disabled') },
    { label: t('catalogZeroCall'), value: zeroCallCount(catalogUsage, statRows), hint: t('catalogZeroCallHint') },
  ]

  return (
    <div className="v3-root mc-cat-root">
      <V3Styles />
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
              placeholder={t('filterByName')}
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
            onClick={() => window.open('https://github.com/PKUfudawei/dsh-capability-menu', '_blank', 'noopener,noreferrer')}
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
              usage={catalogUsage}
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
          onClose={() => setToolDetail(null)}
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
          onClose={() => setSearchEdit(null)}
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
        <LocationModal
          remote={remote}
          t={t}
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
          onClose={() => setCatalogDocs(null)}
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
    setPreview({ id, relPath })
    try {
      const content = unwrap(await remote.readSkillFile(id, relPath), 'capabilityPolicy.readSkillFile')
      if (content === undefined) {
        setPreview({ id, relPath, error: t('notPreviewable') })
      } else {
        setPreview({ id, relPath, content })
      }
    } catch (error) {
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
                <span className="v3-gnm">{skill.name}</span>
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
                    title={skill.classLabel}
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
          onClose={() => setPreview(null)}
          title={preview.relPath}
          closeLabel={t('previewClose')}
        >
            {preview.content !== undefined ? (
              <div className="mc-preview-body">
                {/\.md$/i.test(preview.relPath) ? (
                  <MarkdownFilePreview text={preview.content} t={t} />
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
