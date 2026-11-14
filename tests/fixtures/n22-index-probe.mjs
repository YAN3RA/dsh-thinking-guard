// Actual disposable-host N22 read pipeline. No model loop or production data.
import fs from 'node:fs/promises'
import path from 'node:path'
import { SessionCallIndex } from '../../lib/usage/session-index.js'
export const name = 'n22-index-probe'
export const inject = ['appReady', 'sessionPersistence']
export function apply(ctx) {
  ctx.get('appReady').onReady(async () => {
    const cfg = JSON.parse(process.env.N21_PROBE_CONFIG ?? '{}')
    const report = { scenario: cfg.scenario, assertions: [], modelLoopStarted: false, failedAssertions: 0 }
    const check = (name, pass) => report.assertions.push({ name, pass: Boolean(pass) })
    let index
    try {
      if (!cfg.report || !process.env.DSH_HOME || !path.resolve(process.env.DSH_HOME).startsWith(path.resolve(cfg.scratchRoot) + path.sep)) throw Error('scratch-only guard')
      const service = ctx.get('sessionPersistence')
      const counts = { list: 0, open: 0, closed: 0 }
      const backend = {
        get identity() { return service.identity },
        list: async options => { counts.list++; return service.list(options) },
        stat: (id, options) => service.stat(id, options),
        open: async (id, access, options) => {
          const h = await service.open(id, access, options)
          counts.open++
          let closed = false
          const close = async () => { await h.close(); if (!closed) counts.closed++; closed = true }
          return { id: h.id, header: h.header, inheritedEventCount: h.inheritedEventCount, access: h.access,
            read: (...args) => h.read(...args), close, append: (...args) => h.append(...args), flush: (...args) => h.flush(...args), [Symbol.asyncDispose]: close }
        },
      }
      let mode
      index = new SessionCallIndex({ getMode: () => mode, getBackend: () => backend, pageSize: 3 })
      const off = await index.start()
      check('default disabled does not list or open real history', off.scope.status === 'disabled' && counts.list === 0 && counts.open === 0)
      mode = 'host-visible'
      const first = await index.start()
      check('explicit host-visible reads both official service sessions', first.listedSessions === 2 && first.visibleSessions === 2)
      check('all real persisted calls paired by callId', first.totals.calls === 6 && first.totals.succeeded === 2 && first.totals.failed === 2 && first.totals.unresolved === 2)
      check('complete means this enumerated cut, not known source ownership', first.coverage === 'complete' && first.semanticCoverage.source === 'unknown')
      check('no raw payload leaked into index snapshots', !/synthetic-args|synthetic-success|synthetic-error|arguments|content|stream|backend/.test(JSON.stringify(first)))
      const opens = counts.open
      const unchanged = await index.start()
      check('unchanged incremental run does not reopen sessions', unchanged.totals.calls === 6 && counts.open === opens)
      mode = 'disabled'
      const hidden = await index.start()
      check('disable clears published rows and active-scope label', hidden.rows.length === 0 && hidden.scope.scope === undefined && hidden.scope.status === 'disabled')
      mode = 'host-visible'
      const restored = await index.start()
      check('reenable rebuilds with a new epoch, without duplicate calls', restored.scope.epoch > first.scope.epoch && restored.totals.calls === 6)
      check('all public read handles closed', counts.open === counts.closed)
      report.counts = counts
      report.index = first
      report.afterReenable = { scope: restored.scope, totals: restored.totals }
    } catch (error) {
      report.fatal = { code: 'runtime-probe-failed' }
      console.error('N22 scratch probe diagnostic', error)
    } finally {
      index?.dispose()
      report.failedAssertions = report.assertions.filter(row => !row.pass).length
      report.completed = true
      if (cfg.report) await fs.writeFile(cfg.report, JSON.stringify(report, null, 2))
    }
  })
}
