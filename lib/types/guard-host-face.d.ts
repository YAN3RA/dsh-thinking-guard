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
import type { Context } from '@deepseek-ai/cordis';
/** Package that owns this face — this plugin's own package name. */
export declare const GUARD_HOST_FACE_PACKAGE = "dsh-thinking-guard";
/** Wire namespace shared with the browser face. */
export declare const GUARD_HOST_FACE_NAMESPACE = "thinkingGuard";
/** Service key the gateway registers under; must match `src/server/guard-remote.ts`. */
export declare const GUARD_HOST_FACE_SERVICE = "thinkingGuardGateway";
/** One wire parameter of a registered invocation. */
export interface HostFaceParameter {
    readonly name: string;
    readonly wire: string;
    readonly source: 'json';
    readonly acceptsUndefined?: true;
    readonly codec: HostFaceCodec;
}
/** Strict codec as the gateway consumes it (`create().parse` on decode). */
export interface HostFaceCodec {
    readonly mode: 'strict';
    readonly typeSymbol: string;
    readonly create: () => {
        parse: (value: unknown) => unknown;
    };
}
/** One registered invocation of the host face. */
export interface HostFaceInvocation {
    readonly id: string;
    readonly service: string;
    readonly namespace: string;
    readonly method: string;
    readonly invocation: {
        readonly kind: 'direct';
    };
    readonly parameters: readonly HostFaceParameter[];
    readonly result: HostFaceCodec;
}
/** Contribution accepted by `ctx.typert.register()`. */
export interface TypertHostFace {
    readonly package: string;
    readonly face: 'host';
    readonly schemas: readonly never[];
    readonly invocations: readonly HostFaceInvocation[];
    readonly model: {
        readonly services: readonly never[];
        readonly events: readonly never[];
        readonly objects: readonly never[];
    };
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Typert registry; redeclared locally for the one call this file makes. */
        typert: {
            register(contribution: TypertHostFace): unknown;
        };
    }
}
/** Build the host face for the `thinkingGuard` namespace. */
export declare function guardHostFace(): TypertHostFace;
/**
 * Claim the `thinkingGuard` namespace on a host that has a Typert registry.
 * Called from `ctx.inject(['typert'], …)` so hosts without the registry are
 * unaffected.
 */
export declare function registerGuardHostFace(ctx: Context): void;
//# sourceMappingURL=guard-host-face.d.ts.map