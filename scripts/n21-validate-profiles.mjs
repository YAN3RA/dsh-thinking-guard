// Run only disposable profiles. No production package installation or model request.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const attempt = process.argv[2] ?? 'attempt-04'
const diagnostic = process.argv[3] === 'diagnostic'
const queryAudit = process.argv[3] === 'query'
const indexAudit = process.argv[3] === 'index'
const previewExisting = process.argv[3] === 'explicit-preview'
const explicitIsolation = process.argv[3] === 'explicit-isolation' || previewExisting
const indexTag = indexAudit && process.argv[4] ? process.argv[4] : ''
if (indexTag && !/^v[0-9]+$/.test(indexTag)) throw Error('Expected vN index evidence label')
const manifestName = indexAudit ? `index${indexTag ? '-' + indexTag : ''}-manifest.json` : previewExisting ? 'explicit-preview-manifest.json' : queryAudit ? 'query-manifest.json' : explicitIsolation ? 'explicit-isolation-manifest.json' : diagnostic ? 'diagnostic-manifest.json' : 'run-manifest.json'
if (!/^attempt-[0-9]{2}$/.test(attempt)) throw Error('Expected attempt-NN label')
const scratch = path.resolve(workspace, '99_Temporary_Area/n21-20261108', attempt)
const evidence = path.resolve(workspace, '03_Testing/n21-20261108', attempt)
// Discover the installed desktop app; a literal product-name path is fragile
// because this environment's display layer rewrites that name.
function findInstallation() {
  const base = path.join(process.env.LOCALAPPDATA, 'Programs')
  const preferred = [], fallback = []
  let entries = []
  try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { entries = [] }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(base, entry.name)
    if (!fs.existsSync(path.join(dir, 'resources/app.asar'))) continue
    const exe = fs.readdirSync(dir).find(file => /\.exe$/i.test(file) && !/^Uninstall/i.test(file))
    if (!exe) continue
    const layout = {
      dir,
      executable: path.join(dir, exe),
      hostPackage: path.join(dir, 'resources/app.asar/dsh/package.json'),
      cli: path.join(dir, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
    }
    if (fs.existsSync(path.join(dir, 'resources/runtime/cli/bin/dsh.cmd'))) preferred.push(layout)
    else fallback.push(layout)
  }
  const chosen = preferred[0] ?? fallback[0]
  if (!chosen) throw Error('no installed desktop app with resources/app.asar found')
  return chosen
}
const installation = findInstallation()
const { executable, hostPackage, cli } = installation
const fixture = path.join(workspace, indexAudit ? '01_Source_Code/tests/fixtures/n22-index-probe.mjs' : '01_Source_Code/tests/fixtures/n21-profile-probe.mjs').replaceAll('\\', '/')
const manifest = { schemaVersion: 1, startedAt: new Date().toISOString(), scratchOnly: true, scopeMode: explicitIsolation ? 'explicit-profile-roots' : 'default-home-corpus', queryAudit, stages: [], processes: [] }
const children = new Set()
const exists = p => fs.access(p).then(() => true, () => false)
const envFor = home => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'OFF', N21_HOST_PACKAGE: hostPackage })
async function launch(args, env, label, reportPath) {
  const rawLog = path.join(scratch, `${label}.raw.log`)
  const child = spawn(executable, ['--expose-internals', cli, ...args], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  children.add(child)
  const proc = { label, pid: child.pid, executable: path.basename(executable), dshHome: env.DSH_HOME, args: args.filter(a => !a.includes('token')) }
  manifest.processes.push(proc)
  const log = await fs.open(rawLog, 'wx')
  child.stdout.on('data', b => { void log.write(b).catch(() => {}) })
  child.stderr.on('data', b => { void log.write(b).catch(() => {}) })
  let ended = false
  const closed = new Promise(resolve => {
    child.once('error', error => { proc.errorCode = error.code; ended = true; resolve() })
    child.once('exit', (code, signal) => { proc.exitCode = code; proc.signal = signal; ended = true; children.delete(child); resolve() })
  })
  let deadlineHit = false
  const deadline = Date.now() + 60000
  try {
    while (!ended) {
      if (reportPath && await exists(reportPath)) {
        try { if (JSON.parse(await fs.readFile(reportPath, 'utf8')).completed) break } catch {}
      }
      if (Date.now() >= deadline) { deadlineHit = true; break }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    if (!ended) child.kill('SIGTERM')
    await closed
    if (deadlineHit) throw Error(`stage timeout: ${label}; inspect scratch raw log`)
    if (reportPath && !await exists(reportPath)) throw Error(`missing report: ${label}; inspect scratch raw log`)
    if (!reportPath && proc.exitCode !== 0) throw Error(`CLI stage failed: ${label}`)
  } finally { await log.close(); children.delete(child) }
  return proc
}
async function stage(name, profile, homeLabel, seedId, targets) {
  const home = path.join(scratch, homeLabel)
  const packagePath = path.join(home, 'profiles', profile, 'package.json')
  if (!await exists(packagePath)) await launch(['--profile', profile, '--from-default-profile', 'web', '--dump-config'], envFor(home), `${name}-init`)
  const reportPath = path.join(evidence, `${name}.json`)
  if (await exists(reportPath)) throw Error(`refuse overwriting prior evidence: ${name}`)
  const cfg = { scenario: name, profile, homeLabel, scratchRoot: scratch, seedId, targets, cwd: workspace, report: reportPath, queryAudit }
  const overlay = path.join(scratch, `${name}.patch.json`)
  await fs.writeFile(overlay, JSON.stringify([
    { id: 'session-title-llm', disabled: true },
    { id: 'desktop-product-telemetry', disabled: true },
    { id: 'product-analytics', disabled: true },
    ...(explicitIsolation ? [{ id: 'session-persistence-jsonl', config: { root: path.join(home, 'explicit-session-roots', profile) } }] : []),
    { insert: [{ id: 'n21-probe', name: fixture }] }
  ], null, 2), { flag: 'wx' })
  await launch(['--profile', profile, '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'], { ...envFor(home), N21_PROBE_CONFIG: JSON.stringify(cfg) }, name, reportPath)
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'))
  manifest.stages.push({ name, profile, homeLabel, file: `${name}.json`, fatal: report.fatal, failedAssertions: report.failedAssertions })
  await fs.writeFile(path.join(evidence, manifestName), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify(manifest.stages.at(-1)))
  if (report.fatal) throw Error(`fixture fatal: ${name}`)
}
// Guard outside try/finally: a refused rerun must not overwrite its prior manifest.
if (await exists(path.join(evidence, manifestName))) throw Error(`refuse replacing prior manifest: ${manifestName}`)
try {
  await fs.mkdir(scratch, { recursive: true }); await fs.mkdir(evidence, { recursive: true })
  if (indexAudit) {
    await stage(`index-audit${indexTag ? '-' + indexTag : ''}`, 'n21-a', 'shared-home', undefined, [])
  } else if (previewExisting) {
    await stage('explicit-root-preview-a', 'n21-a', 'shared-home', undefined, [{ id: 'n21-session-a', own: false }, { id: 'n21-session-b', own: false }])
  } else if (queryAudit) {
    await stage('query-a', 'n21-a', 'shared-home', undefined, [{ id: 'n21-session-a', own: true }, { id: 'n21-session-b', own: false }])
    await stage('query-b', 'n21-b', 'shared-home', undefined, [{ id: 'n21-session-b', own: true }, { id: 'n21-session-a', own: false }])
    await stage('query-control', 'n21-a', 'control-home', undefined, [{ id: 'n21-session-control', own: true }, { id: 'n21-session-a', own: false }, { id: 'n21-session-b', own: false }])
  } else if (diagnostic) {
    await stage('diagnostic-read', 'n21-a', 'shared-home', undefined, [{ id: 'n21-session-a', own: true }])
  } else {
  await stage('a-seed', 'n21-a', 'shared-home', 'n21-session-a', [{ id: 'n21-session-a', own: true }])
  await stage('b-seed-read-a', 'n21-b', 'shared-home', 'n21-session-b', [{ id: 'n21-session-b', own: true }, { id: 'n21-session-a', own: false }])
  await stage('a-read-b', 'n21-a', 'shared-home', undefined, [{ id: 'n21-session-a', own: true }, { id: 'n21-session-b', own: false }])
  await stage('other-home-control', 'n21-a', 'control-home', 'n21-session-control', [{ id: 'n21-session-control', own: true }, { id: 'n21-session-a', own: false }, { id: 'n21-session-b', own: false }])
  }
  manifest.verdict = manifest.stages.some(s => s.failedAssertions > 0) ? 'fail-profile-isolation' : explicitIsolation ? 'explicit-config-isolation-observed-not-default-gate-pass' : 'pass'
} catch (error) {
  manifest.executionError = String(error.message)
  manifest.verdict = 'incomplete'
  process.exitCode = 1
} finally {
  for (const child of children) child.kill('SIGTERM')
  manifest.finishedAt = new Date().toISOString()
  manifest.remainingOwnedProcesses = children.size
  await fs.writeFile(path.join(evidence, manifestName), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ verdict: manifest.verdict, executionError: manifest.executionError }))
}
