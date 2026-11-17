/** Package that owns this face — this plugin's own package name. */
export const GUARD_HOST_FACE_PACKAGE = 'dsh-thinking-guard';
/** Wire namespace shared with the browser face. */
export const GUARD_HOST_FACE_NAMESPACE = 'thinkingGuard';
/** Service key the gateway registers under; must match `src/server/guard-remote.ts`. */
export const GUARD_HOST_FACE_SERVICE = 'thinkingGuardGateway';
function passThroughCodec(typeSymbol) {
    return { mode: 'strict', typeSymbol, create: () => ({ parse: (value) => value }) };
}
function jsonParameter(wire, optional) {
    return {
        name: wire,
        wire,
        source: 'json',
        ...(optional ? { acceptsUndefined: true } : {}),
        codec: passThroughCodec(wire),
    };
}
/** `[method, required wire fields, optional wire fields]`, in gateway order. */
const METHODS = [
    ['getGuard', [], []],
    ['updateGuard', ['change'], []],
    ['getGuardDiagnostics', [], []],
    ['getGuardStats', [], []],
];
/** Build the host face for the `thinkingGuard` namespace. */
export function guardHostFace() {
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
            invocation: { kind: 'direct' },
            parameters: [
                ...required.map(wire => jsonParameter(wire, false)),
                ...optional.map(wire => jsonParameter(wire, true)),
            ],
            result: passThroughCodec(`${GUARD_HOST_FACE_PACKAGE}#${GUARD_HOST_FACE_NAMESPACE}/${method}:result`),
        })),
        model: { services: [], events: [], objects: [] },
    };
}
/**
 * Claim the `thinkingGuard` namespace on a host that has a Typert registry.
 * Called from `ctx.inject(['typert'], …)` so hosts without the registry are
 * unaffected.
 */
export function registerGuardHostFace(ctx) {
    ctx.typert.register(guardHostFace());
}
//# sourceMappingURL=guard-host-face.js.map