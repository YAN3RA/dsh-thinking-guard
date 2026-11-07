#!/usr/bin/env node
/**
 * Publish this package to the npm registry.
 *
 * WHY THIS EXISTS
 * ---------------
 * Installing from a GitHub Release asset means pasting a long, content-hashed
 * URL that changes every release. Publishing to npm makes the install a single
 * plain name:
 *
 *   dsh plugin --profile desktop add dsh-thinking-guard
 *
 * and, unlike a `github:` or `git+` source, it needs no `allowBuilds` entry in
 * the profile: the tarball already contains `lib/`, so pnpm never runs a build
 * script. That is the whole reason npm is the low-friction channel.
 *
 * WHAT IT CHECKS BEFORE PUBLISHING
 * --------------------------------
 *   0. The credential can actually publish. `npm whoami` is NOT enough — it only
 *      proves the token is valid. An account with 2FA accepts `npm login`, and
 *      `whoami` succeeds, while every `npm publish` still fails with `EOTP`
 *      because the interactive token keeps requiring a one-time password. That
 *      wasted a whole release cycle once: everything was built, committed and
 *      pushed before the first real publish attempt.
 *   1. `lib/index.js` exists and is newer than `src/` (else the tarball would
 *      ship stale code — the mistake that already cost a release once).
 *   2. The name/version pair is not already taken.
 *   3. `npm pack --dry-run` lists the files the runtime needs.
 *
 * Usage:
 *   node scripts/publish-npm.mjs --dry-run   # run every check, publish nothing
 *   node scripts/publish-npm.mjs             # real publish (needs npm login)
 *
 * The credential check runs first on purpose: it is the cheapest failure and the
 * most expensive one to discover late.
 */
import { execFileSync } from 'node:child_process'
import { readFile, stat, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

function resolveNpm() {
  try {
    execFileSync('npm', ['--version'], { cwd: ROOT, stdio: 'pipe' })
    return { command: 'npm', prefix: [] }
  } catch {
    const cli = process.env['NPM_CLI_JS']
    if (cli) return { command: process.execPath, prefix: [cli] }
    throw new Error('npm not found. Set NPM_CLI_JS to npm-cli.js, or run where npm is on PATH.')
  }
}

const NPM = resolveNpm()
const run = (args, opts = {}) => execFileSync(NPM.command, [...NPM.prefix, ...args], {
  cwd: ROOT, encoding: 'utf8', stdio: opts.pipe ? 'pipe' : 'inherit',
})

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const spec = `${pkg.name}@${pkg.version}`

console.log(`[publish] package ${spec}`)

// --- 0. credential capability ------------------------------------------------
//
// `npm publish` against an account with 2FA fails with EOTP unless the token was
// created to bypass 2FA (Automation / granular with the bypass flag). That is a
// server-side property of the credential, so it can be read up front instead of
// being discovered by a failed publish at the very end.
//
// `npm token list --json` is the probe: it reports `bypass_2fa` and the granted
// permissions without changing anything. If the command itself is unavailable
// (older npm, or a token type that cannot introspect), the check degrades to a
// warning rather than blocking a publish that might well succeed.
function checkCredential() {
  let raw
  try {
    raw = execFileSync(NPM.command, [...NPM.prefix, 'token', 'list', '--json'], {
      cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
    })
  } catch (error) {
    console.log('[publish] WARNING: cannot introspect the token; skipping the capability check.')
    console.log(`[publish]   ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
    return
  }

  let tokens
  try {
    tokens = JSON.parse(raw)
  } catch {
    console.log('[publish] WARNING: token list is not JSON; skipping the capability check.')
    return
  }
  if (!Array.isArray(tokens) || tokens.length === 0) {
    console.log('[publish] WARNING: no tokens listed for this account; skipping the capability check.')
    return
  }

  // The active credential is the newest non-revoked one.
  const live = tokens
    .filter(token => token.revoked === null || token.revoked === undefined)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)))
  const active = live[0]
  if (active === undefined) {
    throw new Error(
      'no active npm token found. Run `npm login`, or write an Automation token into ~/.npmrc.',
    )
  }

  const canWritePackage = (active.permissions ?? [])
    .some(permission => permission.name === 'package' && permission.action === 'write')
  if (!canWritePackage) {
    throw new Error(
      `token "${active.name}" lacks the package:write permission, so it cannot publish. ` +
      'Create an Automation (or granular) token with read+write for this package.',
    )
  }

  if (active.bypass_2fa !== true) {
    throw new Error(
      `token "${active.name}" does not bypass 2FA, so \`npm publish\` will fail with EOTP. ` +
      'Create an Automation token (npmjs.com → Access Tokens → Generate New Token → Automation) ' +
      'and put it in ~/.npmrc as //registry.npmjs.org/:_authToken. ' +
      'Running `npm login` again does NOT fix this — the interactive token keeps requiring an OTP.',
    )
  }

  console.log(`[publish] credential ok (token "${active.name}", bypasses 2FA, package:write)`)

  // The same token CANNOT clean up after itself: npm rejects `unpublish` from a
  // bypass-2FA token with E403 ("Granular access tokens that bypass two-factor
  // authentication may not perform this action"). Say so once, here, instead of
  // letting someone discover it while trying to remove a bad version.
  console.log('[publish] note: this token cannot `npm unpublish` (npm E403 policy) — '
    + 'remove a bad version at npmjs.com or with an OTP-bearing interactive credential.')
}

checkCredential()

// --- 1. lib/ must exist and be newer than the newest source file --------------
let libStat
try {
  libStat = await stat(join(ROOT, 'lib', 'index.js'))
} catch {
  throw new Error('lib/index.js is missing. Run `npm run build` first.')
}

async function newestMtime(dir) {
  let newest = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, await newestMtime(full))
    else if (/\.tsx?$/.test(entry.name)) newest = Math.max(newest, (await stat(full)).mtimeMs)
  }
  return newest
}

const srcMtime = await newestMtime(join(ROOT, 'src'))
if (srcMtime > libStat.mtimeMs) {
  throw new Error(
    'lib/ is older than src/ — the tarball would ship stale code. Run `npm run build` first.',
  )
}
console.log(`[publish] lib/ is up to date (${new Date(libStat.mtimeMs).toISOString()})`)

// --- 2. name/version availability -------------------------------------------
let existing = ''
try {
  existing = execFileSync(NPM.command, [...NPM.prefix, 'view', spec, 'version'], {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
  }).trim()
} catch {
  existing = '' // 404 = free
}

if (existing === pkg.version) {
  throw new Error(
    `${spec} is already published. Bump "version" in package.json — npm does not allow republishing.`,
  )
}
console.log(existing === ''
  ? `[publish] ${spec} is free`
  : `[publish] ${spec} is free (latest published is ${existing})`)

// --- 3. pack contents --------------------------------------------------------
console.log('[publish] checking the tarball contents')
const dryPack = execFileSync(NPM.command, [...NPM.prefix, 'pack', '--dry-run', '--json'], {
  cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
})
const [meta] = JSON.parse(dryPack)
const shipped = new Set(meta.files.map(file => file.path))
const required = ['lib/index.js', 'cordis.patch.yml', 'package.json']
const missing = required.filter(path => !shipped.has(path))
if (missing.length > 0) {
  throw new Error(`tarball is missing required files: ${missing.join(', ')}`)
}
console.log(`[publish] ${meta.entryCount} files, ${(meta.size / 1024).toFixed(1)} kB`)

// --- publish -----------------------------------------------------------------
if (dryRun) {
  console.log('')
  console.log('[publish] --dry-run: all checks passed, nothing was published.')
  console.log(`[publish] run without --dry-run to publish ${spec}.`)
  process.exit(0)
}

console.log(`[publish] publishing ${spec}`)
run(['publish', '--access', 'public'])

console.log('')
console.log(`[publish] done. install it with:`)
console.log(`  dsh plugin --profile desktop add ${pkg.name}`)
console.log('')
console.log('[publish] release notes live in the GitHub release, not in package.json.')
