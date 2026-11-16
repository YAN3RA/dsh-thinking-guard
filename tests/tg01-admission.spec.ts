/**
 * TG-01 admission regression: a stale On-demand attribution proof must never
 * survive a third-party restriction that landed while another agent's mask was
 * being installed.
 *
 * The counterexample, reproduced on the old code:
 *   A already has this policy's On-demand mask (owned=true). Creating B runs
 *   applyOnDemandRestriction(B), whose synchronous tools/change emit gives a
 *   third-party listener the chance to add tools.restrict({ deny }) for A.
 *   The old global 'applying' flag then skipped A's reapply and only cleared
 *   B's proof, leaving A attributable: a direct call was denied by the third
 *   party while meta_invoke lifted the mask and executed the tool.
 *
 * Every case runs a real Context + ToolRuntime, the public
 * ToolExecutionPipeline and a real step ResolvedToolSet; none of this is a
 * model of the restriction layer.
 */
import { mkdtemp } from 'node:fs/promises'
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
import * as toolMetaInvoke from '../src/invoke.ts'
import { mountTestExecutor, runOneToolCall } from './stubs/test-executor.ts'

const testSignal = new AbortController().signal

interface TestAgent {
  id: string
  options: Record<string, unknown>
  session: { header: { cwd: string } }
  ctx: Context
  status: string
}

/** The policy fiber, so lifecycle cases can unload and remount the instance. */
interface Composition {
  readonly ctx: Context
  readonly policyFiber: { uid: number | null; dispose: () => Promise<void> }
}

/**
 * Mount the production composition used by every permission regression.
 *
 * The policy fiber is returned (not just the context) so the lifecycle cases
 * can exercise a real Cordis unload instead of simulating one.
 */
async function mount(prefix: string, onDemand: string[]): Promise<Composition> {
  const home = await mkdtemp(join(tmpdir(), prefix))
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
  const policyFiber = ctx.plugin(policy, { stateFile: '', tools: { 'on-demand': onDemand } })
  await policyFiber
  await ctx.plugin(toolMetaInvoke, {})
  return { ctx, policyFiber }
}

/** The single-target composition every admission case uses. */
async function setup(prefix: string): Promise<Context> {
  const { ctx } = await mount(prefix, ['mcp__matrix__ondemand'])
  return ctx
}

/** Announce a live agent exactly like the host: real child scope + awaited agent/created. */
async function announceAgent(ctx: Context, id: string): Promise<TestAgent> {
  const agent = {
    id,
    options: {},
    session: { header: { cwd: process.cwd() } },
    ctx: new Context(),
    status: 'idle',
  } as unknown as TestAgent
  agent.ctx = createScope(ctx, agent as never).ctx
  await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })
  return agent
}

/** A target tool that records every execution, so bypasses are observable. */
function registerTarget(ctx: Context, name: string, executed: string[]): void {
  ctx.tools.register(defineTool({
    name,
    description: 'TG-01 permission target',
    parameters: { title: { type: 'string', required: true, description: 'Title' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() {
      executed.push(name)
      return { ok: true }
    },
  }))
}

interface ToolResult {
  value: unknown
  isError: boolean
  text: string
}

async function runTool(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
  agent: unknown,
  callId: string,
): Promise<ToolResult> {
  const result = await runOneToolCall(ctx, {
    callId,
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

/** Forward to the On-demand target through meta_invoke. */
function invoke(ctx: Context, target: string, agent: TestAgent, callId: string): Promise<ToolResult> {
  return runTool(ctx, 'meta_invoke', { id: target, kind: 'tool', args: { title: 'x' } }, agent, callId)
}

/**
 * Forward through a real step ResolvedToolSet, resolved the way an agent step
 * does before the model call. A bypass that only exists when toolSet is omitted
 * must not be dismissed as a test artifact.
 */
async function invokeWithToolSet(
  ctx: Context,
  target: string,
  agent: TestAgent,
  callId: string,
): Promise<ToolResult> {
  const toolSet = await ctx.tools.resolve({
    agent: agent as never,
    modelSelection: { provider: 'matrix', model: 'matrix' } as never,
    signal: testSignal,
  })
  try {
    const batch = await ctx.tools.execute({
      calls: [{
        type: 'tool-call',
        id: callId as never,
        name: 'meta_invoke',
        arguments: JSON.stringify({ id: target, kind: 'tool', args: { title: 'x' } }),
      }],
      signal: testSignal,
      agent: agent as never,
      toolSet,
    })
    const settled = batch.results.find(entry => entry.callId === callId)
    if (settled === undefined) throw new Error('no result settled for meta_invoke')
    return {
      value: settled.result.isError ? undefined : settled.result.value,
      isError: settled.result.isError,
      text: settled.result.content.map(block => block.type === 'text' ? block.text : '').join('\n'),
    }
  } finally {
    toolSet.dispose()
  }
}

interface ArmedMutation {
  /** Number of times the armed listener actually installed its restriction. */
  readonly fired: () => number
  /** Stop listening; later cases in the same test remain unaffected. */
  readonly disarm: () => void
}

/**
 * Arm a third-party listener that adds one restriction to 'victim' at the
 * triggerAt-th tools/change event after arming. Used to put the mutation inside
 * another agent's install window, exactly where the old global 'applying' flag
 * swallowed it.
 */
function armThirdPartyRestriction(
  ctx: Context,
  victim: TestAgent,
  triggerAt: number,
  filter: { deny: string[] } | { allow: string[] },
): ArmedMutation {
  const victimTools = victim.ctx.get('tools')!
  let seen = 0
  let fired = 0
  const listener = () => {
    seen += 1
    if (fired > 0 || seen < triggerAt) return
    fired += 1
    victimTools.restrict(filter)
  }
  const dispose = ctx.on('tools/change', listener)
  return {
    fired: () => fired,
    disarm: () => { dispose() },
  }
}

/**
 * The exact counterexample: the victim's proof is valid, then a third party
 * denies it inside the other agent's install emit. Swapped creation orders are
 * covered because the old bug depended on which agent was applied first.
 */
describe('TG-01: cross-agent install reentry must not preserve a stale proof', () => {
  /**
   * The reported counterexample verbatim: victim first (it owns a proof), then
   * the installer, whose install emit lets a third party deny the victim.
   */
  it('fails closed when a third-party deny lands on the victim during the other agent install', async () => {
    const ctx = await setup('dsh-tg01-deny-')
    const executed: string[] = []
    const target = 'mcp__matrix__ondemand'
    registerTarget(ctx, target, executed)
    await ctx.capability.refresh()

    // The victim exists first and owns a legitimate proof.
    const victim = await announceAgent(ctx, 'victim-first')
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(victim, target)).toBe(true)
    const baseline = await invoke(ctx, target, victim, 'tg01-baseline')
    expect(baseline.isError, baseline.text).toBe(false)
    expect(executed).toEqual([target])
    executed.length = 0

    // Arming the third party on the FIRST tools/change after this point puts
    // its deny inside the installer's own install emit.
    const armed = armThirdPartyRestriction(ctx, victim, 1, { deny: [target] })
    const installer = await announceAgent(ctx, 'installer-second')
    expect(armed.fired()).toBe(1)

    // Both sides of the decision must agree: the direct call is refused by the
    // third party, so the forward must be refused too.
    const direct = await runTool(ctx, target, { title: 'direct' }, victim, 'tg01-direct')
    const forwarded = await invoke(ctx, target, victim, 'tg01-forward')
    const withToolSet = await invokeWithToolSet(ctx, target, victim, 'tg01-forward-set')

    expect.soft(ctx.capabilityPolicy.isHiddenOnlyByPolicy(victim, target),
      'a third-party deny must invalidate the stale attribution proof').toBe(false)
    expect.soft(direct.isError, direct.text).toBe(true)
    expect.soft(forwarded.isError,
      'meta_invoke must not lift the third-party deny; got: ' + forwarded.text).toBe(true)
    expect.soft(withToolSet.isError,
      'meta_invoke with a real ResolvedToolSet must not lift the deny; got: ' + withToolSet.text).toBe(true)
    expect.soft(executed).toEqual([])

    // The unaffected installer must keep a working On-demand path: the fix must
    // not degrade into "deny everything after any reentry".
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(installer, target)).toBe(true)
    const installerForward = await invoke(ctx, target, installer, 'tg01-installer-forward')
    expect(installerForward.isError, installerForward.text).toBe(false)
    expect(executed).toEqual([target])
    armed.disarm()
  })

  /**
   * Swapped creation order: the installer exists first, the third-party deny is
   * installed on the future victim's scope, and only then is the victim
   * announced. Its own install window must sample a view that already carries
   * the foreign deny, so the name is never attributed to this policy.
   */
  it('fails closed when the third-party deny predates the victim creation (swapped order)', async () => {
    const ctx = await setup('dsh-tg01-order-')
    const executed: string[] = []
    const target = 'mcp__matrix__ondemand'
    registerTarget(ctx, target, executed)
    await ctx.capability.refresh()

    const installer = await announceAgent(ctx, 'installer-first')

    // Build the victim scope by hand so a third party can restrict it before
    // the policy's `agent/created` handler ever runs.
    const victim = {
      id: 'victim-second',
      options: {},
      session: { header: { cwd: process.cwd() } },
      ctx: new Context(),
      status: 'idle',
    } as unknown as TestAgent
    victim.ctx = createScope(ctx, victim as never).ctx
    victim.ctx.get('tools')!.restrict({ deny: [target] })

    await ctx.emit('agent/created', { agent: victim as never, source: 'startup' as const })

    const direct = await runTool(ctx, target, { title: 'direct' }, victim, 'tg01-order-direct')
    const forwarded = await invoke(ctx, target, victim, 'tg01-order-forward')
    const withToolSet = await invokeWithToolSet(ctx, target, victim, 'tg01-order-set')

    expect.soft(ctx.capabilityPolicy.isHiddenOnlyByPolicy(victim, target)).toBe(false)
    expect.soft(direct.isError, direct.text).toBe(true)
    expect.soft(forwarded.isError, forwarded.text).toBe(true)
    expect.soft(withToolSet.isError, withToolSet.text).toBe(true)
    expect.soft(executed).toEqual([])

    // The installer, created before any of that, still works.
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(installer, target)).toBe(true)
    const installerForward = await invoke(ctx, target, installer, 'tg01-order-installer')
    expect(installerForward.isError, installerForward.text).toBe(false)
    expect(executed).toEqual([target])
  })

  it('fails closed when a third-party allow filter lands during the other agent install', async () => {
    const ctx = await setup('dsh-tg01-allow-')
    const executed: string[] = []
    const target = 'mcp__matrix__ondemand'
    registerTarget(ctx, target, executed)
    // A resident name is needed so the allow filter is a legal restriction.
    registerTarget(ctx, 'mcp__matrix__resident', [])
    await ctx.capability.refresh()

    const victim = await announceAgent(ctx, 'allow-victim')
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(victim, target)).toBe(true)

    const armed = armThirdPartyRestriction(ctx, victim, 1, { allow: ['mcp__matrix__resident'] })
    await announceAgent(ctx, 'allow-installer')
    expect(armed.fired()).toBe(1)

    const direct = await runTool(ctx, target, { title: 'direct' }, victim, 'tg01-allow-direct')
    const forwarded = await invoke(ctx, target, victim, 'tg01-allow-forward')
    expect.soft(ctx.capabilityPolicy.isHiddenOnlyByPolicy(victim, target)).toBe(false)
    expect.soft(direct.isError, direct.text).toBe(true)
    expect.soft(forwarded.isError, forwarded.text).toBe(true)
    expect.soft(executed).toEqual([])
    armed.disarm()
  })

  it('recomputes after a third-party restriction is removed, restoring On-demand', async () => {
    const ctx = await setup('dsh-tg01-unmount-')
    const executed: string[] = []
    const target = 'mcp__matrix__ondemand'
    registerTarget(ctx, target, executed)
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'unmount-agent')
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent, target)).toBe(true)

    const thirdParty = await agent.ctx.plugin({
      name: 'third-party-deny-unmount',
      inject: ['tools'],
      apply(restrictedCtx) {
        restrictedCtx.tools.restrict({ deny: [target] })
      },
    })
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent, target)).toBe(false)
    const denied = await invoke(ctx, target, agent, 'tg01-unmount-denied')
    expect(denied.isError, denied.text).toBe(true)
    expect(executed).toEqual([])

    await thirdParty.dispose()
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent, target)).toBe(true)
    const restored = await invoke(ctx, target, agent, 'tg01-unmount-ok')
    expect(restored.isError, restored.text).toBe(false)
    expect(executed).toEqual([target])
  })

  /**
   * Non-hang guard: a third party that reacts to every `tools/change` by adding
   * another restriction must not turn the policy's reapply into an unbounded
   * synchronous loop. The retry budget is finite, so the composition settles
   * (fail-closed while the storm lasts) instead of hanging the event bus.
   */
  it('settles instead of looping when a third party mutates the view on every change', async () => {
    const ctx = await setup('dsh-tg01-storm-')
    const executed: string[] = []
    const target = 'mcp__matrix__ondemand'
    registerTarget(ctx, target, executed)
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'storm-agent')
    const scopedTools = agent.ctx.get('tools')!

    let changes = 0
    let injections = 0
    const dispose = ctx.on('tools/change', () => {
      changes += 1
      // Bounded but far above the internal retry budget: enough to force the
      // "give up and stay fail-closed" branch without growing without limit.
      if (injections >= 30) return
      injections += 1
      try {
        scopedTools.restrict({ deny: [target] })
      } catch {
        // A restriction that is no longer legal is not the point of this test.
      }
    })

    await announceAgent(ctx, 'storm-installer')
    await new Promise(resolve => setTimeout(resolve, 10))
    dispose()

    // The important assertion is that this test finished at all; the counts pin
    // the bound so a regression to an unbounded loop fails loudly.
    expect(injections).toBe(30)
    expect(changes).toBeLessThan(200)
    // After a storm the instance cannot prove anything, so the forward must be
    // refused unconditionally — not only when the predicate happens to answer
    // `false`. A conditional assertion here would silently pass on a policy
    // that answers `true` and then executes.
    expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent, target)).toBe(false)
    const forwarded = await invoke(ctx, target, agent, 'tg01-storm-forward')
    expect(forwarded.isError, forwarded.text).toBe(true)
    expect(executed).toEqual([])
  })

  /**
   * Lifecycle regression (independent review reproduction).
   *
   * A storm leaves one recovery microtask queued. Disposing the policy fiber
   * used to let that callback run with `uid === null` and install a fresh
   * `deny=[...]` restriction nobody owned, and — with or without a storm — the
   * masks this instance had already installed on a surviving agent's scope were
   * never released. A reloaded policy then could not restore a name the dead
   * instance hid, because restriction layers intersect.
   *
   * Both halves are asserted against a real Cordis fiber: no install after
   * teardown, and no leftover mask from the dead instance.
   */
  it('releases its masks on unload and never installs from a queued recovery', async () => {
    const { ctx, policyFiber } = await mount('dsh-tg01-lifecycle-', ['mcp__matrix__t1', 'mcp__matrix__t2'])
    const executed: string[] = []
    registerTarget(ctx, 'mcp__matrix__t1', executed)
    registerTarget(ctx, 'mcp__matrix__t2', executed)
    // A Resident marker proves the third party's own restriction survives.
    registerTarget(ctx, 'mcp__matrix__resident', executed)
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'lifecycle-agent')
    const scopedTools = agent.ctx.get('tools')!

    // Record every restrict() with the fiber's uid at call time.
    const calls: Array<{ deny: string[]; uid: number | null }> = []
    const realRestrict = scopedTools.restrict.bind(scopedTools)
    ;(scopedTools as { restrict: typeof scopedTools.restrict }).restrict = (filter: { deny?: string[]; allow?: string[] }) => {
      calls.push({ deny: [...filter.deny ?? []], uid: policyFiber.uid })
      return realRestrict(filter as never)
    }

    // A third-party storm: one fresh deny per tools/change, enough to exceed the
    // synchronous retry budget and queue exactly one recovery microtask.
    let injected = 0
    let injecting = false
    const stopStorm = ctx.on('tools/change', () => {
      if (injecting) return
      injecting = true
      injected += 1
      try { scopedTools.restrict({ deny: ['mcp__matrix__t1'] }) } catch { /* illegal name */ }
      injecting = false
    })
    ctx.tools.register(defineTool({
      name: 'mcp__matrix_kick',
      description: 'kick the storm',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {} },
        render: () => [{ type: 'text', text: 'x' }],
      },
      async execute() { return {} },
    }))

    // Stop the storm with a recovery microtask still pending, then unload.
    stopStorm()
    const mark = calls.length
    await policyFiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(injected).toBeGreaterThan(0)
    // Nothing may be installed once the fiber is gone.
    expect(calls.slice(mark).filter(call => call.uid === null)).toEqual([])

    // The dead instance's mask is gone: its On-demand names are visible again
    // (only the third party's deny on t1 remains), and the Resident marker is
    // untouched.
    expect(scopedTools.get('mcp__matrix__t2', agent as never)).toBeDefined()
    expect(scopedTools.get('mcp__matrix__t1', agent as never)).toBeUndefined()
    expect(scopedTools.get('mcp__matrix__resident', agent as never)).toBeDefined()
  })

  it('restores Resident visibility and a working On-demand path after a remount', async () => {
    const { ctx, policyFiber } = await mount('dsh-tg01-remount-', ['mcp__matrix__t2'])
    const executed: string[] = []
    registerTarget(ctx, 'mcp__matrix__t2', executed)
    await ctx.capability.refresh()

    const agent = await announceAgent(ctx, 'remount-agent')
    const scopedTools = agent.ctx.get('tools')!
    expect(scopedTools.get('mcp__matrix__t2', agent as never)).toBeUndefined()

    await policyFiber.dispose()
    // With the masking instance gone the name is visible again, which is what
    // makes the reload below able to observe it at all.
    expect(scopedTools.get('mcp__matrix__t2', agent as never)).toBeDefined()

    // Remount with the same name Resident: the surviving agent must see it.
    const remounted = ctx.plugin(policy, { stateFile: '', tools: { resident: ['mcp__matrix__t2'] } })
    await remounted
    expect(ctx.get('capabilityPolicy')).toBeDefined()
    expect(scopedTools.get('mcp__matrix__t2', agent as never)).toBeDefined()
    const direct = await runTool(ctx, 'mcp__matrix__t2', { title: 'x' }, agent, 'tg01-remount-direct')
    expect(direct.isError, direct.text).toBe(false)
    expect(executed).toEqual(['mcp__matrix__t2'])

    // And a remount that keeps it On-demand still serves the meta_invoke path.
    await remounted.dispose()
    const onDemandAgain = ctx.plugin(policy, { stateFile: '', tools: { 'on-demand': ['mcp__matrix__t2'] } })
    await onDemandAgain
    await ctx.emit('agent/created', { agent: agent as never, source: 'startup' as const })
    expect(scopedTools.get('mcp__matrix__t2', agent as never)).toBeUndefined()
    const forwarded = await invoke(ctx, 'mcp__matrix__t2', agent, 'tg01-remount-forward')
    expect(forwarded.isError, forwarded.text).toBe(false)
    expect(executed).toEqual(['mcp__matrix__t2', 'mcp__matrix__t2'])
  })

  it('keeps the On-demand path working across repeated agent installs with a bounded change count', async () => {
    const ctx = await setup('dsh-tg01-steady-')
    const executed: string[] = []
    const target = 'mcp__matrix__ondemand'
    registerTarget(ctx, target, executed)
    await ctx.capability.refresh()

    let changes = 0
    ctx.on('tools/change', () => { changes += 1 })

    const agents = [
      await announceAgent(ctx, 'steady-a'),
      await announceAgent(ctx, 'steady-b'),
      await announceAgent(ctx, 'steady-c'),
    ]
    // One own install per agent; no recursive re-apply storm.
    expect(changes).toBe(agents.length)

    for (const [index, agent] of agents.entries()) {
      expect(ctx.capabilityPolicy.isHiddenOnlyByPolicy(agent, target)).toBe(true)
      const forwarded = await invoke(ctx, target, agent, 'tg01-steady-' + index)
      expect(forwarded.isError, forwarded.text).toBe(false)
    }
    expect(executed).toEqual([target, target, target])
  })
})
