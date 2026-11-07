/**
 * Model-facing `meta_invoke` tool: unified execution/loading of capabilities.
 *
 * @module @daweifu/capability-menu (invoke plugin)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { isModelInvocable, renderSkillContent, type SkillResourceBase } from '@deepseek-ai/dsh-skill'

export const name = 'capability-menu-invoke'
export const inject = ['capability', 'tools', 'skills']

/** Forwarding mode for the MCP branch. */
export type MetaForwardMode = 'direct' | 'resolve'

/** Model-facing `meta_invoke` configuration. */
export interface Config {
  /** How to forward MCP calls: `direct` executes via the tool pipeline; `resolve` returns the schema for the model to call directly. */
  forwardMode?: MetaForwardMode
}

/** Validate and default the tool configuration. */
export const Config: z<Config> = z.object({
  forwardMode: z.union(['direct', 'resolve']).default('direct'),
})

/** Canonical MCP result shape. */
export interface MetaInvokeMcpDetail {
  readonly forwarded: true
  readonly target: string
  readonly content: ContentBlock[]
}

/** Canonical skill result shape (matches the `skill` tool output). */
export interface MetaInvokeSkillDetail {
  readonly name: string
  readonly provider: string
  readonly resourceBase?: SkillResourceBase
  readonly content: string
}

/** Canonical resolve-mode result shape (forwardMode: 'resolve'). */
export interface MetaInvokeResolveDetail {
  readonly target: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

/** Discriminated canonical result. */
export type MetaInvokeResult =
  | { ok: true; kind: 'mcp'; id: string; detail: MetaInvokeMcpDetail }
  | { ok: true; kind: 'skill'; id: string; detail: MetaInvokeSkillDetail }
  | { ok: true; kind: 'resolve'; id: string; detail: MetaInvokeResolveDetail }

/**
 * Register the `meta_invoke` tool.
 *
 * Dispatch is by the explicit `kind` argument (no id-prefix parsing).
 *
 * - Tools (`kind: 'tool'`, e.g. `mcp__gongfeng__create_issue` or a harness-native
 *   tool such as `bash`): forwards to the underlying tool call via the official
 *   `ctx.tools.execute` pipeline, preserving `agent`/`signal`/parent lineage.
 *   `forwardMode: 'resolve'` instead returns the target schema so the model can
 *   call the tool directly.
 * - Skills (`kind: 'skill'`, id is the bare skill name): loads the full skill
 *   instructions and returns them as `<skill_content>` — no args, no script
 *   execution (matches the existing `skill` tool semantics).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const forwardMode = config.forwardMode ?? 'direct'
  if (forwardMode !== 'direct' && forwardMode !== 'resolve') {
    throw new Error(`forwardMode must be "direct" or "resolve", received "${String(forwardMode)}"`)
  }

  // Per-session dedup for loaded skills. Re-loading an already-injected skill
  // only returns a short reminder instead of re-injecting the full
  // instructions, saving tokens (mirrors synapse's `_loaded_skills`). Keyed by
  // the agent object so two sessions in the same process never share state; a
  // WeakMap lets entries be collected with the agent. Without an agent context
  // (headless dispatch) nothing is cached.
  const loadedSkills = new WeakMap<object, Set<string>>()

  // Shared invocation pipeline used for the nested forward. `ToolsService.execute`
  // is batch-only in 0.2.2 and its `ToolBatchInput` has no `parent`, so a single
  // sub-dispatch goes through the same stages the native executor uses.
  //
  // The source override keeps On-demand targets reachable. The policy hides them
  // with an agent-scoped `tools.restrict({ deny })` (see `src/policy.ts`), which
  // removes them from `view(agent)` — and the default lookup,
  // `tools.executable(name, scope, toolSet)`, reads exactly that view. Without a
  // fallback every On-demand forward would fail as UNKNOWN_TOOL.
  //
  // The fallback is therefore narrow on purpose: it applies only to a name the
  // policy can PROVE is invisible *solely* because of its own On-demand mask
  // (`capabilityPolicy.isHiddenOnlyByPolicy`). Classification alone is not
  // evidence — it says how this plugin treats a name, not whether a third party
  // also denies it — so a `tools.restrict({ deny })`, an `allow` filter, or any
  // other restriction installed by someone else still denies the call, exactly
  // like it denies a direct one. Execution still carries `agent`, `signal`, and
  // `parent`, so scope, pre-execute policy, guards, and event attribution are
  // unchanged.
  const resolveForwardDefinition = (name: string, scope: unknown, toolSet: unknown) => {
    const visible = ctx.tools.executable(name, scope as never, toolSet as never)
    if (visible !== undefined) return visible
    const policy = ctx.get('capabilityPolicy')
    if (policy?.isHiddenOnlyByPolicy(scope as object | undefined, name) !== true) return undefined
    // Registered definitions only: the step's admission set belongs to the
    // caller's view, which this policy just masked.
    return ctx.tools.get(name)
  }

  const pipeline = new ToolExecutionPipeline(ctx, {
    get: (name, scope, toolSet) => resolveForwardDefinition(name, scope, toolSet),
  })

  const tool = defineTool({
    name: 'meta_invoke',
    description: 'Execute a capability by its exact id (from meta_search) and kind. For tools, forwards args to the underlying tool. For skills, loads the full instructions; pass force:true to reload changed instructions in the current session. Always pass the kind reported by meta_search.',
    parameters: {
      id: { type: 'string', required: true, description: 'Capability id from meta_search, e.g. mcp__gongfeng__create_issue or frontend-design.' },
      kind: { type: 'string', enum: ['tool', 'skill'], required: true, description: 'Capability kind reported by meta_search for this id.' },
      args: {
        type: 'object',
        additionalProperties: true,
        description:
          'Arguments for the target tool, passed directly. Each property must be a valid value for the target tool schema (the parameter object from meta_search detail). ' +
          'Do NOT wrap these in another {id, kind, args} object, and do NOT stringify them — pass them as a structured object. ' +
          'Skills ignore this field.',
      },
      force: { type: 'boolean', description: 'For Skills, reload current instructions even if already loaded in this session.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true, const: true },
              kind: { type: 'string', required: true, const: 'mcp' },
              id: { type: 'string', required: true },
              detail: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  forwarded: { type: 'boolean', required: true, const: true },
                  target: { type: 'string', required: true },
                  content: { type: 'array', required: true, items: { type: 'json' } },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true, const: true },
              kind: { type: 'string', required: true, const: 'skill' },
              id: { type: 'string', required: true },
              detail: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  provider: { type: 'string', required: true },
                  resourceBase: { type: 'json' },
                  content: { type: 'string', required: true },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true, const: true },
              kind: { type: 'string', required: true, const: 'resolve' },
              id: { type: 'string', required: true },
              detail: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  target: { type: 'string', required: true },
                  kind: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  description: { type: 'string', required: true },
                  parameters: { type: 'json', required: true },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => {
        const result = value as MetaInvokeResult
        if (result.ok && result.kind === 'skill') {
          return [{ type: 'text', text: renderSkillContent(result.detail as unknown as MetaInvokeSkillDetail) }]
        }
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: { id: string; kind: 'tool' | 'skill'; args?: unknown; force?: boolean }, exec: ToolRunContext) {
      const id = args.id.trim()
      const kind = args.kind
      if (kind !== 'tool' && kind !== 'skill') {
        throw new Error('meta_invoke: kind must be "tool" or "skill" (the kind meta_search reported for this id)')
      }
      const capability = ctx.capability.get(id, kind)
      if (capability === undefined) {
        throw new Error(`meta_invoke: no ${kind} capability "${id}" is available`)
      }
      // Disabled capabilities are a hard deny at the execution surface: the
      // registry keeps them indexed so the management UI can list them, but the
      // model can never reach a disabled capability through meta_invoke.
      const policy = ctx.get('capabilityPolicy')
      if (policy?.isDisabledCapability(id, kind)) {
        throw new Error(`meta_invoke: ${kind} capability "${id}" is disabled and cannot be invoked`)
      }

      // Tool: forward to the underlying tool execution (an MCP server call or a
      // harness-native tool cataloged under the built-in server) — or resolve its
      // schema.
      if (capability.kind === 'tool') {
        // Resolve the target the same way the forward does: the caller's view
        // first, then — only for a name the policy proved it alone masked — the
        // registered definition. Any other restriction still reads as absent,
        // so this never lifts a third party's decision.
        const definition = resolveForwardDefinition(capability.name, exec.agent, exec.toolSet)
        if (definition === undefined) {
          throw new Error(`meta_invoke: tool "${capability.name}" is not available`)
        }
        if (forwardMode === 'resolve') {
          return {
            ok: true,
            kind: 'resolve' as const,
            id,
            detail: {
              target: capability.name,
              kind: 'tool' as const,
              name: definition.name,
              description: definition.description,
              parameters: definition.parameters as unknown as JsonValue,
            },
          }
        }
        // Nested execution through the official pipeline. The parent token marks
        // this as a transport sub-dispatch so code-mode collapse rules treat it
        // like a nested SDK call, and `tools/result` observers can attribute the
        // outcome to the target capability.
        // Keep the caller's agent for every target, including MCP and On-demand
        // tools. Executing on the global view would drop the target's session and
        // could bypass restrictions on the caller's tool view.
        // `args.args` is normalized to an argument object first. The declared
        // contract (see `parameters.args`) already rejects a stringified payload
        // before this runs; what is left for `normalizeArgs` is guaranteeing the
        // MCP layer never receives `undefined` (the pipeline rejects that) or a
        // stray non-object, which would otherwise degrade to `{}` downstream.
        const forwarded = normalizeArgs(args.args)
        // A model that nests the meta_invoke envelope inside `args` satisfies the
        // object contract, so it would reach the target as a wrong parameter
        // object and leave the server to report an unrelated missing/unexpected
        // field. Name the mistake instead — and only name it: rewriting `args`
        // risks turning a legitimate call into a wrong one (see issue #10).
        const envelope = envelopeDiagnostic(forwarded, capability.name, definition.parameters)
        if (envelope !== undefined) throw new Error(envelope)
        //
        // 0.2.2 moved `ToolsService.execute` to a batch contract
        // (`ToolBatchInput` has no `parent`), so the single-call forward goes
        // through the same shared pipeline the native executor uses:
        // `prepare → dispatch → complete`. `ToolExecutionInput` still accepts
        // `parent`, which is what keeps this a transport sub-dispatch.
        const prepared = await pipeline.prepare({
          callId: ToolCallId(`${exec.callId}:meta:${id}`),
          rootCallId: exec.rootCallId,
          name: capability.name,
          arguments: forwarded,
          signal: exec.signal,
          parent: exec.token,
          agent: exec.agent,
          ...exec.toolSet === undefined ? {} : { toolSet: exec.toolSet },
        })
        const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
        const result = await pipeline.complete(prepared.exec, outcome)
        // Nested context and turn conclusion belong to the enclosing
        // meta_invoke result, exactly like any other composite tool.
        for (const context of result.additionalContexts ?? []) exec.deferContext(context)
        if (result.concludesTurn === true) exec.concludeTurn()
        if (result.isError) {
          const message = result.content.map(block => block.type === 'text' ? block.text : `[${block.type} content]`).join('\n')
          throw new Error(message || `meta_invoke: ${capability.name} failed`)
        }
        return {
          ok: true,
          kind: 'mcp' as const,
          id,
          detail: {
            forwarded: true,
            target: capability.name,
            content: result.content as unknown as JsonValue[],
          },
        }
      }

      // Skill: load the full instructions.
      if (capability.kind === 'skill') {
        const name = capability.name

        // Per-session loaded set (see the WeakMap above); undefined when there
        // is no agent context, in which case nothing is deduped.
        const agent = exec.agent
        let sessionSkills: Set<string> | undefined
        if (agent !== undefined) {
          sessionSkills = loadedSkills.get(agent)
          if (sessionSkills === undefined) {
            sessionSkills = new Set<string>()
            loadedSkills.set(agent, sessionSkills)
          }
        }

        // Already loaded this session → return a short reminder, no re-injection.
        if (sessionSkills?.has(name) === true && args.force !== true) {
          return {
            ok: true,
            kind: 'skill' as const,
            id,
            detail: {
              name,
              provider: capability.origin.provider,
              content: `Skill "${name}" is already loaded in this conversation. Read the <skill_content> above and follow it.`,
            },
          }
        }

        const lookup = {
          cwd: exec.agent?.session.header.cwd,
          signal: exec.signal,
          scope: exec.agent,
        }
        const skill = await ctx.skills.get(name, lookup).catch(() => undefined)
        if (skill === undefined) {
          throw new Error(`meta_invoke: skill "${name}" is unknown or no longer available`)
        }
        if (!isModelInvocable(skill)) {
          throw new Error(`meta_invoke: skill "${name}" is not available for model invocation`)
        }
        sessionSkills?.add(name)
        return {
          ok: true,
          kind: 'skill' as const,
          id,
          detail: {
            name: skill.name,
            provider: skill.provider,
            ...skill.resourceBase !== undefined ? { resourceBase: { ...skill.resourceBase } } : {},
            content: skill.content,
          },
        }
      }

      throw new Error(`meta_invoke: capability id "${id}" has an unrecognized kind`)
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Execute capability ${args.id}`,
        kind: args.kind === 'skill' ? 'read' : 'other',
        rawInput: args.id,
      }
    },
  })

  ctx.tools.register(tool)
}

/**
 * Normalize the model-supplied `args` before forwarding them to the target tool.
 *
 * The declared contract (`parameters.args`) is an object and the tool pipeline
 * enforces it before `execute` runs, so this covers only what validation lets
 * through: a missing value on a parameterless call, and `null`. Anything that
 * cannot be forwarded as an MCP argument object is rejected here instead of
 * silently degrading to `{}` at the MCP layer (issue #4).
 */
function normalizeArgs(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('meta_invoke: args must be an object (the target tool parameter object)')
  }

  return raw as Record<string, unknown>
}

/** The three keys of the call envelope models sometimes nest inside `args`. */
const ENVELOPE_KEYS = ['id', 'kind', 'args'] as const

/**
 * Diagnose a `{ id, kind, args }` envelope nested inside `args`.
 *
 * `args` is forwarded as the target tool's parameter object, so a nested
 * envelope reaches the server as a wrong argument object and surfaces as an
 * unrelated missing/unexpected-field error. Detection is deliberately narrow —
 * an exact key set, `kind: 'tool'`, an `id` equal to the target tool's own name,
 * an object payload, and a target that does not declare `id`/`kind` as real
 * parameters — so a tool whose parameters really are those keys is never
 * affected. Only a diagnostic is returned: `args` is never rewritten, because a
 * wrong-but-plausible call is worse than a loud error.
 *
 * @returns the error message to raise, or `undefined` when `args` is not an envelope.
 */
function envelopeDiagnostic(
  forwarded: Record<string, unknown>,
  targetName: string,
  parameters: unknown,
): string | undefined {
  const keys = Object.keys(forwarded)
  if (keys.length !== ENVELOPE_KEYS.length) return undefined
  if (!ENVELOPE_KEYS.every(key => keys.includes(key))) return undefined
  if (forwarded['kind'] !== 'tool' || forwarded['id'] !== targetName) return undefined
  const payload = forwarded['args']
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const declared = (parameters as { properties?: Record<string, unknown> } | undefined)?.properties
  if (declared !== undefined && (Object.hasOwn(declared, 'id') || Object.hasOwn(declared, 'kind'))) return undefined
  return (
    `meta_invoke: args looks like a nested { id, kind, args } envelope for "${targetName}" — ` +
    'pass the target tool\'s parameters directly (the parameter object from meta_search detail)'
  )
}
