import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

/**
 * The browser bundle is registered with the host's client-modules loader under
 * the module id it declares in its banner, and the host looks an installment up
 * by PACKAGE NAME. A bundle whose id keeps the upstream package name therefore
 * never activates: measured in the isolated host as
 * `Uncaught Error: client-modules: duplicate factory registration for
 * "@daweifu/capability-menu"` plus "entry did not activate", with every settings
 * section silently missing. This test locks the banner id to package.json so the
 * defect cannot come back through a config edit.
 */
describe('client bundle identity', () => {
  it('derives the module id from package.json, not from a hard-coded package name', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
    }
    const config = (await import('../tsdown.config.mjs')).default as
      | Array<{ banner?: (ctx: unknown) => string }>
      | { banner?: (ctx: unknown) => string }
    const entries = Array.isArray(config) ? config : [config]
    const banner = entries[0]?.banner
    expect(typeof banner).toBe('function')
    const text = banner!({ format: 'cjs', options: {} })
    expect(text).toContain(JSON.stringify(manifest.name))
    expect(text).not.toMatch(/@daweifu\/capability-menu/)
  })
})
