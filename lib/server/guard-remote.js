var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
let GuardGateway = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _getGuard_decorators;
    let _updateGuard_decorators;
    let _getGuardDiagnostics_decorators;
    let _getGuardStats_decorators;
    return class GuardGateway extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getGuard_decorators = [Remote('getGuard')];
            _updateGuard_decorators = [Remote('updateGuard')];
            _getGuardDiagnostics_decorators = [Remote('getGuardDiagnostics')];
            _getGuardStats_decorators = [Remote('getGuardStats')];
            __esDecorate(this, null, _getGuard_decorators, { kind: "method", name: "getGuard", static: false, private: false, access: { has: obj => "getGuard" in obj, get: obj => obj.getGuard }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateGuard_decorators, { kind: "method", name: "updateGuard", static: false, private: false, access: { has: obj => "updateGuard" in obj, get: obj => obj.updateGuard }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getGuardDiagnostics_decorators, { kind: "method", name: "getGuardDiagnostics", static: false, private: false, access: { has: obj => "getGuardDiagnostics" in obj, get: obj => obj.getGuardDiagnostics }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getGuardStats_decorators, { kind: "method", name: "getGuardStats", static: false, private: false, access: { has: obj => "getGuardStats" in obj, get: obj => obj.getGuardStats }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['thinkingGuardState'];
        constructor(ctx) {
            super(ctx, 'thinkingGuardGateway', { namespace: 'thinkingGuard' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** Effective Guard switches: shipped default < patch base < persisted override. */
        getGuard() {
            return this.ctx.thinkingGuardState.getGuard();
        }
        /**
         * Persist and apply Guard switches.
         *
         * Writes the Guard's own state file, never the patch file: dsh watches patch
         * files and re-applies the plugin on every write, so a toggle stored there
         * would reload the whole plugin each time a switch is flipped.
         */
        async updateGuard(change) {
            await this.ctx.thinkingGuardState.updateGuard(change);
        }
        /**
         * Whether the Guard is actually in effect, plus fixed-code failure reasons.
         *
         * Separate from {@link getGuardStats} on purpose: the counters keep their
         * numeric-only privacy contract, while this answers "is it running, and did
         * the last write land" with a closed allowlist of codes.
         */
        getGuardDiagnostics() {
            return this.ctx.thinkingGuardState.getGuardDiagnostics();
        }
        /** Content-free Guard counters: was the Guard running, and did it do anything? */
        getGuardStats() {
            return this.ctx.thinkingGuardState.getGuardStats();
        }
    };
})();
export { GuardGateway };
/** Register the remote gateway on a context. */
export const name = 'thinking-guard-remote';
export const inject = ['thinkingGuardState'];
export function apply(ctx) {
    ctx.plugin(GuardGateway);
}
//# sourceMappingURL=guard-remote.js.map