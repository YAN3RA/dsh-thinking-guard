/**
 * Host-face Typert contribution for the `callIndex` Remote namespace (N23).
 *
 * Same package as the existing `capabilityPolicy` / `usage` faces
 * (`dsh-thinking-guard`). It is exported as a face builder only and does NOT
 * register itself: the package root merges it with the other faces and calls
 * `ctx.typert.register()` exactly once (a second register for the same package
 * withdraws the first face's strict definitions — see `mergeHostFaces`).
 *
 * Every request parameter is validated with the shared strict schema from
 * `call-index-wire.ts` (the gateway decodes arguments with `codec.create().parse`),
 * and every result is projected through `callIndexReplySchema`, so raw backend
 * handles / tokens / arguments cannot leave the Host through this face.
 *
 * Wire shape mirrors `src/client/call-index-remote.ts`; the parity test
 * (`tests/call-index-face.spec.ts`) fails when the two tables drift.
 *
 * @module dsh-thinking-guard/usage/call-index-host-face
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ZodType } from 'zod'
import type { HostFaceCodec, HostFaceParameter, TypertHostFace } from '../host-face.ts'
import { HOST_FACE_PACKAGE } from '../host-face.ts'
import {
  callIndexCancelRequestSchema,
  callIndexDetailRequestSchema,
  callIndexListRequestSchema,
  callIndexReplySchema,
  callIndexStartRequestSchema,
  callIndexSummaryRequestSchema,
} from './call-index-wire.ts'

/** Package owning this face — must equal the manifest's registered package. */
export const CALL_INDEX_HOST_FACE_PACKAGE = HOST_FACE_PACKAGE

/** Wire namespace shared with the browser face. */
export const CALL_INDEX_HOST_FACE_NAMESPACE = 'callIndex'

/** Service key the gateway registers under (`super(ctx, 'callIndexGateway', …)`). */
export const CALL_INDEX_HOST_FACE_SERVICE = 'callIndexGateway'

/**
 * Optional Cordis key the call-index runtime installs under. Probed with
 * `ctx.get`; never a static inject, so a Host without the runtime still mounts
 * the gateway and answers a plain error reply.
 */
export const CALL_INDEX_RUNTIME_SERVICE = 'callIndexRuntime'

/**
 * The gateway's Remote surface: `[method, required wire fields, optional wire
 * fields]`, in the same order as the Host gateway and browser contribution.
 * Every wire parameter is named `request`.
 */
export const CALL_INDEX_WIRE_METHODS: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
  ['getIndexStatus', [], []],
  ['startIndex', [], ['request']],
  ['cancelIndex', ['request'], []],
  ['getSummary', [], ['request']],
  ['listSessions', [], ['request']],
  ['listCalls', [], ['request']],
  ['getCallDetail', ['request'], []],
]

const REQUEST_SCHEMAS: Readonly<Record<string, ZodType>> = {
  startIndex: callIndexStartRequestSchema,
  cancelIndex: callIndexCancelRequestSchema,
  getSummary: callIndexSummaryRequestSchema,
  listSessions: callIndexListRequestSchema,
  listCalls: callIndexListRequestSchema,
  getCallDetail: callIndexDetailRequestSchema,
}

function schemaCodec(typeSymbol: string, schema: { parse(value: unknown): unknown }): HostFaceCodec {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

function jsonParameter(wire: string, optional: boolean, schema: { parse(value: unknown): unknown }): HostFaceParameter {
  return {
    name: wire,
    wire,
    source: 'json',
    ...(optional ? { acceptsUndefined: true as const } : {}),
    codec: schemaCodec(wire, schema),
  }
}

function requestParameter(method: string, optional: boolean): HostFaceParameter {
  const schema = REQUEST_SCHEMAS[method]
  if (schema === undefined) throw new Error(`callIndex: no request schema for ${method}`)
  return jsonParameter('request', optional, optional ? schema.optional() : schema)
}

/** Build the host face for the `callIndex` namespace. */
export function callIndexHostFace(): TypertHostFace {
  const resultTypeSymbol = `${CALL_INDEX_HOST_FACE_PACKAGE}#${CALL_INDEX_HOST_FACE_NAMESPACE}:reply`
  return {
    package: CALL_INDEX_HOST_FACE_PACKAGE,
    face: 'host',
    schemas: [],
    invocations: CALL_INDEX_WIRE_METHODS.map(([method, required, optional]) => ({
      id: `${CALL_INDEX_HOST_FACE_PACKAGE}#${CALL_INDEX_HOST_FACE_NAMESPACE}/${method}`,
      service: CALL_INDEX_HOST_FACE_SERVICE,
      namespace: CALL_INDEX_HOST_FACE_NAMESPACE,
      method,
      invocation: { kind: 'direct' as const },
      parameters: [
        ...required.map(() => requestParameter(method, false)),
        ...optional.map(() => requestParameter(method, true)),
      ],
      result: schemaCodec(resultTypeSymbol, callIndexReplySchema),
    })),
    model: { services: [], events: [], objects: [] },
  }
}

/** Registration is intentionally left to the package root (see module note). */
export type CallIndexContext = Context
