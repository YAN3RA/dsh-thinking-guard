window.__ModuleLoader__.load({ id: "dsh-thinking-guard", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

import { Context } from "@deepseek-ai/cordis";
import "react";
import { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import "@deepseek-ai/schemastery";
import { ScopeKey } from "@deepseek-ai/dsh-scope";
import { JsonSchemaNode } from "@deepseek-ai/dsh-tools";
//#region src/client/guard-remote.d.ts
/**
 * The Guard switches the settings page exposes.
 *
 * Mirror of `GuardSwitches` in `src/guard-state.ts`; the Host validates every
 * write with the same normalizer, so this schema only has to keep the wire
 * shape honest.
 */
interface GuardSwitches {
  readonly enabled: boolean;
  readonly duplicateDetection: boolean;
  readonly alternatingCycleDetection: boolean;
  readonly noProgressProtection: boolean;
  /** Consecutive-repeat counts that raise a reminder (1-5 ascending 2..50). */
  readonly repeatThresholds: readonly number[];
}
/** Fixed diagnostic reasons; the wire never carries free-form text. */
type GuardDiagnosticReason = 'invalid-patch' | 'not-mounted';
/** Mirror of `GuardDiagnostics` in `src/guard-state.ts`. */
interface GuardDiagnostics {
  readonly available: boolean;
  readonly reasons: readonly GuardDiagnosticReason[];
  readonly persistence: {
    readonly dirty: boolean;
    readonly lastErrorCode?: 'write-failed';
  };
}
/** Content-free Guard counters (mirror of `GuardStatsSnapshot` in guard-core). */
interface GuardStatsSnapshot {
  readonly observations: number;
  readonly reminders: {
    readonly repeat: number;
    readonly cycle: number;
  };
  readonly denials: number;
  readonly outcomes: {
    readonly success: number;
    readonly error: number;
    readonly cancelled: number;
  };
  readonly lastReminderAt?: number;
  readonly lastDenialAt?: number;
  readonly since: number;
}
/** The mounted Guard remote face as the browser sees it. */
interface GuardRemote {
  getGuard(): Promise<RemoteResult<GuardSwitches>>;
  updateGuard(change: Partial<GuardSwitches>): Promise<RemoteResult<void>>;
  getGuardDiagnostics(): Promise<RemoteResult<GuardDiagnostics>>;
  getGuardStats(): Promise<RemoteResult<GuardStatsSnapshot>>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$7468696e6b696e674775617264 {
    getGuard: () => Promise<RemoteResult<GuardSwitches>>;
    updateGuard: (change: Partial<GuardSwitches>) => Promise<RemoteResult<void>>;
    getGuardDiagnostics: () => Promise<RemoteResult<GuardDiagnostics>>;
    getGuardStats: () => Promise<RemoteResult<GuardStatsSnapshot>>;
  }
  interface TypertRemoteMap {
    'thinkingGuard/getGuard': () => Promise<RemoteResult<GuardSwitches>>;
    'thinkingGuard/updateGuard': (change: Partial<GuardSwitches>) => Promise<RemoteResult<void>>;
    'thinkingGuard/getGuardDiagnostics': () => Promise<RemoteResult<GuardDiagnostics>>;
    'thinkingGuard/getGuardStats': () => Promise<RemoteResult<GuardStatsSnapshot>>;
  }
  interface TypertRemoteNamespaceMap {
    thinkingGuard: TypertRemoteNamespace$7468696e6b696e674775617264;
  }
}
//#endregion
//#region src/client/GuardPanel.d.ts
/**
 * 本面板用到的全部文案键。
 *
 * 与旧插件同名键逐一对齐，因此 locale 字典里的中文说明可以直接沿用；不属于本页
 * 的键（tab 标签、总览、调用统计）不再出现在这里，也不再有任何外部 union 依赖。
 */
type GuardPanelKey = 'guardStatsTitle' | 'guardStatObservations' | 'guardStatObservationsHint' | 'guardStatObservationsZeroHint' | 'guardStatOutcomes' | 'guardStatOutcomesHint' | 'guardStatReminders' | 'guardStatRemindersHint' | 'guardStatDenials' | 'guardStatDenialsHint' | 'guardThresholds' | 'guardThresholdSave' | 'guardThresholdDraftHint' | 'guardThresholdHint' | 'guardBoundaryShort' | 'guardScopeTitle' | 'guardScopeBody' | 'guardScopeFoot' | 'guardSectionA' | 'guardSectionB' | 'guardSectionC' | 'guardABody1' | 'guardABody2' | 'guardABody3' | 'guardBBody1' | 'guardBBody2' | 'guardBBody3' | 'guardCBody1' | 'guardCBody2' | 'guardCBody3' | 'guardPurposeB' | 'guardPurposeC' | 'guardFired' | 'guardFootCycle' | 'guardFootNoProgress';
//#endregion
//#region src/client/guard-section.d.ts
/**
 * 本页文案键：页面级（nav / title / desc 与状态行）+ 面板自己的键。
 *
 * 面板键直接复用 `GuardPanelKey`，因此 locale 字典里 guard* 的中文说明与旧插件
 * 逐字一致。
 */
type GuardSectionKey = 'nav' | 'title' | 'desc' | 'guardStatusLoading' | 'guardStatusAvailable' | 'guardStatusUnavailable' | 'guardStatusUnknown' | 'guardDiagInvalidPatch' | 'guardDiagNotMounted' | 'guardDiagPersistenceDirty' | 'guardDiagWriteFailed' | 'guardReadFailed' | 'guardWriteFailed' | 'guardSaveUnconfirmed' | 'guardSavedSwitch' | 'guardSavedThresholds' | 'guardSwitchOn' | 'guardSwitchOff' | GuardPanelKey;
/** Props injected by the `settings.section` registration (see index.ts). */
interface GuardSectionInjected {
  remote: GuardRemote;
  t: (key: GuardSectionKey) => string;
}
//#endregion
//#region src/registry.d.ts
/**
 * Kinds of capability the catalog can hold.
 * - `tool`:   action capability — executes a concrete action (an MCP tool or a
 *   harness-native tool cataloged under the reserved `built-in` server).
 * - `skill`:  action capability — loads the method/instructions for a task.
 */
type CapabilityKind = 'tool' | 'skill';
/**
 * Stable invocation actions a capability can declare. Each kind maps to one
 * canonical action; a new kind only deserves a new value here when it
 * introduces a new action (not a new flavor of an existing one).
 * `execute` = run the concrete action (a tool — MCP or native — via `ctx.tools.execute`);
 * `load`    = load the method/instructions (a skill).
 */
type CapabilityAction = 'execute' | 'load';
/** Capability-stable origin metadata used by search filters and detail views. */
interface CapabilityOrigin {
  /** Human/namespace label: an MCP server name, the reserved `built-in` for native tools, or a skill provider. */
  readonly provider: string;
  /** Server namespace, present only for `kind: 'tool'` (`built-in` for native tools). */
  readonly serverName?: string;
  /** Local skill path, present only for `kind: 'skill'`. */
  readonly path?: string;
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string;
  /**
   * Agent preset whose standing scope this skill was collected from, present
   * only for skills that live in a preset layer.
   *
   * A preset's own `skill-filesystem` mounts its `skills/` directory through
   * `customSkillDirs`, so such a skill is labelled `source: 'custom'` — the
   * same label a user-configured `customSkillDirs` entry gets. The source
   * label therefore cannot tell the two apart; this field is what the
   * management surface groups on ("预设技能" vs. a user's custom root).
   */
  readonly preset?: string;
}
/** Objective and subjective usage statistics, written back from `tools/result`. */
interface CapabilityStats {
  readonly uses: number;
  readonly successes: number;
  readonly failures: number;
  readonly totalMs: number;
  readonly lastUsedAt?: number;
}
/** One indexed capability. */
interface CapabilityRecord {
  /** Stable identifier: `mcp__<server>__<raw>`, a native tool name, or a bare skill name. */
  readonly id: string;
  readonly kind: CapabilityKind;
  /** The canonical invocation action(s) this capability exposes. */
  readonly actions: readonly CapabilityAction[];
  /** Model-facing name (the tool name or skill name without prefix). */
  readonly name: string;
  readonly description: string;
  /** Skill-only extra routing guidance. */
  readonly whenToUse?: string;
  readonly origin: CapabilityOrigin;
  /** Full parameter schema (MCP inputSchema / empty object for skills). */
  readonly parameters: JsonSchemaNode;
  readonly invocation: {
    modelInvocable: boolean;
    userInvocable: boolean;
  };
  readonly tags: readonly string[];
  readonly stats: CapabilityStats;
  /** Token-trimmed short description used by `meta_search` list mode. */
  readonly summary: string;
}
/** Lightweight list-mode projection of one capability (no full schema). */
interface CapabilitySummary {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly summary: string;
  readonly server?: string;
  /** Skill source root label, present only for `kind: 'skill'`. */
  readonly source?: string;
  /** Agent preset id, present only for skills collected from a preset scope. */
  readonly preset?: string;
  readonly path?: string;
  readonly tags: readonly string[];
  readonly success_rate?: number;
  readonly uses: number;
}
/** Full detail projection, including the parameter schema. */
interface CapabilityDetail {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly actions: readonly CapabilityAction[];
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly parameters: JsonSchemaNode;
  readonly output?: JsonSchemaNode;
  readonly origin: CapabilityOrigin;
  readonly tags: readonly string[];
  readonly stats: CapabilityStats;
}
/** Search filter options. */
interface MetaSearchOptions {
  readonly kind?: CapabilityKind | 'all';
  readonly server?: string | undefined;
  readonly tag?: string | undefined;
  /** Maximum number of results to return. */
  readonly maxResults?: number;
  /** Zero-based result offset. */
  readonly offset?: number;
  /**
   * Viewing scope. Retained for caller ergonomics and optional authorization
   * checks, but the policy does NOT use it to filter visibility — On-demand
   * capabilities must remain searchable regardless of the caller's projection.
   */
  readonly scope?: ScopeKey | undefined;
  /** Query string for keyword matching; only matches are returned, with exact id/name first. */
  readonly query?: string;
  /** Exact capability id. */
  readonly id?: string;
  /** Whether to include the full body for skills in `getDetail` (default false). */
  readonly detailIncludesBody?: boolean;
}
/** Runtime detail resolution context. */
interface MetaLookupContext {
  readonly cwd?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly scope?: ScopeKey | undefined;
}
/** One direct child in a skill directory listing. */
interface SkillDirEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}
interface CapabilityDiagnostics {
  readonly unavailableSkills: readonly {
    readonly name: string;
    readonly source: string;
    readonly preset?: string;
  }[];
  readonly shadowedSkills: readonly {
    readonly name: string;
    readonly selectedFrom: string;
    readonly shadowedFrom: string;
  }[];
  readonly brokenPresets: readonly {
    readonly id: string;
    readonly reason: string;
  }[];
  readonly unbrowseableSkills: readonly {
    readonly name: string;
    readonly reason: string;
  }[];
  readonly undocumentedSkills: readonly {
    readonly name: string;
    readonly summary: string;
  }[];
  readonly catalog: {
    readonly state: 'empty' | 'ready';
    readonly count: number;
  };
}
/** User-owned text used only for discovery; the provider's definition stays intact. */
interface SearchMetadata {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly defaultDescription: string;
  readonly description?: string;
  readonly maxChars: number;
}
interface SearchMetadataUpdate {
  readonly id: string;
  readonly kind: CapabilityKind;
  /** Empty or provider-identical text restores the provider-derived description. */
  readonly description: string;
}
/** The `ctx.capability` service surface. */
interface CapabilityService {
  /** Enumerate the current catalog (optionally filtered). */
  search(options?: MetaSearchOptions): CapabilitySummary[];
  /**
   * Resolve one record by id, or undefined. Pass `kind` when the caller knows
   * it (tools and skills may share a bare name, e.g. a skill named `bash`);
   * without `kind` a same-name tool/skill pair resolves to undefined.
   */
  get(id: string, kind?: CapabilityKind): CapabilityRecord | undefined;
  /**
   * Resolve one record's full detail (schema, output; skill body optional).
   * `kind` has the same disambiguation semantics as {@link get}.
   */
  getDetail(id: string, kind?: CapabilityKind, context?: MetaLookupContext): Promise<CapabilityDetail | undefined>;
  /**
   * List a skill's directory children (one level deep). The directory is
   * resolved from the skill's own provider path, never from caller input;
   * `relPath` (optional, relative to the skill root) descends into a child
   * directory.
   */
  listSkillDir(id: string, relPath?: string): Promise<SkillDirEntry[] | undefined>;
  /**
   * Read a text file inside a skill's directory, addressed by a relative path
   * that is resolved against and confined to the skill root. Binary files
   * (content containing NUL) return undefined.
   */
  readSkillFile(id: string, relPath: string): Promise<string | undefined>;
  /**
   * Indexed skills whose provider exposes a filesystem directory, as
   * `{ name, skillDir }` where `skillDir` is `<entryDir>/<name>`.
   */
  skillDirs(): ReadonlyArray<{
    readonly name: string;
    readonly skillDir: string;
    readonly source?: string;
  }>;
  diagnostics(): CapabilityDiagnostics;
  /** Return the current number of indexed capabilities. */
  size(): number;
  /**
   * Monotonic catalog version. It advances only when a rebuild finishes
   * applying, so a caller that compares two samples learns "the catalog really
   * moved" without re-reading the rows — which is what lets the management UI
   * poll a single number instead of `classifyAll` on every tick.
   *
   * Not guaranteed to increase across a plugin restart (the counter is
   * in-process), so compare with `!==`, never with `>`.
   */
  version(): number;
  /**
   * Rebuild the catalog from the current tool/skill registries; resolves when
   * done. In production the registry rebuilds automatically on `tools/change`
   * / `skills/change`; this public handle is for tests and external orchestrators
   * that want to force a rebuild.
   */
  refresh(): Promise<void>;
  /**
   * Ask for a rebuild without waiting for it. The scheduler coalesces bursts,
   * so a caller that changes something repeatedly (the management UI cycling
   * a classification) triggers one rebuild, not one per call.
   */
  requestRefresh(): void;
  getSearchMetadata(id: string, kind: CapabilityKind): SearchMetadata | undefined;
  updateSearchMetadata(input: SearchMetadataUpdate): Promise<void>;
  summaryMaxChars(): number;
  searchSettingsEnabled(): boolean;
  updateSummaryMaxChars(value: number): Promise<void>;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    capability: CapabilityService;
  }
}
//#endregion
//#region src/client/remote.d.ts
/** Read-only row: one capability's Resident/On-demand/Disabled classification. */
interface CapabilityRow {
  readonly id: string;
  readonly kind: 'tool' | 'skill';
  readonly name: string;
  readonly server?: string;
  /** Skill source root label (`project-dsh`/`user-agents`/…), present only for skills. */
  readonly source?: string;
  /**
   * Agent preset id, present only for skills that live in a preset's own layer.
   * The source label is `custom` for these as well, so this is what tells a
   * preset skill apart from one in a user-configured `customSkillDirs` root.
   */
  readonly preset?: string;
  /** The skill's own directory on disk, present only for skills whose provider has one. */
  readonly path?: string;
  readonly class: 'resident' | 'on-demand' | 'disabled';
  readonly classLabel?: string;
  readonly mandatory: boolean;
}
/** Current exposure rules and the live on-demand search summaries. */
interface CatalogDocs {
  /** Effective rule configuration in YAML. */
  readonly policyYaml: string;
  readonly summaryMaxChars: number;
  readonly searchSettingsEnabled: boolean;
  readonly onDemand: readonly {
    readonly id: string;
    readonly kind: 'tool' | 'skill';
    readonly summary: string;
    readonly server?: string;
  }[];
}
interface SelfUpdateStatus {
  readonly current: string;
  readonly latest: string;
  readonly updateAvailable: boolean;
  readonly updatable: boolean;
  readonly reason?: 'local' | 'non-registry' | 'profile-unavailable';
  readonly sourcePath?: string;
}
/** One direct child in a skill directory listing. */
interface SkillFileEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}
/** Full detail projection of one capability (schema, description, stats). */
interface ToolDetail {
  readonly id: string;
  readonly kind: 'tool' | 'skill';
  readonly actions: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly skillContent?: string;
  readonly parameters: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly origin: {
    readonly provider: string;
    readonly serverName?: string;
    readonly path?: string;
    readonly source?: string;
    readonly preset?: string;
  };
  readonly tags: readonly string[];
  readonly stats: {
    readonly uses: number;
    readonly successes: number;
    readonly failures: number;
    readonly totalMs: number;
    readonly lastUsedAt?: number;
  };
}
/** One MCP server declared in the patch file. */
interface McpLocation {
  readonly id: string;
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly disabled: boolean;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly toolCallTimeoutMs?: number;
}
/** One skill entry under a managed skill root (the user root or a project's). */
interface SkillLocation {
  /** The entry's own name under `entryDir`; what update and remove address. */
  readonly name: string;
  /** The name the skill declares in its `SKILL.md` — dsh's identity for it, and what a capability row is named. */
  readonly skillName?: string;
  readonly path: string;
  readonly linked: boolean;
  readonly valid: boolean;
  /** `user` for the default root, `project` for a project's own skill root. */
  readonly root: 'user' | 'project';
  /** The skills directory holding the entry; pass it back to update or remove. */
  readonly entryDir: string;
  /** The directory the entry points at, with symlinks resolved. */
  readonly target?: string;
}
interface SkillUpdateStatus {
  readonly status: 'current' | 'available' | 'modified' | 'unmanaged';
  readonly name: string;
  readonly entryDir: string;
  readonly sourceUrl?: string;
  readonly installedRevision?: string;
  readonly latestRevision?: string;
  readonly changedFiles?: readonly string[];
  readonly compareUrl?: string;
  readonly gitManaged?: boolean;
}
/** Input for registering a new MCP server. */
interface McpInput {
  readonly serverName: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly toolCallTimeoutMs?: number;
}
/** Input for editing a declared server (`serverName` is immutable). */
type McpUpdateInput = Omit<McpInput, 'serverName'>;
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6361706162696c697479506f6c696379 {
    checkSelfUpdate: () => Promise<RemoteResult<SelfUpdateStatus>>;
    installSelfUpdate: (version: string) => Promise<RemoteResult<void>>;
    switchSelfToNpm: (version: string) => Promise<RemoteResult<void>>;
    getConfig: () => Promise<RemoteResult<Record<string, unknown>>>;
    updateConfig: (partial: Record<string, unknown>) => Promise<RemoteResult<void>>;
    classifyAll: () => Promise<RemoteResult<CapabilityRow[]>>;
    getDiagnostics: () => Promise<RemoteResult<CapabilityDiagnostics>>;
    refresh: () => Promise<RemoteResult<void>>;
    catalogVersion: () => Promise<RemoteResult<number>>;
    listSkillDir: (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>;
    readSkillFile: (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>;
    getDetail: (id: string) => Promise<RemoteResult<ToolDetail | undefined>>;
    getSearchMetadata: (id: string, kind: 'tool' | 'skill') => Promise<RemoteResult<SearchMetadata | undefined>>;
    updateSearchMetadata: (input: SearchMetadataUpdate) => Promise<RemoteResult<void>>;
    updateSummaryMaxChars: (value: number) => Promise<RemoteResult<void>>;
    getCatalogDocs: () => Promise<RemoteResult<CatalogDocs>>;
    listLocations: () => Promise<RemoteResult<McpLocation[]>>;
    addLocation: (input: McpInput) => Promise<RemoteResult<string>>;
    removeLocation: (id: string) => Promise<RemoteResult<boolean>>;
    updateLocation: (id: string, input: McpUpdateInput) => Promise<RemoteResult<boolean>>;
    listSkillLocations: () => Promise<RemoteResult<SkillLocation[]>>;
    addSkillLocation: (dir: string, projectPath?: string) => Promise<RemoteResult<string>>;
    importSkillFromGitHub: (url: string, projectPath?: string) => Promise<RemoteResult<string>>;
    removeSkillLocation: (name: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    adoptSkillLocation: (name: string) => Promise<RemoteResult<string>>;
    updateSkillLocation: (name: string, dir: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    dissociateGitHubSkillSource: (name: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    checkSkillUpdate: (name: string, entryDir?: string) => Promise<RemoteResult<SkillUpdateStatus>>;
    associateGitHubSkillSource: (name: string, url: string, entryDir?: string) => Promise<RemoteResult<SkillUpdateStatus>>;
    updateSkillFromGitHub: (name: string, entryDir?: string) => Promise<RemoteResult<{
      revision: string;
    }>>;
  }
  interface TypertRemoteMap {
    'capabilityPolicy/checkSelfUpdate': () => Promise<RemoteResult<SelfUpdateStatus>>;
    'capabilityPolicy/installSelfUpdate': (version: string) => Promise<RemoteResult<void>>;
    'capabilityPolicy/switchSelfToNpm': (version: string) => Promise<RemoteResult<void>>;
    'capabilityPolicy/getConfig': () => Promise<RemoteResult<Record<string, unknown>>>;
    'capabilityPolicy/updateConfig': (partial: Record<string, unknown>) => Promise<RemoteResult<void>>;
    'capabilityPolicy/classifyAll': () => Promise<RemoteResult<CapabilityRow[]>>;
    'capabilityPolicy/getDiagnostics': () => Promise<RemoteResult<CapabilityDiagnostics>>;
    'capabilityPolicy/refresh': () => Promise<RemoteResult<void>>;
    'capabilityPolicy/catalogVersion': () => Promise<RemoteResult<number>>;
    'capabilityPolicy/listSkillDir': (id: string, relPath?: string) => Promise<RemoteResult<SkillFileEntry[] | undefined>>;
    'capabilityPolicy/readSkillFile': (id: string, relPath: string) => Promise<RemoteResult<string | undefined>>;
    'capabilityPolicy/getDetail': (id: string) => Promise<RemoteResult<ToolDetail | undefined>>;
    'capabilityPolicy/getSearchMetadata': (id: string, kind: 'tool' | 'skill') => Promise<RemoteResult<SearchMetadata | undefined>>;
    'capabilityPolicy/updateSearchMetadata': (input: SearchMetadataUpdate) => Promise<RemoteResult<void>>;
    'capabilityPolicy/updateSummaryMaxChars': (value: number) => Promise<RemoteResult<void>>;
    'capabilityPolicy/getCatalogDocs': () => Promise<RemoteResult<CatalogDocs>>;
    'capabilityPolicy/listLocations': () => Promise<RemoteResult<McpLocation[]>>;
    'capabilityPolicy/addLocation': (input: McpInput) => Promise<RemoteResult<string>>;
    'capabilityPolicy/removeLocation': (id: string) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/updateLocation': (id: string, input: McpUpdateInput) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/listSkillLocations': () => Promise<RemoteResult<SkillLocation[]>>;
    'capabilityPolicy/addSkillLocation': (dir: string, projectPath?: string) => Promise<RemoteResult<string>>;
    'capabilityPolicy/importSkillFromGitHub': (url: string, projectPath?: string) => Promise<RemoteResult<string>>;
    'capabilityPolicy/removeSkillLocation': (name: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/adoptSkillLocation': (name: string) => Promise<RemoteResult<string>>;
    'capabilityPolicy/updateSkillLocation': (name: string, dir: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/dissociateGitHubSkillSource': (name: string, entryDir?: string) => Promise<RemoteResult<boolean>>;
    'capabilityPolicy/checkSkillUpdate': (name: string, entryDir?: string) => Promise<RemoteResult<SkillUpdateStatus>>;
    'capabilityPolicy/associateGitHubSkillSource': (name: string, url: string, entryDir?: string) => Promise<RemoteResult<SkillUpdateStatus>>;
    'capabilityPolicy/updateSkillFromGitHub': (name: string, entryDir?: string) => Promise<RemoteResult<{
      revision: string;
    }>>;
  }
  interface TypertRemoteNamespaceMap {
    'capabilityPolicy': TypertRemoteNamespace$6361706162696c697479506f6c696379;
  }
}
//#endregion
//#region src/client/store.d.ts
/** Snapshot of the management surface. */
interface CapabilitySnapshot {
  readonly rows: readonly CapabilityRow[];
  readonly diagnostics?: CapabilityDiagnostics;
}
/** The Host `capabilityPolicy` remote face (generated contribution). */
interface CapabilityPolicyRemote {
  checkSelfUpdate(): Promise<{
    ok: true;
    value: SelfUpdateStatus;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  installSelfUpdate(version: string): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  switchSelfToNpm(version: string): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getConfig(): Promise<{
    ok: true;
    value: Record<string, unknown>;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateConfig(partial: Record<string, unknown>): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  classifyAll(): Promise<{
    ok: true;
    value: CapabilityRow[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getDiagnostics?(): Promise<{
    ok: true;
    value: CapabilityDiagnostics;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  refresh(): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  /** One number naming the host's current catalog state; see the registry's `version()`. */
  catalogVersion(): Promise<{
    ok: true;
    value: number;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listSkillDir(id: string, relPath?: string): Promise<{
    ok: true;
    value: SkillFileEntry[] | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  readSkillFile(id: string, relPath: string): Promise<{
    ok: true;
    value: string | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getDetail(id: string): Promise<{
    ok: true;
    value: ToolDetail | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getSearchMetadata(id: string, kind: 'tool' | 'skill'): Promise<{
    ok: true;
    value: SearchMetadata | undefined;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateSearchMetadata(input: SearchMetadataUpdate): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateSummaryMaxChars(value: number): Promise<{
    ok: true;
    value: void;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  getCatalogDocs(): Promise<{
    ok: true;
    value: CatalogDocs;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listLocations(): Promise<{
    ok: true;
    value: McpLocation[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  addLocation(input: McpInput): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  removeLocation(id: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateLocation(id: string, input: McpUpdateInput): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  listSkillLocations(): Promise<{
    ok: true;
    value: SkillLocation[];
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  addSkillLocation(dir: string, projectPath?: string): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  importSkillFromGitHub(url: string, projectPath?: string): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  removeSkillLocation(name: string, entryDir?: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  adoptSkillLocation(name: string): Promise<{
    ok: true;
    value: string;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateSkillLocation(name: string, dir: string, entryDir?: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  dissociateGitHubSkillSource(name: string, entryDir?: string): Promise<{
    ok: true;
    value: boolean;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  checkSkillUpdate(name: string, entryDir?: string): Promise<{
    ok: true;
    value: SkillUpdateStatus;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  associateGitHubSkillSource(name: string, url: string, entryDir?: string): Promise<{
    ok: true;
    value: SkillUpdateStatus;
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
  updateSkillFromGitHub(name: string, entryDir?: string): Promise<{
    ok: true;
    value: {
      revision: string;
    };
  } | {
    ok: false;
    error: {
      code: string;
      message: string;
    };
  }>;
}
//#endregion
//#region src/client/overview-section.d.ts
/** 本页文案键。zh / en 两份字典的键必须与此完全一致。 */
type OverviewKey = 'nav' | 'title' | 'desc' | 'overviewRefresh' | 'overviewRefreshing' | 'overviewLoading' | 'overviewUnknown' | 'overviewGuardTitle' | 'overviewGuardSource' | 'overviewGuardError' | 'overviewGuardObservations' | 'overviewGuardRepeat' | 'overviewGuardCycle' | 'overviewGuardDenials' | 'overviewGuardSwitches' | 'overviewGuardMaster' | 'overviewGuardDuplicate' | 'overviewGuardCycleSwitch' | 'overviewGuardNoProgress' | 'overviewSwitchOn' | 'overviewSwitchOff' | 'overviewGuardDiag' | 'overviewGuardEffective' | 'overviewGuardNotEffective' | 'overviewDiagInvalidPatch' | 'overviewDiagNotMounted' | 'overviewDiagPersistenceDirty' | 'overviewDiagWriteFailed' | 'overviewDiagNone' | 'overviewCatalogTitle' | 'overviewCatalogSource' | 'overviewCatalogError' | 'overviewCatalogResident' | 'overviewCatalogOnDemand' | 'overviewCatalogDisabled' | 'overviewCatalogTotal' | 'overviewCatalogVersion' | 'overviewCatalogObservedAt' | 'overviewCatalogTools' | 'overviewCatalogSkills' | 'overviewCatalogSkillsHint' | 'overviewCatalogState' | 'overviewCatalogStateEmpty' | 'overviewCatalogStateReady' | 'overviewCatalogStateHint' | 'overviewCatalogDiag' | 'overviewCatalogDiagUnavailable' | 'overviewCatalogDiagShadowed' | 'overviewCatalogDiagBrokenPreset';
/** Props injected by the `settings.section` registration (see index.ts). */
interface OverviewSectionInjected {
  guardRemote: GuardRemote;
  capabilityRemote: CapabilityPolicyRemote;
  t: (key: OverviewKey) => string;
}
//#endregion
//#region src/client/CapabilitySection.d.ts
type CapabilityKey$1 = 'nav' | 'title' | 'desc' | 'resident' | 'on-demand' | 'disabled' | 'tool' | 'skill' | 'mandatory' | 'toolsGroup' | 'skillsGroup' | 'builtInGroup' | 'globalSkills' | 'projectSkills' | 'presetSkills' | 'emptyTools' | 'emptySkills' | 'emptyGlobalSkills' | 'emptyProjectSkills' | 'emptyPresetSkills' | 'filterByName' | 'filterHint' | 'filterNoMatch' | 'toolCount' | 'residentShort' | 'onDemandShort' | 'disabledShort' | 'cycleHint' | 'notPreviewable' | 'previewClose' | 'markdownCode' | 'markdownWrap' | 'markdownUnwrap' | 'markdownCopy' | 'markdownCopied' | 'markdownFootnotes' | 'detailNotFound' | 'cycleOverridden' | 'refreshFailed' | 'mcpToolsPending' | 'feedback' | 'retry' | 'carrierFailureHint' | 'registerCapability' | 'editMcp' | 'editSkillNamed' | 'edit' | 'save' | 'remove' | 'cancel' | 'confirmRemove' | 'confirmRemoveMcp' | 'confirmRemoveSkillLink' | 'confirmRemoveSkillDir' | 'confirmSaveAnyway' | 'saveConfirmRealDir' | 'register' | 'notEditable' | 'entryNotFound' | 'mcpServers' | 'skillDirs' | 'skillUpdates' | 'skillCheckUpdates' | 'skillUpdateAll' | 'skillChecking' | 'skillUpdating' | 'skillInstalledRevision' | 'skillLatestRevision' | 'skillUpToDate' | 'skillLocalModified' | 'skillUpdateAvailable' | 'skillChangedFiles' | 'skillViewChanges' | 'skillUpdateOne' | 'skillUpdateProgress' | 'skillCheckProgress' | 'skillCheckComplete' | 'skillUpdatingItem' | 'skillUpdateComplete' | 'skillAssociatingItem' | 'skillUnlinking' | 'skillUnlinked' | 'skillAssociated' | 'skillSourceFailed' | 'skillAvailableCount' | 'skillWaiting' | 'skillGitManaged' | 'skillEditSource' | 'skillUnlinkSource' | 'skillErrorDetails' | 'skillAssociating' | 'skillSourceUrl' | 'skillAssociateSource' | 'skillAssociateHint' | 'skillDirPath' | 'skillDirHint' | 'skillRoot' | 'skillRootUser' | 'skillRootProject' | 'skillRootHintUser' | 'skillRootHintProject' | 'skillProjectPath' | 'skillProjectPathHint' | 'skillRegisteredAt' | 'skillRepointed' | 'skillAdopted' | 'skillSource' | 'skillSourceHint' | 'skillFromPreset' | 'skillFromPresetHint' | 'githubImporting' | 'importing' | 'skillUnmanaged' | 'adoptSkill' | 'adoptSkillHint' | 'adoptSkillTitle' | 'sourceCustom' | 'sourceBundled' | 'serverName' | 'serverNameImmutable' | 'transport' | 'transportStdio' | 'transportHttp' | 'transportHintStdio' | 'transportHintHttp' | 'command' | 'args' | 'cwd' | 'env' | 'url' | 'headers' | 'headersHint' | 'timeout' | 'timeoutInvalid' | 'viewCatalog' | 'catalogPolicy' | 'catalogOnDemand' | 'catalogPolicyNote' | 'catalogSearchNote' | 'catalogEmpty' | 'diagnosticTitle' | 'diagnosticUnavailable' | 'diagnosticShadowed' | 'diagnosticBroken' | 'diagnosticUnbrowseable' | 'diagnosticUndocumented' | 'editSearchMetadata' | 'searchMetadataButton' | 'searchDescription' | 'searchMetadataNote' | 'searchMetadataSave' | 'searchMetadataRestore' | 'searchMetadataRestoreHint' | 'searchMetadataSaved' | 'summaryLimit' | 'summaryLimitUnit' | 'summaryLimitInvalid' | 'summaryLimitDisabled' | 'summaryLimitSaved' | 'projectRootLabel' | 'skillBrowseUnavailable' | 'updateAvailable' | 'newVersion' | 'updateDialogTitle' | 'updateVersionComparison' | 'updateNpmNote' | 'updateLocalNote' | 'updateSourceSteps' | 'updateSourceStepsHide' | 'updateSourceStepsIntro' | 'updateSourceStepsRestart' | 'installUpdate' | 'switchAndInstall' | 'updatingPlugin' | 'pluginUpdated' | 'pluginSwitched' | 'pluginNonRegistrySource' | 'pluginProfileUnavailable' | 'pluginUpdateFailed';
//#endregion
//#region src/client/capability-v3/section.d.ts
/** Props injected by the settings.section registration (see index.ts). */
interface CapabilitySectionInjected {
  remote: CapabilityPolicyRemote;
  t(key: CapabilityKey, params?: Record<string, unknown>): string;
  /** Diagnostic: `$mount` failure surfaced instead of crashing the section. */
  mountError?: string;
  /**
   * Subscribe to signals that the host catalog may have moved without this page
   * asking: a settings document edit (registering a source, editing a
   * composition file outside the browser) or a carrier reconnect. Returns a
   * disposer.
   */
  subscribeSignals: (listener: () => void) => () => void;
}
type CapabilitySectionProps = CapabilitySectionInjected;
/**
 * 本页用到的 `t` 键。
 *
 * WHY TRIMMED: 0.1.27 的四页签外壳把 Catalog / 概览 / 执行保护三页的键塞进同一个
 * 联合类型，并在 `index.ts` 的字典里一起维护。现在本包改成「一个页面一个视图」，
 * 这一页只保留它真正渲染的 96 个键（档位、过滤、诊断、检索摘要、位置注册、目录
 * 文档、自更新）；概览与 Guard 的键归各自的 section，调用统计的键已随统计
 * 子系统删除。少一个键在这里，`t` 的调用点就少一处能让字典漂移的地方。
 */
type CapabilityKey = 'title' | 'desc' | 'mandatory' | 'toolsGroup' | 'skillsGroup' | 'builtInGroup' | 'globalSkills' | 'projectSkills' | 'presetSkills' | 'emptyTools' | 'emptySkills' | 'emptyGlobalSkills' | 'emptyProjectSkills' | 'emptyPresetSkills' | 'toolCount' | 'filterByName' | 'filterHint' | 'filterNoMatch' | 'residentShort' | 'onDemandShort' | 'disabledShort' | 'cycleHint' | 'cycleSaved' | 'notPreviewable' | 'previewClose' | 'markdownCode' | 'markdownWrap' | 'markdownUnwrap' | 'markdownCopy' | 'markdownCopied' | 'markdownFootnotes' | 'detailNotFound' | 'cycleOverridden' | 'refreshFailed' | 'mcpToolsPending' | 'feedback' | 'retry' | 'carrierFailureHint' | 'registerCapability' | 'edit' | 'cancel' | 'notEditable' | 'skillAdopted' | 'skillSource' | 'skillSourceHint' | 'skillFromPreset' | 'skillFromPresetHint' | 'skillUnmanaged' | 'adoptSkill' | 'adoptSkillHint' | 'adoptSkillTitle' | 'sourceCustom' | 'sourceBundled' | 'viewCatalog' | 'catalogPolicy' | 'catalogOnDemand' | 'catalogPolicyNote' | 'catalogSearchNote' | 'catalogEmpty' | 'diagnosticTitle' | 'diagnosticUnavailable' | 'diagnosticShadowed' | 'diagnosticBroken' | 'diagnosticUnbrowseable' | 'diagnosticUndocumented' | 'editSearchMetadata' | 'searchMetadataButton' | 'searchDescription' | 'searchMetadataNote' | 'searchMetadataSave' | 'searchMetadataRestore' | 'searchMetadataRestoreHint' | 'searchMetadataSaved' | 'summaryLimit' | 'summaryLimitUnit' | 'summaryLimitInvalid' | 'summaryLimitDisabled' | 'summaryLimitSaved' | 'projectRootLabel' | 'skillBrowseUnavailable' | 'updateAvailable' | 'newVersion' | 'updateDialogTitle' | 'updateVersionComparison' | 'updateNpmNote' | 'updateLocalNote' | 'updateSourceSteps' | 'updateSourceStepsHide' | 'updateSourceStepsIntro' | 'updateSourceStepsRestart' | 'installUpdate' | 'switchAndInstall' | 'updatingPlugin' | 'pluginUpdated' | 'pluginSwitched' | 'pluginNonRegistrySource' | 'pluginProfileUnavailable' | 'pluginUpdateFailed';
//#endregion
//#region src/client/thinking-throttle.d.ts
/** 外壳自身用到的文案键（页签与标题）。 */
type ThinkingThrottleKey = 'nav' | 'title' | 'tabOverview' | 'tabGuard' | 'tabCapability';
//#endregion
//#region src/client/index.d.ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 能力菜单 tab copy. */
    'settings.capability': Record<CapabilityKey$1, string>;
    /** 执行保护 tab copy. */
    'settings.thinking-guard': Record<GuardSectionKey, string>;
    /** 总览 tab copy. */
    'settings.thinking-guard-overview': Record<OverviewKey, string>;
    /** 思考节流外壳 copy. */
    'settings.thinking-throttle': Record<ThinkingThrottleKey, string>;
  }
}
/** Required services (cordis fiber inject). `remote.capabilityPolicy` is NOT
 *  injected: we mount it in `apply`, so declaring it would deadlock the boot
 *  ("waiting for service"). Access it via `ctx.get('remote.capabilityPolicy')`,
 *  which resolves the mounted namespace service without the inject gate. */
declare const inject: string[];
/** Register the 能力菜单 section once `settings.section` is on the ledger. */
declare function apply(ctx: Context): void;
//#endregion
export { type CapabilityKey, type CapabilityPolicyRemote, type CapabilityRow, type CapabilitySectionInjected, type CapabilitySectionProps, type CapabilitySnapshot, type GuardDiagnostics, type GuardRemote, type GuardSectionInjected, type GuardSectionKey, type GuardStatsSnapshot, type GuardSwitches, type OverviewKey, type OverviewSectionInjected, apply, inject };

return module.exports;
}});
//# sourceMappingURL=client.d.ts.map