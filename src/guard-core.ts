import { createGuardLoopState, type GuardLoopBlockSource, type GuardLoopState, type GuardToolOutcome } from './guard-loop-core.ts'

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
  /** @deprecated Compatibility-only; N7 uses fixed 3/5/8 thresholds. */
  readonly duplicateWarnAfter: number
  /** @deprecated Accepted for migration only; validated as false. */
  readonly duplicateHardBlock: boolean
  readonly profiles: Readonly<Record<GuardProfileName, GuardProfile>>
  readonly hostIntegration: HostIntegrationConfig
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

export class EfficiencyGuard {
  readonly config: GuardConfig
  readonly states: GuardStateStore

  constructor(config: Partial<GuardConfig> = {}, states = new GuardStateStore()) {
    this.config = validateGuardConfig(config)
    this.states = states
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
    if (!this.config.enabled) return { kind: 'allow' }
    const state = this.states.getOrBegin(agent, turn, now)
    state.modelSteps += 1
    state.lastActivityAt = now
    return { kind: 'allow' }
  }
  observeTool(agent: object, turn: number, observation: ToolCallObservation, now = Date.now()): void {
    if (!this.config.enabled) return
    const state = this.states.getOrBegin(agent, turn, now)
    if (observation.denied || observation.controlPlane) return
    state.businessToolCalls += 1
    state.lastActivityAt = now
  }
}
