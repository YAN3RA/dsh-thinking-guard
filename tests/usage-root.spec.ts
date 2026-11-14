import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.ts'
import { CapabilityPolicyGateway } from '../src/server/remote.ts'
import { UsageGateway } from '../src/server/usage-remote.ts'
import * as guardModule from '../src/guard.ts'
import * as callIndexHost from '../src/usage/call-index-host.ts'
import type { UsageRuntime } from '../src/usage/usage-runtime.ts'

const TIME = Date.UTC(2026, 10, 4, 12, 0, 0)

function toolCall(seq: number): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: TIME + seq,
    data: {
      turn: 1,
      step: 1,
      callId: `call-${seq}`,
      name: 'bash',
      arguments: '{"private":"ARGUMENT"}',
    },
  } as unknown as SessionEvent
}

function toolResult(seq: number): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time: TIME + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        toolCallId: `call-${seq - 1}`,
        content: [{ type: 'text', text: 'PRIVATE-OUTPUT' }],
      },
    },
  } as unknown as SessionEvent
}

type Listener = (session: unknown, event: unknown) => void

function createRootHost() {
  const handlers = new Map<string, Listener>()
  const subscribeNames: string[] = []
  const listenerDisposers: Array<ReturnType<typeof vi.fn>> = []
  const effectCleanups: Array<() => void> = []
  const effectCalls: number[] = []
  const services = new Map<string, unknown>()
  const pluginCalls: unknown[][] = []
  const injectCalls: unknown[][] = []
  const provideCalls: Array<[string, unknown]> = []

  const ctx = {
    logger: { warn: vi.fn(), info: vi.fn() },
    plugin: (...args: unknown[]) => {
      pluginCalls.push(args)
    },
    inject: (...args: unknown[]) => {
      injectCalls.push(args)
    },
    on: (name: string, listener: Listener) => {
      subscribeNames.push(name)
      handlers.set(name, listener)
      const dispose = vi.fn(() => {
        if (handlers.get(name) === listener) handlers.delete(name)
      })
      listenerDisposers.push(dispose)
      return dispose
    },
    effect: (factory: () => () => void) => {
      effectCalls.push(1)
      effectCleanups.push(factory())
    },
    get: (name: string) => services.get(name),
    provide: (name: string, value: unknown) => {
      services.set(name, value)
      provideCalls.push([name, value])
      return () => {
        services.delete(name)
      }
    },
  }

  return {
    ctx: ctx as unknown as Context,
    handlers,
    subscribeNames,
    listenerDisposers,
    effectCalls,
    pluginCalls,
    injectCalls,
    provideCalls,
    services,
    emit(sessionId: string, event: SessionEvent): void {
      handlers.get('session/event')?.({ id: sessionId }, event)
    },
    runEffects(): void {
      for (const cleanup of effectCleanups.splice(0)) cleanup()
    },
  }
}

describe('root usage runtime wiring', () => {
  it('provides one usageRuntime by default and keeps guard/gateway mounts intact', () => {
    const host = createRootHost()
    const guardConfig = { enabled: true, profile: 'normal' as const }

    apply(host.ctx, { guard: guardConfig })

    expect(host.subscribeNames).toEqual(['session/event'])
    // The runtime registers its own disposable effect; the root must not add a
    // second disposer for the same subscription.
    expect(host.effectCalls).toHaveLength(1)
    expect(host.provideCalls).toHaveLength(1)
    const [serviceName, service] = host.provideCalls[0] ?? []
    expect(serviceName).toBe('usageRuntime')
    expect(service).toMatchObject({ metadata: { mode: 'memory', feed: 'session/event' } })
    expect(host.services.get('usageRuntime')).toBe(service)

    // Existing root behavior: the policy gateway and Guard plugin are still
    // mounted, and the Typert host face still registers through ctx.inject.
    expect(host.pluginCalls).toHaveLength(4)
    expect(host.pluginCalls[3]?.[0]).toBe(callIndexHost)
    expect(host.pluginCalls[0]?.[0]).toBe(CapabilityPolicyGateway)
    expect(host.pluginCalls[1]?.[0]).toBe(UsageGateway)
    expect(host.pluginCalls[2]?.[0]).toBe(guardModule)
    expect(host.pluginCalls[2]?.[1]).toBe(guardConfig)
    expect(host.injectCalls).toHaveLength(1)
    expect(host.injectCalls[0]?.[0]).toEqual(['typert'])
  })

  it('does not subscribe or provide twice when apply runs twice', () => {
    const host = createRootHost()

    apply(host.ctx)
    apply(host.ctx)

    expect(host.subscribeNames).toEqual(['session/event'])
    expect(host.effectCalls).toHaveLength(1)
    expect(host.provideCalls).toHaveLength(1)
  })

  it('can be switched off through the runtime config without changing static wiring', () => {
    const host = createRootHost()

    apply(host.ctx, { usageRuntime: false })

    expect(host.subscribeNames).toEqual([])
    expect(host.provideCalls).toEqual([])
    expect(host.pluginCalls).toHaveLength(4)
    expect(host.pluginCalls[3]?.[0]).toBe(callIndexHost)
    expect(host.injectCalls).toHaveLength(1)
  })

  it('disposes the listener and flushes queued events through the runtime effect', () => {
    const host = createRootHost()
    apply(host.ctx)
    const runtime = host.provideCalls[0]?.[1] as UsageRuntime

    host.emit('session-a', toolCall(1))
    host.emit('session-a', toolResult(2))
    expect(runtime.pending()).toBe(2)

    host.runEffects()

    expect(host.listenerDisposers[0]).toHaveBeenCalledTimes(1)
    expect(host.handlers.has('session/event')).toBe(false)
    expect(runtime.pending()).toBe(0)
    expect(runtime.report()).toMatchObject({ calls: 1, succeeded: 1, failed: 0 })
    expect(runtime.stats().received).toBe(2)

    // A listener reference kept by a hostile Host must stay inert after dispose.
    host.emit('session-a', toolCall(3))
    expect(runtime.stats().received).toBe(2)
    expect(runtime.pending()).toBe(0)
  })
})
