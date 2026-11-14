// Read installed public package contracts inside Electron's asar-aware Node runtime.
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const root = process.argv[2]
if (!root) throw Error('Installed dsh package.json path required')
const load = createRequire(root)
for (const name of ['@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-session-query-sqlite', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-profile', '@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis']) {
  try {
    const entry = load.resolve(name)
    const pkgPath = load.resolve(name + '/package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    console.log(JSON.stringify({ name, version: pkg.version, entry, exports: pkg.exports }))
    if (name.includes('persistence-jsonl') || name.includes('query-sqlite')) {
      const lines = fs.readFileSync(entry, 'utf8').split('\n')
      const keep = new Set()
      for (let i = 0; i < lines.length; i++) if (/root|DSH_HOME|dshHome|profile|sessionPersistence|sessionQuery|export |function apply|Config|Schema/.test(lines[i])) {
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 4); j++) keep.add(j)
      }
      for (const i of [...keep].sort((a,b) => a-b).slice(0, 180)) console.log(`${name}:${i + 1} ${lines[i]}`)
    }
  } catch (e) { console.log(JSON.stringify({ name, errorCode: e.code, message: String(e.message).slice(0, 250) })) }
}
