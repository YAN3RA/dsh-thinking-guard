// Actual tarball + disposable profile + authenticated loopback RPC acceptance.
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const attempt = process.argv[2] ?? 'attempt-01'
if (!/^attempt-[0-9]{2}$/.test(attempt)) throw Error('Expected attempt-NN')
const scratch = path.join(workspace, '99_Temporary_Area/n23-20261109', attempt)
const evidence = path.join(workspace, '03_Testing/n23-20261109', attempt)
const home = path.join(scratch, 'home'), profile = 'n23-validation'
// Discover the installed desktop app instead of hard-coding its product name:
// the display layer in this environment rewrites that name, so a literal path is
// fragile and produced false "path missing" readings during handover.
function findInstall() {
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
      cliEntry: path.join(dir, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
    }
    const hasRuntime = fs.existsSync(path.join(dir, 'resources/runtime/cli/bin/dsh.cmd'))
    if (hasRuntime) preferred.push(layout)
    else fallback.push(layout)
  }
  const chosen = preferred[0] ?? fallback[0]
  if (!chosen) throw Error('no installed desktop app with resources/app.asar found')
  return chosen
}
const install = findInstall()
const { executable, hostPackage, cliEntry } = install
const npmEntry = path.join(process.env.ProgramFiles, 'nodejs/node_modules/npm/bin/npm-cli.js')
const report = { schemaVersion: 1, scope: 'D-026 host-visible', assertions: [], rpc: [], processes: [], productionModified: false, modelLoopStarted: false }
const active = new Set()
const exists = p => fs.access(p).then(() => true, () => false)
const mark = (name, pass) => report.assertions.push({ name, pass: Boolean(pass) })
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'OFF', N23_HOST_PACKAGE: hostPackage }
async function save() { await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)) }
async function launch(exe, args, label, childEnv = env, cwd = workspace) {
  const log = createWriteStream(path.join(scratch, `${label}.raw.log`), { flags: 'wx' })
  await new Promise((resolve, reject) => { log.once('open', resolve); log.once('error', reject) })
  const child = spawn(exe, args, { cwd, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  active.add(child)
  const row = { label, pid: child.pid, executable: path.basename(exe), dshHome: childEnv.DSH_HOME }
  report.processes.push(row)
  let output = '', url, ended = false
  const receive = bytes => {
    log.write(bytes)
    output = (output + bytes.toString()).slice(-1024 * 1024)
    if (!url) url = output.replace(/\x1b\[[0-9;]*m/g, '').match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)?.[1]
  }
  child.stdout.on('data', receive); child.stderr.on('data', receive)
  const closed = new Promise(resolve => {
    child.once('error', error => { row.errorCode = error.code })
    child.once('close', (code, signal) => {
      row.exitCode = code; row.signal = signal; ended = true; active.delete(child)
      log.end(resolve)
    })
  })
  return { child, row, closed, output: () => output, url: () => url, ended: () => ended }
}
async function waitFor(predicate, proc, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (true) {
    const value = await predicate()
    if (value) return value
    if (proc?.ended()) throw Error('test child exited before readiness')
    if (Date.now() >= deadline) throw Error('test readiness deadline')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
async function stop(proc) { if (!proc.ended()) proc.child.kill('SIGTERM'); await proc.closed }
async function stopAll() {
  await Promise.all([...active].map(child => new Promise(resolve => { child.once('close', resolve); child.kill('SIGTERM') })))
}
async function oneShot(args, label) {
  const proc = await launch(executable, ['--expose-internals', cliEntry, ...args], label)
  const deadline = setTimeout(() => proc.child.kill('SIGTERM'), 180000)
  deadline.unref?.()
  await proc.closed
  clearTimeout(deadline)
  if (proc.row.exitCode !== 0) throw Error(`CLI failed: ${label}`)
  return proc.output()
}
async function client(url) {
  const landing = new URL(url)
  if (landing.hostname !== '127.0.0.1') throw Error('loopback-only')
  let cookies = '', next = landing
  for (let i = 0; i < 5; i++) {
    const response = await fetch(next, { redirect: 'manual', headers: cookies ? { cookie: cookies } : {} })
    const set = response.headers.getSetCookie?.() ?? []
    if (set.length) cookies = set.map(value => value.split(';')[0]).join('; ')
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (response.status < 300 || response.status >= 400 || !location) break
    next = new URL(location, landing)
    if (next.origin !== landing.origin) throw Error('external redirect refused')
  }
  const headers = { 'Content-Type': 'application/json', ...(cookies ? { cookie: cookies } : {}), Authorization: `Bearer ${landing.searchParams.get('token')}` }
  return {
    async home() { const r = await fetch(landing.origin + '/', { headers }); await r.body?.cancel(); return r.status },
    async rpc(method, args = {}) {
      const response = await fetch(`${landing.origin}/api/${method}`, { method: 'POST', headers, body: JSON.stringify({ type: 'client-request', rpcId: `n23-${report.rpc.length}`, method, payload: { args } }) })
      const text = await response.text()
      mark(`privacy:${method}:${report.rpc.length}`, !/N23_PRIVATE_ARGS|N23_PRIVATE_OUTPUT|N23_PRIVATE_REASON/.test(text))
      let message
      try { message = JSON.parse(text) } catch { message = {} }
      const transport = message.result
      const value = transport?.ok === true ? transport.value : undefined
      report.rpc.push({ method, http: response.status, transportOk: transport?.ok === true, businessOk: value?.ok, kind: value?.kind, reason: value?.reason, transportErrorCode: transport?.error?.code })
      return { http: response.status, transportOk: transport?.ok === true, value }
    },
  }
}
async function boot(stage, scope, withProbe = true) {
  const control = path.join(scratch, `control-${stage}`)
  await fs.mkdir(control, { recursive: true })
  const ready = path.join(control, 'ready.json')
  const overlay = [
    { id: 'session-title-llm', disabled: true }, { id: 'desktop-product-telemetry', disabled: true }, { id: 'product-analytics', disabled: true },
    { id: 'skill-filesystem', config: { dshHome: home, agentsHome: path.join(home, 'agents'), watch: false } },
  ]
  if (withProbe) overlay.push(
    { id: 'thinking-guard', config: { callIndex: { scope, liveDebounceMs: 5 } } },
    { id: 'capability-menu-policy', config: { patchFile: path.join(home, 'cordis.patch.yml'), skillsDir: path.join(home, 'skills'), stateFile: path.join(home, 'capability-menu-policy.json') } },
    { id: 'capability-menu-registry', config: { stateFile: path.join(home, 'capability-menu-policy.json') } },
    { insert: [{ id: 'n23-probe', name: path.join(workspace, '01_Source_Code/tests/fixtures/n23-host-probe.mjs').replaceAll('\\', '/') }] },
  )
  const patch = path.join(scratch, `${stage}.patch.json`)
  await fs.writeFile(patch, JSON.stringify(overlay, null, 2), { flag: 'wx' })
  const cfg = { stage, scratchRoot: scratch, project: workspace, ready, control }
  const proc = await launch(executable, ['--expose-internals', cliEntry, '--profile', profile, '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'], stage, { ...env, N23_PROBE_CONFIG: JSON.stringify(cfg) })
  await waitFor(() => proc.url(), proc)
  if (withProbe) {
    await waitFor(() => exists(ready), proc)
    const state = JSON.parse(await fs.readFile(ready, 'utf8'))
    if (state.fatal) throw Error(`probe failed: ${stage}`)
  }
  const http = await client(proc.url())
  return { ...http, proc, async control(action, seq) {
    await fs.writeFile(path.join(control, 'command.json'), JSON.stringify({ action, seq }))
    const ack = path.join(control, `ack-${seq}.json`)
    await waitFor(() => exists(ack), proc)
    const value = JSON.parse(await fs.readFile(ack, 'utf8'))
    if (!value.ok) throw Error('probe control failed')
    return value
  } }
}
if (await exists(path.join(evidence, 'report.json'))) throw Error('refuse overwriting N23 evidence')
let installed = false
try {
  await fs.mkdir(scratch, { recursive: true }); await fs.mkdir(evidence, { recursive: true })
  const packed = await launch(process.execPath, [npmEntry, 'pack', '--json', '--ignore-scripts', '--pack-destination', scratch], 'pack', { ...process.env }, path.join(workspace, '01_Source_Code'))
  await packed.closed
  if (packed.row.exitCode !== 0) throw Error('pack failed')
  const raw = JSON.parse(packed.output())
  const info = Array.isArray(raw) ? raw[0] : raw.filename ? raw : Object.values(raw)[0]
  if (!info?.filename || !Array.isArray(info.files)) throw Error('unexpected pack JSON')
  const tarball = path.join(scratch, info.filename)
  report.package = { version: info.version, files: info.files.length, sha256: createHash('sha256').update(await fs.readFile(tarball)).digest('hex') }
  await fs.writeFile(path.join(evidence, 'package.json'), JSON.stringify(report.package, null, 2))
  await oneShot(['--profile', profile, '--from-default-profile', 'web', '--dump-config'], 'init')
  await oneShot(['plugin', '--profile', profile, 'add', tarball, '--ignore-scripts'], 'install')
  const manifest = JSON.parse(await fs.readFile(path.join(home, 'profiles', profile, 'package.json'), 'utf8'))
  installed = Boolean(manifest.dependencies?.['dsh-thinking-guard'])
  mark('actual tarball dependency and bundle registered', installed && manifest.dsh?.profile?.bundles?.includes('dsh-thinking-guard'))
  if (!installed) throw Error('package not installed')
  const disabled = await boot('disabled', 'disabled')
  mark('disabled homepage authenticated', await disabled.home() === 200)
  const disabledStatus = await disabled.rpc('callIndex/getIndexStatus')
  mark('formal disabled status route resolves', disabledStatus.http === 200 && disabledStatus.transportOk && disabledStatus.value?.data?.scope?.status === 'disabled')
  mark('disabled history start rejected', (await disabled.rpc('callIndex/startIndex', { request: { mode: 'full' } })).value?.reason === 'scope-disabled')
  mark('disabled list rejected', (await disabled.rpc('callIndex/listCalls')).value?.reason === 'scope-disabled')
  for (const method of ['capabilityPolicy/getConfig', 'usage/getSnapshot']) mark(`legacy route preserved:${method}`, (await disabled.rpc(method)).transportOk)
  await stop(disabled.proc)
  const enabled = await boot('enabled', 'host-visible')
  const started = await enabled.rpc('callIndex/startIndex', { request: { mode: 'full' } })
  mark('formal history task started', started.value?.ok === true && typeof started.value?.data?.taskId === 'string')
  if (!started.value?.ok) throw Error('formal history task did not start')
  const final = await waitFor(async () => {
    const status = await enabled.rpc('callIndex/getIndexStatus')
    return typeof status.value?.data?.task?.phase === 'string' && status.value.data.task.phase !== 'running' ? status.value : undefined
  }, enabled.proc)
  mark('installed Host indexes six persisted calls', final?.data?.totals?.calls === 6 && final?.data?.coverage === 'complete')
  const page = (await enabled.rpc('callIndex/listCalls', { request: { limit: 1 } })).value
  const snapshotId = page?.data?.snapshotId, cursor = page?.data?.nextCursor
  mark('bounded first page and full total', page?.ok && page.data.items.length === 1 && page.data.total === 6 && typeof cursor === 'string')
  const summary = (await enabled.rpc('callIndex/getSummary', { request: { snapshotId } })).value
  mark('summary shares the selected generation and total', summary?.data?.generation === page?.data?.generation && summary?.data?.total === 6)
  const sessions = (await enabled.rpc('callIndex/listSessions', { request: { snapshotId, limit: 1 } })).value
  mark('Session page shares generation with bounded rows and the correct Session total', sessions?.ok && sessions.data.generation === page.data.generation && sessions.data.total === 2 && sessions.data.items.length === 1)
  const second = (await enabled.rpc('callIndex/listCalls', { request: { cursor, limit: 1 } })).value
  const repeated = (await enabled.rpc('callIndex/listCalls', { request: { cursor, limit: 1 } })).value
  mark('cursor replay stable without page drift', JSON.stringify(second?.data?.items) === JSON.stringify(repeated?.data?.items))
  const first = page?.data?.items?.[0]
  const detail = (await enabled.rpc('callIndex/getCallDetail', { request: { snapshotId, sessionId: first?.sessionId, callSeq: first?.callSeq } })).value
  mark('indexed detail uses real visibility check', detail?.ok && detail.data.detail.callId === first.callId)
  mark('arbitrary session detail denied', (await enabled.rpc('callIndex/getCallDetail', { request: { snapshotId, sessionId: '../not-in-index', callSeq: 0 } })).value?.ok === false)
  const invalid = await enabled.rpc('callIndex/listCalls', { request: { limit: 201, arguments: 'N23_PRIVATE_ARGS' } })
  mark('strict invalid request rejected without secret echo', !invalid.transportOk || invalid.value?.ok === false)
  await enabled.control('emit-live', 1)
  const frozen = (await enabled.rpc('callIndex/listCalls', { request: { cursor, limit: 1 } })).value
  mark('live update preserves frozen total and reports freshness', frozen?.data?.total === 6 && frozen.data.hasUpdates === true)
  const fresh = (await enabled.rpc('callIndex/listCalls')).value
  mark('new view sees live-only call without losing prior history', fresh?.data?.total === 7)
  const controlTask = (await enabled.rpc('callIndex/startIndex', { request: { mode: 'full' } })).value
  mark('old cursor invalidated by explicit rescan', (await enabled.rpc('callIndex/listCalls', { request: { cursor } })).value?.reason === 'cursor-stale')
  mark('wrong task cancellation rejected', (await enabled.rpc('callIndex/cancelIndex', { request: { taskId: 'wrong' } })).value?.reason === 'task-not-found')
  mark('matching task cancellation accepted', (await enabled.rpc('callIndex/cancelIndex', { request: { taskId: controlTask?.data?.taskId } })).value?.ok === true)
  await enabled.control('dispose-runtime', 2)
  mark('disposed runtime no longer serves cached data', (await enabled.rpc('callIndex/listCalls', { request: { snapshotId } })).value?.reason === 'runtime-unavailable')
  await stop(enabled.proc)
} catch (error) {
  report.fatal = { reason: String(error.message).slice(0, 160) }
} finally {
  await stopAll()
  // An install can fail after changing its disposable manifest; inspect partial effects before rollback.
  try {
    const partial = JSON.parse(await fs.readFile(path.join(home, 'profiles', profile, 'package.json'), 'utf8'))
    installed ||= Boolean(partial.dependencies?.['dsh-thinking-guard']) || partial.dsh?.profile?.bundles?.includes('dsh-thinking-guard') === true
  } catch { /* Initialization may not have reached manifest creation. */ }
  if (installed) {
    try {
      await oneShot(['plugin', '--profile', profile, 'remove', 'dsh-thinking-guard'], 'uninstall')
      const manifest = JSON.parse(await fs.readFile(path.join(home, 'profiles', profile, 'package.json'), 'utf8'))
      mark('dependency and bundle removed on rollback', !manifest.dependencies?.['dsh-thinking-guard'] && !manifest.dsh?.profile?.bundles?.includes('dsh-thinking-guard'))
      const baseline = await boot('rollback', 'disabled', false)
      mark('baseline homepage works after rollback', await baseline.home() === 200)
      mark('removed Remote is absent after cold restart', (await baseline.rpc('callIndex/getIndexStatus')).http === 404)
      await stop(baseline.proc)
    } catch { report.cleanupError = 'isolated-rollback-failed' }
  }
  await stopAll()
  report.failedAssertions = report.assertions.filter(row => !row.pass).length
  report.remainingOwnedProcesses = active.size
  report.verdict = report.fatal || report.cleanupError || report.failedAssertions || report.remainingOwnedProcesses ? 'fail' : 'pass'
  await save()
  console.log(JSON.stringify({ verdict: report.verdict, failedAssertions: report.failedAssertions, fatal: report.fatal, cleanupError: report.cleanupError, assertions: report.assertions.length }))
  process.exitCode = report.verdict === 'pass' ? 0 : 1
}
