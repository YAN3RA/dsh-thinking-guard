import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createRemoteMount } from '../src/client/remote-mount.ts'

// 我们的能力菜单页是独立视图（任务项 6）；这里把它换成空组件，避免 vitest 去加载
// 浏览器端 UI primitives（它依赖的 clsx 只在宿主运行时提供，不在本包的依赖图里）。
vi.mock('../src/client/capability-v3/section.tsx', () => ({ CapabilitySection: () => null }))
vi.mock('../src/client/settings-nav-icon.ts', () => ({
  installSettingsNavIcon: (ctx: Context) => ctx.effect(() => () => {}, 'nav icon'),
}))
import { apply } from '../src/client/index.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

function entry() {
  let active = true
  const cleanups: Array<() => unknown> = []
  const pending = deferred<() => Promise<void>>()
  // 本插件现在 $mount 两个贡献（上游 capabilityPolicy + 自己的 thinkingGuard），
  // 所以夹具必须给每次 $mount 各自的 promise；共用同一个会让同一个 disposer 被调用两次。
  const otherMounts: Array<ReturnType<typeof deferred<() => Promise<void>>>> = []
  let mountCalls = 0
  const mount = vi.fn(() => {
    if (mountCalls++ === 0) return pending.promise
    const next = deferred<() => Promise<void>>()
    otherMounts.push(next)
    return next.promise
  })
  const remote = { catalogVersion: vi.fn() }
  // 本插件现在注册三个设置页（能力菜单 / 总览 / 执行保护），按 id 取回能力菜单那条。
  type SectionSpec = { id: string; inject(): { remoteMount?: ReturnType<typeof createRemoteMount> } }
  const sections = new Map<string, SectionSpec>()
  const effect = vi.fn((callback: () => unknown) => {
    if (!active) throw Object.assign(new Error('INACTIVE_EFFECT'), { code: 'INACTIVE_EFFECT' })
    const cleanup = callback()
    if (typeof cleanup === 'function') cleanups.push(cleanup as () => unknown)
  })
  const ctx = {
    effect,
    locale: { register: vi.fn(() => () => {}), bind: () => (key: string) => key },
    remote: { $mount: mount },
    get: () => remote,
    slots: {
      inject: (_: string, callback: () => void) => effect(callback),
      register: (spec: SectionSpec) => { sections.set(spec.id, spec); return () => {} },
    },
  }
  return {
    ctx: ctx as unknown as Context, pending, effect, remote,
    state: () => sections.get('capability')!.inject().remoteMount!,
    dispose() { active = false; for (const cleanup of cleanups.reverse()) cleanup() },
  }
}

describe('client activation lifecycle', () => {
  it('registers synchronously while mounting remains pending, then notifies the open panel', async () => {
    const fixture = entry()
    expect(apply(fixture.ctx)).toBeUndefined()
    const store = fixture.state()
    expect(store.getSnapshot()).toEqual({ status: 'loading' })
    const changed = vi.fn()
    store.subscribe(changed)
    const effects = fixture.effect.mock.calls.length
    const dispose = vi.fn(async () => {})
    fixture.pending.resolve(dispose)
    await flush()
    expect(store.getSnapshot()).toEqual({ status: 'ready', remote: fixture.remote })
    expect(changed).toHaveBeenCalledOnce()
    expect(fixture.effect).toHaveBeenCalledTimes(effects)
    fixture.dispose()
    store.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('releases a late mount after disposal without touching effects or notifying the panel', async () => {
    const fixture = entry()
    apply(fixture.ctx)
    const changed = vi.fn()
    fixture.state().subscribe(changed)
    const effects = fixture.effect.mock.calls.length
    fixture.dispose()
    const dispose = vi.fn(async () => {})
    fixture.pending.resolve(dispose)
    await flush()
    expect(dispose).toHaveBeenCalledOnce()
    expect(changed).not.toHaveBeenCalled()
    expect(fixture.effect).toHaveBeenCalledTimes(effects)
  })

  it('reports a mount failure as panel state without failing activation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fixture = entry()
      expect(apply(fixture.ctx)).toBeUndefined()
      fixture.pending.reject(new Error('connection lost'))
      await flush()
      expect(fixture.state().getSnapshot()).toEqual({ status: 'error', error: 'Error: connection lost' })
      fixture.dispose()
    } finally { log.mockRestore() }
  })

  it('ignores teardown-related mount rejection', async () => {
    const fixture = entry()
    apply(fixture.ctx)
    fixture.dispose()
    fixture.pending.reject(new Error('INACTIVE_EFFECT'))
    await flush()
    expect(fixture.state().getSnapshot()).toEqual({ status: 'loading' })
  })

  it('handles synchronous mount failure and rejects a missing namespace', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const failed = createRemoteMount(() => { throw new Error('sync failure') }, () => undefined)
      expect(() => failed.start()).not.toThrow()
      expect(failed.getSnapshot()).toEqual({ status: 'error', error: 'Error: sync failure' })
      const dispose = vi.fn()
      const missing = createRemoteMount(async () => dispose, () => undefined)
      missing.start()
      await flush()
      expect(missing.getSnapshot().status).toBe('error')
      missing.dispose()
      expect(dispose).toHaveBeenCalledOnce()
    } finally { log.mockRestore() }
  })

  it('catches asynchronous cleanup failure and starts at most once', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const mount = vi.fn(async () => async () => { throw new Error('cleanup failure') })
      const store = createRemoteMount(mount, () => ({}))
      store.start()
      store.start()
      await flush()
      store.dispose()
      store.dispose()
      await flush()
      expect(mount).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith('[capability-menu] remote disposal failed:', expect.any(Error))
    } finally { log.mockRestore() }
  })
})
