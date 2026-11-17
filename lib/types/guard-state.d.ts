import type { Context } from '@deepseek-ai/cordis';
import { type GuardStatsSnapshot } from './guard-core.ts';
/**
 * Control-plane tools that must never be loop-detected.
 *
 * `meta_search` / `meta_invoke` are the capability catalog's own control plane:
 * reminding about them (or denying one) would break discovery, and a denial of
 * `meta_invoke` could make an On-demand capability unreachable. The list is a
 * Guard constant now that the Guard owns its own state; the patch config can
 * still override it when a deployment renames the control plane.
 */
export declare const DEFAULT_GUARD_META_TOOLS: readonly string[];
/**
 * The Guard switches the settings page exposes.
 *
 * They are separate booleans, not one master flag, because the page presents
 * them as independent controls; the detector honours each one. The repeat
 * thresholds are editable as well.
 */
export interface GuardSwitches {
    /** Master switch: off means no reminders and no denials at all. */
    readonly enabled: boolean;
    /** Repeated identical calls: remind at the configured {@link repeatThresholds}. */
    readonly duplicateDetection: boolean;
    /** A -> B -> A -> B sequences: detect and explain. */
    readonly alternatingCycleDetection: boolean;
    /** Evidence gate for the local denial of one repeated call. */
    readonly noProgressProtection: boolean;
    /**
     * Consecutive-repeat counts that raise a reminder.
     *
     * 1-5 strictly increasing integers in 2..50. The highest entry is also the
     * repeat count at which an unchanged result/error becomes a denial candidate,
     * so lowering it makes the Guard act earlier and raising it makes it quieter.
     */
    readonly repeatThresholds: readonly number[];
}
/** Fixed diagnostic reasons; the wire never carries free-form text. */
export type GuardDiagnosticReason = 'invalid-patch' | 'not-mounted';
/**
 * Why the Guard is (or is not) actually running, and whether pending writes are
 * durable. Deliberately a closed allowlist: no exception text, no paths.
 */
export interface GuardDiagnostics {
    /**
     * True only when a Guard instance registered a valid base AND finished
     * constructing its hooks. An empty `reasons` list is NOT the proof: a state
     * service whose Guard never mounted also has nothing to complain about.
     */
    readonly available: boolean;
    readonly reasons: readonly GuardDiagnosticReason[];
    readonly persistence: {
        readonly dirty: boolean;
        /** Present only after a real write failure; cleared by the next success. */
        readonly lastErrorCode?: 'write-failed';
    };
}
/** Shipped defaults for {@link GuardSwitches}. */
export declare const DEFAULT_GUARD_SWITCHES: GuardSwitches;
/** Sparse persisted override; absent key means "the operator never chose it". */
export interface GuardStateRecord {
    readonly enabled?: boolean;
    readonly duplicateDetection?: boolean;
    readonly alternatingCycleDetection?: boolean;
    readonly noProgressProtection?: boolean;
    readonly repeatThresholds?: readonly number[];
}
/**
 * Where the Guard keeps its switches.
 *
 * Next to the profile's patch file (dsh's own concept of "this profile") but in
 * its own directory, so nothing about the Guard lives in a file the capability
 * menu also writes. `DSH_HOME` wins when the host sets it, exactly as the
 * upstream patch default does.
 */
export declare function defaultGuardStateFile(): string;
/** Where the Guard's cumulative counters live (survives restarts / plugin updates). */
export declare function defaultGuardStatsFile(): string;
/** Read the persisted counter snapshot; a missing file means "no history yet". */
export declare function readGuardStatsFile(file: string): Promise<GuardStatsSnapshot | undefined>;
/** Atomically replace the persisted counter snapshot. */
export declare function writeGuardStatsFile(file: string, stats: GuardStatsSnapshot): Promise<void>;
/** The 0.1.x state file the Guard's switches used to live in (migration source). */
export declare function legacyPolicyStateFile(): string;
/** Parse the guard section of a state document; unknown keys are ignored. */
export declare function parseGuardState(value: unknown): GuardStateRecord;
/** Missing file means no UI choices; malformed file throws instead of losing edits. */
export declare function readGuardState(file: string): Promise<GuardStateRecord>;
/** Merge one writer's switch changes with the latest file. */
export declare function writeGuardState(file: string, change: GuardStateRecord): Promise<boolean>;
/**
 * Import the 0.1.x Guard switches once, the first time this plugin writes its
 * own file.
 *
 * The old file is `capability-menu-policy.json` in the same directory and is
 * left untouched: it is still the capability menu's tier state, and rewriting it
 * from here would fight the plugin that owns it. A no-op when either file is
 * absent or the old one has no `guard` section.
 */
export declare function migrateLegacyGuardState(file: string, legacyFile: string): Promise<boolean>;
/** The service this plugin exposes as `ctx.thinkingGuardState`. */
export interface GuardStateService {
    /** Effective switches: shipped default < patch base < persisted override. */
    getGuard(): GuardSwitches;
    /** Persist and apply switches; throws when the write fails (never silently drops). */
    updateGuard(change: Partial<GuardSwitches>): Promise<void>;
    /** Declare the patch file's switch values as the base layer; returns its withdrawal. */
    registerGuardBase(base: Partial<GuardSwitches>): () => void;
    /** Report that a Guard instance failed to construct; returns its withdrawal. */
    noteGuardUnavailable(): () => void;
    getGuardDiagnostics(): GuardDiagnostics;
    /** Content-free counters; process-scoped, so they do not reset per turn. */
    getGuardStats(): GuardStatsSnapshot;
    /** Where the persisted overrides live (empty string when persistence is disabled). */
    stateFilePath(): string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        thinkingGuardState: GuardStateService;
    }
}
export interface Config {
    /** Override the state file; an empty string disables persistence (tests). */
    readonly stateFile?: string;
    /** Override the 0.1.x migration source; empty disables migration. */
    readonly legacyStateFile?: string;
    /** Override the counters file; empty disables counter persistence (tests). */
    readonly statsFile?: string;
}
export declare const name = "thinking-guard-state";
/**
 * Mount the Guard's own state service.
 *
 * An unreadable state file is logged and treated as "no overrides": a corrupt
 * JSON file must not take the Guard down, because the Guard is the part of this
 * plugin that protects a running turn. A corrupt LEGACY file is ignored for the
 * same reason (see `migrateLegacyGuardState`).
 */
export declare function apply(ctx: Context, config?: Config): Promise<void>;
//# sourceMappingURL=guard-state.d.ts.map