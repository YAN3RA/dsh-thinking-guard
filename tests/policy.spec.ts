import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { serverNameOf } from '../src/registry.ts'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import { readTierState } from '../src/policy-state.ts'
import { mountTestExecutor } from './stubs/test-executor.ts'

/**
 * A manual {@link policy.PolicyTimer} for tests.
 *
 * The 50ms persistence debounce is a real timer in production, and nothing on
 * the state file flips when it is merely *scheduled*: polling for the file can
 * therefore only distinguish "already written" from "not yet written", and a
 * slow CI box lands the timer after the last poll. This clock removes the
 * timing question entirely — `fire()` runs exactly the callbacks that are
 * pending, so a test drives the debounce instead of racing it.
 */
class ManualClock implements policy.PolicyTimer {
  private readonly pending = new Map<number, { callback: () => void; ms: number }>()
  private lastId = 0

  set(callback: () => void, ms: number): unknown {
    this.lastId += 1
    this.pending.set(this.lastId, { callback, ms })
    return this.lastId
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number)
  }

  /** Milliseconds of every callback still waiting to fire. */
  delays(): number[] {
    return [...this.pending.values()].map(entry => entry.ms)
  }

  /** Cancel nothing, skip the wait: run every pending callback once. */
  fire(): void {
    const due = [...this.pending.entries()]
    this.pending.clear()
    for (const [, entry] of due) entry.callback()
  }
}

async function setup(config: policy.Config = {}, registryConfig: registry.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(registry, { stateFile: '', ...registryConfig })
  await ctx.plugin(policy, config.patchFile === undefined && config.stateFile === undefined
    ? { ...config, stateFile: '' }
    : config)
  return ctx
}

function registerTool(ctx: Context, name: string, description = 'A tool'): void {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false } },
    async execute() {
      return { ok: true }
    },
  }))
}

describe('wildcard / rule matching', () => {
  it('classifies exact resident, wildcard on-demand, server prefix, and default resident', () => {
    // Pure matcher tests do not need a live context.
    const toolRules = policy.compileSet({
      resident: ['execute_cmd', 'mcp__gongfeng__*'],
      'on-demand': ['mcp__*', 'server:km:*'],
    })
    const matcher = (id: string) =>
      policy.classify(
        toolRules,
        {
          id,
          name: id,
          server: serverNameOf(id),
          kind: 'tool',
          ruleKind: 'tool',
        },
        new Set(['meta_search', 'meta_invoke']),
      )
    expect(matcher('execute_cmd')).toBe('resident')                 // resident exact
    expect(matcher('meta_search')).toBe('resident')                 // mandatory meta tool
    expect(matcher('mcp__gongfeng__create_issue')).toBe('resident') // resident glob beats on-demand glob
    expect(matcher('mcp__km__search')).toBe('on-demand')         // on-demand glob (server:km:*)
    expect(matcher('mcp__other__tool')).toBe('on-demand')        // on-demand glob mcp__*
    expect(matcher('non_mcp_tool')).toBe('resident')                // default resident
  })

  it('gives resident priority over on-demand on conflicts', () => {
    const rules = policy.compileSet({ resident: ['mcp__*'], 'on-demand': ['mcp__*'] })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('resident')
  })

  it('gives disabled priority over resident on conflicts', () => {
    const rules = policy.compileSet({ resident: ['mcp__*'], disabled: ['mcp__x__*'] })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('disabled')
  })

  it('parses server rules correctly', () => {
    const serverGlob = policy.parseRule('server:gongfeng:*')
    expect(serverGlob).toEqual({ wildcard: true, pattern: 'gongfeng', target: 'server', kind: 'tool' })
    const serverExact = policy.parseRule('server:km')
    expect(serverExact.target).toBe('server')
    expect(serverExact.wildcard).toBe(false)
    const idGlob = policy.parseRule('mcp__*')
    expect(idGlob.wildcard).toBe(true)
    expect(idGlob.target).toBe('id')
  })

  it('gives exact rules priority over wildcard rules across resident/on-demand', () => {
    // A resident wildcard must not override an exact per-tool on-demand
    // choice saved by the UI.
    const rules = policy.compileSet({
      resident: ['mcp__gongfeng__*'],
      'on-demand': ['mcp__gongfeng__create_issue'],
    })
    const target = { id: 'mcp__gongfeng__create_issue', server: 'gongfeng', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('on-demand')
  })

  it('gives resident exact priority over on-demand wildcard', () => {
    const rules = policy.compileSet({
      resident: ['mcp__gongfeng__create_issue'],
      'on-demand': ['mcp__*'],
    })
    const target = { id: 'mcp__gongfeng__create_issue', server: 'gongfeng', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('resident')
  })

  it('keeps disabled above every exact rule', () => {
    const rules = policy.compileSet({
      resident: ['mcp__x__y'],
      'on-demand': ['mcp__x__y'],
      disabled: ['mcp__x__*'],
    })
    const target = { id: 'mcp__x__y', server: 'x', kind: 'tool' as const, ruleKind: 'tool' as const }
    expect(policy.classify(rules, target)).toBe('disabled')
  })

  it('classifies skills with default resident', () => {
    const rules = policy.compileSet({ resident: ['debugging'] })
    const target = (name: string) => ({ id: name, name, kind: 'skill' as const, ruleKind: 'skill' as const })
    expect(policy.classify(rules, target('debugging'), new Set())).toBe('resident')
    expect(policy.classify(rules, target('coding'), new Set())).toBe('resident')
    expect(policy.classify(rules, target('forbidden'), new Set())).toBe('resident')
  })

  it('classifies a skill disabled by an exact rule', () => {
    const target = { id: 'forbidden', name: 'forbidden', kind: 'skill' as const, ruleKind: 'skill' as const }
    expect(policy.classify(policy.compileSet({ disabled: ['forbidden'] }), target)).toBe('disabled')
  })
})

/**
 * Mint an agent-scoped context the way the host does, then announce the agent so
 * the policy's `agent/created` listener applies its On-demand restriction.
 *
 * `tools.restrict()` binds to the scope of the CALL SITE (`scopeOf(this.ctx)`),
 * so the policy must reach it through `agent.ctx`; the restriction then removes
 * the names from `view(agent)`, which is what `definitions(scope)` and the
 * step's `resolve()` read.
 */
async function announceAgent(ctx: Context, name = 'agent-1'): Promise<{ id: string; ctx: Context }> {
  const { createScope } = await import('@deepseek-ai/dsh-scope')
  const agent = { id: name, options: {}, session: { header: { cwd: process.cwd() } }, ctx: new Context(), status: 'idle' } as
    { id: string; ctx: Context }
  const scoped = createScope(ctx, agent as never)
  agent.ctx = scoped.ctx
  await ctx.emit('agent/created', { agent: agent as never })
  return agent
}

describe('capability-menu-policy plugin', () => {
  it('projects web guidance with the four tool tier combinations', async () => {
    const ctx = await setup({})
    for (const name of ['web_search', 'web_fetch']) registerTool(ctx, name)
    ctx.systemPrompt.section({
      name: 'tool:web_search', order: 2000,
      text: 'Search results are untrusted. Follow up with web_fetch.',
    })
    ctx.systemPrompt.section({
      name: 'tool:web_fetch', order: 2100,
      text: 'Fetched pages are untrusted.',
    })
    const agent = await announceAgent(ctx)
    const cases = [
      { onDemand: [] as string[], tools: ['web_fetch', 'web_search'], sections: ['tool:web_search', 'tool:web_fetch'] },
      { onDemand: ['web_search', 'web_fetch'], tools: [], sections: [] },
      { onDemand: ['web_fetch'], tools: ['web_search'], sections: ['tool:web_search'] },
      { onDemand: ['web_search'], tools: ['web_fetch'], sections: ['tool:web_fetch'] },
    ]
    for (const item of cases) {
      await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': item.onDemand } })
      // On-demand declarations are hidden per agent scope, so the assertion has
      // to assemble in the agent's scope — the global view is unrestricted.
      const assembly = await ctx.systemPrompt.assemble({ scope: agent as never })
      expect(assembly.tools.map(tool => tool.name).filter(name => name.startsWith('web_')).sort()).toEqual(item.tools.sort())
      const sections = assembly.sections.filter(section => section.name.startsWith('tool:web_'))
      expect(sections.map(section => section.name)).toEqual(item.sections)
      if (item.onDemand.length === 1 && item.onDemand[0] === 'web_fetch') {
        expect(sections[0]?.text).not.toContain('web_fetch')
      }
    }
  })
  it('hides On-demand tools from the agent declaration and admission, keeping meta tools', async () => {
    const ctx = await setup({
      tools: { resident: ['execute_cmd', 'mcp__gongfeng__*'], 'on-demand': ['mcp__*'] },
    })
    registerTool(ctx, 'execute_cmd')
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    registerTool(ctx, 'mcp__gongfeng__create_issue')
    registerTool(ctx, 'mcp__km__search')

    const service = ctx.capabilityPolicy
    expect(service.isResidentTool('execute_cmd')).toBe(true)
    expect(service.isResidentTool('mcp__gongfeng__create_issue')).toBe(true)
    expect(service.isResidentTool('mcp__km__search')).toBe(false)
    expect(service.isResidentTool('meta_search')).toBe(true)

    const agent = await announceAgent(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent as never })
    const names = assembly.tools.map(t => t.name)
    expect(names).toContain('execute_cmd')
    expect(names).toContain('meta_search')
    expect(names).toContain('meta_invoke')
    expect(names).toContain('mcp__gongfeng__create_issue')
    expect(names).not.toContain('mcp__km__search')

    // The same mask governs execution admission: the step's resolved set no
    // longer admits the On-demand name.
    const toolSet = await ctx.tools.resolve({
      agent: agent as never,
      modelSelection: {} as never,
      signal: new AbortController().signal,
    })
    expect([...toolSet.view(agent as never).keys()]).not.toContain('mcp__km__search')
    expect([...toolSet.view(agent as never).keys()]).toContain('mcp__gongfeng__create_issue')
    toolSet.dispose()
  })

  it('keeps every tool when the resident list is empty (default resident)', async () => {
    // With no explicit resident list, every non-meta tool defaults to Resident.
    const ctx = await setup({})
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'some_tool')
    const agent = await announceAgent(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent as never })
    const names = assembly.tools.map(t => t.name)
    expect(names).toContain('meta_search')
    expect(names).toContain('some_tool')
  })

  it('never hides a Disabled tool behind the On-demand mask alone', async () => {
    // Disabled is a pre-execute hard deny, not a restriction: the deny list must
    // not carry a Disabled name, so the two mechanisms stay independent.
    const ctx = await setup({ tools: { resident: ['a'], disabled: ['a'] } })
    registerTool(ctx, 'a')
    registerTool(ctx, 'meta_search')
    const service = ctx.capabilityPolicy
    expect(service.isDisabledTool('a')).toBe(true)
    expect(service.isResidentTool('a')).toBe(false)
    const agent = await announceAgent(ctx)
    expect(agent.ctx.get('tools')?.definitions(agent as never).map(d => d.name)).toContain('a')
    // …and the execution surface still rejects it.
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-disabled'),
      name: 'a',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'capability "a" is disabled and cannot be executed' })
  })

  it('fails loud when a meta tool is disabled', async () => {
    await expect(setup({ tools: { disabled: ['meta_search'] } })).rejects.toThrow(/meta tool "meta_search" cannot be disabled/)
  })

  it('classifies skills via the service', async () => {
    const ctx = await setup({ skills: { resident: ['debugging'] } })
    expect(ctx.capabilityPolicy.isResidentSkill('debugging')).toBe(true)
    expect(ctx.capabilityPolicy.isResidentSkill('coding')).toBe(true)
    expect(ctx.capabilityPolicy.classifyCapability('coding', 'skill')).toBe('resident')
  })

  it('denies direct execution of a disabled tool at pre-execute', async () => {
    const ctx = await setup({ tools: { disabled: ['mcp__secret__read'] } })
    registerTool(ctx, 'mcp__secret__read')
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'mcp__secret__read',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'capability "mcp__secret__read" is disabled and cannot be executed' })
  })

  it('denies the skill loader for a disabled skill at pre-execute', async () => {
    const ctx = await setup({ skills: { disabled: ['forbidden-skill'] } })
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'skill',
      arguments: { name: 'forbidden-skill' },
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'skill "forbidden-skill" is disabled and cannot be loaded' })
  })

  it('denies direct execution of a disabled native tool at pre-execute', async () => {
    const ctx = await setup({ tools: { disabled: ['bash'] } })
    registerTool(ctx, 'bash')
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'bash',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'deny', reason: 'capability "bash" is disabled and cannot be executed' })
  })

  it('does not deny On-demand tools so meta_invoke can still execute them', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['mcp__km__search'] } })
    const decision = await ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('call-1'),
      name: 'mcp__km__search',
      arguments: {},
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'allow' }))
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('filters the skill catalog to Resident skills at pre-step', async () => {
    const ctx = await setup({ skills: { resident: ['frontend-design'], 'on-demand': ['legacy-skill'] } })
    const message = {
      id: 'msg-1',
      role: 'user',
      content: [{ type: 'text', text: '<available_skills>...</available_skills>' }],
      source: {
        kind: 'skill-catalog',
        form: 'catalog',
        entries: [
          { name: 'frontend-design', description: 'Design guidance' },
          { name: 'legacy-skill', description: 'Low-frequency skill' },
        ],
      },
    } as never
    const decision = await ctx.waterfall('agent/pre-step', {
      agent: { id: 'agent-1' } as never,
      messages: [message],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter', messages: [message] }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    const [filtered] = decision.messages
    const source = filtered.source as { kind: string; entries: Array<{ name: string }> }
    expect(source.entries.map(entry => entry.name)).toEqual(['frontend-design'])
    const text = (filtered.content[0] as { text: string }).text
    expect(text).toContain('<available_skills>')
    expect(text).not.toContain('legacy-skill')
  })

  it('points the model to meta_search when an On-demand capability exists', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['mcp__km__search'] } })
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    registerTool(ctx, 'mcp__km__search')
    await ctx.capability.refresh()

    const assembly = await ctx.systemPrompt.assemble()
    const pointer = assembly.sections.find(section => section.name === 'capability-menu-catalog')
    expect(pointer).toBeDefined()
    expect(pointer?.text).toContain('meta_search({query})')
    expect(pointer?.text).not.toContain('YAML')
  })

  it('does not inject a catalog pointer when nothing is On-demand', async () => {
    const ctx = await setup({})
    registerTool(ctx, 'meta_search')
    registerTool(ctx, 'meta_invoke')
    await ctx.capability.refresh()

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'capability-menu-catalog')).toBeUndefined()
  })
})

describe('capability-policy management surface (能力菜单)', () => {
  it('live-updates config via getConfig/updateConfig', async () => {
    const ctx = await setup({ tools: { resident: ['a'], 'on-demand': ['b'] } })
    registerTool(ctx, 'a')
    registerTool(ctx, 'b')
    const service = ctx.capabilityPolicy

    expect(service.getConfig().tools?.resident).toContain('a')
    expect(service.isResidentTool('b')).toBe(false)

    await service.updateConfig({ tools: { resident: ['a', 'b'] } })
    expect(service.isResidentTool('b')).toBe(true)
    expect(service.getConfig().tools?.resident).toEqual(['a', 'b'])
  })

  it('classifyAll reports every indexed capability and its class', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      stateFile: '',
      tools: { resident: ['mcp__gongfeng__*'], 'on-demand': ['mcp__*'], disabled: ['mcp__km__search'] },
    })

    registerTool(ctx, 'mcp__gongfeng__create_issue')
    registerTool(ctx, 'mcp__km__search')

    await ctx.capability.refresh()
    const classified = ctx.capabilityPolicy.classifyAll()
    const byId = new Map(classified.map(c => [c.id, c]))
    expect(byId.get('mcp__gongfeng__create_issue')?.class).toBe('resident')
    expect(byId.get('mcp__gongfeng__create_issue')?.classLabel).toBe('Resident · 常驻（直接调用）')
    expect(byId.get('mcp__km__search')?.class).toBe('disabled')
    expect(byId.get('mcp__km__search')?.classLabel).toBe('Disabled · 禁用')
    expect(byId.get('mcp__gongfeng__create_issue')?.mandatory).toBe(false)
  })

  it('classifyAll carries a skill\'s agent preset through to the management row', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    // The registry is stubbed: what is under test is the projection from the
    // catalog summary to a management row, and the preset id has to survive it
    // (the UI groups on it and withholds 纳入管理 because of it). Booting the
    // real preset layers would only re-test the registry.
    ctx.provide('capability', {
      search: () => [{
        id: 'preset-skill',
        kind: 'skill',
        name: 'preset-skill',
        summary: 'Ships inside an agent preset',
        source: 'custom',
        preset: 'cordis',
        tags: [],
        uses: 0,
      }],
      get: () => ({
        origin: { provider: 'filesystem', source: 'custom', preset: 'cordis', path: '/presets/cordis/skills/preset-skill' },
      }),
      // The policy awaits a cold-start rebuild before it can classify anything.
      refresh: async () => {},
    } as unknown as registry.CapabilityService)
    await ctx.plugin(policy, { stateFile: '' })

    const row = ctx.capabilityPolicy.classifyAll().find(c => c.id === 'preset-skill')
    expect(row?.preset).toBe('cordis')
    expect(row?.source).toBe('custom')
    // The adopt dialog names the directory it would link; that is the record's
    // own path, which only the detail lookup carries.
    expect(row?.path).toBe('/presets/cordis/skills/preset-skill')
  })

  it('classifyAll surfaces native tools under the built-in server and lets them cycle to On-demand', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, { stateFile: '' })

    registerTool(ctx, 'grep')
    registerTool(ctx, 'mcp__gongfeng__create_issue')
    await ctx.capability.refresh()

    const service = ctx.capabilityPolicy
    const row = service.classifyAll().find(c => c.id === 'grep')
    expect(row?.server).toBe('built-in')
    expect(row?.class).toBe('resident')
    expect(row?.classLabel).toContain('Resident')

    // The UI cycle writes an exact rule; the native reclassifies immediately.
    await service.updateConfig({ tools: { 'on-demand': ['grep'] } })
    expect(service.classifyCapability('grep')).toBe('on-demand')
    expect(service.classifyAll().find(c => c.id === 'grep')?.classLabel).toContain('On-demand')
  })

  it('rejects an update that would disable a meta tool and commits nothing', async () => {
    const ctx = await setup({ tools: { resident: ['bash'] } })
    registerTool(ctx, 'bash')
    const service = ctx.capabilityPolicy

    await expect(service.updateConfig({ tools: { disabled: ['meta_search'] } }))
      .rejects.toThrow(/cannot be disabled/)

    // Compilation happens before the commit, so the rejected config is not
    // observable anywhere: neither in getConfig nor in classification.
    expect(service.getConfig().tools?.disabled).toEqual([])
    expect(service.getConfig().tools?.resident).toEqual(['bash'])
    expect(service.isDisabledTool('meta_search')).toBe(false)
    expect(service.classifyTool('meta_search')).toBe('resident')
  })

  it('classifyAll is not truncated by the registry maxResults default', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, { stateFile: '' })

    // The registry search default is maxResults=20; classifyAll must enumerate
    // every indexed capability regardless (iWiki alone already exceeds it).
    for (let i = 0; i < 25; i += 1) registerTool(ctx, `mcp__gongfeng__tool_${i}`)
    await ctx.capability.refresh()

    const classified = ctx.capabilityPolicy.classifyAll()
    expect(classified.length).toBe(25)
    expect(new Set(classified.map(c => c.id)).size).toBe(25)
  })
})

/** UI tier moves persist outside the watched patch and survive plugin reloads. */
describe('capability-policy persistence (tier writes)', () => {
  it('does not persist a rejected move alongside a valid pending move', async () => {
    const fs = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const home = await fs.mkdtemp(join(tmpdir(), 'dsh-policy-rejected-'))
    const patchFile = join(home, 'cordis.patch.yml')
    const stateFile = join(home, 'capability-menu-policy.json')
    const patch = '- insert: []\n'
    await fs.writeFile(patchFile, patch, 'utf8')

    const clock = new ManualClock()
    const ctx = await setup({ patchFile, persistDebounceMs: 50, timer: clock })
    await ctx.capabilityPolicy.updateConfig({ skills: { 'on-demand': ['accepted-skill'] } })
    await expect(ctx.capabilityPolicy.updateConfig({ tools: { disabled: ['meta_search'] } }))
      .rejects.toThrow(/meta tool "meta_search" cannot be disabled/)

    // Only one debounce window is pending: the rejected move must never have
    // entered the journal, so the valid move is all that is scheduled.
    expect(clock.delays()).toEqual([50])

    // Drive the debounce instead of racing it, then wait for the write it
    // triggers to settle on disk.
    const flushed = ctx.capabilityPolicy.flushPersistence()
    clock.fire()
    await flushed

    const saved = await readTierState(stateFile)
    expect(saved.skill.get('accepted-skill')).toBe('on-demand')
    expect(saved.tool.has('meta_search')).toBe(false)
    expect(await fs.readFile(patchFile, 'utf8')).toBe(patch)
  })

  it('persists subsequent moves without touching the patch and restores them on remount', async () => {
    const fs = await import('node:fs/promises')
    const { join } = await import('node:path')
    const home = await fs.mkdtemp(join(tmpdir(), 'dsh-policy-persist-'))
    const patchFile = join(home, 'cordis.patch.yml')
    const stateFile = join(home, 'capability-menu-policy.json')
    const patch = '- insert: []\n'
    await fs.writeFile(patchFile, patch, 'utf8')

    const clock = new ManualClock()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      patchFile,
      persistDebounceMs: 50,
      timer: clock,
      tools: { resident: ['mcp__km__search'] },
    })

    registerTool(ctx, 'mcp__km__search', 'Search the knowledge base')
    await ctx.capability.refresh()

    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['mcp__km__search'] } })
    // Still pending: nothing reaches the state file until the debounce fires.
    expect(clock.delays()).toEqual([50])
    expect((await readTierState(stateFile)).tool.size).toBe(0)
    const firstFlush = ctx.capabilityPolicy.flushPersistence()
    clock.fire()
    await firstFlush
    expect((await readTierState(stateFile)).tool.get('mcp__km__search')).toBe('on-demand')

    // A second move coalesces into its own window and overwrites the first.
    await ctx.capabilityPolicy.updateConfig({ tools: { disabled: ['mcp__km__search'] } })
    expect(clock.delays()).toEqual([50])
    const secondFlush = ctx.capabilityPolicy.flushPersistence()
    clock.fire()
    await secondFlush
    expect((await readTierState(stateFile)).tool.get('mcp__km__search')).toBe('disabled')
    expect(await fs.readFile(patchFile, 'utf8')).toBe(patch)
    const restored = await setup({ patchFile, tools: { resident: ['mcp__km__search'] } })
    expect(restored.capabilityPolicy.classifyTool('mcp__km__search')).toBe('disabled')
  })

  it('merges its moves with other state-file edits instead of overwriting them', async () => {
    const fs = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const home = await fs.mkdtemp(join(tmpdir(), 'dsh-policy-replay-'))
    const patchFile = join(home, 'cordis.patch.yml')
    const stateFile = join(home, 'capability-menu-policy.json')
    const patch = '- insert: []\n'
    await fs.writeFile(patchFile, patch, 'utf8')

    const clock = new ManualClock()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    await ctx.plugin(policy, {
      patchFile,
      persistDebounceMs: 50,
      timer: clock,
      skills: { resident: ['stale'], 'on-demand': ['moved'] },
    })

    // The other writer's edit lands before the debounce fires, which is exactly
    // the interleaving the merge has to survive. Driving the clock makes that
    // order a fact instead of a race: the write cannot have happened yet.
    await fs.writeFile(stateFile, JSON.stringify({ version: 1, tools: {}, skills: { sneaky: 'on-demand' } }), 'utf8')
    await ctx.capabilityPolicy.updateConfig({ skills: { resident: ['stale', 'moved'] } })
    expect(clock.delays()).toEqual([50])

    const flushed = ctx.capabilityPolicy.flushPersistence()
    clock.fire()
    await flushed

    const saved = await readTierState(stateFile)
    expect(saved.skill.get('moved')).toBe('resident')
    expect(saved.skill.get('sneaky')).toBe('on-demand')
    expect(await fs.readFile(patchFile, 'utf8')).toBe(patch)
  })

  it('flushes a pending move on teardown without replacing another state-file edit', async () => {
    const fs = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const home = await fs.mkdtemp(join(tmpdir(), 'dsh-policy-flush-'))
    const patchFile = join(home, 'cordis.patch.yml')
    const stateFile = join(home, 'capability-menu-policy.json')
    const patch = '- insert: []\n'
    await fs.writeFile(patchFile, patch, 'utf8')

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    // Keep the write pending until teardown: the clock never fires, so only the
    // disposer can flush it.
    const clock = new ManualClock()
    const fiber = await ctx.plugin(policy, {
      patchFile,
      persistDebounceMs: 60_000,
      timer: clock,
      skills: { resident: ['stale'], 'on-demand': ['moved'] },
    })

    await ctx.capabilityPolicy.updateConfig({ skills: { resident: ['stale', 'moved'] } })
    await fs.writeFile(stateFile, JSON.stringify({ version: 1, tools: {}, skills: { sneaky: 'on-demand' } }), 'utf8')
    expect(clock.delays()).toEqual([60_000])

    await fiber.dispose()

    const saved = await readTierState(stateFile)
    expect(saved.skill.get('moved')).toBe('resident')
    expect(saved.skill.get('sneaky')).toBe('on-demand')
    expect(await fs.readFile(patchFile, 'utf8')).toBe(patch)
  })
})

describe('On-demand attribution predicate (isHiddenOnlyByPolicy)', () => {
  /**
   * The predicate the On-demand `meta_invoke` forward leans on. It must answer
   * `true` only when this policy's own `tools.restrict({ deny })` is the sole
   * reason a name is invisible; every other answer is a refusal to lift.
   */
  it('attributes a mask to this policy only when nobody else hides the name', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['mcp__km__search', 'mcp__km__shared'] } })
    registerTool(ctx, 'mcp__km__search')
    registerTool(ctx, 'mcp__km__shared')
    registerTool(ctx, 'mcp__km__resident')
    await ctx.capability.refresh()
    const agent = await announceAgent(ctx)
    const policyService = ctx.capabilityPolicy

    // Masked by this policy alone → attributable, so the forward may lift it.
    expect(agent.ctx.get('tools')?.get('mcp__km__search', agent as never)).toBeUndefined()
    expect(policyService.isHiddenOnlyByPolicy(agent, 'mcp__km__search')).toBe(true)

    // A Resident name is not hidden at all: there is nothing to attribute.
    expect(policyService.isHiddenOnlyByPolicy(agent, 'mcp__km__resident')).toBe(false)
    // A name this policy never denied, and an agent it never restricted.
    expect(policyService.isHiddenOnlyByPolicy(agent, 'mcp__km__absent')).toBe(false)
    expect(policyService.isHiddenOnlyByPolicy(undefined, 'mcp__km__search')).toBe(false)
    expect(policyService.isHiddenOnlyByPolicy({}, 'mcp__km__search')).toBe(false)

    // A third-party deny of a Resident name is not this policy's doing.
    await agent.ctx.plugin({
      name: 'third-party-deny-resident',
      inject: ['tools'],
      apply(restrictedCtx) { restrictedCtx.tools.restrict({ deny: ['mcp__km__resident'] }) },
    })
    expect(agent.ctx.get('tools')?.get('mcp__km__resident', agent as never)).toBeUndefined()
    expect(policyService.isHiddenOnlyByPolicy(agent, 'mcp__km__resident')).toBe(false)

    // Both masks on the same On-demand name: conservative, so not attributable.
    await agent.ctx.plugin({
      name: 'third-party-deny-shared',
      inject: ['tools'],
      apply(restrictedCtx) { restrictedCtx.tools.restrict({ deny: ['mcp__km__shared'] }) },
    })
    expect(agent.ctx.get('tools')?.get('mcp__km__shared', agent as never)).toBeUndefined()
    expect(policyService.isHiddenOnlyByPolicy(agent, 'mcp__km__shared')).toBe(false)

    // …and the unaffected On-demand name keeps its attribution, so the reapply
    // path rebuilt the set instead of dropping it.
    expect(policyService.isHiddenOnlyByPolicy(agent, 'mcp__km__search')).toBe(true)
  })

  it('drops the attribution when a tier move lifts the mask', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['mcp__km__search'] } })
    registerTool(ctx, 'mcp__km__search')
    await ctx.capability.refresh()
    const agent = await announceAgent(ctx)
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent, 'mcp__km__search')).toBe(true)

    // Resident again: the name is visible, so nothing may be forwarded on the
    // strength of a stale proof.
    await ctx.capabilityPolicy.updateConfig({ tools: { resident: ['mcp__km__search'] } })
    expect(agent.ctx.get('tools')?.get('mcp__km__search', agent as never)).toBeDefined()
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent, 'mcp__km__search')).toBe(false)
  })

  /**
   * The install window is not immune to a third party.
   *
   * `installOnDemandRestriction()` calls `restrict()`, which emits `tools/change`
   * synchronously. A third-party listener mounted after this policy runs inside
   * that same emit and can append its own `deny` while the attribution sample is
   * still held. Without a guard the sample keeps crediting that name to this
   * policy, `isHiddenOnlyByPolicy` returns true, and `meta_invoke` lifts a
   * restriction somebody else installed.
   *
   * The guard is the `tools/change` counter bracketing the window: our own
   * install contributes exactly one emit, so anything beyond that proves the
   * view moved under us and the attribution must be dropped.
   *
   * The trigger must be `agent/created` (or a forced reapply) — the window only
   * opens while the policy actually disposes and reinstalls its restriction.
   */
  it('refuses attribution when a third party installs a mask inside the install emit', async () => {
    const ctx = await setup({ tools: { 'on-demand': ['mcp__km__search'] } })
    registerTool(ctx, 'mcp__km__search')
    await ctx.capability.refresh()

    // Build the agent scope by hand so the third party can be mounted on it
    // BEFORE the policy's restriction is installed by `agent/created`.
    const agent = {
      id: 'in-emit-agent',
      options: {},
      session: { header: { cwd: process.cwd() } },
      ctx: new Context(),
      status: 'idle',
    } as unknown as { id: string; ctx: Context }
    agent.ctx = (await import('@deepseek-ai/dsh-scope')).createScope(ctx, agent as never).ctx

    let armed = false
    let installed = 0
    await agent.ctx.plugin({
      name: 'third-party-in-emit',
      inject: ['tools'],
      apply(scoped: {
        on: (n: string, h: () => void) => unknown
        tools: { restrict: (f: unknown) => () => void }
      }) {
        scoped.on('tools/change', () => {
          if (!armed || installed > 0) return
          installed += 1
          // Append our own restriction inside the policy's install emit.
          scoped.tools.restrict({ deny: ['mcp__km__search'] })
        })
      },
    } as never)

    armed = true
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' } as never)
    armed = false

    expect(installed).toBeGreaterThan(0)
    // Invisible, but NOT only because of this policy — the forward must not lift it.
    expect(agent.ctx.get('tools')?.get('mcp__km__search', agent as never)).toBeUndefined()
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent as never, 'mcp__km__search')).toBe(false)
  })
})

describe('capability-policy startup', () => {
  it('settles despite a pending initial registry refresh', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    mountTestExecutor(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(registry, { stateFile: '' })
    registerTool(ctx, 'mcp__km__search')
    await ctx.capability.refresh()
    const refresh = vi.spyOn(ctx.capability, 'refresh').mockImplementation(() => new Promise<void>(() => {}))

    vi.useFakeTimers()
    try {
      const mounted = ctx.plugin(policy, {
        patchFile: '',
        tools: { 'on-demand': ['mcp__km__search'] },
      })
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(5_000)
      await mounted
      await vi.advanceTimersByTimeAsync(1)
      expect(ctx.get('capabilityPolicy')).toBeDefined()
      expect(ctx.capabilityPolicy.classifyCapability('mcp__km__search', 'tool')).toBe('on-demand')
    } finally {
      vi.useRealTimers()
    }
  })
})
