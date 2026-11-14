/**
 * Client-side Typert remote contribution for the `callIndex` Host gateway
 * (`src/server/call-index-remote.ts`, owned by the runtime side).
 *
 * Mirrors the generated shape `@deepseek-ai/dsh-typert-generator` emits, the
 * same way `src/client/usage-remote.ts` does for `usage`: it augments
 * `@deepseek-ai/dsh-typert-protocol` with the `callIndex` namespace and exports
 * a separate `CALL_INDEX_TYPERT_REMOTE` contribution. The package root mounts
 * it exactly once together with the other faces (see `src/client/index.ts`);
 * this module never mounts itself.
 *
 * Every request parameter is named `request` and encoded with the shared strict
 * schema from `call-index-wire.ts`; every result is parsed with the shared
 * allowlist projector, so the browser never accepts backends, tokens, raw
 * arguments/results or error stacks even if a Host tried to send them.
 *
 * @module dsh-thinking-guard/client/call-index-remote
 */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { ZodType } from 'zod'
import {
  callIndexCancelRequestSchema,
  callIndexDetailRequestSchema,
  callIndexListRequestSchema,
  callIndexReplySchema,
  callIndexStartRequestSchema,
  callIndexSummaryRequestSchema,
  type CallIndexReply,
} from '../usage/call-index-wire.ts'

export type { CallIndexReply } from '../usage/call-index-wire.ts'

/** Package owning the wire methods; must equal the Host contribution's package. */
export const CALL_INDEX_REMOTE_PACKAGE = 'dsh-thinking-guard'

/** Wire namespace; must equal `CALL_INDEX_HOST_FACE_NAMESPACE` on the Host. */
export const CALL_INDEX_REMOTE_NAMESPACE = 'callIndex'

function strictCodec(typeSymbol: string, schema: { parse(value: unknown): unknown }) {
  return { mode: 'strict' as const, typeSymbol, create: () => schema }
}

type RequestMode = 'none' | 'optional' | 'required'

interface WireMethod {
  readonly method: string
  readonly mode: RequestMode
  readonly schema?: ZodType
}

const METHODS: readonly WireMethod[] = [
  { method: 'getIndexStatus', mode: 'none' },
  { method: 'startIndex', mode: 'optional', schema: callIndexStartRequestSchema },
  { method: 'cancelIndex', mode: 'required', schema: callIndexCancelRequestSchema },
  { method: 'getSummary', mode: 'optional', schema: callIndexSummaryRequestSchema },
  { method: 'listSessions', mode: 'optional', schema: callIndexListRequestSchema },
  { method: 'listCalls', mode: 'optional', schema: callIndexListRequestSchema },
  { method: 'getCallDetail', mode: 'required', schema: callIndexDetailRequestSchema },
]

function parametersFor(spec: WireMethod) {
  if (spec.mode === 'none') return []
  const schema = spec.schema
  if (schema === undefined) throw new Error(`callIndex: no request schema for ${spec.method}`)
  const optional = spec.mode === 'optional'
  return [
    {
      name: 'request',
      wire: 'request',
      source: 'json' as const,
      ...(optional ? { acceptsUndefined: true as const } : {}),
      codec: strictCodec(optional ? 'request?' : 'request', optional ? schema.optional() : schema),
    },
  ]
}

/**
 * The result codec is the shared allowlist projector: `.parse` always returns a
 * projected {@link CallIndexReply}, degrading a malformed payload to
 * `internal-error` rather than failing the transport.
 */
const RESULT_CODEC = strictCodec('dsh-thinking-guard#CallIndexReply', callIndexReplySchema)

/** `'callIndex'` → `63616c6c496e646578`; the protocol's per-namespace key. */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$63616c6c496e646578 {
    getIndexStatus: () => Promise<RemoteResult<CallIndexReply>>
    startIndex: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    cancelIndex: (request: unknown) => Promise<RemoteResult<CallIndexReply>>
    getSummary: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    listSessions: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    listCalls: (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    getCallDetail: (request: unknown) => Promise<RemoteResult<CallIndexReply>>
  }
  interface TypertRemoteMap {
    'callIndex/getIndexStatus': () => Promise<RemoteResult<CallIndexReply>>
    'callIndex/startIndex': (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    'callIndex/cancelIndex': (request: unknown) => Promise<RemoteResult<CallIndexReply>>
    'callIndex/getSummary': (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    'callIndex/listSessions': (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    'callIndex/listCalls': (request?: unknown) => Promise<RemoteResult<CallIndexReply>>
    'callIndex/getCallDetail': (request: unknown) => Promise<RemoteResult<CallIndexReply>>
  }
  interface TypertRemoteNamespaceMap {
    callIndex: TypertRemoteNamespace$63616c6c496e646578
  }
}

export const CALL_INDEX_TYPERT_REMOTE: TypertRemoteContribution = {
  package: CALL_INDEX_REMOTE_PACKAGE,
  descriptors: METHODS.map((spec) => ({
    id: `${CALL_INDEX_REMOTE_PACKAGE}#${CALL_INDEX_REMOTE_NAMESPACE}/${spec.method}`,
    service: CALL_INDEX_REMOTE_NAMESPACE,
    namespace: CALL_INDEX_REMOTE_NAMESPACE,
    method: spec.method,
    invocation: { kind: 'direct' as const },
    parameters: parametersFor(spec),
    result: RESULT_CODEC,
    sourceLocation: { file: 'src/server/call-index-remote.ts', line: 1, column: 3 },
  })),
}

export default CALL_INDEX_TYPERT_REMOTE
