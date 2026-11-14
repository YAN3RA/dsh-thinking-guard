/**
 * Explicit scope contract for the new call index (D-026).
 * `host-visible` means the public service corpus, potentially across Profiles.
 * It never claims Profile ownership. The legacy Usage gate is not changed.
 * Resolving a scope never lists or opens history; this is a server-only lease.
 */
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

export type CallIndexScopeMode = 'disabled' | 'host-visible'
export type CallIndexBackend = Pick<SessionPersistence, 'identity' | 'list' | 'stat' | 'open'>
export type CallIndexScope =
  | { readonly status: 'disabled'; readonly mode: 'disabled'; readonly reason: 'not-enabled' }
  | { readonly status: 'unavailable'; readonly mode: 'disabled' | 'host-visible'; readonly reason: 'unsupported-scope' | 'persistence-unavailable' }
  | { readonly status: 'ready'; readonly mode: 'host-visible'; readonly epoch: number; readonly token: symbol; readonly backend: CallIndexBackend }

export interface CallIndexScopeDescription {
  readonly status: CallIndexScope['status']
  readonly mode: CallIndexScopeMode
  readonly scope?: 'host-visible'
  readonly includesOtherProfiles?: true
  readonly epoch?: number
  readonly reason?: 'not-enabled' | 'unsupported-scope' | 'persistence-unavailable'
}

function backendIdentity(value: unknown): symbol | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const candidate = value as Record<string, unknown>
    const identity = candidate.identity
    if (typeof identity !== 'symbol' || typeof candidate.list !== 'function'
      || typeof candidate.stat !== 'function' || typeof candidate.open !== 'function') return undefined
    return identity
  } catch {
    return undefined
  }
}

/** Instance-local epochs and tickets; neither is a persistent Profile identity. */
export class CallIndexScopeController {
  private counter = 0
  private identity: symbol | undefined
  private ticket: symbol | undefined

  /**
   * Resolve the live scope.
   *
   * `undefined` now means "use the configured default", which since D-029 is
   * `host-visible` — matching `CallIndexConfig.scope`'s schema default. Keeping
   * the two in step matters: this method is called directly by
   * `installCallIndexRuntime`, so a schema-only default would leave a host that
   * builds the runtime from a plain object quietly disabled.
   *
   * `'disabled'` still hard-disables, and any unrecognized mode stays
   * `unavailable` rather than guessing.
   */
  resolve(mode: unknown = undefined, backend?: unknown): CallIndexScope {
    if (mode === 'disabled') {
      this.invalidate()
      return Object.freeze({ status: 'disabled', mode: 'disabled', reason: 'not-enabled' })
    }
    if (mode !== undefined && mode !== 'host-visible') {
      this.invalidate()
      return Object.freeze({ status: 'unavailable', mode: 'disabled', reason: 'unsupported-scope' })
    }
    const identity = backendIdentity(backend)
    if (identity === undefined) {
      this.invalidate()
      // Normalized like the ready branch: `undefined` already means host-visible
      // here, and the wire enum has no room for it.
      return Object.freeze({ status: 'unavailable', mode: 'host-visible' as const, reason: 'persistence-unavailable' })
    }
    if (this.identity !== identity) {
      this.counter += 1
      this.identity = identity
      this.ticket = Symbol('call-index-scope')
    }
    // Normalize: `undefined` (the configured default) is host-visible, and the
    // wire enum only allows 'disabled' | 'host-visible'. Passing the raw
    // `undefined` through would fail the reply schema and surface as
    // `internal-error` instead of a ready scope.
    return Object.freeze({ status: 'ready', mode: 'host-visible' as const, epoch: this.counter, token: this.ticket!, backend: backend as CallIndexBackend })
  }

  /** Callers must resolve the current live mode/backend before using this check. */
  isCurrent(scope: CallIndexScope): scope is Extract<CallIndexScope, { status: 'ready' }> {
    return scope.status === 'ready' && this.ticket !== undefined && scope.token === this.ticket && scope.epoch === this.counter
  }

  invalidate(): void {
    this.identity = undefined
    this.ticket = undefined
  }
}

/** Fixed wire projection: no service, symbol, path, Profile inference or raw error. */
export function describeCallIndexScope(scope: CallIndexScope): CallIndexScopeDescription {
  return {
    status: scope.status,
    mode: scope.mode,
    ...(scope.status === 'ready'
      ? { scope: 'host-visible' as const, includesOtherProfiles: true as const, epoch: scope.epoch }
      : { reason: scope.reason }),
  }
}
