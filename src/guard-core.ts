import {
  DEFAULT_REPEAT_THRESHOLDS,
  createGuardLoopState,
  normalizeRepeatThresholds,
  type GuardLoopBlockSource,
  type GuardLoopState,
  type GuardToolOutcome,
} from './guard-loop-core.ts'

export type GuardProfileName = 'quick' | 'normal' | 'deep'

export interface GuardProfile {
  readonly softSteps: number
  readonly hardSteps: number
  readonly softToolCalls: number
  readonly hardToolCalls: number
  readonly softDurationMs: number
  readonly hardDurationMs: number
}

export interface HostIntegrationConfig {
  readonly enabled: boolean
  readonly provider: 'pi-desktop' | string
  readonly preferHostTokenSaver: boolean
  readonly preferHostPromptCache: boolean
  /** @deprecated Accepted for compatibility only; no convergence steer is emitted. */
  readonly maxConvergenceSteersPerTurn: number
  /** @deprecated Accepted for compatibility only; no no-progress stop is applied. */
  readonly maxNoProgressCycles: number
  /** @deprecated Accepted for compatibility only; never rejects the next step. */
  readonly loopBreakMode: 'stop-next-step'
}

export interface GuardConfig {
  readonly enabled: boolean
  readonly profile: GuardProfileName
  /** @deprecated Kept for old configs; validation always resolves to warn-only. */
  readonly stepLimitMode: 'warn-only' | 'hard-stop'
  readonly duplicateDetection: boolean
  /**
   * Alternating-cycle detection (A -> B -> A -> B).
   *
   * Split out of `duplicateDetection` because the settings page exposes the three
   * capabilities as independent switches; a single master flag would make two of
   * them cosmetic. Off means the sequence detector reports no cycle.
   */
  readonly alternatingCycleDetection: boolean
  /**
   * No-progress protection: the evidence gate for locally denying a repeated call.
   *
   * Off means a repeated call may still be *reminded* about, but never denied —
   * the detector keeps its history and the reminder path is unchanged.
   */
  readonly noProgressProtection: boolean
  /** @deprecated Compatibility-only; see `repeatThresholds` for the live list. */
  readonly duplicateWarnAfter: number
  /** @deprecated Accepted for migration only; validated as false. */
  readonly duplicateHardBlock: boolean
  readonly profiles: Readonly<Record<GuardProfileName, GuardProfile>>
  readonly hostIntegration: HostIntegrationConfig
  /** Repeat counts that raise a reminder; strictly increasing, 2..50, 1..5 entries. */
  readonly repeatThresholds: readonly number[]
}

export interface ToolCallObservation {
  readonly controlPlane?: boolean
  readonly denied?: boolean
}

export interface PendingLoopObservation {
  readonly name: string
  readonly callId: string
  readonly dispatchSequence: number
  readonly epoch: number
  readonly signature: string
  readonly outcome: GuardToolOutcome
  /**
   * Omitted when the dispatch was known not to need a fingerprint, or when the
   * result exceeded the fingerprint budget. Absence means "no progress cannot be
   * proven", never "the result is identical" — see `fingerprintsMatch` in
   * guard-loop-core.
   */
  readonly resultFingerprint?: string
}

export interface DispatchRecord {
  readonly sequence: number
  readonly epoch: number
  readonly name: string
  readonly signature: string
  /**
   * Decided at dispatch time from the tool name alone: excluded / polling /
   * warn-only / control-plane calls can never become a block candidate, so their
   * result is never canonicalized or hashed. This skips the work instead of
   * computing a fingerprint the detector then discards.
   */
  readonly fingerprintNeeded: boolean
}

export interface TurnState {
  readonly turn: number
  readonly startedAt: number
  loopEpoch: number
  nextDispatchSequence: number
  nextLoopSequence: number
  loopDetectionDisabled: boolean
  readonly userMessageIds: Set<string>
  readonly dispatchRecords: Map<string, DispatchRecord>
  readonly pendingLoopObservations: Map<number, PendingLoopObservation | null>
  loopState: GuardLoopState
  /**
   * Pending local-denial candidates keyed by tool signature, each holding the
   * detector(s) that produced it. Keeping both sources per signature is what makes
   * `duplicateDetection` and `alternatingCycleDetection` independent: a repeat
   * candidate and a cycle candidate for the same call never overwrite each other.
   */
  readonly pendingBlockCandidates: Map<string, Set<GuardLoopBlockSource>>
  readonly blockedLoopSignatures: Set<string>
  readonly deniedCallIds: Set<string>
  localLoopDenials: number
  readonly loopWarnings: Set<string>
  modelSteps: number
  businessToolCalls: number
  lastActivityAt: number
}

export type GuardDecision = { readonly kind: 'allow' }

/** Which reminder the Guard actually delivered. */
export type GuardReminderKind = 'repeat' | 'cycle'

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
  readonly observations: number
  /** Reminders actually delivered, split by which detector produced them. */
  readonly reminders: { readonly repeat: number; readonly cycle: number }
  /** Local denials actually enforced by `ctx.tools.guard`. */
  readonly denials: number
  /** Outcome class of the observed calls. Denials are counted in `denials`, not here. */
  readonly outcomes: { readonly success: number; readonly error: number; readonly cancelled: number }
  /** Milliseconds timestamp of the most recent delivered reminder. */
  readonly lastReminderAt?: number
  /** Milliseconds timestamp of the most recent enforced denial. */
  readonly lastDenialAt?: number
  /** Milliseconds timestamp this recorder started counting. */
  readonly since: number
}

/** Saturating increment: counters stay finite and exact for any real session. */
function bumpCounter(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? value : value + 1
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
  private startedAt: number
  private observations = 0
  private repeatReminders = 0
  private cycleReminders = 0
  private denials = 0
  private successes = 0
  private errors = 0
  private cancellations = 0
  private lastReminderAt: number | undefined
  private lastDenialAt: number | undefined

  constructor(now = Date.now()) {
    this.startedAt = now
  }

  /** Record one call the detector observed, by its outcome class. */
  observe(outcome: GuardToolOutcome, _now = Date.now()): void {
    this.observations = bumpCounter(this.observations)
    if (outcome === 'success') this.successes = bumpCounter(this.successes)
    else if (outcome === 'error') this.errors = bumpCounter(this.errors)
    else if (outcome === 'cancelled') this.cancellations = bumpCounter(this.cancellations)
  }

  /** Record one reminder that was really delivered to the Agent. */
  remind(kind: GuardReminderKind, now = Date.now()): void {
    if (kind === 'cycle') this.cycleReminders = bumpCounter(this.cycleReminders)
    else this.repeatReminders = bumpCounter(this.repeatReminders)
    this.lastReminderAt = now
  }

  /** Record one local denial that was really enforced. */
  deny(now = Date.now()): void {
    this.denials = bumpCounter(this.denials)
    this.lastDenialAt = now
  }

  /** Frozen, content-free copy. Safe to serialize over the remote wire. */
  snapshot(): GuardStatsSnapshot {
    return {
      observations: this.observations,
      reminders: { repeat: this.repeatReminders, cycle: this.cycleReminders },
      denials: this.denials,
      outcomes: { success: this.successes, error: this.errors, cancelled: this.cancellations },
      ...(this.lastReminderAt !== undefined ? { lastReminderAt: this.lastReminderAt } : {}),
      ...(this.lastDenialAt !== undefined ? { lastDenialAt: this.lastDenialAt } : {}),
      since: this.startedAt,
    }
  }

  /**
   * Seed the counters from a persisted snapshot.
   *
   * Used once at mount so a process restart or a plugin update continues the same
   * totals instead of zeroing them. `since` keeps the original first-start time.
   */
  restore(snapshot: GuardStatsSnapshot): void {
    this.observations = snapshot.observations
    this.repeatReminders = snapshot.reminders.repeat
    this.cycleReminders = snapshot.reminders.cycle
    this.denials = snapshot.denials
    this.successes = snapshot.outcomes.success
    this.errors = snapshot.outcomes.error
    this.cancellations = snapshot.outcomes.cancelled
    this.lastReminderAt = snapshot.lastReminderAt
    this.lastDenialAt = snapshot.lastDenialAt
    this.startedAt = snapshot.since
  }
}

/** Counters for this process; imported by the policy service that serves them. */
export const processGuardStats = new GuardStatsRecorder()

export const DEFAULT_GUARD_PROFILES: Readonly<Record<GuardProfileName, GuardProfile>> = {
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
}

export const DEFAULT_HOST_INTEGRATION: HostIntegrationConfig = {
  enabled: true,
  provider: 'pi-desktop',
  preferHostTokenSaver: true,
  preferHostPromptCache: true,
  maxConvergenceSteersPerTurn: 1,
  maxNoProgressCycles: 2,
  loopBreakMode: 'stop-next-step',
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
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
}

function assertPositiveInteger(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

function validateProfile(name: string, profile: GuardProfile): GuardProfile {
  assertPositiveInteger(`${name}.softSteps`, profile.softSteps)
  assertPositiveInteger(`${name}.hardSteps`, profile.hardSteps)
  assertPositiveInteger(`${name}.softToolCalls`, profile.softToolCalls)
  assertPositiveInteger(`${name}.hardToolCalls`, profile.hardToolCalls)
  assertPositiveInteger(`${name}.softDurationMs`, profile.softDurationMs)
  assertPositiveInteger(`${name}.hardDurationMs`, profile.hardDurationMs)
  if (profile.softSteps >= profile.hardSteps) throw new Error(`${name}.softSteps must be less than hardSteps`)
  if (profile.softToolCalls >= profile.hardToolCalls) throw new Error(`${name}.softToolCalls must be less than hardToolCalls`)
  if (profile.softDurationMs >= profile.hardDurationMs) throw new Error(`${name}.softDurationMs must be less than hardDurationMs`)
  return profile
}

export function validateGuardConfig(input: Partial<GuardConfig> = {}): GuardConfig {
  const profiles = { ...DEFAULT_GUARD_PROFILES, ...(input.profiles ?? {}) }
  for (const name of ['quick', 'normal', 'deep'] as const) validateProfile(`profiles.${name}`, profiles[name])
  if (input.profile !== undefined && !['quick', 'normal', 'deep'].includes(input.profile)) {
    throw new Error(`profile must be quick, normal, or deep`)
  }
  if (input.stepLimitMode !== undefined && !['warn-only', 'hard-stop'].includes(input.stepLimitMode)) {
    throw new Error('stepLimitMode must be warn-only or hard-stop')
  }
  const duplicateWarnAfter = input.duplicateWarnAfter ?? DEFAULT_GUARD_CONFIG.duplicateWarnAfter
  assertPositiveInteger('duplicateWarnAfter', duplicateWarnAfter)
  const host = { ...DEFAULT_HOST_INTEGRATION, ...(input.hostIntegration ?? {}) }
  assertPositiveInteger('hostIntegration.maxConvergenceSteersPerTurn', host.maxConvergenceSteersPerTurn)
  assertPositiveInteger('hostIntegration.maxNoProgressCycles', host.maxNoProgressCycles)
  if (host.loopBreakMode !== 'stop-next-step') throw new Error('hostIntegration.loopBreakMode must be stop-next-step')
  // An absent list falls back to the shipped default; a present one must be legal.
  const repeatThresholds = input.repeatThresholds === undefined
    ? DEFAULT_REPEAT_THRESHOLDS
    : normalizeRepeatThresholds(input.repeatThresholds)
  return {
    ...DEFAULT_GUARD_CONFIG,
    ...input,
    enabled: input.enabled ?? DEFAULT_GUARD_CONFIG.enabled,
    profile: input.profile ?? DEFAULT_GUARD_CONFIG.profile,
    duplicateDetection: input.duplicateDetection ?? DEFAULT_GUARD_CONFIG.duplicateDetection,
    alternatingCycleDetection:
      input.alternatingCycleDetection ?? DEFAULT_GUARD_CONFIG.alternatingCycleDetection,
    noProgressProtection: input.noProgressProtection ?? DEFAULT_GUARD_CONFIG.noProgressProtection,
    stepLimitMode: 'warn-only',
    duplicateHardBlock: false,
    profiles,
    duplicateWarnAfter,
    hostIntegration: host,
    repeatThresholds,
  }
}

export class GuardStateStore {
  private readonly states = new WeakMap<object, TurnState>()

  beginTurn(agent: object, turn: number, now = Date.now()): TurnState {
    const state: TurnState = {
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
    }
    this.states.set(agent, state)
    return state
  }

  get(agent: object): TurnState | undefined {
    return this.states.get(agent)
  }

  getOrBegin(agent: object, turn: number, now = Date.now()): TurnState {
    const current = this.states.get(agent)
    return current?.turn === turn ? current : this.beginTurn(agent, turn, now)
  }

  clear(agent: object): void {
    this.states.delete(agent)
  }
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
  readonly isEnabled?: () => boolean
}

export class EfficiencyGuard {
  readonly config: GuardConfig
  readonly states: GuardStateStore
  private readonly isEnabled?: () => boolean

  constructor(
    config: Partial<GuardConfig> = {},
    states = new GuardStateStore(),
    options: EfficiencyGuardOptions = {},
  ) {
    this.config = validateGuardConfig(config)
    this.states = states
    this.isEnabled = options.isEnabled
  }

  /** The one master switch every entry point must consult. */
  private get enabled(): boolean {
    // A live reader wins; without one the constructed config is the only truth.
    return this.isEnabled === undefined ? this.config.enabled : this.isEnabled()
  }

  resetLoopState(agent: object): void {
    const state = this.states.get(agent)
    if (state === undefined) return
    state.loopEpoch += 1
    state.nextDispatchSequence = 0
    state.nextLoopSequence = 0
    state.loopDetectionDisabled = false
    state.dispatchRecords.clear()
    state.pendingLoopObservations.clear()
    state.loopState = createGuardLoopState(state.turn)
    state.pendingBlockCandidates.clear()
    state.blockedLoopSignatures.clear()
    state.deniedCallIds.clear()
    state.localLoopDenials = 0
    state.loopWarnings.clear()
  }

  admitStep(agent: object, turn: number, now = Date.now()): GuardDecision {
    if (!this.enabled) return { kind: 'allow' }
    const state = this.states.getOrBegin(agent, turn, now)
    state.modelSteps += 1
    state.lastActivityAt = now
    return { kind: 'allow' }
  }
  observeTool(agent: object, turn: number, observation: ToolCallObservation, now = Date.now()): void {
    if (!this.enabled) return
    const state = this.states.getOrBegin(agent, turn, now)
    if (observation.denied || observation.controlPlane) return
    state.businessToolCalls += 1
    state.lastActivityAt = now
  }
}
