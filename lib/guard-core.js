import { DEFAULT_REPEAT_THRESHOLDS, createGuardLoopState, normalizeRepeatThresholds, } from "./guard-loop-core.js";
/** Saturating increment: counters stay finite and exact for any real session. */
function bumpCounter(value) {
    return value >= Number.MAX_SAFE_INTEGER ? value : value + 1;
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
export class GuardStatsRecorder {
    startedAt;
    observations = 0;
    repeatReminders = 0;
    cycleReminders = 0;
    denials = 0;
    successes = 0;
    errors = 0;
    cancellations = 0;
    lastReminderAt;
    lastDenialAt;
    constructor(now = Date.now()) {
        this.startedAt = now;
    }
    /** Record one call the detector observed, by its outcome class. */
    observe(outcome, _now = Date.now()) {
        this.observations = bumpCounter(this.observations);
        if (outcome === 'success')
            this.successes = bumpCounter(this.successes);
        else if (outcome === 'error')
            this.errors = bumpCounter(this.errors);
        else if (outcome === 'cancelled')
            this.cancellations = bumpCounter(this.cancellations);
    }
    /** Record one reminder that was really delivered to the Agent. */
    remind(kind, now = Date.now()) {
        if (kind === 'cycle')
            this.cycleReminders = bumpCounter(this.cycleReminders);
        else
            this.repeatReminders = bumpCounter(this.repeatReminders);
        this.lastReminderAt = now;
    }
    /** Record one local denial that was really enforced. */
    deny(now = Date.now()) {
        this.denials = bumpCounter(this.denials);
        this.lastDenialAt = now;
    }
    /** Frozen, content-free copy. Safe to serialize over the remote wire. */
    snapshot() {
        return {
            observations: this.observations,
            reminders: { repeat: this.repeatReminders, cycle: this.cycleReminders },
            denials: this.denials,
            outcomes: { success: this.successes, error: this.errors, cancelled: this.cancellations },
            ...(this.lastReminderAt !== undefined ? { lastReminderAt: this.lastReminderAt } : {}),
            ...(this.lastDenialAt !== undefined ? { lastDenialAt: this.lastDenialAt } : {}),
            since: this.startedAt,
        };
    }
}
/** Counters for this process; imported by the policy service that serves them. */
export const processGuardStats = new GuardStatsRecorder();
export const DEFAULT_GUARD_PROFILES = {
    quick: {
        softSteps: 3,
        hardSteps: 5,
        softToolCalls: 6,
        hardToolCalls: 8,
        softDurationMs: 120_000,
        hardDurationMs: 240_000,
    },
    normal: {
        softSteps: 5,
        hardSteps: 8,
        softToolCalls: 9,
        hardToolCalls: 12,
        softDurationMs: 300_000,
        hardDurationMs: 480_000,
    },
    deep: {
        softSteps: 10,
        hardSteps: 14,
        softToolCalls: 18,
        hardToolCalls: 25,
        softDurationMs: 720_000,
        hardDurationMs: 1_200_000,
    },
};
export const DEFAULT_HOST_INTEGRATION = {
    enabled: true,
    provider: 'pi-desktop',
    preferHostTokenSaver: true,
    preferHostPromptCache: true,
    maxConvergenceSteersPerTurn: 1,
    maxNoProgressCycles: 2,
    loopBreakMode: 'stop-next-step',
};
export const DEFAULT_GUARD_CONFIG = {
    enabled: true,
    profile: 'normal',
    stepLimitMode: 'warn-only',
    duplicateDetection: true,
    alternatingCycleDetection: true,
    noProgressProtection: true,
    duplicateWarnAfter: 2,
    duplicateHardBlock: false,
    profiles: DEFAULT_GUARD_PROFILES,
    hostIntegration: DEFAULT_HOST_INTEGRATION,
    repeatThresholds: DEFAULT_REPEAT_THRESHOLDS,
};
function assertPositiveInteger(name, value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive safe integer`);
    }
}
function validateProfile(name, profile) {
    assertPositiveInteger(`${name}.softSteps`, profile.softSteps);
    assertPositiveInteger(`${name}.hardSteps`, profile.hardSteps);
    assertPositiveInteger(`${name}.softToolCalls`, profile.softToolCalls);
    assertPositiveInteger(`${name}.hardToolCalls`, profile.hardToolCalls);
    assertPositiveInteger(`${name}.softDurationMs`, profile.softDurationMs);
    assertPositiveInteger(`${name}.hardDurationMs`, profile.hardDurationMs);
    if (profile.softSteps >= profile.hardSteps)
        throw new Error(`${name}.softSteps must be less than hardSteps`);
    if (profile.softToolCalls >= profile.hardToolCalls)
        throw new Error(`${name}.softToolCalls must be less than hardToolCalls`);
    if (profile.softDurationMs >= profile.hardDurationMs)
        throw new Error(`${name}.softDurationMs must be less than hardDurationMs`);
    return profile;
}
export function validateGuardConfig(input = {}) {
    const profiles = { ...DEFAULT_GUARD_PROFILES, ...(input.profiles ?? {}) };
    for (const name of ['quick', 'normal', 'deep'])
        validateProfile(`profiles.${name}`, profiles[name]);
    if (input.profile !== undefined && !['quick', 'normal', 'deep'].includes(input.profile)) {
        throw new Error(`profile must be quick, normal, or deep`);
    }
    if (input.stepLimitMode !== undefined && !['warn-only', 'hard-stop'].includes(input.stepLimitMode)) {
        throw new Error('stepLimitMode must be warn-only or hard-stop');
    }
    const duplicateWarnAfter = input.duplicateWarnAfter ?? DEFAULT_GUARD_CONFIG.duplicateWarnAfter;
    assertPositiveInteger('duplicateWarnAfter', duplicateWarnAfter);
    const host = { ...DEFAULT_HOST_INTEGRATION, ...(input.hostIntegration ?? {}) };
    assertPositiveInteger('hostIntegration.maxConvergenceSteersPerTurn', host.maxConvergenceSteersPerTurn);
    assertPositiveInteger('hostIntegration.maxNoProgressCycles', host.maxNoProgressCycles);
    if (host.loopBreakMode !== 'stop-next-step')
        throw new Error('hostIntegration.loopBreakMode must be stop-next-step');
    // An absent list falls back to the shipped default; a present one must be legal.
    const repeatThresholds = input.repeatThresholds === undefined
        ? DEFAULT_REPEAT_THRESHOLDS
        : normalizeRepeatThresholds(input.repeatThresholds);
    return {
        ...DEFAULT_GUARD_CONFIG,
        ...input,
        enabled: input.enabled ?? DEFAULT_GUARD_CONFIG.enabled,
        profile: input.profile ?? DEFAULT_GUARD_CONFIG.profile,
        duplicateDetection: input.duplicateDetection ?? DEFAULT_GUARD_CONFIG.duplicateDetection,
        alternatingCycleDetection: input.alternatingCycleDetection ?? DEFAULT_GUARD_CONFIG.alternatingCycleDetection,
        noProgressProtection: input.noProgressProtection ?? DEFAULT_GUARD_CONFIG.noProgressProtection,
        stepLimitMode: 'warn-only',
        duplicateHardBlock: false,
        profiles,
        duplicateWarnAfter,
        hostIntegration: host,
        repeatThresholds,
    };
}
export class GuardStateStore {
    states = new WeakMap();
    beginTurn(agent, turn, now = Date.now()) {
        const state = {
            turn,
            startedAt: now,
            loopEpoch: 0,
            nextDispatchSequence: 0,
            nextLoopSequence: 0,
            loopDetectionDisabled: false,
            userMessageIds: new Set(),
            dispatchRecords: new Map(),
            pendingLoopObservations: new Map(),
            loopState: createGuardLoopState(turn),
            pendingBlockCandidates: new Map(),
            blockedLoopSignatures: new Set(),
            deniedCallIds: new Set(),
            localLoopDenials: 0,
            loopWarnings: new Set(),
            modelSteps: 0,
            businessToolCalls: 0,
            lastActivityAt: now,
        };
        this.states.set(agent, state);
        return state;
    }
    get(agent) {
        return this.states.get(agent);
    }
    getOrBegin(agent, turn, now = Date.now()) {
        const current = this.states.get(agent);
        return current?.turn === turn ? current : this.beginTurn(agent, turn, now);
    }
    clear(agent) {
        this.states.delete(agent);
    }
}
export class EfficiencyGuard {
    config;
    states;
    isEnabled;
    constructor(config = {}, states = new GuardStateStore(), options = {}) {
        this.config = validateGuardConfig(config);
        this.states = states;
        this.isEnabled = options.isEnabled;
    }
    /** The one master switch every entry point must consult. */
    get enabled() {
        // A live reader wins; without one the constructed config is the only truth.
        return this.isEnabled === undefined ? this.config.enabled : this.isEnabled();
    }
    resetLoopState(agent) {
        const state = this.states.get(agent);
        if (state === undefined)
            return;
        state.loopEpoch += 1;
        state.nextDispatchSequence = 0;
        state.nextLoopSequence = 0;
        state.loopDetectionDisabled = false;
        state.dispatchRecords.clear();
        state.pendingLoopObservations.clear();
        state.loopState = createGuardLoopState(state.turn);
        state.pendingBlockCandidates.clear();
        state.blockedLoopSignatures.clear();
        state.deniedCallIds.clear();
        state.localLoopDenials = 0;
        state.loopWarnings.clear();
    }
    admitStep(agent, turn, now = Date.now()) {
        if (!this.enabled)
            return { kind: 'allow' };
        const state = this.states.getOrBegin(agent, turn, now);
        state.modelSteps += 1;
        state.lastActivityAt = now;
        return { kind: 'allow' };
    }
    observeTool(agent, turn, observation, now = Date.now()) {
        if (!this.enabled)
            return;
        const state = this.states.getOrBegin(agent, turn, now);
        if (observation.denied || observation.controlPlane)
            return;
        state.businessToolCalls += 1;
        state.lastActivityAt = now;
    }
}
//# sourceMappingURL=guard-core.js.map