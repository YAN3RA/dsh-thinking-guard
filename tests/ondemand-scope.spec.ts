/**
 * On-demand Agent scope isolation, dynamic registration and tier switching.
 *
 * `tests/ondemand-loop.spec.ts` proves the loop itself (hidden → searchable →
 * invocable) for one agent. This file covers the three acceptance items the
 * design (§2.4) adds on top of it:
 *
 * 1. two live agents never share a restriction — a deny installed for one
 *    agent's scope does not leak into another agent's view, and a scope-local
 *    registration stays inside the agent that made it;
 * 2. a tool registered AFTER `agent/created` is still hidden, because the
 *    policy re-derives its deny list on `tools/change`
 *    (`src/policy.ts` `reapplyOnDemandRestrictions`);
 * 3. a tier move through `capabilityPolicy.updateConfig` is applied and, when
 *    moved back, fully lifted (no stale intersecting restriction survives).
 *
 * Plus the two disambiguation rules the model surface depends on: `kind`
 * separates a tool from a skill that share a bare name, and a Disabled
 * capability is neither listed nor invocable.
 *
 * Every assertion below records the OBSERVED value; where the current design
 * cannot express the expectation (per-agent tier classification is process
 * global — `classifyTool(name)` takes no scope), the test asserts the actual
 * behaviour and the comment says why, instead of asserting a fiction.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import * as toolMetaSearch from '../src/search.ts'
import * as toolMetaInvoke from '../src/invoke.ts'
import { mountTestExecutor, runOneToolCall } from './stubs/test-executor.ts'

const testSignal = new AbortController().signal

/** A live agent identity with a real child scope, as `createScope` builds it. */
interface TestAgent {
  id: string
  options: Record<string, unknown>
  session: { header: { cwd: string } }
  ctx: Context
  status: string
}

/**
 * Mount the same composition the loop spec uses, plus `meta_invoke` so the
 * Disabled hard-deny can be asserted at the execution surface.
 */
async function setup(home: string, policyConfig: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    watch: false,
  })
  await ctx.plugin(registry, { stateFile: '' })
  await ctx.plugin(policy, { stateFile: '', ...policyConfig })
  await ctx.plugin(toolMetaSearch, {})
  await ctx.plugin(toolMetaInvoke, {})
  return ctx
}

/**
 * Announce one agent exactly the way the host does: a scoped context plus an
 * awaited `agent/created`, which is where the policy installs its restriction.
 */
async function announceAgent(ctx: Context, id: string): Promise<TestAgent> {
  const agent = {
    id,
    options: {},
    session: { header: { cwd: process.cwd() } },
    ctx: new Context(),
    status: 'idle',
  } as unknown as TestAgent
  // `tools.restrict()` reads `scopeOf(this.ctx)`, so the agent needs a real
  // child scope rather than a detached Context.
  agent.ctx = createScope(ctx, agent as never).ctx
  // The host hands the policy a real `Agent`; this stub carries only the two
  // fields the policy reads (`ctx` for the scope, `id` for logging), so the
  // payload is cast the same way `tests/ondemand-loop.spec.ts` does.
  await ctx.emit('agent/created', { agent } as never)
  return agent
}

/** A tool whose only behaviour is returning `{ ok: true }`. */
function defineProbeTool(name: string, description: string) {
  return defineTool({
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
  })
}

function register(ctx: Context, name: string, description: string): void {
  ctx.tools.register(defineProbeTool(name, description))
}

/** Tool names an agent's own schema projection declares. */
function schemaNames(ctx: Context, agent: TestAgent): string[] {
  return ctx.tools.schemas(agent as never).map(schema => schema.name)
}

/** Run one model-facing tool call as `agent`. */
async function runTool(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
  agent: TestAgent,
): Promise<{ value: unknown; isError: boolean; text: string }> {
  const result = await runOneToolCall(ctx, {
    callId: `call-${name}-${String(args['id'] ?? args['query'] ?? '')}`,
    name,
    arguments: args,
    agent,
    signal: testSignal,
  })
  return {
    value: result.isError ? undefined : result.value,
    isError: result.isError,
    text: result.content.map(block => block.type === 'text' ? block.text : '').join('\n'),
  }
}

/** Ids a `meta_search` list call returned. */
async function searchIds(
  ctx: Context,
  args: Record<string, unknown>,
  agent: TestAgent,
): Promise<string[]> {
  const result = await runTool(ctx, 'meta_search', args, agent)
  expect(result.isError).toBe(false)
  const value = result.value as { results: Array<{ id: string }> }
  return value.results.map(row => row.id)
}

/** Write one skill directory under the isolated agents home. */
async function writeSkill(home: string, name: string, description: string): Promise<void> {
  const dir = join(home, '.agents', 'skills', name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`,
  )
}

describe('On-demand Agent scope isolation', () => {
  it('keeps one agent restriction and scope-local registrations inside their own agent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-ondemand-scope-'))
    const ctx = await setup(home, { tools: { 'on-demand': ['tool_a'] } })

    register(ctx, 'tool_a', 'An On-demand tool hidden from the model surface')
    register(ctx, 'tool_b', 'A Resident tool every agent sees')
    await ctx.capability.refresh()

    const agentX = await announceAgent(ctx, 'agent-x')
    const agentY = await announceAgent(ctx, 'agent-y')

    // Agent Y keeps `tool_a` available the only way a live composition can
    // express a per-agent difference: a registration in Y's OWN scope, which
    // `view()` exempts from inherited restrictions. The policy's tier table is
    // process-global (`classifyTool(name)` has no scope argument), so "Resident
    // for Y only" is not expressible through config — this is that difference.
    // `ctx.tools` needs an injection declaration; `get` is how the policy
    // reaches the same scoped service, and Cordis rebinds the call site to Y.
    const yTools = agentY.ctx.get('tools') as Context['tools']
    yTools.register(defineProbeTool('tool_a', 'Agent Y scope-local tool_a'))
    yTools.register(defineProbeTool('y_only', 'Registered only in agent Y scope'))

    // Declarations: X is restricted, Y sees its own registrations, and Y's
    // scope-local names never appear in X's projection.
    const xSchemas = schemaNames(ctx, agentX)
    const ySchemas = schemaNames(ctx, agentY)
    expect(xSchemas).not.toContain('tool_a')
    expect(xSchemas).toContain('tool_b')
    expect(xSchemas).not.toContain('y_only')
    expect(ySchemas).toContain('tool_a')
    expect(ySchemas).toContain('y_only')

    // Admission follows the same per-agent view: X cannot call what the policy
    // hid, Y can call its own registration.
    const xCall = await runTool(ctx, 'tool_a', { title: 'x' }, agentX)
    expect(xCall.isError).toBe(true)
    const yCall = await runTool(ctx, 'tool_a', { title: 'y' }, agentY)
    expect(yCall.isError).toBe(false)

    // Search: X finds the capability the policy hid from it, and neither agent
    // is handed the Resident tool as an On-demand hit.
    expect(await searchIds(ctx, { query: 'tool_a', kind: 'tool' }, agentX)).toContain('tool_a')
    // OBSERVED, and a design limit rather than an oversight: the tier table is
    // process-global (`classifyTool(name)` takes no scope, `policy.Config` has
    // no per-agent section), so Y's *visible* tool_a is still reported as
    // On-demand — `isSearchable` step 1 admits it because Y can see it. A
    // per-agent Resident/On-demand split is not expressible today; what IS
    // guaranteed is that the deny list itself never crosses scopes, asserted
    // through the declarations and admission checks above/below.
    expect(await searchIds(ctx, { query: 'tool_a', kind: 'tool' }, agentY)).toContain('tool_a')
    expect(await searchIds(ctx, { query: 'tool_b', kind: 'tool' }, agentX)).not.toContain('tool_b')
    expect(await searchIds(ctx, { query: 'tool_b', kind: 'tool' }, agentY)).not.toContain('tool_b')

    // Y's scope-local names are not searchable by X either — the catalog is
    // global, but the two-step scope rule keeps Y's registration out of X's
    // results because X can neither see it nor have it hidden by this policy.
    expect(await searchIds(ctx, { query: 'y_only', kind: 'tool' }, agentX)).not.toContain('y_only')

    // A tier move re-applies the deny list to EVERY live agent, so it must not
    // be mistaken for a per-agent lift: both agents lose `tool_b`, while Y's
    // scope-local registrations (which no restriction can mask) survive.
    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['tool_a', 'tool_b'] } })
    expect(schemaNames(ctx, agentX)).not.toContain('tool_b')
    expect(schemaNames(ctx, agentY)).not.toContain('tool_b')
    expect(schemaNames(ctx, agentY)).toContain('tool_a')
    expect(schemaNames(ctx, agentY)).toContain('y_only')
  })

  it('re-applies the restriction to a tool registered after the agent was created', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-ondemand-late-'))
    // A glob rule classifies the late tool without any config write, so the
    // only path that can hide it is the `tools/change` re-apply.
    const ctx = await setup(home, { tools: { 'on-demand': ['dyn_*'] } })

    register(ctx, 'dyn_early', 'Registered before the agent existed')
    await ctx.capability.refresh()
    const agent = await announceAgent(ctx, 'late-agent')
    expect(schemaNames(ctx, agent)).not.toContain('dyn_early')

    // Register AFTER `agent/created`: the restriction installed at creation
    // time cannot know this name, so only `tools/change` can cover it.
    register(ctx, 'dyn_late', 'Registered after the agent existed')
    // Pin the mechanism: the tool IS globally registered (so its absence from
    // the agent's schemas can only come from the re-applied deny list, not
    // from a missing registration).
    expect(ctx.tools.definitions().map(definition => definition.name)).toContain('dyn_late')
    expect(schemaNames(ctx, agent)).not.toContain('dyn_late')

    await ctx.capability.refresh()
    expect(await searchIds(ctx, { query: 'dyn_late', kind: 'tool' }, agent)).toContain('dyn_late')
    expect(await searchIds(ctx, { query: 'dyn_early', kind: 'tool' }, agent)).toContain('dyn_early')

    // The late tool is hidden from declarations yet still executable through
    // the On-demand path, exactly like one that existed at creation time.
    const direct = await runTool(ctx, 'dyn_late', { title: 'x' }, agent)
    expect(direct.isError).toBe(true)
    const forwarded = await runTool(
      ctx,
      'meta_invoke',
      { id: 'dyn_late', kind: 'tool', args: { title: 'x' } },
      agent,
    )
    expect(forwarded.isError).toBe(false)
  })

  it('applies and fully lifts a tier move made through updateConfig', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-ondemand-tier-'))
    const ctx = await setup(home)

    register(ctx, 'tier_tool', 'A tool whose tier is moved at runtime')
    register(ctx, 'tier_other', 'An unrelated Resident tool')
    await ctx.capability.refresh()
    const agent = await announceAgent(ctx, 'tier-agent')

    // Baseline: unlisted means Resident, so the model sees it and cannot
    // discover it through the catalog.
    expect(schemaNames(ctx, agent)).toContain('tier_tool')
    expect(await searchIds(ctx, { query: 'tier_tool', kind: 'tool' }, agent)).not.toContain('tier_tool')

    // Resident -> On-demand.
    await ctx.capabilityPolicy.updateConfig({ tools: { 'on-demand': ['tier_tool'] } })
    expect(ctx.capabilityPolicy.classifyTool('tier_tool')).toBe('on-demand')
    expect(schemaNames(ctx, agent)).not.toContain('tier_tool')
    expect(await searchIds(ctx, { query: 'tier_tool', kind: 'tool' }, agent)).toContain('tier_tool')

    // On-demand -> Resident: the previous restriction must be disposed, not
    // left intersecting with the new (empty) one.
    await ctx.capabilityPolicy.updateConfig({ tools: { resident: ['tier_tool'] } })
    expect(ctx.capabilityPolicy.classifyTool('tier_tool')).toBe('resident')
    expect(schemaNames(ctx, agent)).toContain('tier_tool')
    expect(schemaNames(ctx, agent)).toContain('tier_other')
    expect(await searchIds(ctx, { query: 'tier_tool', kind: 'tool' }, agent)).not.toContain('tier_tool')
    // Exact-id inspection of a Resident capability is refused, not silently served.
    const detail = await runTool(ctx, 'meta_search', { id: 'tier_tool', kind: 'tool' }, agent)
    expect(detail.isError).toBe(true)

    // And the tool is directly callable again.
    const direct = await runTool(ctx, 'tier_tool', { title: 'x' }, agent)
    expect(direct.isError).toBe(false)
  })
})

describe('On-demand disambiguation and Disabled enforcement', () => {
  it('disambiguates one bare name shared by a tool and a skill through kind', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-ondemand-shared-'))
    await writeSkill(home, 'shared-probe', 'A skill sharing a bare name with a tool')
    const ctx = await setup(home, {
      tools: { 'on-demand': ['shared-probe'] },
      skills: { 'on-demand': ['shared-probe'] },
    })

    register(ctx, 'shared-probe', 'A tool sharing a bare name with a skill')
    await ctx.capability.refresh()
    const agent = await announceAgent(ctx, 'shared-agent')

    // Without `kind` the id is ambiguous and must fail loudly rather than
    // silently picking one kind.
    const ambiguous = await runTool(ctx, 'meta_search', { id: 'shared-probe' }, agent)
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.text).toContain('ambiguous')

    const asTool = await runTool(ctx, 'meta_search', { id: 'shared-probe', kind: 'tool' }, agent)
    expect(asTool.isError).toBe(false)
    expect((asTool.value as { result: { kind: string; name: string } }).result)
      .toMatchObject({ kind: 'tool', name: 'shared-probe' })

    const asSkill = await runTool(ctx, 'meta_search', { id: 'shared-probe', kind: 'skill' }, agent)
    expect(asSkill.isError).toBe(false)
    expect((asSkill.value as { result: { kind: string; name: string } }).result)
      .toMatchObject({ kind: 'skill', name: 'shared-probe' })

    // The kind also routes execution: the tool forward reaches the tool.
    const invoked = await runTool(
      ctx,
      'meta_invoke',
      { id: 'shared-probe', kind: 'tool', args: { title: 'x' } },
      agent,
    )
    expect(invoked.isError).toBe(false)
    expect((invoked.value as { kind: string }).kind).toBe('mcp')
  })

  it('never lists a Disabled tool and refuses both search detail and invocation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-ondemand-disabled-'))
    const ctx = await setup(home, { tools: { disabled: ['off_probe'] } })

    register(ctx, 'off_probe', 'A tool nobody may reach')
    register(ctx, 'on_probe', 'An On-demand tool for contrast')
    await ctx.capabilityPolicy.updateConfig({
      tools: { disabled: ['off_probe'], 'on-demand': ['on_probe'] },
    })
    await ctx.capability.refresh()
    const agent = await announceAgent(ctx, 'disabled-agent')

    expect(await searchIds(ctx, { query: 'off_probe', kind: 'tool' }, agent)).not.toContain('off_probe')
    // A sibling On-demand tool proves the list itself is not empty.
    expect(await searchIds(ctx, { query: 'on_probe', kind: 'tool' }, agent)).toContain('on_probe')

    const detail = await runTool(ctx, 'meta_search', { id: 'off_probe', kind: 'tool' }, agent)
    expect(detail.isError).toBe(true)

    const invoked = await runTool(
      ctx,
      'meta_invoke',
      { id: 'off_probe', kind: 'tool', args: { title: 'x' } },
      agent,
    )
    expect(invoked.isError).toBe(true)
    expect(invoked.text).toContain('disabled')

    // The hard deny sits at the execution surface too, so a hallucinated direct
    // call never reaches the underlying tool.
    const direct = await runTool(ctx, 'off_probe', { title: 'x' }, agent)
    expect(direct.isError).toBe(true)
    expect(direct.text).toContain('disabled')
  })
})
