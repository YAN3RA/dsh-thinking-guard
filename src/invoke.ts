/**
 * Model-facing `meta_invoke` tool: unified execution/loading of capabilities.
 *
 * @module @daweifu/capability-menu (invoke plugin)
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
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
 *   `ctx.tools.execute` pipeline, preserving the agent and cancellation signal.
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
        // On-demand tools are omitted from the prompt assembly, not from the
        // caller's tool view. Resolve in that view so session restrictions and
        // preset-scoped definitions apply to both resolve and execution.
        const definition = ctx.tools.get(capability.name, exec.agent)
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
        // Forward through the host's official executor. Older hosts accept a
        // single nested call; DSH 0.2.2 accepts a one-call batch instead.
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
        const result = await forwardThroughHost(
          ctx,
          { callId: exec.callId, rootCallId: exec.rootCallId, agent: exec.agent, signal: exec.signal, token: exec.token },
          capability.name,
          forwarded,
          id,
        )
        if (result === undefined) throw new Error(`meta_invoke: ${capability.name} returned no result`)
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

/** Minimal settled-result view shared by the two forwarding paths. */
interface ForwardedResult {
  readonly isError: boolean
  readonly error?: { readonly message?: unknown } | undefined
  readonly content: readonly { readonly type: string; readonly text?: string }[]
}

/** Caller context a forwarded call must keep: agent scope, cancellation, correlation. */
interface ForwardScope {
  readonly callId: ToolRunContext['callId']
  readonly rootCallId: ToolRunContext['rootCallId']
  readonly agent: ToolRunContext['agent']
  readonly signal: AbortSignal
  readonly token: ToolRunContext['token']
}

/**
 * Forward one tool call through the host's selected executor.
 *
 * Normally that executor runs the target in place. A program-only executor
 * (PTC / Code Mode) instead rejects every direct call with "only `run_code` is
 * callable directly" — a transport restriction, not a capability one: the same
 * registered tool stays executable through the public native tool pipeline.
 * Only that exact rejection is retried there; every other failure (including a
 * target's own error result) propagates unchanged, so a real tool error is
 * never masked, retried, or turned into a silent success.
 */
async function forwardThroughHost(
  ctx: Context,
  scope: ForwardScope,
  name: string,
  forwarded: Record<string, unknown>,
  id: string,
): Promise<ForwardedResult | undefined> {
  try {
    const result: ForwardedResult | undefined = typeof ctx.tools.resolve === 'function'
      ? (await ctx.tools.execute({
          calls: [{
            type: 'tool-call', id: ToolCallId(`${scope.callId}:meta:${id}`),
            name, arguments: JSON.stringify(forwarded),
          }],
          signal: scope.signal,
          agent: scope.agent,
        })).results[0]?.result
      : await (ctx.tools as unknown as {
          execute(input: {
            callId: ReturnType<typeof ToolCallId>; name: string; arguments: Record<string, unknown>;
            signal: AbortSignal; parent: ToolRunContext['token']; agent: ToolRunContext['agent'];
          }): Promise<ForwardedResult>
        }).execute({
          callId: ToolCallId(`${scope.callId}:meta:${id}`), name,
          arguments: forwarded, signal: scope.signal, parent: scope.token, agent: scope.agent,
        })
    if (result !== undefined && result.isError && isProgramOnlyRestriction(settledFailureText(result))) {
      return await executeOutsideProgramOnlyExecutor(ctx, scope, name, forwarded, id)
    }
    return result
  } catch (error) {
    if (!isProgramOnlyRestriction(thrownMessage(error))) throw error
    return await executeOutsideProgramOnlyExecutor(ctx, scope, name, forwarded, id)
  }
}

/**
 * Execute the target through the public native tool pipeline
 * (`@deepseek-ai/dsh-tools/pipeline`).
 *
 * This is the same protected path the standard executor uses — pre-execute
 * waterfall, guards, approvals, dispatch, post-execute — it just does not route
 * through the program-only executor, which is what frees non-`run_code` tools.
 * The module is imported lazily so a host without that export keeps loading and
 * keeps behaving exactly as before; the retry is only ever reached after an
 * actual program-only rejection. The concurrency accessor must be a function
 * (the batch scheduler reads it per call).
 */
async function executeOutsideProgramOnlyExecutor(
  ctx: Context,
  scope: ForwardScope,
  name: string,
  forwarded: Record<string, unknown>,
  id: string,
): Promise<ForwardedResult | undefined> {
  let pipelineModule: typeof import('@deepseek-ai/dsh-tools/pipeline')
  try {
    pipelineModule = await import('@deepseek-ai/dsh-tools/pipeline')
  } catch (cause) {
    throw new Error(
      `meta_invoke: "${name}" is only callable from inside a run_code program, and this host does not expose the native tool pipeline (@deepseek-ai/dsh-tools/pipeline) for plugin execution`,
      { cause },
    )
  }
  const pipeline = new pipelineModule.ToolExecutionPipeline(ctx)
  // A transport sub-dispatch must carry the enclosing execution's opaque token
  // and its root call: with a program-only executor selected, only a call that
  // has a parent may execute a native tool name (a model-direct call is denied
  // as UNKNOWN_TOOL), and commit-style observers need the root correlation.
  const input: ToolExecutionInput = {
    callId: ToolCallId(`${scope.callId}:outside:${id}`),
    rootCallId: scope.rootCallId,
    name,
    arguments: forwarded,
    signal: scope.signal,
    parent: scope.token,
    ...scope.agent === undefined ? {} : { agent: scope.agent },
  }
  const prepared = await pipeline.prepare(input)
  const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
  const result = await pipeline.complete(prepared.exec, outcome)
  if (result === undefined) return undefined
  // A second rejection means the pipeline is program-only too; do not recurse.
  if (result.isError && isProgramOnlyRestriction(settledFailureText(result))) {
    throw new Error(`meta_invoke: "${name}" cannot be executed outside a run_code program on this host`)
  }
  return result
}

/** Readable text of a settled result: the structured error message plus text blocks. */
function settledFailureText(result: ForwardedResult): string {
  const message = typeof result.error?.message === 'string' ? result.error.message : ''
  const content = result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
  return `${message}\n${content}`
}

/** Readable message of a thrown value, including non-Error throws. */
function thrownMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const message = (error as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : ''
}

/**
 * Detect a program-only executor's direct-call rejection.
 *
 * DSH's PTC executor rejects `ctx.tools.execute` with a `ToolNotFoundError`
 * whose message is "unknown tool \"<x>\": only `run_code` is callable directly".
 * Requiring both fragments keeps the retry scoped to that transport
 * restriction: a genuinely missing tool ("unknown tool" alone) still fails.
 */
function isProgramOnlyRestriction(text: string): boolean {
  return text.includes('run_code') && text.includes('callable directly')
}
