/**
 * Host-face Typert contribution for the `capabilityPolicy` namespace.
 *
 * WHY THIS EXISTS — the claim set of `@deepseek-ai/dsh-api-gateway` is built
 * once and then frozen. `claimsEndpoint()` decides whether an
 * `/api/<namespace>/<method>` request belongs to the gateway:
 *
 *     claimsEndpoint(endpoint) {
 *       if (this.ctx.typert.local.get(endpoint) !== void 0 || …hasSeen(endpoint)) return true
 *       this.srcClaims ??= this.collectSrcClaims()   // ← built once, never refreshed
 *       return this.srcClaims.has(endpoint)
 *     }
 *
 * `collectSrcClaims()` only sees the services that were already visible in
 * `ctx.reflect.props` at the moment of that first evaluation, and the snapshot is
 * only dropped again by an `internal/service` event. A host that starts serving
 * the browser before this package's gateway has registered therefore freezes a
 * claim set without `capabilityPolicy` — and then every 能力菜单 call falls
 * through to the default answer, which the browser reports as
 * `transport failure for /api/capabilityPolicy/…: HTTP 404`. The official
 * desktop application hits that ordering: `dsh-desktop-host` hands the window
 * its authenticated URL as soon as the profile is ready, and the renderer fires
 * `/api/session/…` immediately.
 *
 * `ctx.typert.register()` is the documented path for contributions that do not
 * ship a generated `./typert` artifact (`@deepseek-ai/dsh-typert-loader`: *"Manual
 * `ctx.typert.register()` remains available for contributions that do not use a
 * `./typert` artifact"*). Registering the namespace here puts every endpoint into
 * the **local** store, which `claimsEndpoint()` consults dynamically — so
 * whether the panel can reach the host stops depending on who won the startup
 * race.
 *
 * The wire metadata mirrors the browser face in `src/client/remote.ts`; keep the
 * two tables in step (`tests/host-face.spec.ts` fails when they drift). The
 * codecs are deliberately pass-through: the gateway decodes arguments with
 * `codec.create().parse(value)` and encodes a strict result with
 * `codec.encode?.(value) ?? value`, while the real argument and result types are
 * already enforced by the method signatures in `src/server/remote.ts`.
 *
 * @module @daweifu/capability-menu/host-face
 */

// Imported for the module augmentation below: a `declare module` that does not
// resolve its target through a real import is treated as an ambient declaration
// and shadows the whole cordis module instead of extending it.
import type { Context } from '@deepseek-ai/cordis'

/** Package that owns this face — must equal the package the manifest is registered for. */
export const HOST_FACE_PACKAGE = 'dsh-thinking-guard'

/** Wire namespace shared with the browser face. */
export const HOST_FACE_NAMESPACE = 'capabilityPolicy'

/**
 * Service key the gateway registers under (`super(ctx, 'capabilityPolicyGateway',
 * { namespace: 'capabilityPolicy' })`). The gateway looks the receiver up by this
 * key, so it has to match `src/server/remote.ts` exactly.
 */
export const HOST_FACE_SERVICE = 'capabilityPolicyGateway'

/** One wire parameter of a registered invocation. */
export interface HostFaceParameter {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  /** Present for optional arguments: the gateway only allows a missing wire field when it is set. */
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


/**
 * A wire value is already JSON on both sides, and the gateway runs the codec on
 * every argument. The remote methods validate their own arguments, while this
 * codec carries the JSON value through the gateway.
 */
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

/**
 * The gateway's Remote surface: `[method, required wire fields, optional wire
 * fields]`, in the same order as `src/server/remote.ts` and
 * `src/client/remote.ts`.
 */
const METHODS: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
  ['checkSelfUpdate', [], []],
  ['installSelfUpdate', ['version'], []],
  ['switchSelfToNpm', ['version'], []],
  ['getConfig', [], []],
  ['updateConfig', ['partial'], []],
  ['getGuard', [], []],
  ['updateGuard', ['change'], []],
  ['getGuardStats', [], []],
  ['classifyAll', [], []],
  ['getDiagnostics', [], []],
  ['refresh', [], []],
  ['getDetail', ['id'], []],
  ['getSearchMetadata', ['id', 'kind'], []],
  ['updateSearchMetadata', ['input'], []],
  ['updateSummaryMaxChars', ['value'], []],
  ['listSkillDir', ['id'], ['relPath']],
  ['readSkillFile', ['id', 'relPath'], []],
  ['getCatalogDocs', [], []],
  ['listLocations', [], []],
  ['addLocation', ['input'], []],
  ['removeLocation', ['id'], []],
  ['updateLocation', ['id', 'input'], []],
  ['listSkillLocations', [], []],
  ['addSkillLocation', ['dir'], ['projectPath']],
  ['importSkillFromGitHub', ['url'], ['projectPath']],
  ['removeSkillLocation', ['name'], ['entryDir']],
  ['adoptSkillLocation', ['name'], []],
  ['updateSkillLocation', ['name', 'dir'], ['entryDir']],
  ['catalogVersion', [], []],
]

/** Build the host face for the `capabilityPolicy` namespace. */
export function capabilityPolicyHostFace(): TypertHostFace {
  return {
    package: HOST_FACE_PACKAGE,
    face: 'host',
    // Every codec travels with its invocation, so there is no `<package>#<name>`
    // schema for the registry to resolve.
    schemas: [],
    invocations: METHODS.map(([method, required, optional]) => ({
      id: `${HOST_FACE_PACKAGE}#${HOST_FACE_NAMESPACE}/${method}`,
      service: HOST_FACE_SERVICE,
      namespace: HOST_FACE_NAMESPACE,
      method,
      invocation: { kind: 'direct' as const },
      parameters: [
        ...required.map((wire) => jsonParameter(wire, false)),
        ...optional.map((wire) => jsonParameter(wire, true)),
      ],
      result: passThroughCodec(`${HOST_FACE_PACKAGE}#${HOST_FACE_NAMESPACE}/${method}:result`),
    })),
    model: { services: [], events: [], objects: [] },
  }
}

/**
 * Merge several host faces owned by the SAME package into one contribution.
 *
 * WHY THIS EXISTS — the Typert store keys contributions by `package`, and a
 * second `register()` for a package that is already mounted withdraws the first
 * one's strict definitions. The endpoint then stays `hasSeen()` but has no
 * resolvable definition, so the gateway answers
 * `gateway/definition-unavailable: … its strict definition was withdrawn and SRC
 * fallback is forbidden`. Registering `capabilityPolicy` and `usage` as two
 * separate contributions of `dsh-thinking-guard` produced exactly that
 * failure in the production Host (`capabilityPolicy.classifyAll`).
 *
 * Merging is safe here because the shapes are disjoint: `schemas` and `model`
 * are empty on every face this bundle builds, and each invocation id is already
 * namespaced by package + namespace.
 */
export function mergeHostFaces(faces: readonly TypertHostFace[]): TypertHostFace {
  const [first, ...rest] = faces
  if (first === undefined) throw new Error('mergeHostFaces: at least one face is required')
  for (const face of rest) {
    if (face.package !== first.package) {
      throw new Error(
        `mergeHostFaces: package mismatch (${JSON.stringify(first.package)} vs ${JSON.stringify(face.package)})`,
      )
    }
  }
  const seen = new Set<string>()
  const invocations: HostFaceInvocation[] = []
  for (const face of faces) {
    for (const invocation of face.invocations) {
      if (seen.has(invocation.id)) throw new Error(`mergeHostFaces: duplicate invocation ${invocation.id}`)
      seen.add(invocation.id)
      invocations.push(invocation)
    }
  }
  return {
    package: first.package,
    face: 'host',
    schemas: faces.flatMap((face) => face.schemas),
    invocations,
    model: {
      services: faces.flatMap((face) => face.model.services),
      events: faces.flatMap((face) => face.model.events),
      objects: faces.flatMap((face) => face.model.objects),
    },
  }
}

/**
 * Claim this package's host namespaces on a host that has a Typert registry.
 * Call from a `ctx.inject(['typert'], …)` hook so hosts without the registry are
 * unaffected.
 *
 * `extra` are the package's other faces (`usage`); they MUST travel in the same
 * contribution, see {@link mergeHostFaces} for the withdrawn-definition failure
 * that two separate registrations cause.
 */
export function registerCapabilityPolicyHostFace(
  ctx: Context,
  extra: readonly TypertHostFace[] = [],
): void {
  const legacyRegistry = ctx.typert as unknown as { register(contribution: TypertHostFace): unknown }
  legacyRegistry.register(mergeHostFaces([capabilityPolicyHostFace(), ...extra]))
}
