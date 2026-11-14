// Disposable-host fixture: writes only synthetic sessions below the supplied scratch HOME.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
export const name = 'n21-profile-probe'
export const inject = ['appReady', 'sessionPersistence']
export function apply(ctx) {
  ctx.get('appReady').onReady(async () => {
    const cfg = JSON.parse(process.env.N21_PROBE_CONFIG ?? '{}')
    const report = { schemaVersion: 1, scenario: cfg.scenario, profile: cfg.profile, homeLabel: cfg.homeLabel, modelRequestsIssuedByFixture: 0, modelLoopStarted: false, observations: [], cleanup: [], assertions: [] }
    const record = (name, pass, details = {}) => report.assertions.push({ name, pass: Boolean(pass), ...details })
    const code = e => typeof e?.code === 'string' ? e.code : e?.constructor?.name ?? 'unknown'
    const handles = new Set()
    const close = async h => { await h.close(); handles.delete(h); report.cleanup.push({ kind: 'read-or-write-handle', closed: true }) }
    try {
      if (!cfg.report || !cfg.scratchRoot || !process.env.DSH_HOME || !path.resolve(process.env.DSH_HOME).startsWith(path.resolve(cfg.scratchRoot) + path.sep)) throw Error('scratch-only HOME guard refused')
      const service = ctx.get('sessionPersistence')
      report.services = { persistence: Boolean(service), query: Boolean(ctx.get('sessionQuery')), identityIsSymbol: typeof service.identity === 'symbol', identityStableThroughGet: service.identity === ctx.get('sessionPersistence').identity }
      const req = createRequire(process.env.N21_HOST_PACKAGE)
      const sessionTypes = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-session')).href)
      const llmTypes = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-llm')).href)
      const makeResult = (callId, isError) => llmTypes.createToolResultMessage({ callId, isError, content: [{ type: 'text', text: isError ? 'synthetic-error' : 'synthetic-success' }] })
      const tick = 1794144000000
      if (cfg.seedId) {
        const header = { version: sessionTypes.SESSION_FORMAT_VERSION, id: cfg.seedId, createdAt: tick, cwd: cfg.cwd, isSeeded: false }
        const h = await service.create(header)
        handles.add(h)
        const blocks = [1, 2, 3].map(i => ({ type: 'tool-call', id: `${cfg.seedId}-c${i}`, name: 'n21_echo', arguments: i === 1 ? '{"canary":"synthetic-args"}' : '{}' }))
        const accumulator = new llmTypes.AssistantStreamAccumulator()
        for (const [index, block] of blocks.entries()) {
          accumulator.push({ time: tick, chunk: { type: 'block-start', index, blockType: 'tool-call' } })
          accumulator.push({ time: tick, chunk: { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments } })
          accumulator.push({ time: tick, chunk: { type: 'block-end', index, block } })
        }
        accumulator.push({ time: tick, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } })
        const assistant = llmTypes.createAssistantMessage({ content: blocks, source: { provider: 'n21-synthetic', model: 'no-network-fixture' } })
        const data = [
          ['turn/start', { turn: 1 }], ['step/start', { turn: 1, step: 1 }],
          ['assistant/message', { turn: 1, step: 1, message: assistant, stream: accumulator.snapshot() }],
          ['tool/call', { turn: 1, step: 1, callId: `${cfg.seedId}-c1`, name: 'n21_echo', arguments: '{"canary":"synthetic-args"}' }],
          ['tool/result', { turn: 1, step: 1, message: makeResult(`${cfg.seedId}-c1`, false) }],
          ['tool/call', { turn: 1, step: 1, callId: `${cfg.seedId}-c2`, name: 'n21_echo', arguments: '{}' }],
          ['tool/result', { turn: 1, step: 1, message: makeResult(`${cfg.seedId}-c2`, true), error: { name: 'SyntheticError', code: 'N21_SYNTHETIC_ERROR' } }],
          ['tool/call', { turn: 1, step: 1, callId: `${cfg.seedId}-c3`, name: 'n21_echo', arguments: '{}' }]
        ]
        const events = data.map(([type, value], seq) => ({ seq, time: tick + seq * 10, type, data: value, ...(type === 'tool/result' || type === 'assistant/message' ? { surfaceOp: 'append' } : {}) }))
        // Validate the real public Session contract before any backend append.
        sessionTypes.Session.create(cfg.seedId, events, header)
        await h.append(events)
        await h.flush()
        await close(h)
        report.seed = { id: cfg.seedId, eventCount: data.length, syntheticOnly: true }
      }
      if (cfg.queryAudit) {
        const query = ctx.get('sessionQuery')
        const audit = { available: Boolean(query), targets: [] }
        report.queryAudit = audit
        if (query) {
          audit.listedIds = (await query.listSessions()).map(row => row.header.id).sort()
          audit.cwdFilteredIds = (await query.filterSessions([{ kind: 'cwd', values: [cfg.cwd] }])).map(row => row.header.id).sort()
          for (const target of cfg.targets ?? []) {
            const row = { sessionId: target.id, own: target.own }
            row.idFilteredIds = (await query.filterSessions([{ kind: 'id', values: [target.id] }])).map(item => item.header.id)
            try {
              const log = await query.readSession(target.id)
              row.exactRead = { allowed: true, headerFields: Object.keys(log.session).sort(), eventCount: log.events.length, toolCallCount: log.events.filter(event => event.type === 'tool/call').length }
            } catch (error) { row.exactRead = { allowed: false, errorCode: code(error) } }
            try {
              const window = await query.readEvent({ sessionId: target.id, seq: 3, before: 0, after: 0 })
              row.exactEvent = { allowed: true, type: window.target.type, seq: window.target.seq }
            } catch (error) { row.exactEvent = { allowed: false, errorCode: code(error) } }
            audit.targets.push(row)
          }
        }
      }
      const listed = await service.list()
      report.listedIds = listed.map(x => x.header.id).sort()
      for (const target of cfg.targets ?? []) {
        const row = { sessionId: target.id, expectedOwn: target.own, inList: report.listedIds.includes(target.id) }
        try { const s = await service.stat(target.id); row.stat = { found: Boolean(s), eventCount: s?.eventCount, revisionPresent: s?.revision !== undefined } } catch (e) { row.stat = { errorCode: code(e) } }
        let h
        try {
          h = await service.open(target.id, 'read')
          handles.add(h)
          row.open = { allowed: true, access: h.access, inheritedEventCount: h.inheritedEventCount }
          const events = []
          const pages = []
          for (let offset = 0; offset < 32;) {
            const page = await h.read(offset, 3, { signal: AbortSignal.timeout(5000) })
            pages.push({ offset, length: page.events.length, seqs: page.events.map(e => e.seq), eventState: page.eventState })
            events.push(...page.events)
            offset += page.events.length
            if (page.events.length === 0) break
          }
          row.read = { allowed: true, pages, eventCount: events.length, seqContiguous: events.every((e, i) => e.seq === i) }
          // Only selected metadata leaves the host. No arguments, content, error reason or stack.
          row.calls = events.filter(e => e.type === 'tool/call').map(e => {
            const result = events.find(r => r.type === 'tool/result' && r.data.message.toolCallId === e.data.callId)
            return { sessionId: target.id, callSeq: e.seq, callId: e.data.callId, toolName: e.data.name, turn: e.data.turn, step: e.data.step, startedAt: e.time, resultSeq: result?.seq, outcome: result ? result.data.message.isError ? 'error' : 'success' : 'unresolved' }
          })
          await close(h)
          try { await h.read(0, 1); row.closedReadRejected = false } catch (e) { row.closedReadRejected = true; row.closedReadCode = code(e) }
        } catch (e) {
          // Scratch-only diagnostic. Never send full exception/stack in the metadata report.
          console.error('N21 synthetic public open/read diagnostic', target.id, e)
          row.open ??= { allowed: false, errorCode: code(e) }; if (h && handles.has(h)) await close(h)
        }
        report.observations.push(row)
        if (target.own) record(`own-readable:${target.id}`, row.inList && row.stat?.found && row.open?.allowed && row.read?.eventCount === 8 && row.read.seqContiguous)
        if (!target.own) record(`foreign-isolated:${target.id}`, !row.inList && row.stat?.found !== true && row.open?.allowed === false, { observedForeignReadable: row.read?.allowed === true })
      }
    } catch (e) { report.fatal = { code: code(e), message: String(e.message).slice(0, 240) } }
    finally {
      for (const h of handles) { try { await close(h) } catch (e) { report.cleanup.push({ closed: false, errorCode: code(e) }) } }
      report.failedAssertions = report.assertions.filter(a => !a.pass).length
      report.completed = true
      if (cfg.report) await fs.writeFile(cfg.report, JSON.stringify(report, null, 2))
    }
  })
}
