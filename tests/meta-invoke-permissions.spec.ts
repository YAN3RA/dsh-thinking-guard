/**
 * `meta_invoke` permission boundary matrix (plan §3.2).
 *
 * Every case runs a real agent scope against the official
 * `ToolExecutionPipeline` (via `tests/stubs/test-executor.ts`), never an
 * isolated `resolveForwardDefinition` return value: the question is whether a
 * restriction placed by a *third party* (another plugin's `tools.restrict`,
 * `tools.guard`, or a host `tools/pre-execute` listener) can be bypassed by the
 * On-demand global fallback in `src/invoke.ts`.
 *
 * The seven rows, in order:
 *  1. Resident + no other restriction            → executes
 *  2. On-demand + no other restriction           → meta_invoke executes
 *  3. On-demand + third-party `tools.restrict`   → denied
 *  4. On-demand + third-party `tools.guard`      → denied
 *  5. On-demand + host `tools/pre-execute` deny  → denied
 *  6. Disabled + no other restriction            → denied
 *  7. Disabled + third-party restriction         → denied
 *
 * Row 3 also proves attribution: the same tool, in an otherwise identical
 * composition without the third-party restriction, must succeed — otherwise
 * the denial could be this plugin's own On-demand masking rather than the
 * third party's decision.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as registry from '../src/registry.ts'
import * as policy from '../src/policy.ts'
import * as toolMetaInvoke from '../src/invoke.ts'
import { mountTestExecutor, runOneToolCall } from './stubs/test-executor.ts'

const testSignal = new AbortController().signal

/** The smallest object the pipeline accepts as a caller Agent. */
function agentStub(name: string) {
  return {
    id: name,
    options: {},
    session: { header: { cwd: process.cwd() } },
    ctx: new Context(),
    status: 'idle',
  } as never
}

/** Give the agent its own Cordis scope, exactly like the harness does. */
function scopedAgent(ctx: Context, name: string): { id: string; ctx: Context } {
  const agent = agentStub(name) as unknown as { id: string; ctx: Context }
  agent.ctx = createScope(ctx, agent as never).ctx
  return agent
}

/** Mount the composition every case needs, executor included. */
async function mountCore(ctx: Context, home: string): Promise<void> {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  mountTestExecutor(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: `${home}/.dsh`,
    agentsHome: `${home}/.agents`,
    watch: false,
  })
}

interface Composition {
  readonly ctx: Context
  readonly home: string
}

/**
 * A composition whose policy classifies exactly one tool as `on-demand` (or
 * `disabled`) and everything else as Resident, with `meta_invoke` mounted.
 */
async function setup(
  prefix: string,
  policyConfig: policy.Config,
  invokeConfig: toolMetaInvoke.Config = {},
): Promise<Composition> {
  const home = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), prefix)))
  const ctx = new Context()
  await mountCore(ctx, home)
  await ctx.plugin(registry, { stateFile: '' })
  await ctx.plugin(policy, { stateFile: '', ...policyConfig })
  await ctx.plugin(toolMetaInvoke, invokeConfig)
  return { ctx, home }
}

interface TargetOptions {
  /** Invoked with the raw args and the execution context the pipeline built. */
  readonly onExecute?: (args: unknown, exec: { agent?: unknown; signal?: AbortSignal; parent?: unknown }) => void
}

/**
 * Register the tool under test as a global tool (the shape of an MCP server
 * tool). It records the execution context it received so rows that must prove
 * context preservation can assert on it.
 */
function registerTargetTool(ctx: Context, name: string, options: TargetOptions = {}): string {
  ctx.tools.register(defineTool({
    name,
    description: 'Permission-matrix target tool',
    parameters: { title: { type: 'string', required: true, description: 'Title' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, received: { type: 'json' } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      options.onExecute?.(args, exec as never)
      return { ok: true, received: args as never }
    },
  }))
  return name
}

/** Run one raw model call through `ctx.tools.execute` (the real pipeline). */
async function runTool(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
  agent: unknown,
): Promise<{ value: unknown; isError: boolean; text: string }> {
  const result = await runOneToolCall(ctx, {
    callId: `call-${name}`,
    name,
    arguments: args,
    agent,
    signal: testSignal,
  })
  const text = result.content
    .map(block => (block.type === 'text' ? block.text : `[${block.type} content]`))
    .join('\n')
  return { value: result.isError ? undefined : result.value, isError: result.isError, text }
}

/** `meta_invoke` forwarding to `target` with one argument object. */
function invoke(ctx: Context, target: string, agent: unknown, args: Record<string, unknown> = { title: 'x' }) {
  return runTool(ctx, 'meta_invoke', { id: target, kind: 'tool', args }, agent)
}

/**
 * Run `meta_invoke` with a real step admission set, the way an agent step does.
 * `runOneToolCall` omits `toolSet`, so a bypass reproduced only through it could
 * be dismissed as an artifact of the missing admission set; this closes that.
 */
async function invokeWithToolSet(
  ctx: Context,
  target: string,
  agent: { id: string; ctx: Context },
): Promise<{ isError: boolean; text: string }> {
  const toolSet = await ctx.tools.resolve({
    agent: agent as never,
    modelSelection: { provider: 'matrix', model: 'matrix' } as never,
    signal: testSignal,
  })
  try {
    const callId = 'call-meta_invoke-with-set'
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: callId as never, name: 'meta_invoke', arguments: JSON.stringify({ id: target, kind: 'tool', args: { title: 'x' } }) }],
      signal: testSignal,
      agent: agent as never,
      toolSet,
    })
    const settled = batch.results.find(entry => entry.callId === callId)
    if (settled === undefined) throw new Error('no result settled for meta_invoke')
    const text = settled.result.content
      .map(block => (block.type === 'text' ? block.text : `[${block.type} content]`))
      .join('\n')
    return { isError: settled.result.isError, text }
  } finally {
    toolSet.dispose()
  }
}

/**
 * Build the row-3 composition: one On-demand tool plus a third-party
 * `tools.restrict({ deny })` for it, registered in the caller's scope *after*
 * this plugin's own On-demand restriction is already in place.
 */
async function restrictedOnDemandComposition(prefix: string) {
  const { ctx } = await setup(prefix, { tools: { 'on-demand': ['mcp__matrix__ondemand'] } })
  const executed: string[] = []
  const target = registerTargetTool(ctx, 'mcp__matrix__ondemand', {
    onExecute: () => { executed.push('ondemand') },
  })
  await ctx.capability.refresh()
  const agent = scopedAgent(ctx, `${prefix}agent`)
  await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })
  await agent.ctx.plugin({
    name: 'third-party-deny',
    inject: ['tools'],
    apply(restrictedCtx) {
      restrictedCtx.tools.restrict({ deny: [target] })
    },
  })
  return { ctx, agent, target, executed }
}

describe('meta_invoke permission matrix', () => {
  it('row 1: a Resident tool with no other restriction executes', async () => {
    const { ctx } = await setup('dsh-perm-row1-', {})
    let calls = 0
    const target = registerTargetTool(ctx, 'mcp__matrix__resident', {
      onExecute: () => { calls++ },
    })
    await ctx.capability.refresh()

    expect(ctx.capabilityPolicy.classifyTool(target)).toBe('resident')
    const agent = scopedAgent(ctx, 'row1-agent')
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })

    // Resident means declared to the model as well…
    expect(agent.ctx.get('tools')?.get(target, agent as never)).toBeDefined()
    // …and directly executable, with no restriction applied by anyone.
    const direct = await runTool(ctx, target, { title: 'resident' }, agent)
    expect(direct.isError, direct.text).toBe(false)
    expect(calls).toBe(1)

    // The same tool also stays reachable through meta_invoke.
    const forwarded = await invoke(ctx, target, agent)
    expect(forwarded.isError, forwarded.text).toBe(false)
    expect(calls).toBe(2)
  })

  it('row 2: On-demand with no other restriction executes via meta_invoke and keeps the caller context', async () => {
    const { ctx } = await setup('dsh-perm-row2-', { tools: { 'on-demand': ['mcp__matrix__ondemand'] } })
    let seenAgent: unknown
    let seenSignal: unknown
    let seenParent: unknown
    const target = registerTargetTool(ctx, 'mcp__matrix__ondemand', {
      onExecute: (_args, exec) => {
        seenAgent = exec.agent
        seenSignal = exec.signal
        seenParent = exec.parent
      },
    })
    await ctx.capability.refresh()

    const agent = scopedAgent(ctx, 'row2-agent')
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })

    // The policy masks the name out of the caller's own view…
    expect(ctx.capabilityPolicy.classifyTool(target)).toBe('on-demand')
    expect(agent.ctx.get('tools')?.get(target, agent as never)).toBeUndefined()

    const result = await invoke(ctx, target, agent, { title: 'on-demand' })
    expect(result.isError, result.text).toBe(false)
    expect(result.value).toMatchObject({ ok: true, kind: 'mcp', detail: { forwarded: true, target } })
    // …but the forward must not drop or replace the caller's execution context:
    // the target sees the very same Agent object the batch was dispatched with,
    // a live caller-derived signal, and the enclosing transport parent token.
    expect(seenAgent).toBe(agent)
    expect(seenSignal).toBeDefined()
    expect((seenSignal as AbortSignal).aborted).toBe(false)
    expect(seenParent).toBeDefined()
  })

  it('row 3: On-demand plus a third-party tools.restrict({deny}) — the restriction is real, and it is enforced on both the direct call and the On-demand forward', async () => {
    // Attribution control: the identical composition WITHOUT the third-party
    // restriction must succeed, otherwise a denial could not be attributed to
    // the third party at all.
    const control = await setup('dsh-perm-row3-control-', { tools: { 'on-demand': ['mcp__matrix__ondemand'] } })
    let controlCalls = 0
    const controlTarget = registerTargetTool(control.ctx, 'mcp__matrix__ondemand', {
      onExecute: () => { controlCalls++ },
    })
    await control.ctx.capability.refresh()
    const controlAgent = scopedAgent(control.ctx, 'row3-control')
    await control.ctx.emit('agent/created', { agent: controlAgent as never, source: 'startup' as const })
    const allowed = await invoke(control.ctx, controlTarget, controlAgent)
    expect(allowed.isError, allowed.text).toBe(false)
    expect(controlCalls).toBe(1)

    const { ctx, agent, target, executed } = await restrictedOnDemandComposition('dsh-perm-row3-')

    // The third-party denial really is in force for the caller: the name is gone
    // from the caller's own view, and a direct call is refused.
    expect(agent.ctx.get('tools')?.get(target, agent as never)).toBeUndefined()
    const direct = await runTool(ctx, target, { title: 'direct' }, agent)
    expect(direct.isError, direct.text).toBe(true)
    expect(executed).toEqual([])

    // Isolation: a *Resident* tool denied by the same third party is refused
    // through meta_invoke too, so `resolveForwardDefinition` does honour a
    // third-party deny in general — only the On-demand fallback lifts it.
    let residentCalls = 0
    const resident = registerTargetTool(ctx, 'mcp__matrix__resident_guarded', {
      onExecute: () => { residentCalls++ },
    })
    await ctx.capability.refresh()
    await agent.ctx.plugin({
      name: 'third-party-deny-resident',
      inject: ['tools'],
      apply(restrictedCtx) {
        restrictedCtx.tools.restrict({ deny: [resident] })
      },
    })
    const residentForward = await invoke(ctx, resident, agent)
    expect(residentForward.isError, residentForward.text).toBe(true)
    expect(residentCalls).toBe(0)
  })

  /**
   * Former defect (plan §3.2 row 3), kept as the regression guard.
   *
   * `resolveForwardDefinition` used to fall back to `ctx.tools.get(name)` — the
   * *global* view — whenever `tools.executable(name, scope, toolSet)` returned
   * nothing and the name was classified On-demand. That fallback could not tell
   * this plugin's own On-demand mask from a restriction installed by a third
   * party, so a third-party `tools.restrict({ deny })` of an On-demand name was
   * lifted for `meta_invoke` while still applying to a direct call.
   *
   * The fallback now requires `capabilityPolicy.isHiddenOnlyByPolicy(agent,
   * name)`, which can PROVE the invisibility is this policy's own. This test
   * went green when that landed; it stays here so the bypass cannot come back.
   */
  it('row 3 defect: a third-party tools.restrict({deny}) must deny an On-demand forward', async () => {
    const { ctx, agent, target, executed } = await restrictedOnDemandComposition('dsh-perm-row3-defect-')

    // The denial is in force for a direct call…
    const direct = await runTool(ctx, target, { title: 'direct' }, agent)
    expect(direct.isError, direct.text).toBe(true)
    expect(executed).toEqual([])

    // …so it must deny the forward as well.
    const forwarded = await invoke(ctx, target, agent)
    expect(forwarded.isError, forwarded.text).toBe(true)
    expect(executed).toEqual([])

    // Same requirement through a real step admission set, so the result is not
    // an artifact of `runOneToolCall` omitting `toolSet`.
    const withToolSet = await invokeWithToolSet(ctx, target, agent)
    expect(withToolSet.isError, withToolSet.text).toBe(true)
    expect(executed).toEqual([])
  })

  it('row 4: On-demand plus a third-party tools.guard() denial is denied', async () => {
    const { ctx } = await setup('dsh-perm-row4-', { tools: { 'on-demand': ['mcp__matrix__ondemand'] } })
    let calls = 0
    const target = registerTargetTool(ctx, 'mcp__matrix__ondemand', {
      onExecute: () => { calls++ },
    })
    await ctx.capability.refresh()
    const agent = scopedAgent(ctx, 'row4-agent')
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })
    const scopedTools = agent.ctx.get('tools')
    expect(scopedTools).toBeDefined()
    scopedTools!.guard(exec => (exec.name === target ? 'third-party guard says no' : undefined))

    const result = await invoke(ctx, target, agent)
    expect(result.isError, result.text).toBe(true)
    // The denial reason is carried through, not swallowed or relabelled.
    expect(result.text).toContain('third-party guard says no')
    expect(calls).toBe(0)
  })

  it('row 5: On-demand plus a host tools/pre-execute deny is denied', async () => {
    const { ctx } = await setup('dsh-perm-row5-', { tools: { 'on-demand': ['mcp__matrix__ondemand'] } })
    let calls = 0
    const target = registerTargetTool(ctx, 'mcp__matrix__ondemand', {
      onExecute: () => { calls++ },
    })
    await ctx.capability.refresh()
    const agent = scopedAgent(ctx, 'row5-agent')
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === target) return { kind: 'deny', reason: 'host policy blocks this tool' }
      return next()
    })

    const result = await invoke(ctx, target, agent)
    expect(result.isError, result.text).toBe(true)
    expect(result.text).toContain('host policy blocks this tool')
    expect(calls).toBe(0)
  })

  it('row 6: Disabled with no other restriction is denied', async () => {
    const { ctx } = await setup('dsh-perm-row6-', { tools: { disabled: ['mcp__matrix__disabled'] } })
    let calls = 0
    const target = registerTargetTool(ctx, 'mcp__matrix__disabled', {
      onExecute: () => { calls++ },
    })
    await ctx.capability.refresh()

    expect(ctx.capabilityPolicy.classifyTool(target)).toBe('disabled')
    const agent = scopedAgent(ctx, 'row6-agent')
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })

    const result = await invoke(ctx, target, agent)
    expect(result.isError, result.text).toBe(true)
    expect(result.text).toContain('disabled')
    expect(calls).toBe(0)

    // Disabled is also a hard deny on a direct call, not just through meta_invoke.
    const direct = await runTool(ctx, target, { title: 'x' }, agent)
    expect(direct.isError, direct.text).toBe(true)
    expect(calls).toBe(0)
  })

  it('row 7: Disabled plus a third-party restriction is still denied', async () => {
    const { ctx } = await setup('dsh-perm-row7-', { tools: { disabled: ['mcp__matrix__disabled'] } })
    let calls = 0
    const target = registerTargetTool(ctx, 'mcp__matrix__disabled', {
      onExecute: () => { calls++ },
    })
    await ctx.capability.refresh()
    const agent = scopedAgent(ctx, 'row7-agent')
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })
    await agent.ctx.plugin({
      name: 'third-party-deny-disabled',
      inject: ['tools'],
      apply(restrictedCtx) {
        restrictedCtx.tools.restrict({ deny: [target] })
      },
    })
    agent.ctx.get('tools')!.guard(exec => (exec.name === target ? 'third-party guard also denies' : undefined))

    const result = await invoke(ctx, target, agent)
    expect(result.isError, result.text).toBe(true)
    expect(calls).toBe(0)
  })
})
