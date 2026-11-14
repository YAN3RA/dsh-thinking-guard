import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CallIndexRuntime } from '../usage/call-index-runtime.ts'
import { CALL_INDEX_HOST_FACE_NAMESPACE, CALL_INDEX_HOST_FACE_SERVICE, CALL_INDEX_RUNTIME_SERVICE } from '../usage/call-index-host-face.ts'
import { callIndexError, callIndexReply, type CallIndexReply } from '../usage/call-index-wire.ts'

/** No static inject: disabled/missing optional services must still have a reachable status face. */
export class CallIndexGateway extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, CALL_INDEX_HOST_FACE_SERVICE, { namespace: CALL_INDEX_HOST_FACE_NAMESPACE }) }
  private runtime(): CallIndexRuntime | undefined {
    try { return this.ctx.get(CALL_INDEX_RUNTIME_SERVICE) } catch { return undefined }
  }
  private call(method: 'getIndexStatus' | 'startIndex' | 'cancelIndex' | 'getSummary' | 'listSessions' | 'listCalls', request?: unknown): CallIndexReply {
    try {
      const runtime = this.runtime()
      if (!runtime) return callIndexError('runtime-unavailable')
      if (method === 'getIndexStatus') return callIndexReply(runtime.getIndexStatus())
      return callIndexReply(runtime[method](request))
    } catch { return callIndexError('internal-error') }
  }
  @Remote('getIndexStatus') getIndexStatus(): CallIndexReply { return this.call('getIndexStatus') }
  @Remote('startIndex') startIndex(request?: unknown): CallIndexReply { return this.call('startIndex', request) }
  @Remote('cancelIndex') cancelIndex(request: unknown): CallIndexReply { return this.call('cancelIndex', request) }
  @Remote('getSummary') getSummary(request?: unknown): CallIndexReply { return this.call('getSummary', request) }
  @Remote('listSessions') listSessions(request?: unknown): CallIndexReply { return this.call('listSessions', request) }
  @Remote('listCalls') listCalls(request?: unknown): CallIndexReply { return this.call('listCalls', request) }
  @Remote('getCallDetail') async getCallDetail(request: unknown): Promise<CallIndexReply> {
    try { return callIndexReply(await this.runtime()?.getCallDetail(request) ?? callIndexError('runtime-unavailable')) }
    catch { return callIndexError('internal-error') }
  }
}
