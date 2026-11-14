import type { Context } from '@deepseek-ai/cordis'
import { CallIndexGateway } from '../server/call-index-remote.ts'
import { CallIndexConfig, installCallIndexRuntime, type CallIndexRuntimeConfig } from './call-index-runtime.ts'
export const name = 'thinking-guard-call-index'
export const Config = CallIndexConfig
/** Lifecycle belongs to this plugin fiber; no production profile or Session writes. */
export function apply(ctx: Context, config: CallIndexRuntimeConfig = {}): void {
  if (ctx.get('callIndexRuntime') !== undefined) return
  const runtime = installCallIndexRuntime(ctx, config)
  ctx.provide('callIndexRuntime', runtime)
  ctx.plugin(CallIndexGateway)
}
