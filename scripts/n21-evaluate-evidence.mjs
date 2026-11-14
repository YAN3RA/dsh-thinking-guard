// Independently evaluate actual disposable-host observations; never converts an isolation failure into pass.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const attempt = process.argv[2] ?? 'attempt-04'
if (!/^attempt-[0-9]{2}$/.test(attempt)) throw Error('Expected attempt-NN')
const dir = path.join(workspace, '03_Testing/n21-20261108', attempt)
const names = ['a-seed', 'b-seed-read-a', 'a-read-b', 'other-home-control']
const reports = await Promise.all(names.map(n => fs.readFile(path.join(dir, `${n}.json`), 'utf8').then(JSON.parse)))
const manifest = JSON.parse(await fs.readFile(path.join(dir, 'run-manifest.json'), 'utf8'))
const checks = []
const mark = (name, pass) => checks.push({ name, pass: Boolean(pass) })
const rows = []
for (const report of reports) {
  mark(`${report.scenario}: completed without fixture fatal`, report.completed && !report.fatal)
  mark(`${report.scenario}: handles closed`, report.cleanup.every(c => c.closed === true))
  for (const row of report.observations) {
    if (row.expectedOwn) {
      mark(`${report.scenario}: own list/stat/open/read`, row.inList && row.stat.found && row.open.allowed && row.read?.allowed)
      mark(`${report.scenario}: own valid pages and EOF`, row.read?.eventCount === 8 && row.read.seqContiguous && JSON.stringify(row.read.pages.map(p => p.length)) === '[3,3,2,0]')
      mark(`${report.scenario}: own call/result metadata`, JSON.stringify(row.calls?.map(c => c.outcome)) === '["success","error","unresolved"]' && row.calls.every(c => c.turn === 1 && c.step === 1 && c.toolName === 'n21_echo'))
      mark(`${report.scenario}: closed handle refuses read`, row.closedReadRejected === true && row.closedReadCode === 'SessionHandleClosedError')
    } else {
      rows.push({ scenario: report.scenario, profile: report.profile, homeLabel: report.homeLabel, sessionId: row.sessionId, listed: row.inList, statFound: row.stat?.found ?? false, openAllowed: row.open?.allowed ?? false, readAllowed: row.read?.allowed ?? false, eventCount: row.read?.eventCount ?? 0, errorCode: row.open?.errorCode })
    }
  }
}
const controls = rows.filter(r => r.homeLabel === 'control-home')
mark('different HOME control refuses foreign list/stat/open/read', controls.length === 2 && controls.every(r => !r.listed && !r.statFound && !r.openAllowed && !r.readAllowed && r.errorCode === 'SessionPersistenceNotFoundError'))
mark('all owned processes exited', manifest.remainingOwnedProcesses === 0 && manifest.processes.every(p => p.exitCode !== undefined || p.signal))
const foreign = rows.filter(r => r.homeLabel === 'shared-home')
const isolationChecks = foreign.map(r => ({ name: `${r.profile} cannot access ${r.sessionId}`, pass: !r.listed && !r.statFound && !r.openAllowed && !r.readAllowed }))
const executionValid = checks.every(c => c.pass) && foreign.length === 2
const gate = executionValid ? isolationChecks.every(c => c.pass) ? 'pass' : 'fail' : 'incomplete'
const summary = { schemaVersion: 1, attempt, environment: { dsh: '0.2.2-rc.1', sameHomeProfiles: ['n21-a', 'n21-b'], separateHomeControl: true }, executionValid, n21Gate: gate, n22MayStart: gate === 'pass', reason: gate === 'fail' ? 'same-home-profiles-share-public-persistence-corpus' : gate === 'incomplete' ? 'fixture-or-control-invalid' : 'scope-proven-for-tested-environment', checks, isolationChecks, matrix: rows, remainingOwnedProcesses: manifest.remainingOwnedProcesses, limitations: ['Public service trusted application API; this is not a model tool authorization test.', 'Query service presence observed; Query method semantics and live-only backfill not tested.', 'Service replacement was not tested; instance symbol is not used as an isolation proof.', 'No production Sessions or credentials copied; synthetic fixture records only.'] }
await fs.writeFile(path.join(dir, 'gate-summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ attempt, executionValid, checks: checks.length, n21Gate: gate, n22MayStart: summary.n22MayStart, matrix: rows }))
process.exitCode = gate === 'pass' ? 0 : gate === 'fail' ? 2 : 1
