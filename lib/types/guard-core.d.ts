import { type GuardLoopBlockSource, type GuardLoopState, type GuardToolOutcome } from './guard-loop-core.ts';
export type GuardProfileName = 'quick' | 'normal' | 'deep';
export interface GuardProfile {
    readonly softSteps: number;
    readonly hardSteps: number;
    readonly softToolCalls: number;
    readonly hardToolCalls: number;
    readonly softDurationMs: number;
    readonly hardDurationMs: number;
}
export interface HostIntegrationConfig {
    readonly enabled: boolean;
    readonly provider: 'pi-desktop' | string;
    readonly preferHostTokenSaver: boolean;
    readonly preferHostPromptCache: boolean;
    /** @deprecated Accepted for compatibility only; no convergence steer is emitted. */
    readonly maxConvergenceSteersPerTurn: number;
    /** @deprecated Accepted for compatibility only; no no-progress stop is applied. */
    readonly maxNoProgressCycles: number;
    /** @deprecated Accepted for compatibility only; never rejects the next step. */
    readonly loopBreakMode: 'stop-next-step';
}
export interface GuardConfig {
    readonly enabled: boolean;
    readonly profile: GuardProfileName;
    /** @deprecated Kept for old configs; validation always resolves to warn-only. */
    readonly stepLimitMode: 'warn-only' | 'hard-stop';
    readonly duplicateDetection: boolean;
    /**
     * Alternating-cycle detection (A -> B -> A -> B).
     *
     * Split out of `duplicateDetection` because the settings page exposes the three
     * capabilities as independent switches; a single master flag would make two of
     * them cosmetic. Off means the sequence detector reports no cycle.
     */
    readonly alternatingCycleDetection: boolean;
    /**
     * No-progress protection: the evidence gate for locally denying a repeated call.
     *
     * Off means a repeated call may still be *reminded* about, but never denied —
     * the detector keeps its history and the reminder path is unchanged.
     */
    readonly noProgressProtection: boolean;
    /** @deprecated Compatibility-only; see `repeatThresholds` for the live list. */
    readonly duplicateWarnAfter: number;
    /** @deprecated Accepted for migration only; validated as false. */
    readonly duplicateHardBlock: boolean;
    readonly profiles: Readonly<Record<GuardProfileName, GuardProfile>>;
    readonly hostIntegration: HostIntegrationConfig;
    /** Repeat counts that raise a reminder; strictly increasing, 2..50, 1..5 entries. */
    readonly repeatThresholds: readonly number[];
}
export interface ToolCallObservation {
    readonly controlPlane?: boolean;
    readonly denied?: boolean;
}
export interface PendingLoopObservation {
    readonly name: string;
    readonly callId: string;
    readonly dispatchSequence: number;
    readonly epoch: number;
    readonly signature: string;
    readonly outcome: GuardToolOutcome;
    /**
     * Omitted when the dispatch was known not to need a fingerprint, or when the
     * result exceeded the fingerprint budget. Absence means "no progress cannot be
     * proven", never "the result is identical" — see `fingerprintsMatch` in
     * guard-loop-core.
     */
    readonly resultFingerprint?: string;
}
export interface DispatchRecord {
    readonly sequence: number;
    readonly epoch: number;
    readonly name: string;
    readonly signature: string;
    /**
     * Decided at dispatch time from the tool name alone: excluded / polling /
     * warn-only / control-plane calls can never become a block candidate, so their
     * result is never canonicalized or hashed. This skips the work instead of
     * computing a fingerprint the detector then discards.
     */
    readonly fingerprintNeeded: boolean;
}
export interface TurnState {
    readonly turn: number;
    readonly startedAt: number;
    loopEpoch: number;
    nextDispatchSequence: number;
    nextLoopSequence: number;
    loopDetectionDisabled: boolean;
    readonly userMessageIds: Set<string>;
    readonly dispatchRecords: Map<string, DispatchRecord>;
    readonly pendingLoopObservations: Map<number, PendingLoopObservation | null>;
    loopState: GuardLoopState;
    /**
     * Pending local-denial candidates keyed by tool signature, each holding the
     * detector(s) that produced it. Keeping both sources per signature is what makes
     * `duplicateDetection` and `alternatingCycleDetection` independent: a repeat
     * candidate and a cycle candidate for the same call never overwrite each other.
     */
    readonly pendingBlockCandidates: Map<string, Set<GuardLoopBlockSource>>;
    readonly blockedLoopSignatures: Set<string>;
    readonly deniedCallIds: Set<string>;
    localLoopDenials: number;
    readonly loopWarnings: Set<string>;
    modelSteps: number;
    businessToolCalls: number;
    lastActivityAt: number;
}
export type GuardDecision = {
    readonly kind: 'allow';
};
/** Which reminder the Guard actually delivered. */
export type GuardReminderKind = 'repeat' | 'cycle';
/**
 * Content-free Guard counters for the settings page.
 *
 * This is the answer to "is it running, and did it do anything?". Every field is
 * a number or a timestamp: no tool name, argument, result, error message or
 * reasoning text is ever stored, so the snapshot can be shown (and serialized)
 * without leaking anything the Guard saw. All counters are plain accumulators —
 * there is no per-call key space that could grow without bound.
 */
export interface GuardStatsSnapshot {
    /** Tool calls the detector actually observed (excluded/polling calls are not counted). */
    readonly observations: number;
    /** Reminders actually delivered, split by which detector produced them. */
    readonly reminders: {
        readonly repeat: number;
        readonly cycle: number;
    };
    /** Local denials actually enforced by `ctx.tools.guard`. */
    readonly denials: number;
    /** Outcome class of the observed calls. Denials are counted in `denials`, not here. */
    readonly outcomes: {
        readonly success: number;
        readonly error: number;
        readonly cancelled: number;
    };
    /** Milliseconds timestamp of the most recent delivered reminder. */
    readonly lastReminderAt?: number;
    /** Milliseconds timestamp of the most recent enforced denial. */
    readonly lastDenialAt?: number;
    /** Milliseconds timestamp this recorder started counting. */
    readonly since: number;
}
/**
 * Bounded, process-lifetime Guard counters.
 *
 * Deliberately not per-Agent or per-Turn: the question the settings page asks is
 * "has this process's Guard been working at all", which a per-turn counter would
 * answer with a zero every time the page is opened mid-turn. Mutators are total
 * (they cannot throw), so instrumentation can never turn a real tool call into a
 * failure.
 */
export declare class GuardStatsRecorder {
    private startedAt;
    private observations;
    private repeatReminders;
    private cycleReminders;
    private denials;
    private successes;
    private errors;
    private cancellations;
    private lastReminderAt;
    private lastDenialAt;
    constructor(now?: number);
    /** Record one call the detector observed, by its outcome class. */
    observe(outcome: GuardToolOutcome, _now?: number): void;
    /** Record one reminder that was really delivered to the Agent. */
    remind(kind: GuardReminderKind, now?: number): void;
    /** Record one local denial that was really enforced. */
    deny(now?: number): void;
    /** Frozen, content-free copy. Safe to serialize over the remote wire. */
    snapshot(): GuardStatsSnapshot;
    /**
     * Seed the counters from a persisted snapshot.
     *
     * Used once at mount so a process restart or a plugin update continues the same
     * totals instead of zeroing them. `since` keeps the original first-start time.
     */
    restore(snapshot: GuardStatsSnapshot): void;
}
/** Counters for this process; imported by the policy service that serves them. */
export declare const processGuardStats: GuardStatsRecorder;
export declare const DEFAULT_GUARD_PROFILES: Readonly<Record<GuardProfileName, GuardProfile>>;
export declare const DEFAULT_HOST_INTEGRATION: HostIntegrationConfig;
export declare const DEFAULT_GUARD_CONFIG: GuardConfig;
export declare function validateGuardConfig(input?: Partial<GuardConfig>): GuardConfig;
export declare class GuardStateStore {
    private readonly states;
    beginTurn(agent: object, turn: number, now?: number): TurnState;
    get(agent: object): TurnState | undefined;
    getOrBegin(agent: object, turn: number, now?: number): TurnState;
    clear(agent: object): void;
}
/** Options that are live rather than fixed at construction time. */
export interface EfficiencyGuardOptions {
    /**
     * Reads the live master switch on every call.
     *
     * The settings page can flip `enabled` without reloading the plugin, so a
     * value captured at construction time splits the Guard in two: the hooks would
     * honour the live switch while state creation kept honouring the stale patch
     * value. Passing this makes `admitStep`/`observeTool` use the same switch the
     * hooks use, so "off" really means no state and no reminders anywhere.
     */
    readonly isEnabled?: () => boolean;
}
export declare class EfficiencyGuard {
    readonly config: GuardConfig;
    readonly states: GuardStateStore;
    private readonly isEnabled?;
    constructor(config?: Partial<GuardConfig>, states?: GuardStateStore, options?: EfficiencyGuardOptions);
    /** The one master switch every entry point must consult. */
    private get enabled();
    resetLoopState(agent: object): void;
    admitStep(agent: object, turn: number, now?: number): GuardDecision;
    observeTool(agent: object, turn: number, observation: ToolCallObservation, now?: number): void;
}
//# sourceMappingURL=guard-core.d.ts.map