/**
 * 执行保护（Guard）自有状态：开关、阈值、诊断与落盘。
 *
 * WHY THIS FILE EXISTS — the Guard used to read and write its switches through
 * the capability-policy service (the 1,877-line `policy.ts` we patched in the
 * 0.1.x line). On the upstream baseline that file belongs to `@daweifu/capability-menu`,
 * so keeping the Guard's state there would mean editing an upstream file forever
 * and resolving the same conflict on every upstream release. This module owns the
 * state instead: its own service (`ctx.thinkingGuardState`), its own file under
 * `<profile>/dsh-thinking-guard/guard.json`, and the same three-layer precedence
 * the settings page already promises:
 *
 *     shipped default  <  patch-file base  <  persisted explicit override
 *
 * The persisted layer stays a sparse map of the keys the operator actually
 * chose, so "saved value equals the default" remains distinguishable from
 * "never set" — that is why every resolution reads the saved record per key
 * instead of comparing a whole snapshot against the defaults.
 *
 * The atomic write + cross-process lock below is the same pattern as
 * `policy-state.ts`, deliberately: two writers (settings page + a second host
 * process) merge their own keys into the latest file instead of replacing it.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { processGuardStats, type GuardStatsSnapshot } from './guard-core.ts'
import { DEFAULT_REPEAT_THRESHOLDS, normalizeRepeatThresholds } from './guard-loop-core.ts'
import { defaultPatchFile } from './patch-file.ts'

/**
 * Control-plane tools that must never be loop-detected.
 *
 * `meta_search` / `meta_invoke` are the capability catalog's own control plane:
 * reminding about them (or denying one) would break discovery, and a denial of
 * `meta_invoke` could make an On-demand capability unreachable. The list is a
 * Guard constant now that the Guard owns its own state; the patch config can
 * still override it when a deployment renames the control plane.
 */
export const DEFAULT_GUARD_META_TOOLS: readonly string[] = Object.freeze(['meta_search', 'meta_invoke'])

/**
 * The Guard switches the settings page exposes.
 *
 * They are separate booleans, not one master flag, because the page presents
 * them as independent controls; the detector honours each one. The repeat
 * thresholds are editable as well.
 */
export interface GuardSwitches {
  /** Master switch: off means no reminders and no denials at all. */
  readonly enabled: boolean
  /** Repeated identical calls: remind at the configured {@link repeatThresholds}. */
  readonly duplicateDetection: boolean
  /** A -> B -> A -> B sequences: detect and explain. */
  readonly alternatingCycleDetection: boolean
  /** Evidence gate for the local denial of one repeated call. */
  readonly noProgressProtection: boolean
  /**
   * Consecutive-repeat counts that raise a reminder.
   *
   * 1-5 strictly increasing integers in 2..50. The highest entry is also the
   * repeat count at which an unchanged result/error becomes a denial candidate,
   * so lowering it makes the Guard act earlier and raising it makes it quieter.
   */
  readonly repeatThresholds: readonly number[]
}

/** Fixed diagnostic reasons; the wire never carries free-form text. */
export type GuardDiagnosticReason = 'invalid-patch' | 'not-mounted'

/**
 * Why the Guard is (or is not) actually running, and whether pending writes are
 * durable. Deliberately a closed allowlist: no exception text, no paths.
 */
export interface GuardDiagnostics {
  /**
   * True only when a Guard instance registered a valid base AND finished
   * constructing its hooks. An empty `reasons` list is NOT the proof: a state
   * service whose Guard never mounted also has nothing to complain about.
   */
  readonly available: boolean
  readonly reasons: readonly GuardDiagnosticReason[]
  readonly persistence: {
    readonly dirty: boolean
    /** Present only after a real write failure; cleared by the next success. */
    readonly lastErrorCode?: 'write-failed'
  }
}

/** Shipped defaults for {@link GuardSwitches}. */
export const DEFAULT_GUARD_SWITCHES: GuardSwitches = {
  enabled: true,
  duplicateDetection: true,
  alternatingCycleDetection: true,
  noProgressProtection: true,
  repeatThresholds: DEFAULT_REPEAT_THRESHOLDS,
}

/** Sparse persisted override; absent key means "the operator never chose it". */
export interface GuardStateRecord {
  readonly enabled?: boolean
  readonly duplicateDetection?: boolean
  readonly alternatingCycleDetection?: boolean
  readonly noProgressProtection?: boolean
  readonly repeatThresholds?: readonly number[]
}

/**
 * Where the Guard keeps its switches.
 *
 * Next to the profile's patch file (dsh's own concept of "this profile") but in
 * its own directory, so nothing about the Guard lives in a file the capability
 * menu also writes. `DSH_HOME` wins when the host sets it, exactly as the
 * upstream patch default does.
 */
export function defaultGuardStateFile(): string {
  return join(dirname(defaultPatchFile()), 'dsh-thinking-guard', 'guard.json')
}

/** The 0.1.x state file the Guard's switches used to live in (migration source). */
export function legacyPolicyStateFile(): string {
  return join(dirname(defaultPatchFile()), 'capability-menu-policy.json')
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Same validator the settings page uses: a hand-edited file cannot smuggle in a bad list. */
function parseThresholds(value: unknown, label: string): readonly number[] {
  return normalizeRepeatThresholds(value, label)
}

/** Parse the guard section of a state document; unknown keys are ignored. */
export function parseGuardState(value: unknown): GuardStateRecord {
  if (value === undefined) return {}
  const record = object(value, 'guard state')
  const state: { -readonly [K in keyof GuardStateRecord]: GuardStateRecord[K] } = {}
  for (const key of ['enabled', 'duplicateDetection', 'alternatingCycleDetection', 'noProgressProtection'] as const) {
    const field = record[key]
    if (field === undefined) continue
    if (typeof field !== 'boolean') throw new Error(`guard.${key} must be a boolean`)
    state[key] = field
  }
  const thresholds = record['repeatThresholds']
  if (thresholds !== undefined) state.repeatThresholds = parseThresholds(thresholds, 'guard.repeatThresholds')
  return state
}

const STATE_VERSION = 1

function parseStateFile(source: string): GuardStateRecord {
  const record = object(JSON.parse(source) as unknown, 'guard state file')
  if (record['version'] !== STATE_VERSION) throw new Error('unsupported guard state version')
  return parseGuardState(record['guard'])
}

/** Missing file means no UI choices; malformed file throws instead of losing edits. */
export async function readGuardState(file: string): Promise<GuardStateRecord> {
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  return parseStateFile(source)
}

/** A short-lived cross-process lock keeps two writers from clobbering each other. */
async function withStateLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const deadline = Date.now() + 10_000
  while (true) {
    try {
      await mkdir(lock)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const age = await stat(lock).then(info => Date.now() - info.mtimeMs, () => 0)
      if (age > 30_000) await rmdir(lock).catch(() => undefined)
      if (Date.now() >= deadline) throw new Error(`timed out waiting for guard state lock: ${lock}`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  try {
    return await action()
  } finally {
    await rmdir(lock)
  }
}

async function replaceState(file: string, guard: GuardStateRecord): Promise<void> {
  const content = JSON.stringify({ version: STATE_VERSION, guard }, null, 2) + '\n'
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** Structural equality for a threshold list, so a re-save reports "no change". */
function sameThresholds(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** The four boolean switches, in one place so the merge below stays exhaustive. */
const BOOLEAN_SWITCH_KEYS = [
  'enabled',
  'duplicateDetection',
  'alternatingCycleDetection',
  'noProgressProtection',
] as const

/** Merge one writer's switch changes with the latest file. */
export async function writeGuardState(file: string, change: GuardStateRecord): Promise<boolean> {
  const keys = Object.keys(change) as (keyof GuardStateRecord)[]
  if (keys.length === 0) return false
  return withStateLock(file, async () => {
    const saved = await readGuardState(file)
    let changed = false
    const next: { -readonly [K in keyof GuardStateRecord]: GuardStateRecord[K] } = { ...saved }
    for (const key of BOOLEAN_SWITCH_KEYS) {
      const value = change[key]
      if (value === undefined || saved[key] === value) continue
      next[key] = value
      changed = true
    }
    if (change.repeatThresholds !== undefined) {
      const thresholds = normalizeRepeatThresholds(change.repeatThresholds, 'guard.repeatThresholds')
      if (!sameThresholds(saved.repeatThresholds, thresholds)) {
        next.repeatThresholds = thresholds
        changed = true
      }
    }
    if (!changed) return false
    await replaceState(file, next)
    return true
  })
}

/**
 * Import the 0.1.x Guard switches once, the first time this plugin writes its
 * own file.
 *
 * The old file is `capability-menu-policy.json` in the same directory and is
 * left untouched: it is still the capability menu's tier state, and rewriting it
 * from here would fight the plugin that owns it. A no-op when either file is
 * absent or the old one has no `guard` section.
 */
export async function migrateLegacyGuardState(file: string, legacyFile: string): Promise<boolean> {
  if (file.length === 0 || legacyFile.length === 0 || file === legacyFile) return false
  let source: string
  try {
    source = await readFile(legacyFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  return withStateLock(file, async () => {
    // Already migrated (or written by this version): never overwrite a newer file.
    const existing = await readGuardState(file).catch(() => undefined)
    if (existing !== undefined && Object.keys(existing).length > 0) return false
    let record: Record<string, unknown>
    try {
      record = object(JSON.parse(source) as unknown, 'legacy menu state')
    } catch {
      return false
    }
    let guard: GuardStateRecord
    try {
      guard = parseGuardState(record['guard'])
    } catch {
      // A corrupt legacy section must not block the Guard: falling back to the
      // shipped defaults is the same behaviour as a profile that never set them.
      return false
    }
    if (Object.keys(guard).length === 0) return false
    await replaceState(file, guard)
    return true
  })
}

/** The service this plugin exposes as `ctx.thinkingGuardState`. */
export interface GuardStateService {
  /** Effective switches: shipped default < patch base < persisted override. */
  getGuard(): GuardSwitches
  /** Persist and apply switches; throws when the write fails (never silently drops). */
  updateGuard(change: Partial<GuardSwitches>): Promise<void>
  /** Declare the patch file's switch values as the base layer; returns its withdrawal. */
  registerGuardBase(base: Partial<GuardSwitches>): () => void
  /** Report that a Guard instance failed to construct; returns its withdrawal. */
  noteGuardUnavailable(): () => void
  getGuardDiagnostics(): GuardDiagnostics
  /** Content-free counters; process-scoped, so they do not reset per turn. */
  getGuardStats(): GuardStatsSnapshot
  /** Where the persisted overrides live (empty string when persistence is disabled). */
  stateFilePath(): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    thinkingGuardState: GuardStateService
  }
}

export interface Config {
  /** Override the state file; an empty string disables persistence (tests). */
  readonly stateFile?: string
  /** Override the 0.1.x migration source; empty disables migration. */
  readonly legacyStateFile?: string
}

export const name = 'thinking-guard-state'

/**
 * Mount the Guard's own state service.
 *
 * An unreadable state file is logged and treated as "no overrides": a corrupt
 * JSON file must not take the Guard down, because the Guard is the part of this
 * plugin that protects a running turn. A corrupt LEGACY file is ignored for the
 * same reason (see `migrateLegacyGuardState`).
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const stateFile = (config.stateFile ?? defaultGuardStateFile()).trim()
  const legacyFile = (config.legacyStateFile ?? legacyPolicyStateFile()).trim()
  let saved: GuardStateRecord = {}
  if (stateFile.length > 0) {
    try {
      if (await migrateLegacyGuardState(stateFile, legacyFile)) {
        ctx.logger.info(`thinking-guard: migrated Guard switches from ${legacyFile}`)
      }
    } catch (error) {
      ctx.logger.warn(`thinking-guard: cannot migrate Guard switches from ${legacyFile}: ${String(error)}`)
    }
    try {
      saved = await readGuardState(stateFile)
    } catch (error) {
      ctx.logger.warn(`thinking-guard: cannot read Guard state ${stateFile}; using shipped defaults: ${String(error)}`)
      saved = {}
    }
  }

  /** Patch-file values, registered by the Guard itself (keyed so withdrawal is exact). */
  const bases = new Map<number, Partial<GuardSwitches>>()
  let baseToken = 0
  /** `invalid-patch` reports from Guards that failed construction. */
  const unavailable = new Set<number>()
  let unavailableToken = 0
  /** Set while a write is in flight or after a failed one. */
  let pendingWrites = 0
  let lastWriteErrorCode: 'write-failed' | undefined

  const resolve = (): GuardSwitches => {
    let base: Partial<GuardSwitches> = {}
    for (const value of bases.values()) base = { ...base, ...value }
    return {
      ...DEFAULT_GUARD_SWITCHES,
      ...base,
      ...saved,
      repeatThresholds: saved.repeatThresholds
        ?? base.repeatThresholds
        ?? DEFAULT_GUARD_SWITCHES.repeatThresholds,
    }
  }

  const service: GuardStateService = {
    getGuard(): GuardSwitches {
      // Effective value, never an error shape: the panel shows what is in force,
      // while getGuardDiagnostics says separately whether the Guard actually runs.
      return resolve()
    },
    registerGuardBase(base: Partial<GuardSwitches>): () => void {
      baseToken += 1
      const token = baseToken
      bases.set(token, { ...base })
      let withdrawn = false
      return () => {
        // Idempotent: a double withdrawal (unmount racing a reload) must not
        // remove another registration.
        if (withdrawn) return
        withdrawn = true
        bases.delete(token)
      }
    },
    noteGuardUnavailable(): () => void {
      unavailableToken += 1
      const token = unavailableToken
      unavailable.add(token)
      return () => { unavailable.delete(token) }
    },
    getGuardDiagnostics(): GuardDiagnostics {
      const reasons: GuardDiagnosticReason[] = []
      if (unavailable.size > 0) reasons.push('invalid-patch')
      if (bases.size === 0) reasons.push('not-mounted')
      return {
        available: reasons.length === 0,
        reasons,
        persistence: {
          dirty: pendingWrites > 0,
          ...(lastWriteErrorCode !== undefined ? { lastErrorCode: lastWriteErrorCode } : {}),
        },
      }
    },
    async updateGuard(change: Partial<GuardSwitches>): Promise<void> {
      // Persist ONLY the keys this call actually changes: passing a full snapshot
      // makes a concurrent writer (or a second process) silently revert the other
      // switch. The state-file writer merges per key under its lock.
      const patch: { -readonly [K in keyof GuardSwitches]?: GuardSwitches[K] } = {}
      for (const key of ['enabled', 'duplicateDetection', 'alternatingCycleDetection', 'noProgressProtection'] as const) {
        const value = change[key]
        if (value === undefined) continue
        if (typeof value !== 'boolean') throw new Error(`updateGuard: ${key} must be a boolean`)
        patch[key] = value
      }
      if (change.repeatThresholds !== undefined) {
        // Throws on anything but 1-5 strictly increasing integers in 2..50, so an
        // illegal list is rejected here instead of silently ignored by the
        // detector (which fails open and would look like "the setting does nothing").
        patch.repeatThresholds = normalizeRepeatThresholds(change.repeatThresholds, 'updateGuard: repeatThresholds')
      }
      if (Object.keys(patch).length === 0) return
      if (stateFile.length > 0) {
        pendingWrites += 1
        try {
          await writeGuardState(stateFile, patch)
          lastWriteErrorCode = undefined
        } catch (error) {
          lastWriteErrorCode = 'write-failed'
          ctx.logger.warn(`thinking-guard: cannot persist Guard switches to ${stateFile}: ${String(error)}`)
          throw new Error(`cannot persist Guard switches to ${stateFile}: ${String(error)}`)
        } finally {
          pendingWrites -= 1
        }
      }
      // Only the explicit override layer moves. The patch base stays whatever the
      // Guard registered, so one edited key cannot reset the others.
      saved = { ...saved, ...patch }
      ctx.logger.info(`thinking-guard: Guard switches updated: ${JSON.stringify(patch)}`)
    },
    getGuardStats(): GuardStatsSnapshot {
      return processGuardStats.snapshot()
    },
    stateFilePath(): string {
      return stateFile
    },
  }

  ctx.provide('thinkingGuardState', service)
}
