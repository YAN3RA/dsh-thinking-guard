import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMenuState, readTierState, writeTierState } from '../src/policy-state.ts'

/**
 * Upgrade compatibility: the 0.1.x line writes `version: 3` (tiers + search +
 * guard). A reader that only accepts 1/2 makes the policy entry fail to activate
 * on every real upgrade — the failure this suite pins down.
 */
async function v3File(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-v3-'))
  const file = join(dir, 'capability-menu-policy.json')
  await writeFile(file, JSON.stringify({
    version: 3,
    tools: { read: 'on-demand', bash: 'resident' },
    skills: { genui: 'on-demand' },
    guard: { enabled: true, duplicateDetection: false, repeatThresholds: [3, 5, 8] },
    search: { descriptions: { 'tool:read': 'Read a file' } },
  }))
  return file
}

describe('version 3 menu state (0.1.x upgrade)', () => {
  it('reads tiers and search from a version 3 file', async () => {
    const file = await v3File()
    const state = await readMenuState(file)
    expect(state.tiers.tool.get('read')).toBe('on-demand')
    expect(state.tiers.tool.get('bash')).toBe('resident')
    expect(state.tiers.skill.get('genui')).toBe('on-demand')
    expect(state.search.descriptions.get('tool:read')).toBe('Read a file')
  })

  it('readTierState accepts version 3 (the call the policy entry makes)', async () => {
    const file = await v3File()
    const tiers = await readTierState(file)
    expect(tiers.tool.get('read')).toBe('on-demand')
  })

  it('still writes a state both 0.1.x and 0.3.x can read', async () => {
    const file = await v3File()
    expect(await writeTierState(file, { tool: new Map([['read', 'resident']]), skill: new Map() })).toBe(true)
    const written = JSON.parse(await readFile(file, 'utf8')) as { version: number }
    expect(written.version).toBe(2)
    expect((await readMenuState(file)).tiers.tool.get('read')).toBe('resident')
  })

  it('rejects an unknown future version instead of silently accepting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-v4-'))
    const file = join(dir, 'capability-menu-policy.json')
    await writeFile(file, JSON.stringify({ version: 4, tools: {}, skills: {} }))
    await expect(readMenuState(file)).rejects.toThrow(/unsupported menu state version/)
  })
})
