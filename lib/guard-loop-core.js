import { createHash } from 'node:crypto';
export const LOOP_HISTORY_LIMIT = 16;
export const DEFAULT_REPEAT_THRESHOLDS = Object.freeze([3, 5, 8]);
/** Smallest accepted repeat threshold. */
export const REPEAT_THRESHOLD_MIN = 2;
/** Largest accepted repeat threshold. */
export const REPEAT_THRESHOLD_MAX = 50;
/** How many thresholds one configuration may carry. */
export const REPEAT_THRESHOLD_LIMIT = 5;
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
export const CONSECUTIVE_COUNT_LIMIT = REPEAT_THRESHOLD_MAX + 1;
/**
 * Validate a repeat-threshold list and return a frozen copy.
 *
 * One shared validator so the settings page, the persisted state file and the
 * detector cannot disagree about what a legal list is. It throws instead of
 * coercing: silently sorting, deduplicating or clamping would make the settings
 * page claim a behaviour the detector does not have.
 */
export function normalizeRepeatThresholds(value, label = 'repeatThresholds') {
    if (!Array.isArray(value))
        throw new Error(`${label} must be an array of integers`);
    if (value.length < 1 || value.length > REPEAT_THRESHOLD_LIMIT) {
        throw new Error(`${label} must contain 1 to ${REPEAT_THRESHOLD_LIMIT} integers`);
    }
    const normalized = [];
    for (const entry of value) {
        if (typeof entry !== 'number' || !Number.isSafeInteger(entry)
            || entry < REPEAT_THRESHOLD_MIN || entry > REPEAT_THRESHOLD_MAX) {
            throw new Error(`${label} must contain integers between ${REPEAT_THRESHOLD_MIN} and ${REPEAT_THRESHOLD_MAX}`);
        }
        if (normalized.length > 0 && entry <= normalized[normalized.length - 1]) {
            throw new Error(`${label} must be strictly increasing`);
        }
        normalized.push(entry);
    }
    return Object.freeze(normalized);
}
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
export const FINGERPRINT_MAX_NODES = 20_000;
export const FINGERPRINT_MAX_DEPTH = 64;
export const FINGERPRINT_MAX_BYTES = 256 * 1024;
/** Internal signal: this value cannot be fingerprinted within budget. */
export class GuardFingerprintBudgetError extends Error {
    limit;
    constructor(limit) {
        super(`guard fingerprint budget exceeded: ${limit}`);
        this.name = 'GuardFingerprintBudgetError';
        this.limit = limit;
    }
}
export function createGuardLoopState(turn) {
    return { turn, history: [], consecutiveCount: 0 };
}
function chargeBytes(budget, text) {
    budget.bytes += Buffer.byteLength(text, 'utf8');
    if (budget.bytes > FINGERPRINT_MAX_BYTES)
        throw new GuardFingerprintBudgetError('bytes');
    return text;
}
/**
 * Canonical JSON with hard node/depth/byte budgets.
 *
 * Throws `GuardFingerprintBudgetError` the moment a budget is crossed instead of
 * returning a partial string, because a partial string is indistinguishable from
 * a complete one. The cycle check stays a `TypeError` so cyclic input keeps its
 * own error class.
 */
function canonicalJson(value, depth, budget, seen) {
    budget.nodes += 1;
    if (budget.nodes > FINGERPRINT_MAX_NODES)
        throw new GuardFingerprintBudgetError('nodes');
    if (depth > FINGERPRINT_MAX_DEPTH)
        throw new GuardFingerprintBudgetError('depth');
    if (value === null)
        return chargeBytes(budget, 'null');
    if (typeof value === 'string' || typeof value === 'boolean')
        return chargeBytes(budget, JSON.stringify(value));
    if (typeof value === 'number')
        return chargeBytes(budget, Number.isFinite(value) ? JSON.stringify(value) : 'null');
    if (typeof value === 'undefined')
        return chargeBytes(budget, '"[undefined]"');
    if (typeof value !== 'object')
        return chargeBytes(budget, JSON.stringify(String(value)));
    if (seen.has(value))
        throw new TypeError('Cannot fingerprint a cyclic value');
    seen.add(value);
    const isArray = Array.isArray(value);
    const open = chargeBytes(budget, isArray ? '[' : '{');
    let body = '';
    if (isArray) {
        const items = value;
        for (let index = 0; index < items.length; index += 1) {
            if (index > 0)
                body += chargeBytes(budget, ',');
            body += canonicalJson(items[index], depth + 1, budget, seen);
        }
    }
    else {
        const record = value;
        for (const key of Object.keys(record).sort()) {
            if (body.length > 0)
                body += chargeBytes(budget, ',');
            body += chargeBytes(budget, `${JSON.stringify(key)}:`);
            body += canonicalJson(record[key], depth + 1, budget, seen);
        }
    }
    const close = chargeBytes(budget, isArray ? ']' : '}');
    seen.delete(value);
    return `${open}${body}${close}`;
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
/**
 * Fingerprint one canonical form, or `undefined` when it cannot be proven.
 *
 * Fail-open by construction: budget overflow, cycles, and a throwing getter on
 * an otherwise plain object all resolve to "no fingerprint", never an exception
 * for the caller. `undefined` is *not* evidence that two values are equal — see
 * `fingerprintsMatch`.
 */
function boundedHash(prefix, value) {
    try {
        const canonical = canonicalJson(value, 1, { nodes: 0, bytes: 0 }, new Set());
        return sha256(`${prefix}\0${canonical}`);
    }
    catch {
        return undefined;
    }
}
/** Bounded argument signature; `undefined` means this call is not comparable. */
export function guardToolSignature(name, argumentsValue) {
    return boundedHash(name, argumentsValue);
}
/**
 * Fingerprint a result/error transiently; raw content is never returned or
 * retained. `undefined` means "cannot prove the result did not change".
 */
export function guardResultFingerprint(outcome, value) {
    return boundedHash(outcome, value);
}
/**
 * Two entries match only when *both* carry a fingerprint. A missing fingerprint
 * means "cannot prove no progress happened" and must never be read as "results
 * are identical" — otherwise every oversized result would become no-progress
 * evidence and could be denied.
 */
function fingerprintsMatch(a, b) {
    return a.outcome === b.outcome
        && a.resultFingerprint !== undefined
        && b.resultFingerprint !== undefined
        && a.resultFingerprint === b.resultFingerprint;
}
function unchangedEvidence(previous, current) {
    if (previous === undefined || !fingerprintsMatch(previous, current))
        return 'none';
    return current.outcome === 'error' ? 'unchanged-error' : 'unchanged-result';
}
function cycleLength(history) {
    const maxLength = Math.floor(history.length / 2);
    for (let length = 2; length <= maxLength; length += 1) {
        const first = history.slice(-2 * length, -length);
        const second = history.slice(-length);
        if (new Set(second.map(entry => entry.signature)).size < 2)
            continue;
        if (first.every((entry, index) => entry.signature === second[index]?.signature))
            return length;
    }
    return 0;
}
function noopDecision() {
    return {
        ignored: true,
        repeatCount: 0,
        alternatingCycle: false,
        warning: 'none',
        blockCandidate: false,
        noProgressEvidence: 'none',
    };
}
/**
 * Pure bounded detector. It never enforces a step, call-count, or duration budget.
 * Alternating cycles warn; a local-block candidate requires matching result/error
 * fingerprints for every leg of the repeated cycle.
 *
 * An observation whose argument signature exceeds the fingerprint budget is
 * dropped exactly like an excluded tool: without a stable signature there is no
 * comparable history entry, so no reminder and no block candidate is produced.
 */
export function observeGuardLoop(previousState, turn, observation, options = {}) {
    const base = previousState.turn === turn ? previousState : createGuardLoopState(turn);
    if (options.excludedTools?.has(observation.name) || options.pollingTools?.has(observation.name)) {
        return { state: base, decision: noopDecision() };
    }
    const signature = observation.signature ?? guardToolSignature(observation.name, observation.arguments);
    if (signature === undefined)
        return { state: base, decision: noopDecision() };
    const fingerprint = observation.resultFingerprint
        ?? (Object.hasOwn(observation, 'result') ? guardResultFingerprint(observation.outcome, observation.result) : undefined);
    const current = {
        ...(observation.callId !== undefined ? { callId: observation.callId } : {}),
        ...(observation.dispatchSequence !== undefined ? { dispatchSequence: observation.dispatchSequence } : {}),
        signature,
        outcome: observation.outcome,
        ...(fingerprint !== undefined ? { resultFingerprint: fingerprint } : {}),
    };
    const history = base.history.slice(-LOOP_HISTORY_LIMIT);
    // The consecutive count is an INDEPENDENT saturating counter. Deriving it from
    // `history` (capped at LOOP_HISTORY_LIMIT) made every legal threshold above 16
    // unreachable — the TG-03 defect. The counter resets whenever the signature
    // changes (see `continuesRun`) and on a new turn / effective reset (fresh state),
    // and never resets on a result change: reminders track identical CALLS, while
    // no-progress EVIDENCE is gated separately below.
    const continuesRun = base.consecutiveSignature === signature;
    const repeatCount = Math.min((continuesRun ? base.consecutiveCount : 0) + 1, CONSECUTIVE_COUNT_LIMIT);
    const previousConsecutive = history.at(-1)?.signature === signature ? history.at(-1) : undefined;
    const exactEvidence = unchangedEvidence(previousConsecutive, current);
    const nextHistory = [...history, current].slice(-LOOP_HISTORY_LIMIT);
    const cycleSize = options.disableSequenceDetection === true || options.alternatingCycleEnabled === false
        ? 0
        : cycleLength(nextHistory);
    const alternatingCycle = cycleSize > 0;
    let cycleEvidence = 'none';
    if (alternatingCycle) {
        const previousCycle = nextHistory.slice(-2 * cycleSize, -cycleSize);
        const latestCycle = nextHistory.slice(-cycleSize);
        if (previousCycle.every((entry, index) => fingerprintsMatch(entry, latestCycle[index]))) {
            cycleEvidence = 'unchanged-cycle';
        }
    }
    // Sorted before validation so an unsorted but otherwise legal list keeps working;
    // the shared validator then enforces range, count and strict ordering.
    const thresholds = normalizeRepeatThresholds([...(options.repeatThresholds ?? DEFAULT_REPEAT_THRESHOLDS)].sort((a, b) => a - b));
    const repeatThreshold = thresholds.includes(repeatCount) ? repeatCount : undefined;
    // Repeat detection and cycle detection are independent switches: neither may
    // suppress the other. `repeatCount` keeps counting even when reminders are off.
    const repeatEnabled = options.repeatDetection !== false;
    const warning = alternatingCycle ? 'alternating-cycle' : repeatEnabled && repeatThreshold !== undefined ? 'repeat' : 'none';
    const noProgressEvidence = cycleEvidence !== 'none' ? cycleEvidence : exactEvidence;
    const repeatCandidate = repeatEnabled && exactEvidence !== 'none' && repeatCount >= thresholds[thresholds.length - 1];
    const cycleCandidate = cycleEvidence !== 'none';
    const blockSource = cycleCandidate
        ? 'cycle'
        : repeatCandidate
            ? 'repeat'
            : undefined;
    const blockCandidate = options.noProgressProtection !== false
        && !options.warnOnlyTools?.has(observation.name)
        && blockSource !== undefined;
    return {
        state: { turn, history: nextHistory, consecutiveCount: repeatCount, consecutiveSignature: signature },
        decision: {
            ignored: false,
            signature,
            repeatCount,
            alternatingCycle,
            warning,
            ...(repeatThreshold !== undefined ? { repeatThreshold } : {}),
            blockCandidate,
            ...(blockCandidate && blockSource !== undefined ? { blockSource } : {}),
            noProgressEvidence,
        },
    };
}
//# sourceMappingURL=guard-loop-core.js.map