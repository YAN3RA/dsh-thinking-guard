// Minimal in-host probe for the release CI smoke.
//
// Loaded as an inserted plugin via --patch. On appReady it confirms that the
// packaged plugin actually loaded inside a real DSH host (its capability
// policy service and meta tools exist), records the result, and exits the host.
// It never starts an agent turn and never contacts a model provider.
import fs from 'node:fs'
import path from 'node:path'

export const name = 'release-ci-smoke-probe'
export const inject = ['appReady', 'tools', 'capabilityPolicy']

export function apply(ctx) {
  const dir = process.env.SMOKE_DIR || process.cwd()
  const resultPath = process.env.SMOKE_RESULT_PATH || path.join(dir, 'result.json')
  const out = {
    startedAt: new Date().toISOString(),
    ok: false,
    checks: {},
    errors: [],
    hostVersion: process.env.SMOKE_HOST_VERSION || null,
    expectedHostVersion: process.env.SMOKE_EXPECT_HOST || null,
    pluginVersion: process.env.SMOKE_PLUGIN_VERSION || null,
    expectedPluginVersion: process.env.SMOKE_EXPECT_PLUGIN || null,
  }
  let done = false
  let watchdog

  const save = () => {
    try {
      fs.writeFileSync(resultPath, JSON.stringify(out, null, 2))
    } catch (error) {
      console.error('smoke probe could not write result:', String((error && error.message) || error))
    }
  }

  const finish = (code) => {
    if (done) return
    done = true
    clearTimeout(watchdog)
    out.finishedAt = new Date().toISOString()
    save()
    let exited = false
    try {
      const exit = ctx.get('appExit')
      if (typeof exit === 'function') {
        exit(code)
        exited = true
      }
    } catch (error) {
      out.errors.push('appExit: ' + String((error && error.message) || error))
    }
    if (!exited) setTimeout(() => process.exit(code), 50)
  }

  watchdog = setTimeout(() => {
    out.errors.push('WATCHDOG_TIMEOUT')
    finish(2)
  }, Number(process.env.SMOKE_TIMEOUT_MS || 120000))

  try {
    ctx.get('appReady').onReady(async () => {
      try {
        const names = (ctx.tools.schemas() || []).map((schema) => schema && schema.name).filter(Boolean)
        out.checks.toolsTotal = names.length
        out.checks.hasMetaSearch = names.includes('meta_search')
        out.checks.hasMetaInvoke = names.includes('meta_invoke')
        try {
          out.checks.hasCapabilityPolicy = Boolean(ctx.get('capabilityPolicy') || ctx.capabilityPolicy)
        } catch (error) {
          out.checks.hasCapabilityPolicy = false
          out.errors.push('capabilityPolicy: ' + String((error && error.message) || error))
        }
        // This plugin exists only because the probe insert was applied, so the
        // host has already merged the smoke overlay and booted past load.
        out.checks.patchInserted = true
        out.checks.hostVersionMatches = !out.expectedHostVersion || out.hostVersion === out.expectedHostVersion
        out.checks.pluginVersionMatches = !out.expectedPluginVersion || out.pluginVersion === out.expectedPluginVersion
        out.ok = Boolean(
          out.checks.hasMetaSearch &&
            out.checks.hasMetaInvoke &&
            out.checks.hasCapabilityPolicy &&
            out.checks.hostVersionMatches &&
            out.checks.pluginVersionMatches,
        )
        finish(out.ok ? 0 : 1)
      } catch (error) {
        out.errors.push('probe: ' + String((error && error.stack) || error))
        finish(1)
      }
    })
  } catch (error) {
    out.errors.push('appReady: ' + String((error && error.stack) || error))
    finish(1)
  }
}
