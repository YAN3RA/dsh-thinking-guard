#!/usr/bin/env node
// Release CI smoke: install the packaged plugin into a throwaway DSH host and
// prove it loads. Isolated HOME/DSH_HOME, loopback random port, no model
// requests, no production profile. Child output is written to log files and
// never echoed, so host session tokens and env values stay out of CI output.
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROBE_PATH = path.join(HERE, 'release-ci-smoke-probe.mjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseArgs(argv) {
  const out = { timeoutMs: 180000 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new Error('missing value for ' + arg)
      i += 1
      return next
    }
    if (arg === '--host-version') out.hostVersion = value()
    else if (arg === '--tarball') out.tarball = value()
    else if (arg === '--dsh-root') out.dshRoot = value()
    else if (arg === '--work-dir') out.workDir = value()
    else if (arg === '--timeout-ms') out.timeoutMs = Number(value())
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error('unknown argument: ' + arg)
  }
  return out
}

function usage() {
  console.log('usage: node scripts/release-ci-smoke.mjs --tarball <file> (--host-version <v> | --dsh-root <dsh-pkg-dir>) [--work-dir <dir>] [--timeout-ms <n>]')
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function scrub(text) {
  return String(text)
    .replace(/token=[^&\s"']+/gi, 'token=<redacted>')
    .replace(/("?token"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,})\b/g, '<redacted>')
}

function buildEnv(extra) {
  const keep = new Set([
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'COMSPEC',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'HOME', 'USERPROFILE',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TERM', 'SHELL', 'CI',
  ])
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    // Never forward anything that looks like a credential to child processes.
    if (/secret|token|password|passwd|api[_-]?key|credential|private[_-]?key/i.test(key)) continue
    if (keep.has(key) || /^(npm_config_|pnpm_|node_|dsh_|xdg_)/i.test(key)) env[key] = value
  }
  return Object.assign(env, extra)
}

function npmEntry() {
  const nodeDir = path.dirname(process.execPath)
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return { cmd: process.execPath, args: [process.env.npm_execpath], shell: false }
  }
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { cmd: process.execPath, args: [candidate], shell: false }
  }
  return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [], shell: process.platform === 'win32' }
}

function runLogged(label, entry, args, options) {
  const logPath = path.join(options.logDir, label + '.log')
  const fd = fs.openSync(logPath, 'a')
  const started = Date.now()
  let result
  try {
    result = spawnSync(entry.cmd, entry.args.concat(args), {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', fd, fd],
      timeout: options.timeoutMs || 300000,
      windowsHide: true,
      shell: Boolean(entry.shell),
    })
  } finally {
    fs.closeSync(fd)
  }
  return { status: result.status, signal: result.signal, error: result.error, logPath, ms: Date.now() - started }
}

function findPluginDir(profileDir, homeDir) {
  const candidates = [
    path.join(profileDir, 'node_modules', 'dsh-thinking-guard'),
    path.join(homeDir, 'node_modules', 'dsh-thinking-guard'),
    path.join(profileDir, '..', 'node_modules', 'dsh-thinking-guard'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  return null
}

function versionFromTarballName(file) {
  const match = /dsh-thinking-guard-(.+)\.tgz$/.exec(path.basename(file))
  return match ? match[1] : null
}

function printSummary(summary) {
  const printable = {
    ok: summary.ok,
    hostRequested: summary.hostRequested,
    hostInstalled: summary.hostInstalled,
    pluginVersion: summary.pluginVersion,
    tarball: path.basename(summary.tarball),
    tarballSha256: summary.tarballSha256,
    checks: summary.result ? summary.result.checks : null,
    errors: summary.result ? summary.result.errors : summary.errors,
    workDir: summary.workDir,
  }
  console.log('[release-ci-smoke] ' + JSON.stringify(printable))
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try { child.kill('SIGTERM') } catch {}
  for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i += 1) await sleep(100)
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL') } catch {}
  }
}

// Read only the loopback port from the host banner; the accompanying session
// token is never printed or returned.
function portFromHostLog(logPath) {
  try {
    const match = /127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(logPath, 'utf8'))
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

// Scrub the session token out of the captured host log before it is left on
// disk. The token is ephemeral and only ever belongs to this throwaway host.
function scrubFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const redacted = text.replace(/token=[^&\s"\']+/gi, 'token=<redacted>')
    if (redacted !== text) fs.writeFileSync(file, redacted)
  } catch {}
}

// true = nothing accepts connections on the port. Anything else (still open or
// indeterminate within the timeout) is treated as not closed.
function portClosed(port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let settled = false
    const settle = (closed) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(closed)
    }
    socket.once('connect', () => settle(false))
    socket.once('error', () => settle(true))
    socket.setTimeout(timeoutMs, () => settle(true))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return 0 }
  if (!args.tarball) throw new Error('--tarball is required')
  if (!args.dshRoot && !args.hostVersion) throw new Error('--host-version (or --dsh-root) is required')
  if (!fs.existsSync(PROBE_PATH)) throw new Error('probe script missing: ' + PROBE_PATH)
  const tarball = path.resolve(args.tarball)
  if (!fs.existsSync(tarball)) throw new Error('tarball not found: ' + tarball)

  const workBase = args.workDir ? path.resolve(args.workDir) : os.tmpdir()
  fs.mkdirSync(workBase, { recursive: true })
  // Always allocate a fresh run directory. A pre-existing --work-dir is only a
  // parent container: stale profiles, locks or policy journals must never be
  // trusted or reused, so the smoke never derives validity from old state.
  const workDir = fs.mkdtempSync(path.join(workBase, 'release-ci-smoke-run-'))
  const logDir = path.join(workDir, 'logs'); fs.mkdirSync(logDir, { recursive: true })
  const homeDir = path.join(workDir, 'home'); fs.mkdirSync(homeDir, { recursive: true })
  const env = buildEnv({
    DSH_HOME: homeDir,
    HOME: homeDir,
    USERPROFILE: homeDir,
    DSH_TELEMETRY_DISABLED: '1',
    CI: 'true',
    NO_COLOR: '1',
    npm_config_cache: path.join(workDir, 'npm-cache'),
    npm_config_store_dir: path.join(workDir, 'pnpm-store'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    PNPM_HOME: path.join(workDir, 'pnpm-home'),
  })

  const summary = {
    ok: false,
    hostRequested: args.hostVersion || null,
    hostInstalled: null,
    pluginVersion: null,
    tarball,
    tarballSha256: sha256File(tarball),
    workDir,
    steps: [],
    result: null,
    errors: [],
  }

  const fail = (message, step) => {
    summary.ok = false
    summary.errors.push(message + (step ? ' (exit ' + step.status + ')' : ''))
    printSummary(summary)
    return 1
  };

  let dshPkgDir
  if (args.dshRoot) {
    dshPkgDir = path.resolve(args.dshRoot)
    if (!fs.existsSync(path.join(dshPkgDir, 'lib', 'bin.js'))) return fail('--dsh-root does not contain lib/bin.js')
  } else {
    const prefix = path.join(workDir, 'dsh')
    fs.mkdirSync(prefix, { recursive: true })
    fs.writeFileSync(path.join(prefix, 'package.json'), JSON.stringify({ name: 'release-ci-smoke-host', private: true }, null, 2) + '\n')
    const install = runLogged(
      'npm-install',
      npmEntry(),
      ['install', '@deepseek-ai/dsh@' + args.hostVersion, '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel=error'],
      { cwd: workDir, env, logDir, timeoutMs: 600000 },
    )
    summary.steps.push({ step: 'npm-install', status: install.status, ms: install.ms, log: path.relative(workDir, install.logPath) })
    if (install.status !== 0) return fail('npm install @deepseek-ai/dsh@' + args.hostVersion + ' failed', install)
    dshPkgDir = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh')
  }

  const dshPkg = readJson(path.join(dshPkgDir, 'package.json'))
  if (!dshPkg || !dshPkg.version) return fail('cannot read installed dsh package version')
  summary.hostInstalled = dshPkg.version
  if (args.hostVersion && dshPkg.version !== args.hostVersion) {
    return fail('installed dsh ' + dshPkg.version + ' does not match requested ' + args.hostVersion)
  }
  const binJs = path.join(dshPkgDir, 'lib', 'bin.js')

  const profile = 'smoke'
  const profileDir = path.join(homeDir, 'profiles', profile)
  if (!fs.existsSync(profileDir)) {
    const init = runLogged(
      'init-profile',
      { cmd: process.execPath, args: [binJs], shell: false },
      ['--profile', profile, '--from-default-profile', 'web', '--dump-config'],
      { cwd: workDir, env, logDir, timeoutMs: 180000 },
    )
    summary.steps.push({ step: 'init-profile', status: init.status, ms: init.ms, log: path.relative(workDir, init.logPath) })
    if (init.status !== 0) return fail('dsh profile init failed', init)
  }

  const add = runLogged(
    'plugin-add',
    { cmd: process.execPath, args: [binJs], shell: false },
    ['plugin', '--profile', profile, 'add', tarball, '--ignore-scripts'],
    { cwd: workDir, env, logDir, timeoutMs: 600000 },
  )
  summary.steps.push({ step: 'plugin-add', status: add.status, ms: add.ms, log: path.relative(workDir, add.logPath) })
  if (add.status !== 0) return fail('dsh plugin add failed', add)

  const pluginDir = findPluginDir(profileDir, homeDir)
  if (!pluginDir) return fail('plugin dsh-thinking-guard was not installed into the profile')
  const pluginPkg = readJson(path.join(pluginDir, 'package.json')) || {}
  summary.pluginVersion = pluginPkg.version || null
  if (!fs.existsSync(path.join(pluginDir, 'lib', 'index.js'))) return fail('installed plugin is missing lib/index.js')
  const expectedPlugin = versionFromTarballName(tarball)
  if (expectedPlugin && pluginPkg.version !== expectedPlugin) {
    return fail('installed plugin ' + pluginPkg.version + ' does not match tarball ' + expectedPlugin)
  }

  const patchPath = path.join(workDir, 'smoke.patch.yml')
  const patch = [
    '# release CI smoke overlay (isolated; no model requests)',
    '- id: session-title-llm',
    '  disabled: true',
    '- id: llm-retry',
    '  disabled: true',
    '- insert:',
    '    - id: release-ci-smoke',
    '      name: ' + JSON.stringify(PROBE_PATH),
  ].join('\n') + '\n'
  fs.writeFileSync(patchPath, patch)

  const resultPath = path.join(workDir, 'result.json')
  fs.rmSync(resultPath, { force: true })
  const hostEnv = Object.assign({}, env, {
    SMOKE_DIR: workDir,
    SMOKE_RESULT_PATH: resultPath,
    SMOKE_TIMEOUT_MS: String(args.timeoutMs),
    SMOKE_HOST_VERSION: dshPkg.version,
    SMOKE_EXPECT_HOST: args.hostVersion || dshPkg.version,
    SMOKE_PLUGIN_VERSION: pluginPkg.version || null,
    SMOKE_EXPECT_PLUGIN: expectedPlugin || pluginPkg.version || null,
  })

  const hostLogPath = path.join(logDir, 'host.log')
  const hostFd = fs.openSync(hostLogPath, 'a')
  const child = spawn(
    process.execPath,
    [binJs, '--profile', profile, '--patch', patchPath, '--host', '127.0.0.1', '--port', '0', '--no-open'],
    { cwd: workDir, env: hostEnv, stdio: ['ignore', hostFd, hostFd], windowsHide: true },
  )
  let exited = false
  let spawnError = null
  child.on('exit', () => { exited = true })
  child.once('error', (error) => { spawnError = error })
  await sleep(50)
  if (spawnError) {
    try { fs.closeSync(hostFd) } catch {}
    return fail('could not spawn dsh host: ' + String((spawnError && spawnError.message) || spawnError))
  }

  const deadline = Date.now() + args.timeoutMs + 30000
  let result = null
  while (Date.now() < deadline) {
    result = readJson(resultPath)
    if (result && result.finishedAt) break
    if (exited) { await sleep(300); result = readJson(resultPath); break }
    await sleep(500)
  }
  await stopChild(child)
  try { fs.closeSync(hostFd) } catch {}
  const hostStopped = child.exitCode !== null || child.signalCode !== null
  const hostPort = portFromHostLog(hostLogPath)
  scrubFile(hostLogPath)
  const listenerClosed = hostPort === null ? null : await portClosed(hostPort)
  summary.steps.push({ step: 'host', exitCode: child.exitCode, hostStopped, listenerClosed, log: path.relative(workDir, hostLogPath) })
  if (!hostStopped) {
    summary.errors.push('host process was still running after termination')
    printSummary(summary)
    return 1
  }
  if (listenerClosed === false) {
    summary.errors.push('host listener on 127.0.0.1:' + hostPort + ' was still open after termination')
    printSummary(summary)
    return 1
  }
  summary.result = result
  if (!result) {
    summary.errors.push('probe produced no result (host exit ' + child.exitCode + ')')
    printSummary(summary)
    return 1
  }
  summary.ok = result.ok === true
  if (!summary.ok) summary.errors.push(...(result.errors || []))
  fs.writeFileSync(path.join(workDir, 'smoke-summary.json'), JSON.stringify(summary, null, 2))
  printSummary(summary)
  return summary.ok ? 0 : 1
}

main()
  .then((code) => { process.exitCode = code })
  .catch((error) => { console.error('[release-ci-smoke] ERROR ' + scrub((error && error.stack) || error)); process.exitCode = 1 })
