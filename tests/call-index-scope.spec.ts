import { describe, expect, it, vi } from 'vitest'
import { CallIndexScopeController, describeCallIndexScope, type CallIndexBackend } from '../src/usage/call-index-scope.ts'

function backend(identity = Symbol('backend')): CallIndexBackend {
  return {
    identity,
    list: vi.fn(async () => []),
    stat: vi.fn(async () => undefined),
    open: vi.fn(async () => { throw Error('scope resolution must not read history') }),
  }
}

describe('call index explicit host-visible scope', () => {
  it('defaults to host-visible since D-029, and rejects inferred profile scope', () => {
    const controller = new CallIndexScopeController()
    const service = backend()
    // D-029 flipped the default: no mode now means "index the host-visible
    // corpus", which is why the runtime default and the schema default must
    // agree. Resolving it still does not touch the service.
    // `resolve()` returns the live scope; the `scope: 'host-visible'` label is
    // added by `describeCallIndexScope`, which is what the wire actually sends.
    const resolved = controller.resolve(undefined, service)
    expect(resolved).toMatchObject({ status: 'ready', mode: 'host-visible' })
    expect(describeCallIndexScope(resolved)).toMatchObject({ status: 'ready', scope: 'host-visible', includesOtherProfiles: true })
    // An explicit `disabled` remains the fail-closed escape hatch.
    expect(controller.resolve('disabled', service)).toMatchObject({ status: 'disabled', reason: 'not-enabled' })
    for (const value of ['profile', 'current-profile', '', null, true, { mode: 'host-visible' }]) {
      expect(controller.resolve(value, service)).toMatchObject({ status: 'unavailable', reason: 'unsupported-scope' })
    }
    expect(service.list).not.toHaveBeenCalled()
    expect(service.stat).not.toHaveBeenCalled()
    expect(service.open).not.toHaveBeenCalled()
  })

  it('never describes disabled or unavailable scope as an active cross-profile corpus', () => {
    const controller = new CallIndexScopeController()
    expect(describeCallIndexScope(controller.resolve('disabled', backend()))).toEqual({ status: 'disabled', mode: 'disabled', reason: 'not-enabled' })
    expect(describeCallIndexScope(controller.resolve('host-visible'))).toEqual({ status: 'unavailable', mode: 'host-visible', reason: 'persistence-unavailable' })
    expect(describeCallIndexScope(controller.resolve('profile', backend()))).toEqual({ status: 'unavailable', mode: 'disabled', reason: 'unsupported-scope' })
  })

  it('permits only explicit host-visible mode and describes cross-profile corpus honestly', () => {
    const service = backend()
    const controller = new CallIndexScopeController()
    const scope = controller.resolve('host-visible', service)
    expect(scope.status).toBe('ready')
    expect(controller.isCurrent(scope)).toBe(true)
    const dto = describeCallIndexScope(scope)
    expect(dto).toEqual({ status: 'ready', mode: 'host-visible', scope: 'host-visible', includesOtherProfiles: true, epoch: 1 })
    expect(JSON.stringify(dto)).not.toMatch(/identity|token|backend|profileName|root/)
    expect(service.list).not.toHaveBeenCalled()
  })

  it('fails closed for absent, incomplete or unreadable public service contracts', () => {
    const controller = new CallIndexScopeController()
    for (const value of [undefined, null, {}, { identity: 'profile-a' }, { ...backend(), open: undefined }, Object.defineProperty({}, 'identity', { get() { throw Error('sensitive-error-canary') } })]) {
      expect(controller.resolve('host-visible', value)).toEqual({ status: 'unavailable', mode: 'host-visible', reason: 'persistence-unavailable' })
    }
  })

  it('keeps one epoch through Context proxies, but invalidates leases after service replacement', () => {
    const controller = new CallIndexScopeController()
    const service = backend()
    const a = controller.resolve('host-visible', service)
    const proxy = controller.resolve('host-visible', new Proxy(service, {}))
    expect(describeCallIndexScope(proxy).epoch).toBe(describeCallIndexScope(a).epoch)
    expect(controller.isCurrent(a)).toBe(true)
    const replacement = controller.resolve('host-visible', backend())
    expect(describeCallIndexScope(replacement).epoch).toBe(2)
    expect(controller.isCurrent(a)).toBe(false)
    expect(controller.isCurrent(replacement)).toBe(true)
  })

  it('invalidates immediately on disabling, service loss and unsupported mode; re-enabling never revives old tickets', () => {
    for (const change of ['disabled', 'missing', 'current-profile']) {
      const controller = new CallIndexScopeController()
      const service = backend()
      const before = controller.resolve('host-visible', service)
      if (change === 'missing') controller.resolve('host-visible')
      else controller.resolve(change, service)
      expect(controller.isCurrent(before)).toBe(false)
      const after = controller.resolve('host-visible', service)
      expect(controller.isCurrent(before)).toBe(false)
      expect(describeCallIndexScope(after).epoch).toBe(2)
    }
  })

  it('does not confuse equal epoch numbers or backend symbols from different index instances', () => {
    const a = new CallIndexScopeController()
    const b = new CallIndexScopeController()
    const service = backend()
    const scope = a.resolve('host-visible', service)
    b.resolve('host-visible', service)
    expect(b.isCurrent(scope)).toBe(false)
  })

  it('does not read unrelated profile or path fields while resolving an explicitly selected scope', () => {
    const service = backend()
    Object.defineProperty(service, 'profileName', { get() { throw Error('must not infer profile') } })
    Object.defineProperty(service, 'root', { get() { throw Error('must not infer path') } })
    expect(new CallIndexScopeController().resolve('host-visible', service).status).toBe('ready')
  })
})
