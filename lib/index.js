/**
 * dsh-thinking-guard — 能力菜单（上游底座的 v3 视图）+ 总览 + 执行保护，一个可安装的
 * 包同时提供 server 与 browser 两端。
 *
 * One installable package exposing:
 *
 * - four cordis plugin factories via subpath exports (`/registry`, `/search`,
 *   `/invoke`, `/policy`), mounted by the bundle patch as separate entries —
 *   unchanged from the upstream baseline these forks rest on:
 *   - `registry` (P0): capability catalog + `ctx.capability` service (no model tool).
 *   - `search`   (P1): registers `meta_search`.
 *   - `invoke`   (P2): registers `meta_invoke`.
 *   - `policy`   (P3): Resident/On-demand/Disabled projection policy + `ctx.capabilityPolicy`.
 * - the Agent Efficiency Guard (`./guard.ts`) and its own state service
 *   (`./guard-state.ts`), mounted from THIS root entry. The Guard keeps its
 *   switches in `<profile>/dsh-thinking-guard/guard.json` and never imports the
 *   capability policy, so following upstream never reopens a Guard conflict.
 * - the package root entry (`name` + `apply` below): mounts the two browser-facing
 *   Typert gateways — the upstream `capabilityPolicy` namespace and the Guard's own
 *   `thinkingGuard` namespace — each registered as a separate host face, plus the
 *   browser bundle via the `./client` subpath (`src/client`), discovered by
 *   `@deepseek-ai/dsh-client-modules` from this package's `dsh.client` declaration.
 *
 * NOTE: this module deliberately re-exports nothing from the subpath plugins
 * (not even types — those live at `/registry`, `/search`, `/invoke`, `/policy`).
 * Re-exporting would either pollute the root entry's plugin identity with the
 * sub-plugins' `name`/`apply`/`inject`, or trigger ambiguous-type re-exports
 * (each subpath exports its own `Config` interface).
 *
 * @module dsh-thinking-guard
 */
import z from '@deepseek-ai/schemastery';
import { CapabilityPolicyGateway } from "./server/remote.js";
import { registerCapabilityPolicyHostFace } from "./host-face.js";
import { GuardGateway } from "./server/guard-remote.js";
import { registerGuardHostFace } from "./guard-host-face.js";
import * as GuardState from "./guard-state.js";
import * as AgentEfficiencyGuard from "./guard.js";
/** Root plugin identity (matches the `capability-menu` patch entry id). */
export const name = 'capability-menu';
export const Config = z.object({
    guard: AgentEfficiencyGuard.Config,
    guardStateFile: z.string().default(''),
});
/**
 * Root entry: mount the Guard's state service, the Guard itself, and both
 * browser-facing gateways, then claim both Typert namespaces.
 *
 * Order matters and is intentional:
 *
 * 1. `GuardState` first, because both the Guard and the Guard gateway inject its
 *    service — mounting them first would still work (cordis waits on `inject`),
 *    but mounting it here keeps one instance for the process.
 * 2. `AgentEfficiencyGuard` next, so its hooks exist before any turn runs.
 * 3. The two gateways, then one `typert.register()` per face: the faces belong
 *    to different packages and must not share a single contribution.
 *
 * The registry is reached through `ctx.inject` instead of a static `inject`: a
 * host that has no `typert` service must still mount both gateways, exactly as
 * the upstream root entry did before this hook existed.
 */
export function apply(ctx, config = {}) {
    const guardStateFile = (config.guardStateFile ?? '').trim();
    ctx.plugin(GuardState, guardStateFile.length > 0 ? { stateFile: guardStateFile } : {});
    ctx.plugin(AgentEfficiencyGuard, config.guard ?? {});
    ctx.plugin(CapabilityPolicyGateway);
    ctx.plugin(GuardGateway);
    ctx.inject(['typert'], (registry) => {
        registerCapabilityPolicyHostFace(registry);
        registerGuardHostFace(registry);
    });
}
//# sourceMappingURL=index.js.map