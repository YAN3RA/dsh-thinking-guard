// One-shot probe inside an actually installed disposable profile. No model loop.
import fs from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
export const name = 'n23-host-probe'
export const inject = ['appReady', 'sessionPersistence', 'sessions']
export function apply(ctx) {
  let watcher, timer
  let busy = false, last = 0
  ctx.effect(() => () => { watcher?.close(); if (timer) clearTimeout(timer) })
  ctx.get('appReady').onReady(async () => {
    const cfg = JSON.parse(process.env.N23_PROBE_CONFIG ?? '{}')
    try {
      if (!cfg.scratchRoot || !process.env.DSH_HOME || !path.resolve(process.env.DSH_HOME).startsWith(path.resolve(cfg.scratchRoot) + path.sep)) throw Error('scratch-only HOME required')
      const load = createRequire(process.env.N23_HOST_PACKAGE)
      const sessionApi = await import(pathToFileURL(load.resolve('@deepseek-ai/dsh-session')).href)
      const llm = await import(pathToFileURL(load.resolve('@deepseek-ai/dsh-llm')).href)
      const runtime = ctx.get('callIndexRuntime')
      if (!runtime) throw Error('installed root did not provide callIndexRuntime')
      const build = (id, count = 3) => {
        const tick = Date.now() - 1000
        const blocks = Array.from({ length: count }, (_, i) => ({ type: 'tool-call', id: `${id}-c${i}`, name: 'n23_echo', arguments: '{"canary":"N23_PRIVATE_ARGS"}' }))
        const stream = new llm.AssistantStreamAccumulator()
        for (const [index, block] of blocks.entries()) {
          stream.push({ time: tick, chunk: { type: 'block-start', index, blockType: 'tool-call' } })
          stream.push({ time: tick, chunk: { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments } })
          stream.push({ time: tick, chunk: { type: 'block-end', index, block } })
        }
        stream.push({ time: tick, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } })
        const rows = [
          ['turn/start', { turn: 1 }], ['step/start', { turn: 1, step: 1 }],
          ['assistant/message', { turn: 1, step: 1, message: llm.createAssistantMessage({ content: blocks, source: { provider: 'n23-synthetic', model: 'no-network' } }), stream: stream.snapshot() }],
        ]
        for (const [index, block] of blocks.entries()) {
          rows.push(['tool/call', { turn: 1, step: 1, callId: block.id, name: block.name, arguments: block.arguments }])
          if (count > 1 && index === count - 1) continue
          const isError = index === 1
          rows.push(['tool/result', { turn: 1, step: 1, message: llm.createToolResultMessage({ callId: block.id, isError, content: [{ type: 'text', text: 'N23_PRIVATE_OUTPUT' }] }), ...(isError ? { error: { name: 'Synthetic', code: 'N23_SYNTHETIC_ERROR', reason: 'N23_PRIVATE_REASON' } } : {}) }])
        }
        return { tick, rows }
      }
      for (const id of ['n23-history-a', 'n23-history-b']) {
        if (await ctx.sessionPersistence.stat(id)) continue
        const { tick, rows } = build(id)
        const header = { version: sessionApi.SESSION_FORMAT_VERSION, id, createdAt: tick, cwd: cfg.project, isSeeded: false }
        const h = await ctx.sessionPersistence.create(header)
        try {
          const events = rows.map(([type, data], seq) => ({ seq, time: tick + seq * 10, type, data, ...(['assistant/message', 'tool/result'].includes(type) ? { surfaceOp: 'append' } : {}) }))
          sessionApi.Session.create(id, events, header)
          await h.append(events); await h.flush()
        } finally { await h.close() }
      }
      await fs.mkdir(cfg.control, { recursive: true })
      const runControl = async () => {
        if (busy) return
        busy = true
        try {
          const command = JSON.parse(await fs.readFile(path.join(cfg.control, 'command.json'), 'utf8'))
          if (!Number.isSafeInteger(command.seq) || command.seq <= last) return
          last = command.seq
          const ack = { seq: last, action: command.action, ok: true }
          if (command.action === 'emit-live') {
            const id = 'n23-live'
            const session = ctx.sessions.create(sessionApi.SessionId(id), { meta: { cwd: cfg.project } })
            const { rows } = build(id, 1)
            for (const [type, data] of rows) {
              if (type === 'assistant/message' || type === 'tool/result') session.append(type, data, { surfaceOp: 'append' })
              else session.append(type, data)
            }
            const deadline = Date.now() + 5000
            while (true) {
              const status = runtime.getIndexStatus()
              if (status.ok && status.data?.pendingLive === 0 && status.data?.totals?.calls >= 7) break
              if (Date.now() >= deadline) throw Error('live projection deadline')
              await new Promise(resolve => setTimeout(resolve, 20))
            }
            ack.liveSession = id
          } else if (command.action === 'dispose-runtime') {
            await runtime.dispose()
            watcher?.close(); if (timer) clearTimeout(timer)
          } else throw Error('unsupported probe control')
          await fs.writeFile(path.join(cfg.control, `ack-${last}.json`), JSON.stringify(ack))
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            console.error('N23 scratch control diagnostic', error)
            await fs.writeFile(path.join(cfg.control, `ack-${last}.json`), JSON.stringify({ seq: last, ok: false, reason: 'probe-control-failed' }))
          }
        } finally { busy = false }
      }
      watcher = watch(cfg.control, () => { void runControl() })
      timer = setTimeout(() => { watcher?.close() }, 120000)
      timer.unref?.()
      await fs.writeFile(cfg.ready, JSON.stringify({ completed: true, stage: cfg.stage, runtimeProvided: true, seededSessions: 2, modelLoopStarted: false }))
    } catch (error) {
      console.error('N23 scratch startup diagnostic', error)
      if (cfg.ready) await fs.writeFile(cfg.ready, JSON.stringify({ completed: true, fatal: 'host-probe-startup-failed' }))
    }
  })
}
