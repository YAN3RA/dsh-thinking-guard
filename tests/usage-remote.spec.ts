import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  UsageGateway,
  projectUsageReport,
  projectUsageSnapshot,
  readUsageSnapshot,
} from '../src/server/usage-remote.ts'
import { USAGE_TYPERT_REMOTE } from '../src/client/usage-remote.ts'
import { installUsageRuntime } from '../src/usage/usage-runtime.ts'
import {
  USAGE_RUNTIME_SERVICE,
  USAGE_SNAPSHOT_AGGREGATE_LIMIT,
  USAGE_SNAPSHOT_COVERAGE_LIMIT,
  USAGE_SNAPSHOT_ERROR_COUNT_LIMIT,
  type UsageSnapshot,
} from '../src/usage/usage-host-face.ts'

type UnknownRecord = { readonly [key: string]: unknown }

/** One aggregate row with a core-shaped `Map` error table. */
function aggregateRow(overrides: UnknownRecord = {}): UnknownRecord {
  return {
    sessionId: 'sess-1',
    date: '2026-11-04',
    workspaceAttribution: 'event-time',
    capabilityId: 'mcp__files__read',
    capabilityKind: 'mcp',
    providerId: 'files',
    calls: 3,
    succeeded: 2,
    failed: 1,
    denied: 0,
    cancelled: 0,
    unresolved: 0,
    firstObservedAt: 1_700_000_000_000,
    // The core keeps errors in a `Map`; a JSON wire cannot carry it.
    errors: new Map([['E_NOENT', 2]]),
    ...overrides,
  }
}

/** One coverage record. */
function coverageRow(overrides: UnknownRecord = {}): UnknownRecord {
  return {
    status: 'partial',
    fromSeq: 1,
    throughSeq: 9,
    skippedSessions: 1,
    skippedEvents: 2,
    reasons: ['sequence-gap'],
    reasonsTruncated: false,
    ...overrides,
  }
}

/** A structurally valid snapshot, including fields the wire must drop. */
function snapshot(overrides: UnknownRecord = {}): UnknownRecord {
  return {
    metadata: {
      mode: 'memory',
      profile: { status: 'known', name: 'desktop' },
      workspaceRegistry: true,
      capability: true,
      feed: 'session/event',
    },
    stats: {
      received: 10,
      delivered: 10,
      accepted: 9,
      duplicates: 1,
      invalid: 0,
      dropped: 0,
      batches: 3,
      reasons: { 'sequence-gap': 2 },
    },
    report: {
      aggregates: [aggregateRow()],
      calls: 3,
      succeeded: 2,
      failed: 1,
      denied: 0,
      cancelled: 0,
      unresolved: 0,
      coverage: { 'sess-1': coverageRow() },
      orphanResults: 0,
      duplicateResults: 1,
      limitsReached: false,
    },
    ...overrides,
  }
}

/** A gateway on a real Context with an optional `usageRuntime` service. */
function gateway(runtime?: unknown): UsageGateway {
  const ctx = new Context()
  if (runtime !== undefined) ctx.provide(USAGE_RUNTIME_SERVICE, runtime)
  return new UsageGateway(ctx)
}

/** Extract the strict result codec of a browser descriptor (the union also has an `src-json` variant). */
function resultCodec(method: string) {
  const descriptor = USAGE_TYPERT_REMOTE.descriptors.find(row => row.method === method)
  if (descriptor === undefined) throw new Error(`no descriptor for ${method}`)
  const codec = descriptor.result as { mode: string; create: () => { parse: (value: unknown) => unknown } }
  expect(codec.mode).toBe('strict')
  return codec.create()
}

describe('usage gateway · @Remote wiring', () => {
  it('registers one Remote method per decorated method in the source', async () => {
    // Guards the transform itself: without it every method would silently stop
    // being exported over Typert and no behavioural test would notice.
    const source = await readFile(new URL('../src/server/usage-remote.ts', import.meta.url), 'utf8')
    const decorated = source.match(/^\s*@Remote(?![\w$])/gm) ?? []
    expect(decorated.length).toBeGreaterThan(0)
    expect(remoteMethods(gateway()).map(marker => marker.method)).toHaveLength(decorated.length)
  })

  it('mirrors every Remote method into the client contribution', async () => {
    // `src/client/usage-remote.ts` is hand-maintained (it mirrors what the
    // Typert generator would emit), so a method added to the Host class without
    // its descriptor would be registered on the wire and still invisible to the
    // browser. Derive both sides instead of listing names twice.
    const source = await readFile(new URL('../src/server/usage-remote.ts', import.meta.url), 'utf8')
    const decorated = [...source.matchAll(/^\s*@Remote\(['"]([^'"]+)['"]\)/gm)].map(m => m[1])
    const mirrored = USAGE_TYPERT_REMOTE.descriptors.map(descriptor => descriptor.method)
    expect(decorated.length).toBeGreaterThan(0)
    expect([...mirrored].sort()).toEqual([...decorated].sort())
  })
  it('mounts capability and usage descriptors as one package contribution', async () => {
    const source = await readFile(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(source).toContain("export const inject = ['slots', 'locale', 'remote']")
    expect(source).toContain('descriptors: [...TYPERT_REMOTE.descriptors, ...USAGE_TYPERT_REMOTE.descriptors]')
    expect([...source.matchAll(/ctx\.remote\.\$mount\(/g)]).toHaveLength(1)
    expect(source).not.toContain('$mount(USAGE_TYPERT_REMOTE)')
  })

  it('accepts the snapshot emitted by the installed runtime', () => {
    const ctx = new Context()
    const runtime = installUsageRuntime(ctx, { historyBackfill: false })
    ctx.provide(USAGE_RUNTIME_SERVICE, runtime)

    const result = new UsageGateway(ctx).getSnapshot()
    runtime.dispose()
    expect(result).toMatchObject({
      available: true,
      stats: { dropped: 0 },
    })
  })

  it('answers service-absent when no runtime is installed', () => {
    // A Host without the usage runtime is a normal Host: the panel must be able
    // to say "not installed", not fail the call.
    expect(gateway().getSnapshot()).toEqual({ available: false, reason: 'service-absent' })
  })

  it('answers service-absent when the context cannot look services up', () => {
    const ctx = {} as unknown as Context
    expect(readUsageSnapshot(ctx)).toEqual({ available: false, reason: 'service-absent' })
  })

  it('answers service-absent when the lookup itself throws', () => {
    const ctx = {
      get: () => {
        throw new Error('lookup failed')
      },
    } as unknown as Context
    expect(readUsageSnapshot(ctx)).toEqual({ available: false, reason: 'service-absent' })
  })

  it('answers snapshot-unavailable when the service has no readable snapshot', () => {
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {})
    expect(new UsageGateway(ctx).getSnapshot()).toEqual({ available: false, reason: 'snapshot-unavailable' })
    expect(readUsageSnapshot({ get: () => 'not-a-service' } as unknown as Context))
      .toEqual({ available: false, reason: 'snapshot-unavailable' })
  })

  it('answers snapshot-unavailable when snapshot() throws or returns nothing', () => {
    expect(readUsageSnapshot({
      get: () => ({ snapshot: () => { throw new Error('boom') } }),
    } as unknown as Context)).toEqual({ available: false, reason: 'snapshot-unavailable' })

    expect(readUsageSnapshot({
      get: () => ({ snapshot: () => undefined }),
    } as unknown as Context)).toEqual({ available: false, reason: 'snapshot-unavailable' })
  })

  it('answers snapshot-invalid when the payload cannot be read', () => {
    for (const payload of ['nope', 42, {}, { metadata: null }]) {
      const ctx = new Context()
      ctx.provide(USAGE_RUNTIME_SERVICE, { snapshot: () => payload })
      expect(new UsageGateway(ctx).getSnapshot(), JSON.stringify(payload))
        .toEqual({ available: false, reason: 'snapshot-invalid' })
    }
  })
})

describe('usage gateway · snapshot projection', () => {
  it('projects the runtime snapshot into a JSON-safe DTO', () => {
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, { snapshot: () => snapshot() })
    const result = new UsageGateway(ctx).getSnapshot()

    expect(result.available).toBe(true)
    if (!result.available) throw new Error('expected an available snapshot')
    expect(result.metadata).toEqual({
      mode: 'memory',
      profile: { status: 'known', name: 'desktop' },
      workspaceRegistry: true,
      capability: true,
      feed: 'session/event',
    })
    expect(result.stats).toEqual({
      received: 10,
      delivered: 10,
      accepted: 9,
      duplicates: 1,
      invalid: 0,
      dropped: 0,
      batches: 3,
      reasons: { 'sequence-gap': 2 },
    })
    // A `Map` never crosses the wire; it becomes a plain object.
    expect(result.report.aggregates[0]?.errors).toEqual({ E_NOENT: 2 })

    // JSON-safety is part of the contract, not an accident: the DTO round-trips.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('keeps the "profile unknown" metadata honest', () => {
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {
      snapshot: () => snapshot({
        metadata: {
          mode: 'memory',
          profile: { status: 'unknown', label: 'profile unknown', reason: 'profile-context-absent' },
          workspaceRegistry: false,
          capability: false,
          feed: 'session/event',
        },
      }),
    })
    const result = new UsageGateway(ctx).getSnapshot()
    if (!result.available) throw new Error('expected an available snapshot')
    expect(result.metadata.profile).toEqual({
      status: 'unknown',
      label: 'profile unknown',
      reason: 'profile-context-absent',
    })
  })

  it('drops one malformed aggregate row instead of blanking the panel', () => {
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {
      snapshot: () => snapshot({
        report: {
          ...(snapshot().report as UnknownRecord),
          aggregates: [
            aggregateRow({ capabilityId: 'good' }),
            aggregateRow({ capabilityId: 'bad', calls: 'three' }),
            aggregateRow({ capabilityId: 'good-2' }),
          ],
        },
      }),
    })
    const result = new UsageGateway(ctx).getSnapshot()
    if (!result.available) throw new Error('expected an available snapshot')
    expect(result.report.aggregates.map(row => row.capabilityId)).toEqual(['good', 'good-2'])
  })

  it('caps aggregates at 500 and coverage at 4096', () => {
    const aggregates = Array.from({ length: USAGE_SNAPSHOT_AGGREGATE_LIMIT + 1 },
      (_, index) => aggregateRow({ capabilityId: `cap-${index}` }))
    const coverage: Record<string, UnknownRecord> = {}
    for (let index = 0; index < USAGE_SNAPSHOT_COVERAGE_LIMIT + 4; index += 1) {
      coverage[`sess-${index}`] = coverageRow()
    }
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {
      snapshot: () => snapshot({
        report: {
          ...(snapshot().report as UnknownRecord),
          aggregates,
          coverage,
        },
      }),
    })
    const result = new UsageGateway(ctx).getSnapshot()
    if (!result.available) throw new Error('expected an available snapshot')
    expect(result.report.aggregates).toHaveLength(USAGE_SNAPSHOT_AGGREGATE_LIMIT)
    expect(Object.keys(result.report.coverage)).toHaveLength(USAGE_SNAPSHOT_COVERAGE_LIMIT)
    expect(result.report.limitsReached).toBe(true)
  })

  it('reports coverage-only truncation and caps per-row error counters', () => {
    const coverage: Record<string, UnknownRecord> = {}
    for (let index = 0; index < USAGE_SNAPSHOT_COVERAGE_LIMIT + 1; index += 1) coverage[`sess-${index}`] = coverageRow()
    const errors = Object.fromEntries(Array.from({ length: USAGE_SNAPSHOT_ERROR_COUNT_LIMIT + 10 }, (_, index) => [`e-${index}`, 1]))
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {
      snapshot: () => snapshot({
        report: {
          ...(snapshot().report as UnknownRecord),
          coverage,
          aggregates: [aggregateRow({ errors })],
        },
      }),
    })
    const result = new UsageGateway(ctx).getSnapshot()
    if (!result.available) throw new Error('expected an available snapshot')
    expect(result.report.limitsReached).toBe(true)
    expect(Object.keys(result.report.coverage)).toHaveLength(USAGE_SNAPSHOT_COVERAGE_LIMIT)
    expect(Object.keys(result.report.aggregates[0].errors)).toHaveLength(USAGE_SNAPSHOT_ERROR_COUNT_LIMIT)
  })

  it('preserves own __proto__ keys from plain-object coverage and errors maps', () => {
    const errors = Object.create(null) as Record<string, number>
    errors.__proto__ = 7
    const coverage = Object.create(null) as Record<string, UnknownRecord>
    coverage.__proto__ = coverageRow()
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {
      snapshot: () => snapshot({
        report: {
          ...(snapshot().report as UnknownRecord),
          aggregates: [aggregateRow({ errors })],
          coverage,
        },
      }),
    })
    const result = new UsageGateway(ctx).getSnapshot()
    if (!result.available) throw new Error('expected an available snapshot')
    expect(result.report.aggregates[0].errors['__proto__']).toBe(7)
    expect(result.report.coverage['__proto__']).toMatchObject({ status: 'partial' })
  })

  it('caps Map inputs and treats exact caps as complete', () => {
    const exactErrors = new Map(Array.from({ length: USAGE_SNAPSHOT_ERROR_COUNT_LIMIT }, (_, index) => [`e-${index}`, 1] as const))
    const overErrors = new Map(Array.from({ length: USAGE_SNAPSHOT_ERROR_COUNT_LIMIT + 1 }, (_, index) => [`e-${index}`, 1] as const))
    const exactCoverage = new Map(Array.from({ length: USAGE_SNAPSHOT_COVERAGE_LIMIT }, (_, index) => [`s-${index}`, coverageRow()] as const))
    const overCoverage = new Map(Array.from({ length: USAGE_SNAPSHOT_COVERAGE_LIMIT + 1 }, (_, index) => [`s-${index}`, coverageRow()] as const))
    const project = (errors: Map<string, number>, coverage: Map<string, UnknownRecord>) => {
      const ctx = new Context()
      ctx.provide(USAGE_RUNTIME_SERVICE, {
        snapshot: () => snapshot({
          report: {
            ...(snapshot().report as UnknownRecord),
            aggregates: [aggregateRow({ errors })],
            coverage,
          },
        }),
      })
      const result = new UsageGateway(ctx).getSnapshot()
      if (!result.available) throw new Error('expected an available snapshot')
      return result.report
    }

    const exact = project(exactErrors, exactCoverage)
    expect(exact.limitsReached).toBe(false)
    expect(Object.keys(exact.aggregates[0].errors)).toHaveLength(USAGE_SNAPSHOT_ERROR_COUNT_LIMIT)
    expect(Object.keys(exact.coverage)).toHaveLength(USAGE_SNAPSHOT_COVERAGE_LIMIT)

    const over = project(overErrors, overCoverage)
    expect(over.limitsReached).toBe(true)
    expect(Object.keys(over.aggregates[0].errors)).toHaveLength(USAGE_SNAPSHOT_ERROR_COUNT_LIMIT)
    expect(Object.keys(over.coverage)).toHaveLength(USAGE_SNAPSHOT_COVERAGE_LIMIT)
  })

  it('never forwards raw sessions, events, arguments, or extra row fields', () => {
    // The runtime is a Host module too, and a future change could hang a raw
    // event off its snapshot. The projection copies an allowlist, so such a
    // field cannot reach the browser through this face.
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {
      snapshot: () => snapshot({
        events: [{ type: 'tool/call', data: { arguments: 'SECRET-ARGUMENT' } }],
        sessions: [{ id: 'sess-1', messages: 'SECRET-MESSAGE' }],
        raw: 'SECRET-RAW',
        report: {
          ...(snapshot().report as UnknownRecord),
          aggregates: [aggregateRow({ arguments: 'SECRET-ARGUMENT', meta: 'SECRET-META' })],
        },
      }),
    })
    const result = new UsageGateway(ctx).getSnapshot()
    expect(JSON.stringify(result)).not.toContain('SECRET')
    if (!result.available) throw new Error('expected an available snapshot')
    expect(result).not.toHaveProperty('events')
    expect(result).not.toHaveProperty('sessions')
    expect(result.report.aggregates[0]).not.toHaveProperty('arguments')
    expect(result.report.aggregates[0]).not.toHaveProperty('meta')
  })

  it('reads a fresh snapshot on every call, so refresh is a real re-read', () => {
    let calls = 0
    const snapshotFn = vi.fn(() => snapshot({
      stats: {
        received: calls, delivered: calls, accepted: calls, duplicates: 0,
        invalid: 0, dropped: 0, batches: calls, reasons: {},
      },
    }))
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, {
      snapshot: () => {
        calls += 1
        return snapshotFn()
      },
    })
    const instance = new UsageGateway(ctx)

    const first = instance.getSnapshot()
    const second = instance.refresh()
    if (!first.available || !second.available) throw new Error('expected available snapshots')
    // Two independent samples: the second is not a cached copy of the first.
    expect(first.stats.received).toBe(1)
    expect(second.stats.received).toBe(2)
    expect(snapshotFn).toHaveBeenCalledTimes(2)
  })
})

describe('usage gateway · client/server schema parity', () => {
  it('parses the Host output with the browser codec', () => {
    const ctx = new Context()
    ctx.provide(USAGE_RUNTIME_SERVICE, { snapshot: () => snapshot() })
    const instance = new UsageGateway(ctx)
    for (const method of ['getSnapshot', 'refresh'] as const) {
      const result = instance[method]()
      expect(resultCodec(method).parse(result)).toEqual(result)
    }
  })

  it('parses the unavailable answer with the browser codec', () => {
    const result = gateway().getSnapshot()
    expect(result).toEqual({ available: false, reason: 'service-absent' })
    expect(resultCodec('getSnapshot').parse(result)).toEqual(result)
  })

  it('rejects a payload above the documented bounds', () => {
    const codec = resultCodec('getSnapshot')
    const overCap = snapshot({
      report: {
        ...(snapshot().report as UnknownRecord),
        aggregates: Array.from({ length: USAGE_SNAPSHOT_AGGREGATE_LIMIT + 1 }, () => aggregateRow()),
      },
    })
    expect(() => codec.parse(overCap)).toThrow()

    const coverage: Record<string, UnknownRecord> = {}
    for (let index = 0; index < USAGE_SNAPSHOT_COVERAGE_LIMIT + 1; index += 1) coverage[`s-${index}`] = coverageRow()
    const overCoverage = snapshot({ report: { ...(snapshot().report as UnknownRecord), coverage } })
    expect(() => codec.parse(overCoverage)).toThrow()
  })

  it('rejects an unknown unavailable reason and an unknown capability kind', () => {
    const codec = resultCodec('getSnapshot')
    expect(() => codec.parse({ available: false, reason: 'some-free-text' })).toThrow()
    expect(() => codec.parse(snapshot({
      report: {
        ...(snapshot().report as UnknownRecord),
        aggregates: [aggregateRow({ capabilityKind: 'workflow' })],
      },
    }))).toThrow()
  })

  it('projects the report independently of the snapshot envelope', () => {
    // `projectUsageReport` is the seam a future Host-side consumer (or the
    // settings page's host half) can reuse without going through Remote.
    const projected = projectUsageReport(snapshot().report)
    expect(projected?.calls).toBe(3)
    expect(projectUsageReport('nope')).toBeUndefined()
    expect(projectUsageSnapshot({})).toEqual({ available: false, reason: 'snapshot-invalid' })
  })

  it('is a pure function of its input', () => {
    const input = snapshot()
    const first = projectUsageSnapshot(input) as Extract<UsageSnapshot, { available: true }>
    const second = projectUsageSnapshot(input) as Extract<UsageSnapshot, { available: true }>
    expect(first).toEqual(second)
    // The projection must not alias the source rows (a later Host mutation
    // would otherwise change a value already handed to the browser).
    expect(first.report.aggregates[0]).not.toBe(((input.report as UnknownRecord).aggregates as unknown[])[0])
  })
})

describe('usage gateway · backfill diagnostics projection', () => {
  it('projects the history-only reason counters', () => {
    const input = snapshot({
      stats: {
        received: 10, delivered: 10, accepted: 9, duplicates: 1,
        invalid: 0, dropped: 0, batches: 3,
        reasons: { 'sequence-gap': 2 },
        backfillReasons: { budget: 20, timeout: 1 },
      },
    })
    const result = projectUsageSnapshot(input) as Extract<UsageSnapshot, { available: true }>
    // The whole point of the field: the panel can finally see `budget` /
    // `timeout` instead of the backfill running blind.
    expect(result.stats.backfillReasons).toEqual({ budget: 20, timeout: 1 })
    // It stays separate from the live collector reasons.
    expect(result.stats.reasons).toEqual({ 'sequence-gap': 2 })
  })

  it('accepts a Map like the other counter maps', () => {
    const input = snapshot({
      stats: {
        received: 1, delivered: 1, accepted: 1, duplicates: 0,
        invalid: 0, dropped: 0, batches: 1, reasons: {},
        backfillReasons: new Map([['cancelled', 3]]),
      },
    })
    const result = projectUsageSnapshot(input) as Extract<UsageSnapshot, { available: true }>
    expect(result.stats.backfillReasons).toEqual({ cancelled: 3 })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('leaves the field absent without failing the whole stats', () => {
    // Absent is meaningful (an older Host), so it must not be zero-filled, and
    // it must never take the live counters down with it.
    const result = projectUsageSnapshot(snapshot()) as Extract<UsageSnapshot, { available: true }>
    expect(result.available).toBe(true)
    expect(result.stats.received).toBe(10)
    expect('backfillReasons' in result.stats).toBe(false)
  })

  it('drops the field when the value is not a counter map', () => {
    const input = snapshot({
      stats: {
        received: 10, delivered: 10, accepted: 9, duplicates: 1,
        invalid: 0, dropped: 0, batches: 3, reasons: {},
        backfillReasons: 'nope',
      },
    })
    const result = projectUsageSnapshot(input) as Extract<UsageSnapshot, { available: true }>
    expect(result.available).toBe(true)
    expect('backfillReasons' in result.stats).toBe(false)
  })

  it('keeps only bounded, non-negative integer entries', () => {
    const input = snapshot({
      stats: {
        received: 10, delivered: 10, accepted: 9, duplicates: 1,
        invalid: 0, dropped: 0, batches: 3, reasons: {},
        backfillReasons: { budget: 20, negative: -1, fractional: 1.5, text: 'x', empty: '' },
      },
    })
    const result = projectUsageSnapshot(input) as Extract<UsageSnapshot, { available: true }>
    expect(result.stats.backfillReasons).toEqual({ budget: 20 })
  })
})
