// Summarize actual scope-option experiments without promoting configured isolation to the default N21 gate.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = path.join(root, '03_Testing/n21-20261108')
const read = async relative => JSON.parse(await fs.readFile(path.join(evidence, relative), 'utf8'))
const reports = await Promise.all(['query-a', 'query-b', 'query-control'].map(n => read(`attempt-04/${n}.json`)))
const queryManifest = await read('attempt-04/query-manifest.json')
const explicitManifest = await read('attempt-05/explicit-isolation-manifest.json')
const configured = await Promise.all(['a-seed', 'b-seed-read-a', 'a-read-b', 'other-home-control'].map(n => read(`attempt-05/${n}.json`)))
const checks = []
const mark = (name, pass) => checks.push({ name, pass: Boolean(pass) })
const queryRows = []
for (const report of reports) {
  mark(`${report.scenario}: completed`, report.completed && !report.fatal && report.queryAudit?.available)
  for (const row of report.queryAudit.targets) {
    const foreign = row.own === false
    const shared = report.homeLabel === 'shared-home'
    if (shared || !foreign) {
      mark(`${report.scenario}:${row.sessionId}: exact and event reads valid`, row.idFilteredIds.includes(row.sessionId) && row.exactRead.allowed && row.exactRead.toolCallCount === 3 && row.exactEvent.allowed && row.exactEvent.type === 'tool/call')
    } else {
      mark(`${report.scenario}:${row.sessionId}: control unavailable`, row.idFilteredIds.length === 0 && !row.exactRead.allowed && !row.exactEvent.allowed)
    }
    if (foreign) queryRows.push({ profile: report.profile, homeLabel: report.homeLabel, sessionId: row.sessionId, idFilterReturnsTarget: row.idFilteredIds.includes(row.sessionId), exactReadAllowed: row.exactRead.allowed, exactEventAllowed: row.exactEvent.allowed, returnedEventCount: row.exactRead.eventCount, readErrorCode: row.exactRead.errorCode })
  }
  if (report.homeLabel === 'shared-home') mark(`${report.scenario}: cwd filter includes both profiles`, ['n21-session-a', 'n21-session-b'].every(id => report.queryAudit.cwdFilteredIds.includes(id)))
}
const configuredRows = []
for (const report of configured) {
  mark(`${report.scenario}: explicit fixture complete and all assertions pass`, report.completed && !report.fatal && report.failedAssertions === 0)
  for (const row of report.observations) {
    if (row.expectedOwn) mark(`${report.scenario}: explicit own reads valid`, row.inList && row.stat.found && row.open.allowed && row.read?.eventCount === 8 && row.read.seqContiguous && row.closedReadRejected)
    else configuredRows.push({ profile: report.profile, homeLabel: report.homeLabel, sessionId: row.sessionId, listed: row.inList, statFound: row.stat.found, openAllowed: row.open.allowed, errorCode: row.open.errorCode })
  }
}
mark('explicit-root foreign reads all NotFound', configuredRows.length === 4 && configuredRows.every(row => !row.listed && !row.statFound && !row.openAllowed && row.errorCode === 'SessionPersistenceNotFoundError'))
mark('explicit configuration is labeled rather than called default pass', explicitManifest.scopeMode === 'explicit-profile-roots' && explicitManifest.verdict === 'explicit-config-isolation-observed-not-default-gate-pass')
mark('all experiment children exited', queryManifest.remainingOwnedProcesses === 0 && explicitManifest.remainingOwnedProcesses === 0)
const valid = checks.every(check => check.pass)
const result = { schemaVersion: 1, executionValid: valid, checks, queryRows, configuredRows, strictDefaultProfileGate: 'fail', queryProvidesProfileIsolation: false, explicitRootExperiment: valid ? 'pass-config-only' : 'incomplete', scopeDecision: 'awaiting-user', n22MayStart: false, recoveryObservation: 'Query readSession returned 11 events while Persistence still returned its original 8; logical recovery must not be treated as new tool calls.' }
await fs.writeFile(path.join(evidence, 'scope-options-summary.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ executionValid: valid, checks: checks.length, queryRows, configuredRows, explicitRootExperiment: result.explicitRootExperiment, n22MayStart: false }))
process.exitCode = valid ? 0 : 1
