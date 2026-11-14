import { describe, expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionPersistenceRevision, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { SessionCallIndex } from '../src/usage/session-index.ts'
import type { CallIndexBackend } from '../src/usage/call-index-scope.ts'

/**
 * D-030 end-to-end: a backend that declares `eventCount: 1` for a log holding
 * thousands of events must still be fully indexed. The numbers here mirror the
 * real artifact measured on this machine (4009 events / 745 tool calls).
 */
describe('D-030 realistic corpus', () => {
  it('indexes a 4000-event log that declares one event', async () => {
    const session = Session.create(SessionId('big'))
    const events: SessionEvent[] = []
    for (let i = 0; i < 745; i++) {
      const callId = ToolCallId(`c${i}`)
      events.push(session.append('tool/call', { turn: 1, step: 1, callId, name: 'echo', arguments: '{}' }))
      events.push(session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'ok' }] }) }, { surfaceOp: 'append' }))
    }
    const backend: CallIndexBackend = {
      identity: Symbol('big'),
      list: async () => [{ header: session.header, revision: SessionPersistenceRevision('r1'), eventCount: 1 }],
      stat: async () => ({ header: session.header, revision: SessionPersistenceRevision('r1'), eventCount: 1 }),
      open: async (): Promise<SessionHandle> => ({
        id: session.id, header: session.header, inheritedEventCount: SessionLogOffset(0), access: 'read',
        read: async (offset = 0, length = 128) => {
          const start = Math.min(offset, events.length)
          const end = Math.min(start + length, events.length)
          return { eventState: 'detached', events: events.slice(start, end) }
        },
        append: async () => undefined, flush: async () => undefined, close: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      } as SessionHandle),
    }
    const index = new SessionCallIndex({ getMode: () => 'host-visible', getBackend: () => backend })
    const result = await index.start()

    // Every call is indexed even though the declaration said "1 event".
    expect(result.totals.calls).toBe(745)
    expect(result.rows).toHaveLength(745)
    expect([...result.reasons]).toContain('event-count-underreported')
  })
})
