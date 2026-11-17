import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools';
import { DEFAULT_GUARD_META_TOOLS } from "./guard-state.js";
import { DEFAULT_REPEAT_THRESHOLDS, LOOP_HISTORY_LIMIT, createGuardLoopState, guardResultFingerprint, guardToolSignature, observeGuardLoop, } from "./guard-loop-core.js";
import { DEFAULT_GUARD_PROFILES, DEFAULT_HOST_INTEGRATION, EfficiencyGuard, processGuardStats, } from "./guard-core.js";
export const name = 'thinking-guard';
// The Guard owns its state now: `thinkingGuardState` is a service of this same
// package (`src/guard-state.ts`), mounted by `src/index.ts` before this plugin.
// Nothing here reads the capability menu's `policy.ts`.
export const inject = ['tools', 'thinkingGuardState'];
const DEFAULT_POLLING_TOOLS = [
    'get_image_generation_task', 'job_output', 'job_status', 'wait', 'wait_status', 'wait_for_job', 'poll_job', 'get_status',
];
const DEFAULT_WARN_ONLY_TOOLS = [
    'read', 'read_file', 'read_text_file', 'cat', 'ls', 'list_files', 'glob', 'grep', 'search', 'find', 'stat',
];
const profileSchema = z.object({
    softSteps: z.number(),
    hardSteps: z.number(),
    softToolCalls: z.number(),
    hardToolCalls: z.number(),
    softDurationMs: z.number(),
    hardDurationMs: z.number(),
});
export const Config = z.object({
    enabled: z.boolean().default(true),
    profile: z.union(['quick', 'normal', 'deep']).default('normal'),
    stepLimitMode: z.union(['warn-only', 'hard-stop']).default('warn-only'),
    duplicateDetection: z.boolean().default(true),
    alternatingCycleDetection: z.boolean().default(true),
    noProgressProtection: z.boolean().default(true),
    repeatThresholds: z.array(z.number()).default([...DEFAULT_REPEAT_THRESHOLDS]),
    duplicateWarnAfter: z.number().default(2),
    duplicateHardBlock: z.boolean().default(false),
    excludedTools: z.array(z.string()).default([]),
    pollingTools: z.array(z.string()).default([...DEFAULT_POLLING_TOOLS]),
    warnOnlyTools: z.array(z.string()).default([...DEFAULT_WARN_ONLY_TOOLS]),
    metaTools: z.array(z.string()).default([]),
    profiles: z.object({
        quick: profileSchema.default(DEFAULT_GUARD_PROFILES.quick),
        normal: profileSchema.default(DEFAULT_GUARD_PROFILES.normal),
        deep: profileSchema.default(DEFAULT_GUARD_PROFILES.deep),
    }),
    hostIntegration: z.object({
        enabled: z.boolean().default(DEFAULT_HOST_INTEGRATION.enabled),
        provider: z.string().default(DEFAULT_HOST_INTEGRATION.provider),
        preferHostTokenSaver: z.boolean().default(DEFAULT_HOST_INTEGRATION.preferHostTokenSaver),
        preferHostPromptCache: z.boolean().default(DEFAULT_HOST_INTEGRATION.preferHostPromptCache),
        maxConvergenceSteersPerTurn: z.number().default(DEFAULT_HOST_INTEGRATION.maxConvergenceSteersPerTurn),
        maxNoProgressCycles: z.number().default(DEFAULT_HOST_INTEGRATION.maxNoProgressCycles),
        loopBreakMode: z.union(['stop-next-step']).default(DEFAULT_HOST_INTEGRATION.loopBreakMode),
    }),
});
const RESERVED_TRANSPORT_TOOLS = new Set(['run_code']);
const MAX_PENDING_DISPATCHES = 64;
const MAX_LOCAL_LOOP_DENIALS = 16;
const LOOP_WARNING_LIMIT = 32;
function isControlPlaneTool(metaTools, name) {
    return RESERVED_TRANSPORT_TOOLS.has(name) || metaTools.has(name);
}
/**
 * True when this tool can never become a local-block candidate, judged from its
 * name alone. Such a call needs no result fingerprint at all, which is what lets
 * the result stage skip canonicalizing and hashing a payload it would discard.
 */
function isNonBlockableTool(metaTools, name, excludedTools, pollingTools, warnOnlyTools) {
    return isControlPlaneTool(metaTools, name)
        || excludedTools.has(name) || pollingTools.has(name) || warnOnlyTools.has(name);
}
function rememberDeniedCall(state, callId) {
    if (state.deniedCallIds.has(callId))
        return;
    if (state.deniedCallIds.size >= MAX_LOCAL_LOOP_DENIALS) {
        const oldest = state.deniedCallIds.values().next().value;
        if (oldest !== undefined)
            state.deniedCallIds.delete(oldest);
    }
    state.deniedCallIds.add(callId);
}
function rememberUserMessage(state, messageId) {
    if (state.userMessageIds.has(messageId))
        return false;
    if (state.userMessageIds.size >= LOOP_WARNING_LIMIT) {
        const oldest = state.userMessageIds.values().next().value;
        if (oldest !== undefined)
            state.userMessageIds.delete(oldest);
    }
    state.userMessageIds.add(messageId);
    return true;
}
function failOpenLoopDetection(state) {
    state.loopDetectionDisabled = true;
    state.dispatchRecords.clear();
    state.pendingLoopObservations.clear();
    state.pendingBlockCandidates.clear();
    state.loopState = createGuardLoopState(state.turn);
    state.nextLoopSequence = state.nextDispatchSequence;
}
function rememberLoopWarning(state, key) {
    if (state.loopWarnings.has(key))
        return false;
    if (state.loopWarnings.size >= LOOP_WARNING_LIMIT) {
        const oldest = state.loopWarnings.values().next().value;
        if (oldest !== undefined)
            state.loopWarnings.delete(oldest);
    }
    state.loopWarnings.add(key);
    return true;
}
function rememberBlockCandidate(state, signature, source) {
    const sources = state.pendingBlockCandidates.get(signature);
    if (sources !== undefined) {
        sources.add(source);
        return;
    }
    if (state.pendingBlockCandidates.size >= LOOP_HISTORY_LIMIT) {
        const oldest = state.pendingBlockCandidates.keys().next().value;
        if (oldest !== undefined)
            state.pendingBlockCandidates.delete(oldest);
    }
    state.pendingBlockCandidates.set(signature, new Set([source]));
}
/**
 * Consume a pending candidate, but only if the detector that produced it is still
 * enabled. A candidate whose source switch was flipped off stops counting instead
 * of being silently ignored, and the other source's candidate survives untouched.
 */
function takeBlockCandidate(state, signature, allowed) {
    const sources = state.pendingBlockCandidates.get(signature);
    if (sources === undefined)
        return false;
    for (const source of allowed) {
        if (sources.delete(source)) {
            if (sources.size === 0)
                state.pendingBlockCandidates.delete(signature);
            return true;
        }
    }
    return false;
}
function rememberBlockedSignature(state, signature) {
    if (state.blockedLoopSignatures.has(signature))
        return;
    if (state.blockedLoopSignatures.size >= MAX_LOCAL_LOOP_DENIALS) {
        const oldest = state.blockedLoopSignatures.values().next().value;
        if (oldest !== undefined)
            state.blockedLoopSignatures.delete(oldest);
    }
    state.blockedLoopSignatures.add(signature);
}
function outcomeFor(result) {
    if (!result.isError)
        return 'success';
    if (result.error.info?.code === TOOL_ABORTED || result.error.info?.code === TOOL_ABORTED_BEFORE_DISPATCH)
        return 'cancelled';
    return 'error';
}
function shortMessage(text) {
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'thinking-guard' },
    });
}
function handleLoopObservation(state, agent, observation, options) {
    if (agent === undefined || state.loopDetectionDisabled)
        return;
    const loopObserved = observeGuardLoop(state.loopState, state.turn, {
        name: observation.name,
        signature: observation.signature,
        callId: observation.callId,
        dispatchSequence: observation.dispatchSequence,
        outcome: observation.outcome,
        resultFingerprint: observation.resultFingerprint,
    }, options);
    state.loopState = loopObserved.state;
    const decision = loopObserved.decision;
    // "Did the Guard look at this call at all?" — an excluded/polling call is
    // skipped by the detector and must not inflate the observation count, or the
    // settings page would report activity the detector never had.
    if (!decision.ignored)
        processGuardStats.observe(observation.outcome);
    const signature = decision.signature;
    // No-progress protection is the evidence gate for the LOCAL denial. With it off
    // the call is still reminded about (below), but never becomes blockable, so the
    // switch in the settings page changes behaviour instead of being cosmetic.
    const blockSource = decision.blockSource;
    if (signature !== undefined && decision.blockCandidate && blockSource !== undefined
        && options.noProgressProtection !== false) {
        rememberBlockCandidate(state, signature, blockSource);
    }
    if (signature === undefined || decision.warning === 'none')
        return;
    const warningKey = `${signature}:${decision.warning}:${decision.repeatThreshold ?? LOOP_HISTORY_LIMIT}`;
    if (!rememberLoopWarning(state, warningKey))
        return;
    const message = decision.warning === 'alternating-cycle'
        ? decision.noProgressEvidence === 'none'
            ? '检测到交替工具调用序列，但结果仍变化或证据不足；暂不拒绝任何调用。'
            : '检测到交替工具调用循环且结果/错误指纹未变化；后续相同循环调用可能被局部拒绝，当前 Turn 会继续。'
        : `检测到工具调用连续重复（第 ${decision.repeatThreshold ?? decision.repeatCount} 次）；请检查已有结果，避免无意义重复。`;
    agent.inject(shortMessage(message));
    // Counted after the inject returns: a reminder the host refused to deliver is
    // not a reminder the user was ever told about.
    processGuardStats.remind(decision.warning === 'alternating-cycle' ? 'cycle' : 'repeat');
}
function createLoopOptions(metaTools, excludedTools, pollingTools, warnOnlyTools, repeatThresholds, repeatDetectionEnabled, alternatingCycleEnabled) {
    return {
        // Configured, not constant: the settings page owns this list now.
        repeatThresholds,
        excludedTools: new Set([...excludedTools, ...metaTools, ...RESERVED_TRANSPORT_TOOLS]),
        pollingTools,
        warnOnlyTools,
        repeatDetection: repeatDetectionEnabled,
        alternatingCycleEnabled,
    };
}
function toGuardConfig(config) {
    return {
        enabled: config.enabled,
        profile: config.profile,
        stepLimitMode: config.stepLimitMode,
        duplicateDetection: config.duplicateDetection,
        alternatingCycleDetection: config.alternatingCycleDetection,
        noProgressProtection: config.noProgressProtection,
        repeatThresholds: config.repeatThresholds,
        duplicateWarnAfter: config.duplicateWarnAfter,
        duplicateHardBlock: config.duplicateHardBlock,
        profiles: config.profiles === undefined ? undefined : { ...DEFAULT_GUARD_PROFILES, ...config.profiles },
        hostIntegration: config.hostIntegration === undefined ? undefined : { ...DEFAULT_HOST_INTEGRATION, ...config.hostIntegration },
    };
}
/**
 * The switch values this deployment's patch file declares, as the policy base.
 *
 * These are the middle layer of `shipped default < patch base < persisted
 * explicit override`. Only the five keys the settings page exposes are
 * published: profiles and host integration are not part of `GuardSwitches`,
 * and sending them would let the patch overwrite UI state it does not own.
 */
function toGuardBase(config) {
    return {
        ...(config.enabled !== undefined ? { enabled: config.enabled } : {}),
        ...(config.duplicateDetection !== undefined ? { duplicateDetection: config.duplicateDetection } : {}),
        ...(config.alternatingCycleDetection !== undefined
            ? { alternatingCycleDetection: config.alternatingCycleDetection } : {}),
        ...(config.noProgressProtection !== undefined ? { noProgressProtection: config.noProgressProtection } : {}),
        ...(config.repeatThresholds !== undefined ? { repeatThresholds: [...config.repeatThresholds] } : {}),
    };
}
/**
 * Register this Guard's patch values as the state service's base layer, and
 * withdraw that registration when the Guard unloads.
 *
 * The service belongs to this package (`src/guard-state.ts`), so there is no
 * startup race to wait for: it is mounted before this plugin by `src/index.ts`.
 * A minimal test host that mounts no state service simply keeps the patch
 * config, which is the only layer that exists there.
 */
function withGuardState(ctx, callback, label) {
    const state = ctx.get('thinkingGuardState');
    if (state === undefined || state === null || typeof state.getGuard !== 'function')
        return;
    let withdraw;
    try {
        withdraw = callback(state);
    }
    catch {
        // A host that predates the lifecycle entry points must not break the Guard.
        withdraw = undefined;
    }
    if (withdraw !== undefined)
        ctx.effect(() => withdraw, label);
}
/**
 * Live Guard switches, resolved by this package's own state service.
 *
 * The service is the single resolver: it already holds `shipped default < patch
 * base < persisted explicit override`, and the Guard registers its patch values
 * there as the base (see `apply`). Reading the whole object from the service
 * (instead of `live?.key ?? patch.key` per field) is what stops a defaulted
 * `getGuard()` from silently overwriting the patch: previously the service
 * always returned a fully defaulted object, so every patch value lost.
 *
 * A minimal host without the service still falls back to the patch config.
 */
function readSwitches(state, config) {
    const live = state?.getGuard();
    return {
        enabled: live?.enabled ?? config.enabled ?? true,
        duplicateDetection: live?.duplicateDetection ?? config.duplicateDetection ?? true,
        alternatingCycleDetection: live?.alternatingCycleDetection ?? config.alternatingCycleDetection ?? true,
        noProgressProtection: live?.noProgressProtection ?? config.noProgressProtection ?? true,
        // The persisted list is validated where it is written; an unreadable one here
        // must not disable detection, so the shipped default is the fallback.
        repeatThresholds: live?.repeatThresholds ?? config.repeatThresholds ?? DEFAULT_REPEAT_THRESHOLDS,
    };
}
/**
 * DSH-facing efficiency guard. All state is keyed by the live Agent object and
 * the current turn number; no conversation text or raw tool arguments are
 * persisted. Only a SHA-256 signature and bounded counters remain in memory.
 */
export function apply(ctx, config = {}) {
    if (config.stepLimitMode === 'hard-stop') {
        ctx.logger.warn('thinking-guard: stepLimitMode=hard-stop is deprecated and ignored; normal task steps are never blocked by hardSteps');
    }
    if (config.duplicateHardBlock === true) {
        ctx.logger.warn('thinking-guard: duplicateHardBlock is deprecated and ignored; duplicate calls are advisory until no-progress evidence is confirmed');
    }
    const excludedTools = new Set(config.excludedTools ?? []);
    const pollingTools = new Set([...DEFAULT_POLLING_TOOLS, ...(config.pollingTools ?? [])]);
    const warnOnlyTools = new Set([...DEFAULT_WARN_ONLY_TOOLS, ...(config.warnOnlyTools ?? [])]);
    /**
     * Control-plane names, excluded from loop detection.
     *
     * The catalog's own two control tools are the default; a patch file that
     * renames the control plane lists its names instead. They are a Guard constant
     * now instead of a read through the capability policy, so the Guard stays
     * independent of that plugin's service.
     */
    const metaTools = new Set([...DEFAULT_GUARD_META_TOOLS, ...(config.metaTools ?? [])]);
    const guardState = () => ctx.get('thinkingGuardState');
    const switches = () => readSwitches(guardState(), config);
    /**
     * Construct the Guard, or disable just this sub-plugin.
     *
     * A patch file with illegal thresholds is an operator error, not a reason to
     * take the whole plugin down: the capability catalog, policy and usage pages
     * have nothing to do with it. Previously the throw escaped `apply`, cordis
     * logged it and the fiber failed — with no machine-readable answer anywhere.
     * Now the Guard registers no hooks at all (so it cannot silently run with
     * defaults) and reports `invalid-patch` through the policy diagnostics.
     */
    let guard;
    let constructionError;
    try {
        guard = new EfficiencyGuard(toGuardConfig(config), undefined, {
            // Same live switch the hooks read: `admitStep`/`observeTool` must obey the
            // settings page too, or a UI-off Guard keeps creating turn state.
            isEnabled: () => switches().enabled,
        });
    }
    catch (error) {
        constructionError = error;
    }
    const disposers = [];
    if (guard === undefined) {
        ctx.logger.error(`thinking-guard: Guard disabled by an invalid patch: ${String(constructionError)}`);
        // Registered on the state service and withdrawn when this fiber unloads, so
        // a reload cannot inherit a dead instance's reason.
        withGuardState(ctx, state => state.noteGuardUnavailable(), 'thinking-guard: unavailable report');
        return;
    }
    const activeGuard = guard;
    /**
     * Publish the patch values as the state service's base layer.
     *
     * Bound to the service lifetime instead of a one-shot read at mount: if a
     * second Guard instance registers, or this one unloads, the base is
     * registered on the instance that actually exists and withdrawn with it.
     */
    withGuardState(ctx, state => state.registerGuardBase(toGuardBase(config)), 'thinking-guard: guard base');
    /**
     * Turn number per Agent, recorded even while the Guard is off.
     *
     * A live switch can turn the Guard ON in the middle of a turn, after the
     * pre-step that would normally have created state. Without the turn number the
     * hooks could not lazily create it, and "switched on" would silently mean
     * "works from the next turn" — the very lag the live switch is supposed to
     * remove. A WeakMap keeps this bounded by live Agents.
     */
    const turnOf = new WeakMap();
    /**
     * Turn state for the CURRENT turn, creating it only when the live switch is on.
     *
     * The previous version returned whatever state happened to be cached, which is
     * exactly how evidence crossed a turn boundary: with the Guard switched off at
     * the new pre-step, `admitStep` returned before `getOrBegin`, so the old turn's
     * state (history + pending block candidates) survived and the next turn's first
     * identical call consumed it. Every lookup now compares the cached state's turn
     * with the live turn and drops a stale one instead of reusing it.
     */
    const stateFor = (agent) => {
        const turn = turnOf.get(agent);
        if (turn === undefined)
            return undefined;
        const existing = activeGuard.states.get(agent);
        if (existing !== undefined && existing.turn !== turn)
            activeGuard.states.clear(agent);
        if (!switches().enabled)
            return undefined;
        return activeGuard.states.getOrBegin(agent, turn);
    };
    /**
     * Cached state only if it belongs to the current turn; never creates one.
     *
     * Used by read-only entry points (the local-deny guard, result observation)
     * that must not resurrect a turn, and must never read across a turn boundary.
     */
    const stateIfCurrent = (agent) => {
        const state = activeGuard.states.get(agent);
        if (state === undefined)
            return undefined;
        const turn = turnOf.get(agent);
        if (turn !== undefined && state.turn !== turn)
            return undefined;
        return state;
    };
    /**
     * True while at least one of the two detectors is on. The observation entries
     * key off this instead of `duplicateDetection` alone, so turning exact-repeat
     * detection off no longer starves the alternating-cycle detector of history.
     */
    const loopDetectionActive = () => {
        const sw = switches();
        return sw.duplicateDetection || sw.alternatingCycleDetection;
    };
    /** Candidate sources still permitted by the live switches. */
    const allowedBlockSources = () => {
        const sw = switches();
        const sources = new Set();
        if (sw.duplicateDetection)
            sources.add('repeat');
        if (sw.alternatingCycleDetection)
            sources.add('cycle');
        return sources;
    };
    const loopOptions = () => {
        const sw = switches();
        return {
            ...createLoopOptions(metaTools, excludedTools, pollingTools, warnOnlyTools, sw.repeatThresholds, sw.duplicateDetection, sw.alternatingCycleDetection),
            noProgressProtection: sw.noProgressProtection,
        };
    };
    const toolGuard = ctx.tools.guard((execution) => {
        try {
            const agent = execution.agent;
            const sw = switches();
            // Candidates are gated per source instead of by `duplicateDetection`, which
            // used to make every alternating-cycle candidate unblockable.
            const allowed = allowedBlockSources();
            // `noProgressProtection` is the gate for the LOCAL DENIAL itself, so it must
            // be re-read here and not only where a candidate is recorded. A turn can
            // record candidates while the switch is on and then have it turned off;
            // without this check those already-recorded candidates would still fire and
            // the switch would not mean what the settings page promises.
            if (!sw.enabled || sw.noProgressProtection === false || allowed.size === 0 || agent === undefined
                || isControlPlaneTool(metaTools, execution.name)
                || excludedTools.has(execution.name) || pollingTools.has(execution.name) || warnOnlyTools.has(execution.name))
                return undefined;
            // Read-only lookup: it must never resurrect a turn, and never read a
            // previous turn's pending candidate (that was the cross-turn denial).
            const state = stateIfCurrent(agent);
            if (state === undefined || state.loopDetectionDisabled)
                return undefined;
            // A signature beyond the fingerprint budget is not a stable identity, so it
            // can never justify a denial: fail open instead of comparing it.
            const signature = guardToolSignature(execution.name, execution.arguments);
            if (signature === undefined)
                return undefined;
            if (state.localLoopDenials >= MAX_LOCAL_LOOP_DENIALS
                || !takeBlockCandidate(state, signature, allowed)
                || state.blockedLoopSignatures.has(signature))
                return undefined;
            rememberBlockedSignature(state, signature);
            rememberDeniedCall(state, String(execution.callId));
            state.localLoopDenials += 1;
            // The one counter that answers "did it actually refuse anything?".
            processGuardStats.deny();
            return '检测到相同工具调用及相同结果/错误证据；已局部拒绝本次重复调用，当前 Turn 继续运行。';
        }
        catch {
            // Fail open: a Guard fault must never block a real tool call.
            return undefined;
        }
    });
    disposers.push(toolGuard);
    disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
        const agent = payload.agent;
        if (agent !== undefined) {
            const previousTurn = turnOf.get(agent);
            turnOf.set(agent, payload.turn);
            // A new turn starts here even when the Guard is OFF: the cached state is
            // from an older turn and must be discarded now, not when (or if) the switch
            // is turned back on. Otherwise turn-2's first identical call would consume
            // turn-1's pending candidate / repeat history.
            if (previousTurn !== undefined && previousTurn !== payload.turn)
                activeGuard.states.clear(agent);
        }
        activeGuard.admitStep(payload.agent, payload.turn);
        return next();
    }));
    disposers.push(ctx.on('agent/inbox/inserted', ({ agent, message }) => {
        const state = stateIfCurrent(agent);
        if (state === undefined || message.source.kind !== 'user')
            return;
        if (!rememberUserMessage(state, String(message.id)))
            return;
        activeGuard.resetLoopState(agent);
    }));
    disposers.push(ctx.on('tools/execute', async (execution, next) => {
        try {
            const agent = execution.agent;
            // Both detectors share one history, so the dispatch record must be built while
            // either switch is on; gating on `duplicateDetection` alone starved the cycle
            // detector whenever exact-repeat detection was turned off.
            if (!switches().enabled || !loopDetectionActive() || agent === undefined)
                return next();
            const state = stateFor(agent);
            if (state === undefined || state.loopDetectionDisabled)
                return next();
            const callId = String(execution.callId);
            if (state.dispatchRecords.has(callId)
                || state.dispatchRecords.size + state.pendingLoopObservations.size >= MAX_PENDING_DISPATCHES) {
                failOpenLoopDetection(state);
                return next();
            }
            const dispatchSequence = state.nextDispatchSequence;
            // A call that can never become a block candidate gets no result fingerprint:
            // the decision is name-based, so it is made here and the result stage skips
            // canonicalizing and hashing a payload it would only throw away.
            const fingerprintNeeded = !isNonBlockableTool(metaTools, execution.name, excludedTools, pollingTools, warnOnlyTools);
            // A signature beyond the fingerprint budget is not a stable identity, so the
            // call is not observed at all. The sequence number is consumed only when a
            // record is actually stored: a gap would stall the ordered drain below and
            // silently disable detection for the rest of the turn.
            const signature = guardToolSignature(execution.name, execution.arguments);
            if (signature === undefined)
                return next();
            state.nextDispatchSequence += 1;
            const epoch = state.loopEpoch;
            state.dispatchRecords.set(callId, {
                sequence: dispatchSequence, epoch, name: execution.name, signature, fingerprintNeeded,
            });
            activeGuard.observeTool(agent, state.turn, { controlPlane: isControlPlaneTool(metaTools, execution.name) });
            return next();
        }
        catch {
            // Fail open: loop detection is advisory, the tool call is not.
            return next();
        }
    }));
    disposers.push(ctx.on('tools/result', (execution, result) => {
        let activeState;
        try {
            const agent = execution.agent;
            // A result that belonged to an older turn must not be observed into the
            // new turn's history: only a state for the CURRENT turn may consume it.
            const state = agent === undefined ? undefined : stateIfCurrent(agent);
            if (!switches().enabled || agent === undefined || state === undefined)
                return;
            activeState = state;
            const callId = String(execution.callId);
            if (state.deniedCallIds.delete(callId))
                return;
            const dispatch = state.dispatchRecords.get(callId);
            if (dispatch === undefined)
                return;
            state.dispatchRecords.delete(callId);
            if (dispatch.epoch !== state.loopEpoch || !loopDetectionActive() || state.loopDetectionDisabled)
                return;
            // No fingerprint for excluded / polling / warn-only / control-plane calls, and
            // none when the payload exceeds the fingerprint budget. The result itself is
            // returned to the caller untouched either way; a missing fingerprint only
            // means "no progress cannot be proven", so it never becomes evidence.
            let resultFingerprint;
            let outcome = 'error';
            if (dispatch.fingerprintNeeded) {
                try {
                    outcome = outcomeFor(result);
                    resultFingerprint = guardResultFingerprint(outcome, result.isError
                        ? { code: result.error.info?.code ?? null, message: result.error.message, content: result.content }
                        : { value: result.value, content: result.content });
                }
                catch {
                    // A malformed host result yields no fingerprint, but the observation is
                    // still recorded below: dropping it would leave a hole in the ordered
                    // sequence and stall every later observation for the rest of the turn.
                    resultFingerprint = undefined;
                }
            }
            else {
                outcome = outcomeFor(result);
            }
            const pending = {
                name: dispatch.name,
                callId,
                dispatchSequence: dispatch.sequence,
                epoch: dispatch.epoch,
                signature: dispatch.signature,
                outcome,
                ...(resultFingerprint !== undefined ? { resultFingerprint } : {}),
            };
            if (state.pendingLoopObservations.size >= MAX_PENDING_DISPATCHES) {
                failOpenLoopDetection(state);
                return;
            }
            state.pendingLoopObservations.set(dispatch.sequence, pending);
            while (state.pendingLoopObservations.has(state.nextLoopSequence)) {
                const observation = state.pendingLoopObservations.get(state.nextLoopSequence);
                state.pendingLoopObservations.delete(state.nextLoopSequence);
                state.nextLoopSequence += 1;
                if (observation === null || observation === undefined || observation.epoch !== state.loopEpoch)
                    continue;
                handleLoopObservation(state, agent, observation, loopOptions());
            }
        }
        catch {
            // Fail open: a Guard fault must never disturb the real tool result. The
            // ordered drain advances its cursor before handling each observation, so a
            // throw cannot leave a permanent gap; resetting detection for the rest of the
            // turn is a conservative extra: after an unknown fault the Guard stops
            // producing evidence instead of continuing from possibly stale history.
            if (activeState !== undefined)
                failOpenLoopDetection(activeState);
        }
    }));
    disposers.push(ctx.on('agent/disposed', ({ agent }) => activeGuard.states.clear(agent)));
    // The live switch, not the constructed snapshot: with the settings page able to
    // flip `enabled`, reporting the patch value here would describe a state the
    // Guard may no longer be in.
    ctx.logger.info(`thinking-guard: ${switches().enabled ? 'enabled' : 'disabled'}; host Token Saver/Prompt Cache remain owned by the host and existing Save Token plugin`);
    ctx.effect(() => () => {
        for (const dispose of disposers.splice(0))
            dispose();
    }, 'thinking-guard: cleanup');
}
//# sourceMappingURL=guard.js.map