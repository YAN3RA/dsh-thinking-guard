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
 *   1. `lib/index.js` exists and is newer than `src/` (else the tarball would
 *      ship stale code — the mistake that already cost a release once).
 *   2. The name/version pair is not already taken.
 *   3. `npm pack --dry-run` lists the files the runtime needs.
 *
 * Usage:
 *   node scripts/publish-npm.mjs --dry-run   # run every check, publish nothing
 *   node scripts/publish-npm.mjs             # real publish (needs npm login)
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
