export declare const LOOP_HISTORY_LIMIT = 16;
export declare const DEFAULT_REPEAT_THRESHOLDS: readonly [3, 5, 8];
/** Smallest accepted repeat threshold. */
export declare const REPEAT_THRESHOLD_MIN = 2;
/** Largest accepted repeat threshold. */
export declare const REPEAT_THRESHOLD_MAX = 50;
/** How many thresholds one configuration may carry. */
export declare const REPEAT_THRESHOLD_LIMIT = 5;
/**
 * Saturating ceiling for the independent consecutive-repeat counter.
 *
 * The counter must be able to reach every legal threshold, so it is bounded one
 * step ABOVE `REPEAT_THRESHOLD_MAX`. Bounding it AT the maximum would pin the
 * reported count to a legal value forever once saturated, making a reminder fire
 * on every later call; one past the maximum keeps all legal thresholds exactly
 * reachable while saturating cleanly out of the legal set afterwards.
 *
 * This is deliberately separate from `LOOP_HISTORY_LIMIT`: the 16-entry window is
 * short so the alternating-cycle scan stays cheap, but deriving the repeat count
 * from it capped every legal threshold above 16 (the TG-03 defect).
 */
export declare const CONSECUTIVE_COUNT_LIMIT: number;
/**
 * Validate a repeat-threshold list and return a frozen copy.
 *
 * One shared validator so the settings page, the persisted state file and the
 * detector cannot disagree about what a legal list is. It throws instead of
 * coercing: silently sorting, deduplicating or clamping would make the settings
 * page claim a behaviour the detector does not have.
 */
export declare function normalizeRepeatThresholds(value: unknown, label?: string): readonly number[];
/**
 * Fingerprint budgets, checked *while* canonicalizing.
 *
 * Exceeding any budget abandons the fingerprint entirely. A truncated canonical
 * form would still look complete and could make two different results compare
 * equal — the false "no progress" evidence this guard must never invent.
 *
 * - `FINGERPRINT_MAX_NODES`: values visited (object keys charge bytes only).
 *   A 1000-row x 5-field tool result is ~6k nodes; 20k still fingerprints a
 *   ~3300-row table in a few milliseconds.
 * - `FINGERPRINT_MAX_DEPTH`: nesting levels, root = 1. The recursive walk
 *   overflows the stack at ~2000 object levels on the bundled Node 22 runtime
 *   with the default stack (measured), so 64 keeps ~30x headroom and is still
 *   far deeper than any real payload (`content[] -> block -> value` is depth 4).
 * - `FINGERPRINT_MAX_BYTES`: UTF-8 bytes of the canonical JSON. 256 KiB covers
 *   ordinary file reads, search hits and multi-hundred-KB JSON in under 1 ms,
 *   while a multi-megabyte result is rejected before it is fully materialized.
 */
export declare const FINGERPRINT_MAX_NODES = 20000;
export declare const FINGERPRINT_MAX_DEPTH = 64;
export declare const FINGERPRINT_MAX_BYTES: number;
/** Which budget rejected a value. */
export type GuardFingerprintBudget = 'nodes' | 'depth' | 'bytes';
/** Internal signal: this value cannot be fingerprinted within budget. */
export declare class GuardFingerprintBudgetError extends Error {
    readonly limit: GuardFingerprintBudget;
    constructor(limit: GuardFingerprintBudget);
}
export type GuardToolOutcome = 'success' | 'error' | 'denied' | 'cancelled';
type LoopHistoryEntry = {
    readonly callId?: string;
    readonly dispatchSequence?: number;
    readonly signature: string;
    readonly outcome: GuardToolOutcome;
    readonly resultFingerprint?: string;
};
/** Caller owns one state per Agent and Turn; only fingerprints are retained. */
export interface GuardLoopState {
    readonly turn: number;
    readonly history: readonly LoopHistoryEntry[];
    /**
     * Independent saturating count of the current consecutive run. It is NOT
     * derived from `history`, so a legal threshold above `LOOP_HISTORY_LIMIT` is
     * still reachable. Zero when no run is active; advances only while the same
     * signature repeats.
     */
    readonly consecutiveCount: number;
    /** Signature of the current consecutive run; unset before the first observation. */
    readonly consecutiveSignature?: string;
}
export interface GuardLoopObservation {
    readonly name: string;
    readonly arguments?: unknown;
    readonly signature?: string;
    readonly callId?: string;
    readonly dispatchSequence?: number;
    readonly outcome: GuardToolOutcome;
    /** Precomputed safe fingerprint, or provide result for local hashing. */
    readonly resultFingerprint?: string;
    readonly result?: unknown;
}
export interface GuardLoopOptions {
    readonly repeatThresholds?: readonly number[];
    /** Disable sequence-cycle detection after overlapping dispatches were observed. */
    readonly disableSequenceDetection?: boolean;
    /**
     * Exact-repeat detection switch. False suppresses the 'repeat' reminder and the
     * repeat block candidate; `repeatCount` is still counted for diagnostics and the
     * alternating-cycle path keeps running on the same history.
     */
    readonly repeatDetection?: boolean;
    /**
     * Alternating-cycle detection switch. False reports no cycle at all, leaving
     * the repeat-detection path (and its reminders) untouched.
     */
    readonly alternatingCycleEnabled?: boolean;
    /**
     * No-progress protection switch. False keeps detection and reminders but makes
     * no call blockable, so the local denial never fires.
     */
    readonly noProgressProtection?: boolean;
    /** Exact tool names ignored without changing the recent-call window. */
    readonly excludedTools?: ReadonlySet<string>;
    /** Exact tool names ignored without changing the recent-call window. */
    readonly pollingTools?: ReadonlySet<string>;
    /** Exact tool names that may warn but can never become a block candidate. */
    readonly warnOnlyTools?: ReadonlySet<string>;
}
export type NoProgressEvidence = 'none' | 'unchanged-result' | 'unchanged-error' | 'unchanged-cycle';
/** Which detector turned a call into a local-block candidate. */
export type GuardLoopBlockSource = 'repeat' | 'cycle';
export interface GuardLoopDecision {
    readonly ignored: boolean;
    readonly signature?: string;
    readonly repeatCount: number;
    readonly alternatingCycle: boolean;
    readonly warning: 'none' | 'repeat' | 'alternating-cycle';
    readonly repeatThreshold?: number;
    /** Advisory only. The caller must not block without applying its own policy. */
    readonly blockCandidate: boolean;
    /** Set only when `blockCandidate` is true, so the caller can gate per source. */
    readonly blockSource?: GuardLoopBlockSource;
    readonly noProgressEvidence: NoProgressEvidence;
}
export interface GuardLoopObservationResult {
    readonly state: GuardLoopState;
    readonly decision: GuardLoopDecision;
}
export declare function createGuardLoopState(turn: number): GuardLoopState;
/** Bounded argument signature; `undefined` means this call is not comparable. */
export declare function guardToolSignature(name: string, argumentsValue: unknown): string | undefined;
/**
 * Fingerprint a result/error transiently; raw content is never returned or
 * retained. `undefined` means "cannot prove the result did not change".
 */
export declare function guardResultFingerprint(outcome: GuardToolOutcome, value: unknown): string | undefined;
/**
 * Pure bounded detector. It never enforces a step, call-count, or duration budget.
 * Alternating cycles warn; a local-block candidate requires matching result/error
 * fingerprints for every leg of the repeated cycle.
 *
 * An observation whose argument signature exceeds the fingerprint budget is
 * dropped exactly like an excluded tool: without a stable signature there is no
 * comparable history entry, so no reminder and no block candidate is produced.
 */
export declare function observeGuardLoop(previousState: GuardLoopState, turn: number, observation: GuardLoopObservation, options?: GuardLoopOptions): GuardLoopObservationResult;
export {};
//# sourceMappingURL=guard-loop-core.d.ts.map