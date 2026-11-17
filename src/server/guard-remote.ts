/**
 * Host-side Typert gateway exposing the Guard's own state service to the browser.
 *
 * Registered under its own package (`dsh-thinking-guard`) and its own wire
 * namespace (`thinkingGuard`) — deliberately NOT reusing the upstream
 * `capabilityPolicy` namespace, so the two faces are registered separately and
 * an upstream change can never renumber our endpoints (task item 3).
 *
 * The service key (`thinkingGuardGateway`) differs from both the wire namespace
 * and the provided service name: the gateway looks the receiver up by key, and
 * keeping it distinct is what lets `ctx.thinkingGuardState` stay the one owner
 * of the state.
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { GuardDiagnostics, GuardSwitches } from '../guard-state.ts'
import type { GuardStatsSnapshot } from '../guard-core.ts'

export class GuardGateway extends TypertRemoteService {
  static inject = ['thinkingGuardState']

  constructor(ctx: Context) {
    super(ctx, 'thinkingGuardGateway', { namespace: 'thinkingGuard' })
  }

  /** Effective Guard switches: shipped default < patch base < persisted override. */
  @Remote('getGuard')
  getGuard(): GuardSwitches {
    return this.ctx.thinkingGuardState.getGuard()
  }

  /**
   * Persist and apply Guard switches.
   *
   * Writes the Guard's own state file, never the patch file: dsh watches patch
   * files and re-applies the plugin on every write, so a toggle stored there
   * would reload the whole plugin each time a switch is flipped.
   */
  @Remote('updateGuard')
  async updateGuard(change: Partial<GuardSwitches>): Promise<void> {
    await this.ctx.thinkingGuardState.updateGuard(change)
  }

  /**
   * Whether the Guard is actually in effect, plus fixed-code failure reasons.
   *
   * Separate from {@link getGuardStats} on purpose: the counters keep their
   * numeric-only privacy contract, while this answers "is it running, and did
   * the last write land" with a closed allowlist of codes.
   */
  @Remote('getGuardDiagnostics')
  getGuardDiagnostics(): GuardDiagnostics {
    return this.ctx.thinkingGuardState.getGuardDiagnostics()
  }

  /** Content-free Guard counters: was the Guard running, and did it do anything? */
  @Remote('getGuardStats')
  getGuardStats(): GuardStatsSnapshot {
    return this.ctx.thinkingGuardState.getGuardStats()
  }
}

/** Register the remote gateway on a context. */
export const name = 'thinking-guard-remote'
export const inject = ['thinkingGuardState']
export function apply(ctx: Context): void {
  ctx.plugin(GuardGateway)
}
