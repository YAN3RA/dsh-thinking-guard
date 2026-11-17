/**
 * Client-side Typert remote contribution for the 执行保护 (Guard) Host gateway.
 *
 * This is a SECOND contribution next to the upstream `capabilityPolicy` one
 * (`./remote.ts`): different package (this plugin's own name), different wire
 * namespace (`thinkingGuard`), its own Host face (`src/guard-host-face.ts`).
 * Both are mounted from `src/client/index.ts`, each with its own `$mount`.
 */
import { z } from 'zod'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

/** Create a strict codec for the DSH 0.2 protocol. */
function strictCodec(typeSymbol: string, schema: { parse(value: unknown): unknown }) {
  return { mode: 'strict' as const, typeSymbol, create: () => schema }
}

/** Wire package id of this plugin. Must equal `GUARD_HOST_FACE_PACKAGE`. */
export const GUARD_REMOTE_PACKAGE = 'dsh-thinking-guard'

/** Wire namespace shared with `src/guard-host-face.ts`. */
export const GUARD_REMOTE_NAMESPACE = 'thinkingGuard'

/**
 * The Guard switches the settings page exposes.
 *
 * Mirror of `GuardSwitches` in `src/guard-state.ts`; the Host validates every
 * write with the same normalizer, so this schema only has to keep the wire
 * shape honest.
 */
export interface GuardSwitches {
  readonly enabled: boolean
  readonly duplicateDetection: boolean
  readonly alternatingCycleDetection: boolean
  readonly noProgressProtection: boolean
  /** Consecutive-repeat counts that raise a reminder (1-5 ascending 2..50). */
  readonly repeatThresholds: readonly number[]
}

/** Fixed diagnostic reasons; the wire never carries free-form text. */
export type GuardDiagnosticReason = 'invalid-patch' | 'not-mounted'

/** Mirror of `GuardDiagnostics` in `src/guard-state.ts`. */
export interface GuardDiagnostics {
  readonly available: boolean
  readonly reasons: readonly GuardDiagnosticReason[]
  readonly persistence: {
    readonly dirty: boolean
    readonly lastErrorCode?: 'write-failed'
  }
}

/** Content-free Guard counters (mirror of `GuardStatsSnapshot` in guard-core). */
export interface GuardStatsSnapshot {
  readonly observations: number
  readonly reminders: { readonly repeat: number; readonly cycle: number }
  readonly denials: number
  readonly outcomes: { readonly success: number; readonly error: number; readonly cancelled: number }
  readonly lastReminderAt?: number
  readonly lastDenialAt?: number
  readonly since: number
}

/** The mounted Guard remote face as the browser sees it. */
export interface GuardRemote {
  getGuard(): Promise<RemoteResult<GuardSwitches>>
  updateGuard(change: Partial<GuardSwitches>): Promise<RemoteResult<void>>
  getGuardDiagnostics(): Promise<RemoteResult<GuardDiagnostics>>
  getGuardStats(): Promise<RemoteResult<GuardStatsSnapshot>>
}

const guardSwitches$schema = z.object({
  enabled: z.boolean(),
  duplicateDetection: z.boolean(),
  alternatingCycleDetection: z.boolean(),
  noProgressProtection: z.boolean(),
  repeatThresholds: z.array(z.number()),
})

const guardSwitchesPatch$schema = z.object({
  enabled: z.boolean().optional(),
  duplicateDetection: z.boolean().optional(),
  alternatingCycleDetection: z.boolean().optional(),
  noProgressProtection: z.boolean().optional(),
  repeatThresholds: z.array(z.number()).optional(),
})

const guardDiagnostics$schema = z.object({
  available: z.boolean(),
  reasons: z.array(z.union([z.literal('invalid-patch'), z.literal('not-mounted')])),
  persistence: z.object({
    dirty: z.boolean(),
    lastErrorCode: z.literal('write-failed').optional(),
  }),
})

const guardStats$schema = z.object({
  observations: z.number(),
  reminders: z.object({ repeat: z.number(), cycle: z.number() }),
  denials: z.number(),
  outcomes: z.object({ success: z.number(), error: z.number(), cancelled: z.number() }),
  lastReminderAt: z.number().optional(),
  lastDenialAt: z.number().optional(),
  since: z.number(),
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$7468696e6b696e674775617264 {
    getGuard: () => Promise<RemoteResult<GuardSwitches>>
    updateGuard: (change: Partial<GuardSwitches>) => Promise<RemoteResult<void>>
    getGuardDiagnostics: () => Promise<RemoteResult<GuardDiagnostics>>
    getGuardStats: () => Promise<RemoteResult<GuardStatsSnapshot>>
  }
  interface TypertRemoteMap {
    'thinkingGuard/getGuard': () => Promise<RemoteResult<GuardSwitches>>
    'thinkingGuard/updateGuard': (change: Partial<GuardSwitches>) => Promise<RemoteResult<void>>
    'thinkingGuard/getGuardDiagnostics': () => Promise<RemoteResult<GuardDiagnostics>>
    'thinkingGuard/getGuardStats': () => Promise<RemoteResult<GuardStatsSnapshot>>
  }
  interface TypertRemoteNamespaceMap {
    thinkingGuard: TypertRemoteNamespace$7468696e6b696e674775617264
  }
}

export const TYPERT_GUARD_REMOTE: TypertRemoteContribution = {
  package: GUARD_REMOTE_PACKAGE,
  descriptors: [
    {
      id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/getGuard`,
      service: GUARD_REMOTE_NAMESPACE,
      namespace: GUARD_REMOTE_NAMESPACE,
      method: 'getGuard',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardSwitches`, guardSwitches$schema),
    },
    {
      id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/updateGuard`,
      service: GUARD_REMOTE_NAMESPACE,
      namespace: GUARD_REMOTE_NAMESPACE,
      method: 'updateGuard',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'change',
        wire: 'change',
        source: 'json',
        codec: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardSwitchesPatch`, guardSwitchesPatch$schema),
      }],
      result: strictCodec('void', z.undefined()),
    },
    {
      id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/getGuardDiagnostics`,
      service: GUARD_REMOTE_NAMESPACE,
      namespace: GUARD_REMOTE_NAMESPACE,
      method: 'getGuardDiagnostics',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardDiagnostics`, guardDiagnostics$schema),
    },
    {
      id: `${GUARD_REMOTE_PACKAGE}#${GUARD_REMOTE_NAMESPACE}/getGuardStats`,
      service: GUARD_REMOTE_NAMESPACE,
      namespace: GUARD_REMOTE_NAMESPACE,
      method: 'getGuardStats',
      invocation: { kind: 'direct' },
      parameters: [],
      result: strictCodec(`${GUARD_REMOTE_PACKAGE}#GuardStatsSnapshot`, guardStats$schema),
    },
  ],
}

export default TYPERT_GUARD_REMOTE
