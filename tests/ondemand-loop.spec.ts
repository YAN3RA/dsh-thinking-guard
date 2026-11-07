import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import * as toolMetaSearch from '../src/search.ts'
import { createScope } from '@deepseek-ai/dsh-scope'
import { mountTestExecutor, runOneToolCall } from './stubs/test-executor.ts'

const testSignal = new AbortController().signal

async function setupMapped(home: string, policyConfig: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: `${home}/.dsh`,
    agentsHome: `${home}/.agents`,
    watch: false,
  })
  await ctx.plugin(registry, { stateFile: '' })
  await ctx.plugin(policy, { stateFile: '', ...policyConfig })
  await ctx.plugin(toolMetaSearch, {})
  return ctx
}

async function announceAgent(ctx: Context, id: string): Promise<unknown> {
  const agent = {
    id,
    options: {},
    session: { header: { cwd: process.cwd() } },
    ctx: new Context(),
    status: 'idle',
  } as unknown as { ctx: Context }
  agent.ctx = createScope(ctx, agent as never).ctx
  await ctx.emit('agent/created', { agent })
  return agent
}

async function setup(home: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: `${home}/.dsh`,
    agentsHome: `${home}/.agents`,
    watch: false,
  })
  await ctx.plugin(registry, { stateFile: '' })
  await ctx.plugin(policy, {
    stateFile: '',
    tools: { 'on-demand': ['hidden_tool'], disabled: ['disabled_tool'] },
  })
  await ctx.plugin(toolMetaSearch, {})
  return ctx
}

function register(ctx: Context, name: string, description: string): void {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters: { title: { type: 'string', required: true, description: 'Title' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() {
      return { ok: true }
    },
  }))
}

describe('On-demand loop: search, detail and invoke stay reachable', () => {
  it('keeps an On-demand tool searchable while the model cannot see it', async () => {
    const fs = await import('node:fs/promises')
    const home = await fs.mkdtemp(join(tmpdir(), 'dsh-probe-'))
    const ctx = await setup(home)

    register(ctx, 'visible_tool', 'A tool the model can see directly')
    register(ctx, 'hidden_tool', 'An On-demand tool hidden behind meta_search')
    register(ctx, 'disabled_tool', 'A tool nobody may call')
    await ctx.capability.refresh()

    // A real agent identity: policy keys restrictions on the agent object.
    const agent = {
      id: 'probe-agent',
      options: {},
      session: { header: { cwd: process.cwd() } },
      ctx: new Context(),
      status: 'idle',
    } as never
    // The policy applies its deny through `agent.ctx.get('tools')`, so the
    // agent needs a real child scope, not a detached Context.
    ;(agent as { ctx: Context }).ctx = createScope(ctx, agent).ctx

    // Fire agent/created so the policy applies its tools.restrict({ deny }).
    // The listener destructures `{ agent }`, so the payload must be an object.
    await ctx.emit('agent/created', { agent })
    const scoped = ctx.tools.schemas(agent as never).map(s => s.name)

    const list = await runOneToolCall(ctx, {
      callId: 'probe-1',
      name: 'meta_search',
      arguments: { query: 'hidden', kind: 'tool' },
      agent,
      signal: testSignal,
    })

    // The regression this probe guards: an On-demand tool must stay reachable
    // through meta_search, while remaining absent from the model's own view.
    expect(scoped).not.toContain('hidden_tool')
    expect(list.isError).toBe(false)
    const listed = list.value as { results: Array<{ id: string }> }
    expect(listed.results.map(row => row.id)).toContain('hidden_tool')

    // Detail mode must expose the full schema.
    const detail = await runOneToolCall(ctx, {
      callId: 'probe-2',
      name: 'meta_search',
      arguments: { id: 'hidden_tool', kind: 'tool' },
      agent,
      signal: testSignal,
    })
    expect(detail.isError).toBe(false)

    // Disabled must never be searchable, even though it is registered.
    const disabledList = await runOneToolCall(ctx, {
      callId: 'probe-3',
      name: 'meta_search',
      arguments: { query: 'disabled', kind: 'tool' },
      agent,
      signal: testSignal,
    })
    const disabledIds = (disabledList.value as { results: Array<{ id: string }> }).results.map(r => r.id)
    expect(disabledIds).not.toContain('disabled_tool')
  })

  it('covers an MCP tool registered by another server, not just a native one', async () => {
    const fs = await import('node:fs/promises')
    const home = await fs.mkdtemp(join(tmpdir(), 'dsh-ondemand-mcp-'))
    const ctx = await setupMapped(home, { tools: { 'on-demand': ['mcp__km__*'] } })
    register(ctx, 'mcp__km__search', 'Search the knowledge base')
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'mcp-agent')
    const scoped = ctx.tools.schemas(agent as never).map(s => s.name)
    expect(scoped).not.toContain('mcp__km__search')

    const list = await runOneToolCall(ctx, {
      callId: 'mcp-1',
      name: 'meta_search',
      arguments: { query: 'knowledge base', kind: 'tool' },
      agent,
      signal: testSignal,
    })
    expect(list.isError).toBe(false)
    expect((list.value as { results: Array<{ id: string }> }).results.map(r => r.id))
      .toContain('mcp__km__search')
  })

  it('filters On-demand skills out of the catalog message but keeps them readable', async () => {
    const fs = await import('node:fs/promises')
    const { join: joinPath } = await import('node:path')
    const home = await fs.mkdtemp(join(tmpdir(), 'dsh-ondemand-skill-'))
    const project = joinPath(home, 'project')
    await fs.mkdir(joinPath(project, '.git'), { recursive: true })
    const dir = joinPath(project, '.agents/skills/hidden-skill')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(joinPath(dir, 'SKILL.md'),
      '---\nname: hidden-skill\ndescription: A hidden skill\n---\n\nBody.\n')

    const ctx = await setupMapped(home, { skills: { 'on-demand': ['*'] } })
    const agent = await announceAgent(ctx, 'skill-agent')
    ;(agent as { session: { header: { cwd: string } } }).session.header.cwd = project
    ctx.provide('agents', { list: () => [agent] })
    await ctx.capability.refresh()

    const list = await runOneToolCall(ctx, {
      callId: 'skill-1',
      name: 'meta_search',
      arguments: { query: 'hidden skill', kind: 'skill' },
      agent,
      signal: testSignal,
    })
    expect(list.isError).toBe(false)
    // A skill hidden by this policy stays readable through meta_search; the
    // catalog message filters it separately in policy.ts.
    expect((list.value as { results: Array<{ id: string }> }).results.map(r => r.id))
      .toContain('hidden-skill')
  })
})
