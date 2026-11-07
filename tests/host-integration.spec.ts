/**
 * Host-chain integration: the combinations the per-module specs do not cover.
 *
 * Each block below exercises one §6.1 coverage item against the real DSH
 * services (`@deepseek-ai/dsh-tools`, `dsh-skill`, `dsh-system-prompt`,
 * `dsh-skill-filesystem`, `cordis`), not against a mock of our own internals:
 *
 *  1. `agent/created` moves On-demand tools out of the model declaration while
 *     Resident tools stay declared on both sides.
 *  2. A tier move on an existing Agent updates declaration AND admission
 *     together, and disposes the previous restriction instead of intersecting it.
 *  3. The `skill-catalog` pre-step filter keeps Resident skills, drops
 *     On-demand/Disabled ones, and leaves a catalog without `entries` intact
 *     while warning.
 *  4. Disabled is a hard deny on both execution paths (native call and
 *     `meta_invoke`), for tools and for the skill loader.
 *  5. The merged Typert contribution (`capabilityPolicy` + `usage`) registers
 *     once and leaves every browser endpoint resolvable.
 *  6. Disposing the plugin releases every hook, listener and per-Agent
 *     restriction, and `agent/disposed` releases one Agent early.
 *  7. Usage without `sessionPersistence` stays `unknown`/`partial`; a zero is
 *     never reported as "never used".
 *
 * Deliberately NOT covered here: the Guard's three switches and its fingerprints
 * (own spec files) — this file only drives the capability policy and usage faces.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import * as toolMetaInvoke from '../src/invoke.ts'
import { CapabilityPolicyGateway } from '../src/server/remote.ts'
import { UsageGateway } from '../src/server/usage-remote.ts'
import {
  HOST_FACE_NAMESPACE,
  HOST_FACE_PACKAGE,
  HOST_FACE_SERVICE,
  registerCapabilityPolicyHostFace,
} from '../src/host-face.ts'
import {
  USAGE_HOST_FACE_NAMESPACE,
  USAGE_HOST_FACE_SERVICE,
  USAGE_RUNTIME_SERVICE,
  usageHostFace,
} from '../src/usage/usage-host-face.ts'
import { TYPERT_REMOTE } from '../src/client/remote.ts'
import { USAGE_TYPERT_REMOTE } from '../src/client/usage-remote.ts'
import { readUsageSnapshot } from '../src/server/usage-remote.ts'
import { installUsageRuntime } from '../src/usage/usage-runtime.ts'
import { runUsageBackfill } from '../src/usage/usage-backfill.ts'
import { toUsagePanelResult } from '../src/client/usage-adapter.ts'
import { UsagePanelView, type UsagePanelViewProps } from '../src/client/usage.tsx'
import { mountTestExecutor, runOneToolCall } from './stubs/test-executor.ts'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

const testSignal = new AbortController().signal

// — harness ————————————————————————————————————————————————————————————————

/**
 * Mount the same composition every block needs.
 *
 * `mountTestExecutor` is the official executor stub (see
 * `tests/stubs/test-executor.ts`): it runs the published
 * `pre-execute → guards → execute → post-execute` chain, so a Disabled deny is
 * observed where production observes it.
 */
async function mountCore(home: string): Promise<CordisContext> {
  const ctx = new CordisContext()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: `${home}/.dsh`,
    agentsHome: `${home}/.agents`,
    watch: false,
  })
  return ctx
}

/** Register one native tool with an observable execution counter. */
function registerTool(ctx: Context, name: string, onExecute?: () => unknown): void {
  ctx.tools.register(defineTool({
    name,
    description: `Tool ${name}`,
    parameters: { name: { type: 'string', description: 'Ignored' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() {
      return (onExecute === undefined ? { ok: true } : onExecute()) as never
    },
  }))
}

/** A real scoped Agent identity: the policy keys restrictions on the Agent object. */
async function announceAgent(
  ctx: Context,
  id: string,
): Promise<{ ctx: Context; session: { header: { cwd: string } }; id: string }> {
  const agent = {
    id,
    options: {},
    session: { header: { cwd: process.cwd() } },
    ctx: new CordisContext(),
    status: 'idle',
  } as unknown as { ctx: Context; session: { header: { cwd: string } }; id: string }
  // `tools.restrict()` reads the CALL SITE's scope, so the Agent needs a real
  // child scope rather than a detached Context.
  agent.ctx = createScope(ctx, agent as never).ctx
  await ctx.serial('agent/created', { agent: agent as never, source: 'startup' as const })
  return agent
}

function declaredNames(ctx: Context, agent: unknown): string[] {
  return ctx.tools.schemas(agent as never).map(schema => schema.name)
}

/** Whether a direct call to `name` is admitted for this Agent right now. */
function admitted(ctx: Context, agent: unknown, name: string): boolean {
  return ctx.tools.executable(name, agent as never) !== undefined
}

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const fs = await import('node:fs/promises')
  const dir = join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`,
  )
}

async function tempHome(prefix: string): Promise<string> {
  const fs = await import('node:fs/promises')
  return fs.mkdtemp(join(tmpdir(), prefix))
}

// — 1. declaration before/after agent/created ———————————————————————————————

describe('agent scope: declaration changes exactly at agent/created', () => {
  it('declares On-demand tools before the Agent exists and drops them after', async () => {
    const home = await tempHome('dsh-host-integration-scope-')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      stateFile: '',
      tools: { 'on-demand': ['on_demand_tool'], resident: ['resident_tool'] },
    })
    registerTool(ctx, 'on_demand_tool')
    registerTool(ctx, 'resident_tool')
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    await ctx.capability.refresh()

    // The global view (no Agent scope) is the pre-Agent declaration: nothing has
    // applied a restriction yet, so both tiers are declared.
    const global = ctx.tools.schemas().map(schema => schema.name)
    expect(global).toContain('on_demand_tool')
    expect(global).toContain('resident_tool')

    const agent = await announceAgent(ctx, 'scope-agent')
    const scoped = declaredNames(ctx, agent)

    // On-demand is gone from the declaration and from admission.
    expect(scoped).not.toContain('on_demand_tool')
    expect(admitted(ctx, agent, 'on_demand_tool')).toBe(false)
    // Resident and the mandatory meta tools stay declared on both sides.
    expect(scoped).toContain('resident_tool')
    expect(scoped).toContain('meta_search')
    expect(scoped).toContain('meta_invoke')
    expect(global).toContain('meta_search')
    expect(admitted(ctx, agent, 'resident_tool')).toBe(true)

    // The declaration difference is per-Agent, not a global mutation.
    const second = await announceAgent(ctx, 'scope-agent-2')
    expect(declaredNames(ctx, second)).toEqual(scoped)
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('on_demand_tool')
  })
})

// — 2. tier moves on an existing Agent ——————————————————————————————————————

describe('tier moves: an existing Agent follows the policy without stale masks', () => {
  it('updates schemas and admission together, replacing rather than intersecting the mask', async () => {
    const home = await tempHome('dsh-host-integration-tiers-')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      stateFile: '',
      tools: { 'on-demand': ['alpha', 'beta'] },
    })
    registerTool(ctx, 'alpha')
    registerTool(ctx, 'beta')
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'tier-agent')
    // On-demand: neither is declared nor admitted.
    expect(declaredNames(ctx, agent)).not.toContain('alpha')
    expect(declaredNames(ctx, agent)).not.toContain('beta')
    expect(admitted(ctx, agent, 'alpha')).toBe(false)

    // On-demand → Resident: both become declared and admitted.
    await ctx.capabilityPolicy.updateConfig({ tools: { resident: ['alpha', 'beta'], 'on-demand': [] } })
    expect(declaredNames(ctx, agent)).toContain('alpha')
    expect(declaredNames(ctx, agent)).toContain('beta')
    expect(admitted(ctx, agent, 'alpha')).toBe(true)
    expect(admitted(ctx, agent, 'beta')).toBe(true)

    // Resident → On-demand for `alpha` ONLY. `beta` must stay visible: a
    // restriction that intersected the previous deny list would still hide it.
    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['alpha'], resident: ['beta'] } })
    expect(declaredNames(ctx, agent)).not.toContain('alpha')
    expect(declaredNames(ctx, agent)).toContain('beta')
    expect(admitted(ctx, agent, 'alpha')).toBe(false)
    expect(admitted(ctx, agent, 'beta')).toBe(true)

    // On-demand → Disabled: the tool returns to the declaration (Disabled is an
    // execution-surface deny, not a mask) and the deny moves to pre-execute.
    await ctx.capabilityPolicy.updateConfig({ tools: { disabled: ['alpha'], resident: ['beta'] } })
    expect(declaredNames(ctx, agent)).toContain('alpha')
    const denied = await runOneToolCall(ctx, {
      callId: 'tier-disabled', name: 'alpha', arguments: {}, agent, signal: testSignal,
    })
    expect(denied.isError).toBe(true)

    // Disabled → Resident: the deny is lifted, the call runs again.
    await ctx.capabilityPolicy.updateConfig({ tools: { resident: ['alpha', 'beta'], disabled: [] } })
    const allowed = await runOneToolCall(ctx, {
      callId: 'tier-resident', name: 'alpha', arguments: {}, agent, signal: testSignal,
    })
    expect(allowed.isError).toBe(false)
  })

  it('covers a tool registered after the Agent was created', async () => {
    const home = await tempHome('dsh-host-integration-late-')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, { stateFile: '', tools: { 'on-demand': ['late_tool'] } })
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'late-agent')
    // Registering after agent/created emits `tools/change`; the policy re-derives
    // the deny list, so the new tool is masked for the live Agent too.
    registerTool(ctx, 'late_tool')
    await ctx.capability.refresh()
    await vi.waitFor(() => {
      expect(declaredNames(ctx, agent)).not.toContain('late_tool')
    })
    expect(admitted(ctx, agent, 'late_tool')).toBe(false)
    expect(declaredNames(ctx, agent)).toContain('meta_search')
  })
})

// — 3. skill catalog filter —————————————————————————————————————————————————

describe('skill catalog: only Resident skills reach the model', () => {
  it('drops On-demand and Disabled entries and keeps Resident ones', async () => {
    const home = await tempHome('dsh-host-integration-catalog-')
    await writeSkill(`${home}/.agents/skills`, 'keep-skill', 'Resident skill')
    await writeSkill(`${home}/.agents/skills`, 'lazy-skill', 'On-demand skill')
    await writeSkill(`${home}/.agents/skills`, 'blocked-skill', 'Disabled skill')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      stateFile: '',
      skills: { resident: ['keep-skill'], 'on-demand': ['lazy-skill'], disabled: ['blocked-skill'] },
    })
    await ctx.capability.refresh()

    // All three skills are really indexed, so the filter is not passing by
    // accident on an empty catalog.
    const indexed = ctx.capability.search({ maxResults: 100 })
      .filter(record => record.kind === 'skill')
      .map(record => record.id)
    expect(indexed).toEqual(expect.arrayContaining(['keep-skill', 'lazy-skill', 'blocked-skill']))

    const catalog = {
      id: 'msg-catalog',
      role: 'user',
      content: [{ type: 'text', text: '<available_skills>all three</available_skills>' }],
      source: {
        kind: 'skill-catalog',
        form: 'catalog',
        entries: [
          { name: 'keep-skill', description: 'Resident skill' },
          { name: 'lazy-skill', description: 'On-demand skill' },
          { name: 'blocked-skill', description: 'Disabled skill' },
        ],
      },
    } as never

    const decision = await ctx.waterfall('agent/pre-step', {
      agent: { id: 'catalog-agent' } as never,
      messages: [catalog],
      modelSelection: { provider: 'test', model: 'test' } as never,
      turn: 1,
      step: 1,
      signal: testSignal,
    }, () => Promise.resolve({ kind: 'enter', messages: [catalog] }))

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    const [filtered] = decision.messages
    const source = filtered.source as { kind: string; entries: Array<{ name: string }> }
    expect(source.kind).toBe('skill-catalog')
    expect(source.entries.map(entry => entry.name)).toEqual(['keep-skill'])
    // The rendered body is replaced too, so the model cannot read a dropped name
    // out of the text the message still carries.
    const text = (filtered.content[0] as { text: string }).text
    expect(text).toContain('<available_skills>')
    expect(text).toContain('keep-skill')
    expect(text).not.toContain('lazy-skill')
    expect(text).not.toContain('blocked-skill')
  })

  it('leaves a catalog message without an entries array intact and warns', async () => {
    const home = await tempHome('dsh-host-integration-catalog-warn-')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, { stateFile: '', skills: { disabled: ['blocked-skill'] } })
    await ctx.capability.refresh()

    const warn = vi.spyOn(ctx.logger, 'warn')
    try {
      // A provider that publishes a catalog without the `entries` array gives the
      // filter nothing to classify; it must stay untouched, and say so.
      const opaque = {
        id: 'msg-opaque',
        role: 'user',
        content: [{ type: 'text', text: 'catalog with an unknown shape' }],
        source: { kind: 'skill-catalog', form: 'catalog' },
      } as never
      const decision = await ctx.waterfall('agent/pre-step', {
        agent: { id: 'catalog-agent' } as never,
        messages: [opaque],
        modelSelection: { provider: 'test', model: 'test' } as never,
        turn: 1,
        step: 1,
        signal: testSignal,
      }, () => Promise.resolve({ kind: 'enter', messages: [opaque] }))

      expect(decision.kind).toBe('enter')
      if (decision.kind !== 'enter') return
      // Same object: not rewritten, not dropped.
      expect(decision.messages[0]).toBe(opaque)
      expect(decision.messages).toHaveLength(1)
      const warned = warn.mock.calls.map(call => String(call[0])).join('\n')
      expect(warned).toContain('skill-catalog message has no entries array')
    } finally {
      warn.mockRestore()
    }
  })
})

// — 4. Disabled is a hard deny on both paths ————————————————————————————————

describe('Disabled: rejected at pre-execute and through meta_invoke', () => {
  it('denies a Disabled tool on the direct path and keeps On-demand forwardable', async () => {
    const home = await tempHome('dsh-host-integration-disabled-tool-')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      stateFile: '',
      tools: { disabled: ['blocked_tool'], 'on-demand': ['hidden_tool'] },
    })
    await ctx.plugin(toolMetaInvoke, {})
    let blockedRuns = 0
    let hiddenRuns = 0
    registerTool(ctx, 'blocked_tool', () => { blockedRuns += 1; return { ok: true } })
    registerTool(ctx, 'hidden_tool', () => { hiddenRuns += 1; return { ok: true } })
    registerTool(ctx, 'meta_search')
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'disabled-tool-agent')

    // 1) Direct call: pre-execute denies before the executor body runs.
    const direct = await runOneToolCall(ctx, {
      callId: 'disabled-direct', name: 'blocked_tool', arguments: {}, agent, signal: testSignal,
    })
    expect(direct.isError).toBe(true)
    expect(blockedRuns).toBe(0)
    expect(JSON.stringify(direct.content)).toContain('is disabled and cannot be executed')

    // 2) meta_invoke: the same capability is refused before forwarding.
    const viaMeta = await runOneToolCall(ctx, {
      callId: 'disabled-meta',
      name: 'meta_invoke',
      arguments: { id: 'blocked_tool', kind: 'tool', args: {} },
      agent,
      signal: testSignal,
    })
    expect(viaMeta.isError).toBe(true)
    expect(blockedRuns).toBe(0)
    expect(JSON.stringify(viaMeta.content)).toContain('is disabled and cannot be invoked')

    // 3) On-demand is NOT denied at pre-execute: meta_invoke must still reach it.
    const forwarded = await runOneToolCall(ctx, {
      callId: 'ondemand-meta',
      name: 'meta_invoke',
      arguments: { id: 'hidden_tool', kind: 'tool', args: {} },
      agent,
      signal: testSignal,
    })
    expect(forwarded.isError).toBe(false)
    expect(hiddenRuns).toBe(1)
  })

  it('denies the skill loader and meta_invoke for a Disabled skill', async () => {
    const home = await tempHome('dsh-host-integration-disabled-skill-')
    await writeSkill(`${home}/.agents/skills`, 'keep-skill', 'Resident skill')
    await writeSkill(`${home}/.agents/skills`, 'blocked-skill', 'Disabled skill')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      stateFile: '',
      skills: { resident: ['keep-skill'], disabled: ['blocked-skill'] },
    })
    await ctx.plugin(toolMetaInvoke, {})
    // Stand-in for `dsh-tool-skill`'s loader: the real one is not part of this
    // composition, and what matters here is that the policy denies the call
    // BEFORE any loader body runs.
    let loaderRuns = 0
    registerTool(ctx, 'skill', () => { loaderRuns += 1; return { ok: true } })
    registerTool(ctx, 'meta_search')
    await ctx.capability.refresh()
    expect(ctx.capability.get('blocked-skill', 'skill')).toBeDefined()

    const agent = await announceAgent(ctx, 'disabled-skill-agent')

    // 1) The `skill` loader is denied at pre-execute.
    const loader = await runOneToolCall(ctx, {
      callId: 'skill-disabled', name: 'skill', arguments: { name: 'blocked-skill' }, agent, signal: testSignal,
    })
    expect(loader.isError).toBe(true)
    expect(loaderRuns).toBe(0)
    expect(JSON.stringify(loader.content)).toContain('is disabled and cannot be loaded')

    // 2) meta_invoke refuses the same skill.
    const viaMeta = await runOneToolCall(ctx, {
      callId: 'skill-disabled-meta',
      name: 'meta_invoke',
      arguments: { id: 'blocked-skill', kind: 'skill' },
      agent,
      signal: testSignal,
    })
    expect(viaMeta.isError).toBe(true)
    expect(JSON.stringify(viaMeta.content)).toContain('is disabled and cannot be invoked')

    // 3) A Resident skill still loads through both paths.
    const resident = await runOneToolCall(ctx, {
      callId: 'skill-resident', name: 'skill', arguments: { name: 'keep-skill' }, agent, signal: testSignal,
    })
    expect(resident.isError).toBe(false)
    expect(loaderRuns).toBe(1)
    const residentMeta = await runOneToolCall(ctx, {
      callId: 'skill-resident-meta',
      name: 'meta_invoke',
      arguments: { id: 'keep-skill', kind: 'skill' },
      agent,
      signal: testSignal,
    })
    expect(residentMeta.isError).toBe(false)
  })
})

// — 5. merged Typert contribution ——————————————————————————————————————————

/**
 * A faithful stand-in for the Host's Typert store.
 *
 * The real store is not part of this package's dependency set, so it cannot be
 * mounted here. What CAN be asserted is the contract the production failure was
 * about, as documented on `mergeHostFaces` in `src/host-face.ts`:
 *
 *  - contributions are keyed by `package`;
 *  - a second `register()` for an already-mounted package withdraws the FIRST
 *    contribution's strict definitions;
 *  - the withdrawn endpoint stays `hasSeen()` but has no resolvable definition,
 *    which is what the gateway reports as `definition-unavailable`.
 *
 * This implements exactly those three rules against the public
 * `TypertRemoteRegistry` method names, so a regression to "two separate
 * registrations" is observable instead of vacuous.
 */
interface StrictDefinition {
  readonly id: string
  readonly namespace: string
  readonly method: string
}

function createStrictStore() {
  const contributions: Array<{ package: string; invocations: readonly StrictDefinition[] }> = []
  const definitions = new Map<string, StrictDefinition>()
  const withdrawn = new Set<string>()
  const seen = new Set<string>()
  const listeners: Array<() => void> = []
  const live = new Map<string, readonly StrictDefinition[]>()

  const endpointOf = (invocation: StrictDefinition): string => `${invocation.namespace}/${invocation.method}`

  return {
    register(contribution: {
      package: string
      face: string
      invocations: readonly StrictDefinition[]
    }): () => void {
      const previous = live.get(contribution.package)
      if (previous !== undefined) {
        // The documented withdrawal: the earlier strict definitions are gone.
        for (const invocation of previous) {
          const endpoint = endpointOf(invocation)
          definitions.delete(endpoint)
          withdrawn.add(endpoint)
        }
      }
      contributions.push(contribution)
      live.set(contribution.package, contribution.invocations)
      for (const invocation of contribution.invocations) {
        const endpoint = endpointOf(invocation)
        definitions.set(endpoint, invocation)
        seen.add(endpoint)
      }
      for (const listener of listeners) listener()
      return () => {
        for (const invocation of contribution.invocations) {
          const endpoint = endpointOf(invocation)
          if (definitions.get(endpoint) === invocation) definitions.delete(endpoint)
        }
        if (live.get(contribution.package) === contribution.invocations) live.delete(contribution.package)
      }
    },
    get(endpoint: string): StrictDefinition | undefined {
      return definitions.get(endpoint)
    },
    hasSeen(endpoint: string): boolean {
      return seen.has(endpoint)
    },
    list(): readonly StrictDefinition[] {
      return [...definitions.values()]
    },
    subscribe(listener: () => void): () => void {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    contributions,
    withdrawn,
  }
}

describe('Typert host face: one merged contribution, every endpoint resolvable', () => {
  it('registers capabilityPolicy and usage together and answers no definition-unavailable', async () => {
    const home = await tempHome('dsh-host-integration-typert-')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, { stateFile: '' })

    const store = createStrictStore()
    const register = vi.fn((contribution: never) => store.register(contribution as never))
    const disposeTypert = ctx.provide('typert', { register })
    try {
      // The face half of the root entry (`src/index.ts` lines 78–87): both
      // gateways mounted, then ONE merged contribution claimed inside
      // `ctx.inject(['typert'], …)`. The root `apply()` is not used here on
      // purpose — it also mounts the Guard, whose switches are covered by their
      // own spec files and are unrelated to the Typert claim.
      ctx.plugin(CapabilityPolicyGateway)
      ctx.plugin(UsageGateway)
      ctx.inject(['typert'], (typertCtx: Context) => {
        registerCapabilityPolicyHostFace(typertCtx, [usageHostFace()])
      })
      await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))

      // One contribution for the one package — a second register() for the same
      // package would withdraw the first one's strict definitions.
      expect(register).toHaveBeenCalledTimes(1)
      const [contribution] = register.mock.calls[0] as unknown as [{
        package: string
        face: string
        invocations: readonly StrictDefinition[]
      }]
      expect(contribution.package).toBe(HOST_FACE_PACKAGE)
      expect(contribution.face).toBe('host')
      expect([...new Set(contribution.invocations.map(invocation => invocation.namespace))].sort())
        .toEqual([HOST_FACE_NAMESPACE, USAGE_HOST_FACE_NAMESPACE].sort())
      expect(store.withdrawn.size).toBe(0)

      // Every endpoint the browser declares resolves to a live strict definition,
      // and none of them was withdrawn — i.e. the gateway can never answer
      // `definition-unavailable` for a `capabilityPolicy` or `usage` call.
      const browserEndpoints = [
        ...TYPERT_REMOTE.descriptors.map(descriptor => `${descriptor.namespace}/${descriptor.method}`),
        ...USAGE_TYPERT_REMOTE.descriptors.map(descriptor => `${descriptor.namespace}/${descriptor.method}`),
      ]
      expect(browserEndpoints.length).toBeGreaterThan(0)
      for (const endpoint of browserEndpoints) {
        expect(store.get(endpoint), endpoint).toBeDefined()
        expect(store.hasSeen(endpoint), endpoint).toBe(true)
        expect(store.withdrawn.has(endpoint), endpoint).toBe(false)
      }
      expect(store.list()).toHaveLength(browserEndpoints.length)

      // The declared `service` keys are the gateway services actually mounted on
      // this context, so the face cannot drift from the composition.
      const capabilityGateway = ctx.get(HOST_FACE_SERVICE) as
        { typertRemote?: { serviceKey: string; namespace: string } } | undefined
      const usageGateway = ctx.get(USAGE_HOST_FACE_SERVICE) as
        { typertRemote?: { serviceKey: string; namespace: string } } | undefined
      expect(capabilityGateway?.typertRemote?.serviceKey).toBe(HOST_FACE_SERVICE)
      expect(capabilityGateway?.typertRemote?.namespace).toBe(HOST_FACE_NAMESPACE)
      expect(usageGateway?.typertRemote?.serviceKey).toBe(USAGE_HOST_FACE_SERVICE)
      expect(usageGateway?.typertRemote?.namespace).toBe(USAGE_HOST_FACE_NAMESPACE)
    } finally {
      await disposeTypert()
    }
  })

  it('would fail if the two faces were registered separately', async () => {
    // Negative control for the assertion above: prove the stand-in really models
    // the withdrawal, so "withdrawn.size === 0" is not a vacuous pass.
    const { capabilityPolicyHostFace, mergeHostFaces } = await import('../src/host-face.ts')
    const { usageHostFace } = await import('../src/usage/usage-host-face.ts')
    const [firstDescriptor] = TYPERT_REMOTE.descriptors
    expect(firstDescriptor).toBeDefined()
    const capabilityEndpoint = `${HOST_FACE_NAMESPACE}/${firstDescriptor!.method}`
    const usageEndpoint = `${USAGE_HOST_FACE_NAMESPACE}/${USAGE_TYPERT_REMOTE.descriptors[0]!.method}`

    // A) Two separate contributions: the second withdraws the first.
    const separate = createStrictStore()
    separate.register(capabilityPolicyHostFace() as never)
    separate.register(usageHostFace() as never)
    expect(separate.contributions.map(contribution => contribution.package)).toEqual([
      HOST_FACE_PACKAGE, HOST_FACE_PACKAGE,
    ])
    // Withdrawn, yet remembered: exactly the `hasSeen()` + no-definition state
    // the gateway reports as `definition-unavailable`.
    expect(separate.hasSeen(capabilityEndpoint)).toBe(true)
    expect(separate.get(capabilityEndpoint)).toBeUndefined()
    expect(separate.withdrawn.has(capabilityEndpoint)).toBe(true)
    expect(separate.get(usageEndpoint)).toBeDefined()

    // B) The merged contribution the root entry actually sends: nothing withdrawn.
    const merged = createStrictStore()
    merged.register(mergeHostFaces([capabilityPolicyHostFace(), usageHostFace()]) as never)
    expect(merged.contributions).toHaveLength(1)
    expect(merged.withdrawn.size).toBe(0)
    expect(merged.get(capabilityEndpoint)).toBeDefined()
    expect(merged.get(usageEndpoint)).toBeDefined()

    // C) Drift alarm on the composition itself: `src/index.ts` must claim the
    // namespaces through ONE `registerCapabilityPolicyHostFace` call that carries
    // the usage face as `extra`. A second registration would withdraw the first
    // one's strict definitions (see `mergeHostFaces`). Asserted on the source
    // because mounting the root entry would also mount the Guard, which this
    // spec deliberately stays out of.
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    const registrations = source.match(/registerCapabilityPolicyHostFace\(/g) ?? []
    expect(registrations).toHaveLength(1)
    expect(source).toMatch(/registerCapabilityPolicyHostFace\(registry, \[usageHostFace\(\)\]\)/)
    expect(source).not.toMatch(/registerUsageHostFace\(/)
  })
})

// — 6. unload lifecycle ————————————————————————————————————————————————————

/**
 * Count `ctx.effect` disposals on the plugin's OWN context.
 *
 * Every `ctx.on` / `ctx.provide` inside the policy is recorded by Cordis as its
 * own effect (visible in `fiber.getEffects()`); the explicit flush effect is the
 * one this wrapper sees, so the two together cover "every disposer ran".
 */
function countedContext(target: Context): { ctx: Context; disposals: () => number } {
  let disposals = 0
  const proxy = new Proxy(target, {
    get(object, prop) {
      // Resolve against the REAL context (`object` as receiver): Cordis binds a
      // service getter to the fiber that owns the receiver, so forwarding the
      // Proxy here would fail as "cannot get property X without inject".
      const value = Reflect.get(object, prop, object)
      if (prop === 'effect' && typeof value === 'function') {
        return (fn: () => () => unknown, label?: string) => {
          const wrapped = () => {
            const inner = fn()
            return () => {
              disposals += 1
              return inner()
            }
          }
          return Reflect.apply(value, object, [wrapped, label])
        }
      }
      return value
    },
  }) as unknown as Context
  return { ctx: proxy, disposals: () => disposals }
}

describe('unload: dispose releases hooks, listeners and per-Agent state', () => {
  it('drops every effect and stops enforcing after dispose', async () => {
    const home = await tempHome('dsh-host-integration-dispose-')
    const ctx = await mountCore(home)
    await ctx.plugin(registry, { stateFile: '' })
    registerTool(ctx, 'hidden_tool')
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    await ctx.capability.refresh()

    // `apply` receives the plugin's own child context, which is exactly the
    // context the policy registers its effects on. The declared injections are
    // repeated here because this wrapper is the plugin runtime, not `policy.ts`.
    let disposals = (): number => 0
    const fiber = await ctx.plugin({
      name: 'counted-policy',
      inject: [...policy.inject],
      apply: (childCtx: Context) => {
        const counted = countedContext(childCtx)
        disposals = counted.disposals
        return policy.apply(counted.ctx, { stateFile: '', tools: { 'on-demand': ['hidden_tool'] } })
      },
    })

    expect(ctx.get('capabilityPolicy')).toBeDefined()
    const labels = fiber.getEffects().map(effect => effect.label)
    // The host's own record of what this plugin owns: seven listener
    // registrations, the provided service, and the explicit flush effect.
    for (const label of [
      'capability-menu-policy: flush tier persistence',
      'ctx.on("agent/created")',
      'ctx.on("agent/disposed")',
      'ctx.on("tools/change")',
      'ctx.on("tools/pre-execute")',
      'ctx.on("agent/pre-step")',
      'ctx.on("system-prompt/assemble")',
      'ctx.provide("capabilityPolicy")',
    ]) expect(labels, label).toContain(label)
    expect(labels).toHaveLength(8)

    const agent = await announceAgent(ctx, 'dispose-agent')
    expect(declaredNames(ctx, agent)).not.toContain('hidden_tool')

    // A disposed Agent is released early: the mask is lifted while the plugin is
    // still mounted, and a later tier move does not resurrect it.
    ctx.emit('agent/disposed', { agent: agent as never })
    expect(declaredNames(ctx, agent)).toContain('hidden_tool')
    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['hidden_tool', 'meta_search'] } })
    expect(declaredNames(ctx, agent)).toContain('hidden_tool')

    // Unload the plugin: every effect is torn down and the disposers run once.
    await fiber.dispose()
    expect(fiber.getEffects()).toEqual([])
    expect(ctx.get('capabilityPolicy')).toBeUndefined()
    // GAP: `ctx.on` / `ctx.provide` register their disposers inside the Cordis
    // service call, so a context wrapper cannot observe those disposers being
    // invoked — only the explicit `ctx.effect` body is visible to it. The
    // `getEffects() === []` assertion above is the host's own accounting that
    // they were released; the behavioural checks below prove the release.
    expect(disposals()).toBe(1)
    // Idempotent: a second dispose must not run the flush disposer again.
    await fiber.dispose()
    expect(disposals()).toBe(1)

    // The pre-execute hook is gone, so nothing denies any more.
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: 'after-dispose', rootCallId: 'after-dispose', token: 'after-dispose:token',
      name: 'hidden_tool', arguments: {}, signal: testSignal,
    } as never, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'allow' })

    // The agent/created listener is gone: a new Agent is never masked, and the
    // tools/change reapply path cannot resurrect the old deny list.
    const late = await announceAgent(ctx, 'after-dispose-agent')
    expect(declaredNames(ctx, late)).toContain('hidden_tool')
    expect(admitted(ctx, late, 'hidden_tool')).toBe(true)
    registerTool(ctx, 'another_on_demand')
    await ctx.capability.refresh()
    expect(declaredNames(ctx, late)).toContain('another_on_demand')

    // The pre-step filter is gone too: no warn, message untouched.
    const warn = vi.spyOn(ctx.logger, 'warn')
    try {
      const opaque = {
        id: 'msg-after', role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'skill-catalog' },
      } as never
      const preStep = await ctx.waterfall('agent/pre-step', {
        agent: agent as never, messages: [opaque], turn: 1, step: 1, signal: testSignal,
        modelSelection: { provider: 'test', model: 'test' } as never,
      }, () => Promise.resolve({ kind: 'enter', messages: [opaque] }))
      expect(preStep.kind).toBe('enter')
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }

    // The system-prompt listener is gone: the On-demand pointer is not appended.
    const assembly = await ctx.systemPrompt.assemble({ scope: late as never })
    expect(assembly.sections.find(section => section.name === 'capability-menu-catalog')).toBeUndefined()
  })
})

// — 7. usage honesty without sessionPersistence ——————————————————————————————

/** Flatten a React element tree to text, mirroring `tests/client-usage.spec.tsx`. */
function collectText(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (!isValidElement(node)) return out
  const element = node as ReactElement<{ children?: ReactNode }>
  if (typeof element.type === 'function') {
    collectText((element.type as unknown as (props: unknown) => ReactNode)(element.props), out)
    return out
  }
  collectText(element.props.children, out)
  return out
}

function panelText(snapshot: UsagePanelViewProps['snapshot']): string {
  return collectText(UsagePanelView({ query: { days: 7 }, snapshot })).join('\n')
}

describe('usage: unknown/partial stay honest without sessionPersistence', () => {
  it('reports the missing service as unknown coverage, never as zero calls', async () => {
    const home = await tempHome('dsh-host-integration-usage-')
    const ctx = await mountCore(home)
    // A known profile isolates the gap under test: what is missing here is
    // `sessionPersistence`, not the profile name.
    const disposeProfile = ctx.provide('profileContext', { name: 'integration-probe' })

    // 1) The backfill path: no `sessionPersistence` on this Host.
    const backfill = await runUsageBackfill({
      context: ctx,
      classify: () => ({ source: { kind: 'native' }, capabilityId: 'bash' }),
    })
    expect(backfill.coverageStatus).toBe('unknown')
    expect(backfill.coverageStatus).not.toBe('complete')
    expect(backfill.stats.disabled).toBe('session-persistence-unavailable')
    expect(backfill.stats.reasons['backfill-disabled-service-unavailable']).toBe(1)
    expect(backfill.stats.cancelled).toBe(false)

    // 2) The live runtime path: installed, observing, but with no history to
    //    read. `available: true` with an empty coverage map — NOT `complete`.
    const runtime = installUsageRuntime(ctx)
    const disposeRuntime = ctx.provide(USAGE_RUNTIME_SERVICE, runtime)
    try {
      expect(runtime.stats().backfillReasons['backfill-disabled-service-unavailable']).toBe(1)
      const wire = readUsageSnapshot(ctx)
      expect(wire.available).toBe(true)
      if (!wire.available) return
      expect(wire.metadata.profile).toEqual({ status: 'known', name: 'integration-probe' })
      expect(wire.report.coverage).toEqual({})
      expect(wire.report.calls).toBe(0)
      // `limitsReached` is a Host-side truncation signal, and nothing was read.
      expect(wire.report.limitsReached).toBe(false)

      const mapped = toUsagePanelResult(wire, { days: 7 }, Date.UTC(2026, 10, 4, 20, 0))
      expect(mapped.ok).toBe(true)
      if (!mapped.ok) return
      // Zero rows + zero coverage is `unknown`, never `complete`: "nothing
      // reported" is not "nothing missing".
      expect(mapped.value.coverage?.status).toBe('unknown')
      expect(mapped.value.coverage?.status).not.toBe('complete')
      expect(mapped.value.totals?.calls).toBe(0)

      const text = panelText(mapped.value)
      // The panel refuses to read a zero as "unused".
      expect(text).toContain('不能据此判断能力未使用')
      expect(text).not.toContain('所选范围内没有调用记录')
      expect(text).toContain('未知')
    } finally {
      await disposeRuntime()
      runtime.dispose()
      await disposeProfile()
    }
  })

  it('separates "zero calls" from "never used" and never upgrades partial to complete', async () => {
    const home = await tempHome('dsh-host-integration-usage-partial-')
    const ctx = await mountCore(home)
    const disposeProfile = ctx.provide('profileContext', { name: 'integration-probe' })
    const runtime = installUsageRuntime(ctx)
    let disposeRuntime = ctx.provide(USAGE_RUNTIME_SERVICE, runtime)
    try {
      const base = readUsageSnapshot(ctx)
      expect(base.available).toBe(true)
      if (!base.available) return

      const now = Date.UTC(2026, 10, 4, 20, 0)
      const emptyReport = base.report

      // A) A live-observed Session with no `sessionPersistence` to verify it.
      //    The runtime's own listener produces `partial` coverage for it — the
      //    real host path, not a hand-built fixture.
      ctx.emit('session/event', { id: SessionId('session-live') } as never, {
        type: 'tool/call',
        seq: 1,
        time: now - 60_000,
        data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' },
      } as never)
      runtime.flush()
      const live = readUsageSnapshot(ctx)
      expect(live.available).toBe(true)
      if (!live.available) return
      expect(live.report.coverage['session-live']?.status).toBe('partial')
      expect(live.report.coverage['session-live']?.status).not.toBe('complete')
      // The unverified history is named, not silently assumed complete.
      expect(live.report.coverage['session-live']?.reasons).toContain('live-only')

      const livePanel = toUsagePanelResult(live, { days: 7 }, now)
      expect(livePanel.ok).toBe(true)
      if (!livePanel.ok) return
      expect(livePanel.value.coverage?.status).toBe('partial')
      const liveText = panelText(livePanel.value)
      // The panel labels the page "部分" and states that the numbers are a lower
      // bound, never a complete count.
      expect(liveText).toContain('覆盖：部分')
      expect(liveText).toContain('覆盖不完整')
      expect(liveText).toContain('不能当作完整调用量')
      expect(liveText).toContain('live-only')
      expect(liveText).toContain('sessionPersistence')
      expect(liveText).not.toContain('所选范围内没有调用记录')

      // B) Only verified coverage may read a zero as "no calls in range". No live
      //    path can produce `complete` without `sessionPersistence`, so this case
      //    is built from the documented wire shape of the real snapshot.
      const complete = toUsagePanelResult({
        ...live,
        report: {
          ...live.report,
          aggregates: [],
          calls: 0,
          coverage: {
            'session-1': {
              status: 'complete', fromSeq: 1, throughSeq: 2,
              skippedSessions: 0, skippedEvents: 0, reasons: [], reasonsTruncated: false,
            },
          },
        },
      }, { days: 7 }, now)
      expect(complete.ok).toBe(true)
      if (!complete.ok) return
      expect(complete.value.coverage?.status).toBe('complete')
      const completeText = panelText(complete.value)
      expect(completeText).toContain('所选范围内没有调用记录')
      expect(completeText).not.toContain('不能据此判断能力未使用')

      // C) A Host that hit its aggregate cap downgrades even a `complete` page.
      const capped = toUsagePanelResult({
        ...live,
        report: {
          ...emptyReport,
          limitsReached: true,
          coverage: {
            'session-1': {
              status: 'complete', fromSeq: 1, throughSeq: 2,
              skippedSessions: 0, skippedEvents: 0, reasons: [], reasonsTruncated: false,
            },
          },
        },
      }, { days: 7 }, now)
      expect(capped.ok).toBe(true)
      if (!capped.ok) return
      expect(capped.value.coverage?.status).toBe('partial')
      expect(capped.value.coverage?.status).not.toBe('complete')

      // D) no runtime at all is an error result, not a zero-filled page.
      await disposeRuntime()
      disposeRuntime = () => undefined
      runtime.dispose()
      const absent = readUsageSnapshot(ctx)
      expect(absent.available).toBe(false)
      if (absent.available) return
      expect(absent.reason).toBe('service-absent')
      const absentPanel = toUsagePanelResult(absent, { days: 7 }, now)
      expect(absentPanel.ok).toBe(false)
      if (absentPanel.ok) return
      expect(absentPanel.error.message).toContain('不是「0 次调用」')
    } finally {
      await disposeRuntime()
      runtime.dispose()
      await disposeProfile()
    }
  })
})
