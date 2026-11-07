import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { USAGE_TYPERT_REMOTE } from '../src/client/usage-remote.ts'
import {
  USAGE_AGGREGATE_LIMIT as CLIENT_AGGREGATE_LIMIT,
  USAGE_COVERAGE_LIMIT as CLIENT_COVERAGE_LIMIT,
  USAGE_REMOTE_NAMESPACE,
  USAGE_REMOTE_PACKAGE,
} from '../src/client/usage-remote.ts'
import {
  USAGE_HOST_FACE_NAMESPACE,
  USAGE_HOST_FACE_PACKAGE,
  USAGE_HOST_FACE_SERVICE,
  USAGE_RUNTIME_SERVICE,
  USAGE_SNAPSHOT_AGGREGATE_LIMIT,
  USAGE_SNAPSHOT_COVERAGE_LIMIT,
  USAGE_WIRE_METHODS,
  registerUsageHostFace,
  usageHostFace,
} from '../src/usage/usage-host-face.ts'

const hostFace = usageHostFace()

/** `<method>` → `[wire, optional]` pairs, as the browser face declares them. */
function clientWireTable() {
  const table = new Map<string, [string, boolean][]>()
  for (const descriptor of USAGE_TYPERT_REMOTE.descriptors) {
    table.set(
      descriptor.method,
      descriptor.parameters.map((parameter) => [
        parameter.wire,
        (parameter as { acceptsUndefined?: boolean }).acceptsUndefined === true,
      ]),
    )
  }
  return table
}

/** `<method>` → `[wire, optional]` pairs, as the host face declares them. */
function hostWireTable() {
  const table = new Map<string, [string, boolean][]>()
  for (const invocation of hostFace.invocations) {
    table.set(
      invocation.method,
      invocation.parameters.map((parameter) => [parameter.wire, parameter.acceptsUndefined === true]),
    )
  }
  return table
}

describe('usage host face', () => {
  it('registers the wire namespace the browser face calls', () => {
    expect(USAGE_HOST_FACE_PACKAGE).toBe(USAGE_REMOTE_PACKAGE)
    expect(USAGE_HOST_FACE_NAMESPACE).toBe(USAGE_REMOTE_NAMESPACE)
    expect(hostFace.package).toBe(USAGE_HOST_FACE_PACKAGE)
    expect(hostFace.package).toBe(USAGE_TYPERT_REMOTE.package)
    expect(hostFace.face).toBe('host')
    expect(hostFace.schemas).toEqual([])
    expect(hostFace.model).toEqual({ services: [], events: [], objects: [] })

    for (const invocation of hostFace.invocations) {
      expect(invocation.namespace).toBe(USAGE_HOST_FACE_NAMESPACE)
      // The gateway resolves the receiver by service key and then asserts its
      // `typertRemote` binding, so this must be the gateway's own service key.
      expect(invocation.service).toBe(USAGE_HOST_FACE_SERVICE)
      expect(invocation.invocation).toEqual({ kind: 'direct' })
    }
  })

  it('keeps the gateway key and the optional runtime key distinct', () => {
    // The runtime is optional and probed through `ctx.get`; the gateway is the
    // always-mounted receiver. Sharing a key would make one of the two
    // impossible: either the gateway requires the runtime, or the probe finds
    // the gateway itself.
    expect(USAGE_HOST_FACE_SERVICE).not.toBe(USAGE_RUNTIME_SERVICE)
    expect(USAGE_RUNTIME_SERVICE).toBe('usageRuntime')
  })

  it('covers exactly the endpoints the browser face declares', () => {
    const host = [...hostWireTable().keys()].sort()
    const browser = [...clientWireTable().keys()].sort()
    expect(host).toEqual(browser)
    // Guard the guard: an empty table would make the comparison vacuous.
    expect(host.length).toBeGreaterThan(0)
    expect(host).toEqual(['getSnapshot', 'refresh'])
  })

  it('sends every field the browser sends, with the same optionality', () => {
    const host = hostWireTable()
    for (const [method, expected] of clientWireTable()) {
      expect(host.get(method), method).toEqual(expected)
    }
  })

  it('declares no arguments — both methods only read the current snapshot', () => {
    // A parameter here would mean the face accepts a filter or a mutation; the
    // contract is deliberately "give me what you have now".
    for (const invocation of hostFace.invocations) expect(invocation.parameters).toEqual([])
    for (const descriptor of USAGE_TYPERT_REMOTE.descriptors) expect(descriptor.parameters).toEqual([])
  })

  it('exposes the same method list in the shared table', () => {
    expect(USAGE_WIRE_METHODS.map(([method]) => method)).toEqual(['getSnapshot', 'refresh'])
  })

  it('satisfies the registry’s invocation rules', () => {
    const ids = new Set<string>()
    const endpoints = new Set<string>()
    const wireName = /^[A-Za-z0-9_$.-]+$/

    for (const invocation of hostFace.invocations) {
      expect(invocation.id.length).toBeGreaterThan(0)
      expect(ids.has(invocation.id)).toBe(false)
      ids.add(invocation.id)

      const endpoint = `${invocation.namespace}/${invocation.method}`
      expect(endpoints.has(endpoint)).toBe(false)
      endpoints.add(endpoint)

      expect(invocation.method).toMatch(wireName)
      expect(invocation.result.mode).toBe('strict')
      expect(invocation.result.typeSymbol.length).toBeGreaterThan(0)

      const wires = new Set<string>()
      for (const parameter of invocation.parameters) {
        expect(parameter.name).toMatch(wireName)
        expect(parameter.wire).toMatch(wireName)
        expect(parameter.source).toBe('json')
        expect(wires.has(parameter.wire)).toBe(false)
        wires.add(parameter.wire)
        expect(parameter.codec.mode).toBe('strict')
        expect(parameter.codec.typeSymbol.length).toBeGreaterThan(0)
      }
    }
  })

  it('decodes arguments with a pass-through codec', () => {
    // The gateway decodes arguments with `codec.create().parse(value)`; a
    // pass-through keeps rc-to-rc payload differences from being rejected after
    // the method signature has already accepted the call.
    const value = { nested: [1, 'two', null] }
    for (const invocation of hostFace.invocations) {
      expect(invocation.result.create().parse(value)).toBe(value)
      for (const parameter of invocation.parameters) {
        expect(parameter.codec.create().parse(value)).toBe(value)
      }
    }
  })

  it('claims the namespace through the typert registry exactly once', () => {
    const register = vi.fn()
    const ctx = { typert: { register } } as unknown as Context
    registerUsageHostFace(ctx)
    expect(register).toHaveBeenCalledTimes(1)
    // Compare the declared shape, not the codec closures: every `usageHostFace()`
    // call builds fresh codec objects, and function identity is not the contract.
    const [contribution] = register.mock.calls[0] as unknown as [{
      package: string
      face: string
      invocations: readonly { readonly id: string }[]
    }]
    expect(contribution.package).toBe(USAGE_HOST_FACE_PACKAGE)
    expect(contribution.face).toBe('host')
    expect(contribution.invocations.map(invocation => invocation.id))
      .toEqual(usageHostFace().invocations.map(invocation => invocation.id))
  })
})

describe('usage wire bounds', () => {
  it('caps aggregates at 500 and coverage at 4096 on both faces', () => {
    expect(USAGE_SNAPSHOT_AGGREGATE_LIMIT).toBe(500)
    expect(USAGE_SNAPSHOT_COVERAGE_LIMIT).toBe(4096)
    // The browser bundle keeps its own literals (it must not import a Host
    // module for two integers); these assertions are the drift alarm.
    expect(CLIENT_AGGREGATE_LIMIT).toBe(USAGE_SNAPSHOT_AGGREGATE_LIMIT)
    expect(CLIENT_COVERAGE_LIMIT).toBe(USAGE_SNAPSHOT_COVERAGE_LIMIT)
  })

  it('documents both endpoints with the shared snapshot codec', () => {
    for (const descriptor of USAGE_TYPERT_REMOTE.descriptors) {
      expect(descriptor.id).toBe(`${USAGE_REMOTE_PACKAGE}#${USAGE_REMOTE_NAMESPACE}/${descriptor.method}`)
      expect(descriptor.service).toBe(USAGE_REMOTE_NAMESPACE)
      expect(descriptor.namespace).toBe(USAGE_REMOTE_NAMESPACE)
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
      expect(descriptor.result.mode).toBe('strict')
      // getSnapshot and refresh answer the same contract; a different symbol
      // would mean the browser face and the Host disagree about the shape.
      // `mode` narrows the union: only the strict variant carries `typeSymbol`.
      if (descriptor.result.mode !== 'strict') throw new Error('expected a strict result codec')
      expect(descriptor.result.typeSymbol).toBe('dsh-thinking-guard#UsageSnapshot')
    }
  })
})
