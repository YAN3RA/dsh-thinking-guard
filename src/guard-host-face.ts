/**
 * Host-face Typert contribution for the `thinkingGuard` namespace.
 *
 * WHY A SECOND FACE — `@deepseek-ai/dsh-api-gateway` freezes its claim set on
 * first evaluation, and only `ctx.typert.register()` puts an endpoint into the
 * local store that `claimsEndpoint()` consults dynamically. The upstream
 * `capabilityPolicy` face already does this for its namespace; the Guard's
 * namespace needs its own registration with its own package id, because a face
 * belongs to exactly one package and the two faces must not share a single
 * `register()` call (task item 3: different package name, separate registration).
 *
 * The wire metadata mirrors the browser descriptors in `src/client/guard-remote.ts`;
 * keep the two tables in step. Codecs are pass-through: the gateway decodes
 * arguments with `codec.create().parse(value)`, while the real argument and
 * result types are enforced by the method signatures in `src/server/guard-remote.ts`.
 *
 * @module dsh-thinking-guard/guard-host-face
 */
import type { Context } from '@deepseek-ai/cordis'

/** Package that owns this face — this plugin's own package name. */
export const GUARD_HOST_FACE_PACKAGE = 'dsh-thinking-guard'

/** Wire namespace shared with the browser face. */
export const GUARD_HOST_FACE_NAMESPACE = 'thinkingGuard'

/** Service key the gateway registers under; must match `src/server/guard-remote.ts`. */
export const GUARD_HOST_FACE_SERVICE = 'thinkingGuardGateway'

/** One wire parameter of a registered invocation. */
export interface HostFaceParameter {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly acceptsUndefined?: true
  readonly codec: HostFaceCodec
}

/** Strict codec as the gateway consumes it (`create().parse` on decode). */
export interface HostFaceCodec {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly create: () => { parse: (value: unknown) => unknown }
}

/** One registered invocation of the host face. */
export interface HostFaceInvocation {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly HostFaceParameter[]
  readonly result: HostFaceCodec
}

/** Contribution accepted by `ctx.typert.register()`. */
export interface TypertHostFace {
  readonly package: string
  readonly face: 'host'
  readonly schemas: readonly never[]
  readonly invocations: readonly HostFaceInvocation[]
  readonly model: {
    readonly services: readonly never[]
    readonly events: readonly never[]
    readonly objects: readonly never[]
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Typert registry; redeclared locally for the one call this file makes. */
    typert: {
      register(contribution: TypertHostFace): unknown
    }
  }
}

function passThroughCodec(typeSymbol: string): HostFaceCodec {
  return { mode: 'strict', typeSymbol, create: () => ({ parse: (value: unknown) => value }) }
}

function jsonParameter(wire: string, optional: boolean): HostFaceParameter {
  return {
    name: wire,
    wire,
    source: 'json',
    ...(optional ? { acceptsUndefined: true as const } : {}),
    codec: passThroughCodec(wire),
  }
}

/** `[method, required wire fields, optional wire fields]`, in gateway order. */
const METHODS: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
  ['getGuard', [], []],
  ['updateGuard', ['change'], []],
  ['getGuardDiagnostics', [], []],
  ['getGuardStats', [], []],
]

/** Build the host face for the `thinkingGuard` namespace. */
export function guardHostFace(): TypertHostFace {
  return {
    package: GUARD_HOST_FACE_PACKAGE,
    face: 'host',
    // Every codec travels with its invocation, so there is no schema for the
    // registry to resolve.
    schemas: [],
    invocations: METHODS.map(([method, required, optional]) => ({
      id: `${GUARD_HOST_FACE_PACKAGE}#${GUARD_HOST_FACE_NAMESPACE}/${method}`,
      service: GUARD_HOST_FACE_SERVICE,
      namespace: GUARD_HOST_FACE_NAMESPACE,
      method,
      invocation: { kind: 'direct' as const },
      parameters: [
        ...required.map(wire => jsonParameter(wire, false)),
        ...optional.map(wire => jsonParameter(wire, true)),
      ],
      result: passThroughCodec(`${GUARD_HOST_FACE_PACKAGE}#${GUARD_HOST_FACE_NAMESPACE}/${method}:result`),
    })),
    model: { services: [], events: [], objects: [] },
  }
}

/**
 * Claim the `thinkingGuard` namespace on a host that has a Typert registry.
 * Called from `ctx.inject(['typert'], …)` so hosts without the registry are
 * unaffected.
 */
export function registerGuardHostFace(ctx: Context): void {
  ctx.typert.register(guardHostFace())
}
