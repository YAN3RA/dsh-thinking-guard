import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  migrateLegacySearchState, readGuardState, readMenuState, writeGuardState, writeSearchState, writeTierState,
} from '../src/policy-state.ts'

describe('unified menu state', () => {
  it('migrates legacy search choices without losing tier choices', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    const legacyFile = join(dir, 'capability-menu-search-metadata.json')
    await writeFile(stateFile, JSON.stringify({ version: 1, tools: { bash: 'resident' }, skills: { slides: 'on-demand' } }))
    await writeFile(legacyFile, JSON.stringify({
      _settings: { summaryMaxChars: 180 },
      'skill:slides': { description: 'Make presentation slides' },
    }))

    expect(await migrateLegacySearchState(stateFile, legacyFile)).toBe(true)
    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('resident')
    expect(state.tiers.skill.get('slides')).toBe('on-demand')
    expect(state.search.summaryMaxChars).toBe(180)
    expect(state.search.descriptions.get('skill:slides')).toBe('Make presentation slides')
    // Version 3 adds the Guard section; the migration itself is unchanged.
    expect(JSON.parse(await readFile(stateFile, 'utf8')).version).toBe(3)
    const backup = (await readdir(dir)).find(name => name.startsWith('capability-menu-search-metadata.json.migrated-'))
    expect(backup).toBeDefined()
    expect(await readFile(join(dir, backup!), 'utf8')).toContain('Make presentation slides')

    await writeSearchState(stateFile, { description: { key: 'skill:slides', value: 'New description' } })
    expect(await migrateLegacySearchState(stateFile, legacyFile)).toBe(false)
    expect((await readMenuState(stateFile)).search.descriptions.get('skill:slides')).toBe('New description')
  })

  it('preserves both sections when policy and search write together', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    await Promise.all([
      writeTierState(stateFile, { tool: new Map([['bash', 'on-demand']]), skill: new Map() }),
      writeSearchState(stateFile, { description: { key: 'tool:bash', value: 'Run a command' } }),
      writeSearchState(stateFile, { summaryMaxChars: 120 }),
    ])

    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('on-demand')
    expect(state.search.descriptions.get('tool:bash')).toBe('Run a command')
    expect(state.search.summaryMaxChars).toBe(120)
  })

  it('imports legacy search choices after a tier edit upgraded the state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    const legacyFile = join(dir, 'capability-menu-search-metadata.json')
    await writeFile(stateFile, JSON.stringify({ version: 1, tools: {}, skills: {} }))
    await writeFile(legacyFile, JSON.stringify({
      _settings: { summaryMaxChars: 160 },
      'tool:bash': { description: 'Run commands' },
    }))
    await writeTierState(stateFile, { tool: new Map([['bash', 'on-demand']]), skill: new Map() })

    expect(await migrateLegacySearchState(stateFile, legacyFile)).toBe(true)
    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('on-demand')
    expect(state.search.summaryMaxChars).toBe(160)
    expect(state.search.descriptions.get('tool:bash')).toBe('Run commands')
  })
})

describe('Guard switch persistence', () => {
  it('round-trips the three switches and leaves tiers/search untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    await writeTierState(stateFile, { tool: new Map([['bash', 'on-demand']]), skill: new Map() })
    await writeSearchState(stateFile, { summaryMaxChars: 120 })

    expect(await writeGuardState(stateFile, {
      enabled: true,
      duplicateDetection: false,
      alternatingCycleDetection: true,
      noProgressProtection: false,
    })).toBe(true)

    const guard = await readGuardState(stateFile)
    expect(guard).toEqual({
      enabled: true,
      duplicateDetection: false,
      alternatingCycleDetection: true,
      noProgressProtection: false,
    })

    // The other sections survive a Guard write.
    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('on-demand')
    expect(state.search.summaryMaxChars).toBe(120)
  })

  it('reports no change when the stored value already matches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    expect(await writeGuardState(stateFile, { duplicateDetection: false })).toBe(true)
    expect(await writeGuardState(stateFile, { duplicateDetection: false })).toBe(false)
  })

  it('reads an absent guard section from a version-2 file as unset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    await writeFile(stateFile, JSON.stringify({
      version: 2, tools: { bash: 'on-demand' }, skills: {}, search: { descriptions: {} },
    }))
    expect(await readGuardState(stateFile)).toEqual({})
    const state = await readMenuState(stateFile)
    expect(state.tiers.tool.get('bash')).toBe('on-demand')
  })

  it('rejects a non-boolean switch instead of coercing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    await writeFile(stateFile, JSON.stringify({
      version: 3, tools: {}, skills: {}, guard: { enabled: 'yes' }, search: { descriptions: {} },
    }))
    await expect(readGuardState(stateFile)).rejects.toThrow(/guard\.enabled must be a boolean/)
  })

  it('round-trips the repeat thresholds and keeps them out of a re-save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')

    expect(await writeGuardState(stateFile, { repeatThresholds: [2, 4, 6] })).toBe(true)
    expect((await readGuardState(stateFile)).repeatThresholds).toEqual([2, 4, 6])
    // An identical list is not a change; a different one is.
    expect(await writeGuardState(stateFile, { repeatThresholds: [2, 4, 6] })).toBe(false)
    expect(await writeGuardState(stateFile, { repeatThresholds: [2, 4] })).toBe(true)
    expect((await readGuardState(stateFile)).repeatThresholds).toEqual([2, 4])
  })

  it('reads a pre-thresholds guard section as unset so the caller can default it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    // Written by a release before the field existed: four booleans only.
    await writeFile(stateFile, JSON.stringify({
      version: 3,
      tools: {},
      skills: {},
      guard: { enabled: true, duplicateDetection: true, alternatingCycleDetection: true, noProgressProtection: true },
      search: { descriptions: {} },
    }))
    const guard = await readGuardState(stateFile)
    // 'undefined', not '[]': an empty list would mean "never remind".
    expect(guard.repeatThresholds).toBeUndefined()
    expect(guard.enabled).toBe(true)
  })

  it('rejects an illegal threshold list instead of writing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    const illegal: readonly (readonly number[])[] = [[], [8, 3], [3, 3], [1], [51], [2, 3, 4, 5, 6, 7]]
    for (const value of illegal) {
      await expect(writeGuardState(stateFile, { repeatThresholds: value }))
        .rejects.toThrow(/repeatThresholds/)
    }
    // Nothing was written by the rejected calls.
    expect(await readGuardState(stateFile)).toEqual({})
  })

  it('rejects a hand-edited illegal list already in the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-menu-state-'))
    const stateFile = join(dir, 'capability-menu-policy.json')
    await writeFile(stateFile, JSON.stringify({
      version: 3, tools: {}, skills: {}, guard: { repeatThresholds: [3, 3] }, search: { descriptions: {} },
    }))
    await expect(readGuardState(stateFile)).rejects.toThrow(/guard\.repeatThresholds must be strictly increasing/)
  })
})
