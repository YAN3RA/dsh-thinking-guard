import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type GuardProfile, type HostIntegrationConfig } from './guard-core.ts';
export declare const name = "thinking-guard";
export declare const inject: string[];
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'thinking-guard': {
            kind: 'thinking-guard';
        };
    }
}
export interface Config {
    enabled?: boolean;
    profile?: 'quick' | 'normal' | 'deep';
    /** @deprecated Accepted for migration only; hard steps never stop a turn. */
    stepLimitMode?: 'warn-only' | 'hard-stop';
    duplicateDetection?: boolean;
    /** Alternating-cycle detection (A -> B -> A -> B). Defaults to on. */
    alternatingCycleDetection?: boolean;
    /** No-progress protection: may locally deny a repeated call. Defaults to on. */
    noProgressProtection?: boolean;
    /**
     * Repeat counts that raise a reminder (1-5 strictly increasing integers in
     * 2..50). The settings page owns the live value; this is the patch-file base
     * for a deployment that never opens the page.
     */
    repeatThresholds?: number[];
    /** @deprecated Accepted for config migration only; see `repeatThresholds`. */
    duplicateWarnAfter?: number;
    duplicateHardBlock?: boolean;
    /** Exact names excluded from duplicate and cycle detection. */
    excludedTools?: string[];
    /** Exact polling/status tools; warn/block detection is skipped, counters remain. */
    pollingTools?: string[];
    /** Exact tools may warn but never be locally denied based on identical results. */
    warnOnlyTools?: string[];
    /**
     * Control-plane tool names, excluded from loop detection.
     *
     * Defaults to the capability catalog's own `meta_search` / `meta_invoke` (see
     * `DEFAULT_GUARD_META_TOOLS`); the patch file can override the list when a
     * deployment renames the control plane.
     */
    metaTools?: string[];
    profiles?: Partial<Record<'quick' | 'normal' | 'deep', GuardProfile>>;
    hostIntegration?: Partial<HostIntegrationConfig>;
}
export declare const Config: z<Config>;
/**
 * DSH-facing efficiency guard. All state is keyed by the live Agent object and
 * the current turn number; no conversation text or raw tool arguments are
 * persisted. Only a SHA-256 signature and bounded counters remain in memory.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=guard.d.ts.map