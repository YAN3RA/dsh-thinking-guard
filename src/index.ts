/**
 * @daweifu/capability-menu — consolidated plugin package (server + browser).
 *
 * One installable source package exposing:
 *
 * - four cordis plugin factories via subpath exports (`/registry`, `/search`,
 *   `/invoke`, `/policy`), mounted by the bundle patch as separate entries:
 *   - `registry` (P0): capability catalog + `ctx.capability` service (no model tool).
 *   - `search`   (P1): registers `meta_search`.
 *   - `invoke`   (P2): registers `meta_invoke`.
 *   - `policy`   (P3): Resident/On-demand/Disabled projection policy + `ctx.capabilityPolicy`.
 * - the package root entry (`name` + `apply` below): mounts the Typert gateway
 *   that exposes `ctx.capabilityPolicy` to the browser as the `capabilityPolicy`
 *   remote namespace — the data source of the 能力菜单 settings tab.
 * - a browser bundle via the `./client` subpath (`src/client`), discovered by
 *   `@deepseek-ai/dsh-client-modules` from this package's `dsh.client`
 *   declaration and served as `/plugins/<id>/client.js`.
 *
 * NOTE: this module deliberately re-exports nothing from the subpath plugins
 * (not even types — those live at `/registry`, `/search`, `/invoke`, `/policy`).
 * Re-exporting would either pollute the root entry's plugin identity with the
 * sub-plugins' `name`/`apply`/`inject`, or trigger ambiguous-type re-exports
 * (each subpath exports its own `Config` interface).
 *
 * @module @daweifu/capability-menu
 */

import type { Context } from '@deepseek-ai/cordis'
import { CapabilityPolicyGateway } from './server/remote.ts'
import { registerCapabilityPolicyHostFace } from './host-face.ts'
import { UsageGateway } from './server/usage-remote.ts'
import { usageHostFace } from './usage/usage-host-face.ts'
import * as AgentEfficiencyGuard from './guard.ts'
import { installUsageRuntime } from './usage/usage-runtime.ts'
import z from '@deepseek-ai/schemastery'
import * as CallIndexHost from './usage/call-index-host.ts'
import { CallIndexConfig, type CallIndexRuntimeConfig } from './usage/call-index-runtime.ts'
import { callIndexHostFace } from './usage/call-index-host-face.ts'
export interface Config {
  guard?: AgentEfficiencyGuard.Config
  /**
   * Install the live Session usage runtime on this root entry.
   *
   * Enabled by default so existing configurations keep working unchanged. The
   * runtime is still optional at the Host level: it resolves every optional
   * service through `ctx.get`, and this root entry declares no static
   * dependency for it.
   */
  usageRuntime?: boolean
  /** Explicit D-026 corpus scope; disabled by default. Never enables history by visiting a tab. */
  callIndex?: CallIndexRuntimeConfig
}
export const Config: z<Config> = z.object({
  guard: AgentEfficiencyGuard.Config,
  usageRuntime: z.boolean().default(true),
  callIndex: CallIndexConfig,
})

/**
 * Install the usage runtime once per root context and expose the handle as
 * `ctx.usageRuntime`.
 *
 * The runtime owns its listener/effect teardown (`ctx.effect` inside
 * `installUsageRuntime`), so the root entry must not register a second
 * disposer. The `ctx.get` check avoids a duplicate subscription when the root
 * entry is evaluated twice and keeps `ctx.provide` from throwing on an
 * already-provided name.
 */
function installUsageRoot(ctx: Context): void {
  if (ctx.get('usageRuntime') !== undefined) return
  const runtime = installUsageRuntime(ctx)
  ctx.provide('usageRuntime', runtime)
}

/** Root plugin identity (matches the `capability-menu` patch entry id). */
export const name = 'thinking-guard'

/**
 * Root entry: mount the browser-facing capabilityPolicy gateway and claim its
 * namespace in the Typert registry, so `@deepseek-ai/dsh-api-gateway` accepts
 * `/api/capabilityPolicy/*` no matter how the boot order turns out (see
 * `src/host-face.ts` for the mechanism and the 404 it prevents).
 *
 * The registry is reached through `ctx.inject` instead of a static `inject`: a
 * host that has no `typert` service must still mount the gateway, exactly as it
 * did before this hook existed.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(CapabilityPolicyGateway)
  ctx.plugin(UsageGateway)
  ctx.plugin(AgentEfficiencyGuard, config.guard ?? {})
  if (config.usageRuntime !== false) installUsageRoot(ctx)
  ctx.plugin(CallIndexHost, config.callIndex ?? {})
  ctx.inject(['typert'], (registry) => {
    // One contribution, not two: Typert keys contributions by `package`, and a
    // second `register()` for an already-mounted package withdraws the first
    // one's strict definitions (see mergeHostFaces in ./host-face.ts).
    registerCapabilityPolicyHostFace(registry, [usageHostFace(), callIndexHostFace()])
  })
}
