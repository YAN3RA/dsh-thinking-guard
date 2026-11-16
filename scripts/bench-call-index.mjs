#!/usr/bin/env node
/**
 * Directed benchmark for the compact CallIndexPartition seq evidence.
 *
 * Run from 01_Source_Code:
 *   node --expose-gc scripts/bench-call-index.mjs
 *
 * The default parent process spawns one fresh worker per scenario/implementation
 * so heap measurements cannot leak across runs. Workers keep the actual
 * Partition objects in a global reference while measuring, and report
 * heapUsed / external / RSS separately. arrayBuffers is deliberately NOT added
 * to external (external already includes it).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { performance } from 'node:perf_hooks'

const scriptPath = fileURLToPath(import.meta.url)
const scriptsDir = dirname(scriptPath)
const sourceRoot = resolve(scriptsDir, '..')
const workspaceRoot = resolve(sourceRoot, '..')
const defaultOut = join(workspaceRoot, '03_Testing', 'tg-index-20261116', 'compact-benchmark.json')
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0)
const LEDGER_LIMIT = 64 * 1024 * 1024
// SessionCallIndex passes its global maxBytes to every stage's CallIndexPartition;
// keep the benchmark on the same wiring instead of the partition's local default.
const PARTITION_MAX_BYTES = LEDGER_LIMIT

const args = process.argv.slice(2)
const workerIndex = args.indexOf('--worker')
const outIndex = args.indexOf('--out')
const workerName = workerIndex >= 0 ? args[workerIndex + 1] : undefined
const outPath = outIndex >= 0 ? args[outIndex + 1] : defaultOut

function other(seq, time = T0 + seq) {
  return { seq, time, kind: 'other' }
}

function buildOtherHeavy(count) {
  const events = [{ seq: 0, time: T0, kind: 'call', callId: 'call-0', toolName: 'read', turn: 1, step: 1 }]
  for (let seq = 1; seq < count; seq += 1) events.push(other(seq))
  return events
}

function buildCallDense(pairs) {
  const events = []
  for (let index = 0; index < pairs; index += 1) {
    const callSeq = index * 2
    const resultSeq = callSeq + 1
    events.push({
      seq: callSeq,
      time: T0 + callSeq,
      kind: 'call',
      callId: `call-${index}`,
      toolName: index % 3 === 0 ? 'mcp__demo__read' : 'read',
      turn: 1 + (index % 3),
      step: 1,
    })
    const isError = index % 7 === 0
    events.push({
      seq: resultSeq,
      time: T0 + resultSeq,
      kind: 'result',
      callId: `call-${index}`,
      outcome: isError ? 'error' : 'success',
      ...(isError ? { errorCode: 'E_FAIL' } : {}),
      turn: 1 + (index % 3),
      step: 1,
    })
  }
  return events
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function buildMixed(session, count) {
  const rng = mulberry32(0x1000 + session)
  const events = []
  const callIds = []
  let seq = 0
  for (let index = 0; index < count; index += 1) {
    const roll = rng()
    if (roll < 0.18 || callIds.length === 0) {
      const callId = `s${session}-c${Math.floor(rng() * 40)}`
      if (!callIds.includes(callId)) callIds.push(callId)
      events.push({
        seq,
        time: T0 + seq * 1.25,
        kind: 'call',
        callId,
        toolName: rng() < 0.2 ? 'mcp__demo__tool' : 'read',
        turn: 1 + Math.floor(rng() * 3),
        step: 1 + Math.floor(rng() * 4),
      })
      seq += 1
    } else if (roll < 0.58) {
      const callId = callIds[Math.floor(rng() * callIds.length)]
      const outcomeRoll = rng()
      events.push({
        seq,
        time: T0 + seq * 1.25,
        kind: 'result',
        callId,
        outcome: outcomeRoll < 0.6 ? 'success' : outcomeRoll < 0.8 ? 'error' : outcomeRoll < 0.92 ? 'cancelled' : 'unresolved',
        ...(outcomeRoll >= 0.6 && outcomeRoll < 0.8 ? { errorCode: 'E_FAIL' } : {}),
        turn: 1 + Math.floor(rng() * 3),
        step: 1 + Math.floor(rng() * 4),
      })
      seq += 1
    } else if (roll < 0.94) {
      events.push(other(seq, T0 + seq * 1.25))
      seq += 1
    } else {
      const target = Math.max(0, seq - 1 - Math.floor(rng() * 3))
      events.push({ seq: target, time: T0 + target * 1.25, kind: 'other' })
    }
  }
  return { events, cut: seq }
}

async function loadImplementation(kind) {
  if (kind === 'new') return import(pathToFileURL(join(sourceRoot, 'src', 'usage', 'call-index-core.ts')).href)
  if (kind !== 'baseline') throw new Error(`unknown implementation: ${kind}`)
  const source = execFileSync('git', ['show', 'HEAD:src/usage/call-index-core.ts'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  })
  const require = createRequire(join(sourceRoot, 'package.json'))
  const sessionUrl = pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href
  const toolsUrl = pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href
  const patched = source
    .replace("'@deepseek-ai/dsh-session'", JSON.stringify(sessionUrl))
    .replace("'@deepseek-ai/dsh-tools'", JSON.stringify(toolsUrl))
  const dir = mkdtempSync(join(process.env.TEMP || workspaceRoot, 'tg-index-baseline-'))
  const file = join(dir, 'call-index-core.ts')
  writeFileSync(file, patched)
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // The OS temp directory is disposable; the repo never receives the copy.
    }
  }
}

function memorySnapshot() {
  const value = process.memoryUsage()
  return {
    heapUsed: value.heapUsed,
    external: value.external,
    rss: value.rss,
  }
}

function delta(before, after) {
  return {
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    rss: after.rss - before.rss,
  }
}

/**
 * Independent synthetic sample: keep every Partition plus exactly one frozen
 * partition snapshot. This deliberately double-retains source rows and the
 * published row copy, so it must never be presented as a real runtime-memory
 * measurement. The original part-only sample above stays untouched.
 */
function sampleSnapshotRetention(parts, cut, baselineMemory, partOnlyMemory) {
  const snapshot = parts.length > 0 ? parts[0].snapshot(cut) : undefined
  globalThis.__benchSnapshotRetained = snapshot
  global.gc?.()
  const afterSnapshot = memorySnapshot()
  return {
    scope: 'parts + one frozen partition snapshot (synthetic double retention)',
    syntheticDoubleRetention: true,
    notRuntimeMemoryClaim: true,
    snapshotSessionId: snapshot?.sessionId ?? null,
    snapshotRows: snapshot?.rows.length ?? 0,
    snapshotEstimatedBytes: snapshot?.estimatedBytes ?? 0,
    memoryDelta: delta(baselineMemory, afterSnapshot),
    incrementalOverPartOnly: delta(partOnlyMemory, afterSnapshot),
    deltaNote: 'single-shot gc delta; a negative incremental value is allocator/GC noise, not evidence of memory release',
    memoryRaw: { before: baselineMemory, afterPartOnly: partOnlyMemory, afterSnapshot },
  }
}

async function runOtherHeavy(kind, fullBudget = false) {
  const { CallIndexPartition } = await loadImplementation(kind)
  const ledgerLimit = fullBudget ? Number.MAX_SAFE_INTEGER : LEDGER_LIMIT
  const partitionMaxBytes = fullBudget ? 1_000_000_000 : PARTITION_MAX_BYTES
  global.gc?.()
  const before = memorySnapshot()
  let used = 0
  const parts = []
  const started = performance.now()
  for (let session = 0; session < 32; session += 1) {
    const part = new CallIndexPartition({
      sessionId: `other-heavy-${session}`,
      revision: 'rev-1',
      inheritedEventCount: 0,
      maxBytes: partitionMaxBytes,
      reserve: (bytes) => {
        if (!Number.isFinite(bytes) || bytes < 0 || used + bytes > ledgerLimit) return false
        used += bytes
        return true
      },
    })
    part.ingest(buildOtherHeavy(4096))
    parts.push(part)
  }
  const elapsedMs = performance.now() - started
  globalThis.__benchRetained = parts
  global.gc?.()
  const after = memorySnapshot()
  const partOnlyDelta = delta(before, after)
  const snapshotRetentionSample = sampleSnapshotRetention(parts, 4096, before, after)
  const snapshots = parts.map(part => part.snapshot(4096))
  return {
    implementation: fullBudget ? `${kind}-full-budget` : kind,
    fullBudget,
    events: 32 * 4096,
    sessions: 32,
    ledgerLimitBytes: fullBudget ? null : LEDGER_LIMIT,
    elapsedMs: Math.round(elapsedMs * 1000) / 1000,
    ledgerUsedBytes: used,
    estimatedBytes: parts.reduce((sum, part) => sum + part.usage().bytes, 0),
    estimatedBytesScope: 'CallIndexPartition.usage().bytes (part ledger only; not whole-runtime memory)',
    completeSessions: snapshots.filter(snapshot => snapshot.coverage === 'complete').length,
    partialSessions: snapshots.filter(snapshot => snapshot.coverage !== 'complete').length,
    rows: snapshots.reduce((sum, snapshot) => sum + snapshot.rows.length, 0),
    reasons: [...new Set(snapshots.flatMap(snapshot => snapshot.reasons))].sort(),
    memoryScope: 'part-only (no snapshots retained at sample time)',
    memoryDelta: partOnlyDelta,
    memoryDeltaPartOnly: partOnlyDelta,
    memoryRaw: { before, after },
    snapshotRetentionSample,
  }
}

async function runCallDense(kind, fullBudget = false) {
  const { CallIndexPartition } = await loadImplementation(kind)
  const ledgerLimit = fullBudget ? Number.MAX_SAFE_INTEGER : LEDGER_LIMIT
  const partitionMaxBytes = fullBudget ? 1_000_000_000 : PARTITION_MAX_BYTES
  global.gc?.()
  const before = memorySnapshot()
  let used = 0
  const parts = []
  const started = performance.now()
  for (let session = 0; session < 32; session += 1) {
    const part = new CallIndexPartition({
      sessionId: `call-dense-${session}`,
      revision: 'rev-1',
      inheritedEventCount: 0,
      maxBytes: partitionMaxBytes,
      reserve: (bytes) => {
        if (!Number.isFinite(bytes) || bytes < 0 || used + bytes > ledgerLimit) return false
        used += bytes
        return true
      },
    })
    part.ingest(buildCallDense(1024))
    parts.push(part)
  }
  const elapsedMs = performance.now() - started
  globalThis.__benchRetained = parts
  global.gc?.()
  const after = memorySnapshot()
  const partOnlyDelta = delta(before, after)
  const snapshotRetentionSample = sampleSnapshotRetention(parts, 2048, before, after)
  const snapshots = parts.map(part => part.snapshot(2048))
  return {
    implementation: fullBudget ? `${kind}-full-budget` : kind,
    fullBudget,
    events: 32 * 2048,
    sessions: 32,
    ledgerLimitBytes: fullBudget ? null : LEDGER_LIMIT,
    elapsedMs: Math.round(elapsedMs * 1000) / 1000,
    ledgerUsedBytes: used,
    estimatedBytes: parts.reduce((sum, part) => sum + part.usage().bytes, 0),
    estimatedBytesScope: 'CallIndexPartition.usage().bytes (part ledger only; not whole-runtime memory)',
    completeSessions: snapshots.filter(snapshot => snapshot.coverage === 'complete').length,
    partialSessions: snapshots.filter(snapshot => snapshot.coverage !== 'complete').length,
    rows: snapshots.reduce((sum, snapshot) => sum + snapshot.rows.length, 0),
    reasons: [...new Set(snapshots.flatMap(snapshot => snapshot.reasons))].sort(),
    memoryScope: 'part-only (no snapshots retained at sample time)',
    memoryDelta: partOnlyDelta,
    memoryDeltaPartOnly: partOnlyDelta,
    memoryRaw: { before, after },
    snapshotRetentionSample,
  }
}

async function runBudgetStrict() {
  const { CallIndexPartition } = await loadImplementation('new')
  const options = { sessionId: 'budget', revision: 'rev-1', inheritedEventCount: 0, maxBytes: 8_000_000 }
  const probe = new CallIndexPartition(options)
  const events = Array.from({ length: 300 }, (_, seq) => other(seq))
  probe.ingest(events)
  const exact = probe.usage().bytes
  const strict = new CallIndexPartition({ ...options, maxBytes: exact })
  strict.ingest(events)
  const beforeExtra = strict.usage()
  strict.ingest([other(300)])
  const afterExtra = strict.usage()
  const snapshot = strict.snapshot(301)
  return {
    implementation: 'new',
    exactBudgetBytes: exact,
    acceptedEvents: beforeExtra.events,
    bytesAfterExtra: afterExtra.bytes,
    eventsAfterExtra: afterExtra.events,
    rejectedReason: snapshot.reasons.includes('index-capacity') ? 'index-capacity' : null,
    coverage: snapshot.coverage,
    withinBudget: afterExtra.bytes <= exact,
  }
}

async function runEquivalence() {
  const baseline = await loadImplementation('baseline')
  const current = await loadImplementation('new')
  const options = {
    sessionId: 'equivalence',
    revision: 'rev-1',
    inheritedEventCount: 0,
    maxEvents: 1_000_000,
    maxCalls: 100_000,
    maxBytes: 1_000_000_000,
    maxOrphans: 10_000,
  }
  let comparedSnapshots = 0
  let comparedRows = 0
  for (let session = 0; session < 6; session += 1) {
    const { events, cut } = buildMixed(session, 500)
    const oldPart = new baseline.CallIndexPartition({ ...options, sessionId: `equivalence-${session}` })
    const newPart = new current.CallIndexPartition({ ...options, sessionId: `equivalence-${session}` })
    for (let start = 0; start < events.length; start += 50) {
      const batch = events.slice(start, start + 50)
      oldPart.ingest(batch)
      newPart.ingest(batch)
      const oldSnapshot = oldPart.snapshot(cut)
      const newSnapshot = newPart.snapshot(cut)
      const oldComparable = { ...oldSnapshot }
      const newComparable = { ...newSnapshot }
      delete oldComparable.estimatedBytes
      delete newComparable.estimatedBytes
      if (!isDeepStrictEqual(oldComparable, newComparable)) {
        return { matched: false, comparedSnapshots, comparedRows, mismatchAt: `session-${session}/batch-${start / 50}` }
      }
      comparedSnapshots += 1
      comparedRows += oldSnapshot.rows.length
    }
  }
  return { matched: true, comparedSnapshots, comparedRows, sessions: 6, eventsPerSession: 500 }
}

async function runWorker(name) {
  if (name === 'other-heavy-32x4096/new') return runOtherHeavy('new')
  if (name === 'other-heavy-32x4096/baseline') return runOtherHeavy('baseline')
  if (name === 'other-heavy-32x4096/baseline-full') return runOtherHeavy('baseline', true)
  if (name === 'call-dense-32x1024/new') return runCallDense('new')
  if (name === 'call-dense-32x1024/baseline') return runCallDense('baseline')
  if (name === 'call-dense-32x1024/baseline-full') return runCallDense('baseline', true)
  if (name === 'budget-strict') return runBudgetStrict()
  if (name === 'equivalence-mixed') return runEquivalence()
  throw new Error(`unknown worker: ${name}`)
}

function runChild(name) {
  const result = spawnSync(process.execPath, ['--expose-gc', scriptPath, '--worker', name], {
    cwd: sourceRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
    timeout: 120000,
  })
  if (result.status !== 0) {
    throw new Error(`worker ${name} failed (${result.status}): ${result.stderr || result.stdout}`)
  }
  const lines = result.stdout.trim().split(/\r?\n/)
  return JSON.parse(lines[lines.length - 1])
}

async function main() {
  if (workerName !== undefined) {
    const result = await runWorker(workerName)
    process.stdout.write(JSON.stringify(result) + '\n')
    return
  }
  const workers = [
    'other-heavy-32x4096/new',
    'other-heavy-32x4096/baseline',
    'other-heavy-32x4096/baseline-full',
    'call-dense-32x1024/new',
    'call-dense-32x1024/baseline',
    'call-dense-32x1024/baseline-full',
    'budget-strict',
    'equivalence-mixed',
  ]
  const collected = {}
  for (const name of workers) collected[name] = runChild(name)
  const relativeScript = relative(process.cwd(), scriptPath).split('\\').join('/')
  const report = {
    schema: 'tg-index-compact-benchmark/v1',
    generatedAt: new Date().toISOString(),
    command: `node --expose-gc ${relativeScript}`,
    invocation: {
      cwd: process.cwd(),
      execPath: process.execPath,
      execArgv: [...process.execArgv],
      script: scriptPath,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      gcAvailable: typeof global.gc === 'function',
    },
    methodology: {
      memory: 'Each implementation/scenario runs in a fresh Node process. The part-only memoryDelta sample keeps only the actual CallIndexPartition objects in globalThis.__benchRetained and forces gc before sampling; no snapshot is created yet. External is reported as-is and already includes arrayBuffers; arrayBuffers is not added again. snapshotRetentionSample is a separate synthetic sample that additionally keeps exactly one frozen partition snapshot; it is not a real runtime-footprint claim.',
      memoryLayers: {
        partOnly: 'memoryDelta / memoryRaw are part-only: excludes frozen published snapshots, CallIndexQuery views/caches, client stores, and host JSONL decode objects.',
        snapshotRetention: 'snapshotRetentionSample keeps parts plus one frozen partition snapshot only to expose the extra published-row copy; it deliberately double-retains source and published rows and must not be called real runtime memory.',
        external: 'external already includes ArrayBuffers; do not add arrayBuffers again.',
      },
      limitations: [
        'usage().bytes / estimatedBytes is the CallIndexPartition retained-budget ledger, not whole-runtime memory.',
        'CallIndexPartition.turnClosedSeq and sourceByTool Maps are not separately charged by usage().bytes; resident metadata remains bounded by event/call limits, but no strict heap cap is claimed.',
        'call-dense actual heapUsed / external / RSS and elapsedMs may not improve; each field is reported separately and no universal reduction is claimed.',
        'The 64 MiB-capped baseline completes only 13/32 sessions; its partial memory/bytes are a capacity red control, not a like-for-like reduction baseline.',
      ],
      comparisonBasis: 'baselineFullBudget is the same-workload old implementation comparison. baseline is retained only as the 64 MiB capacity red control.',
      baseline: 'The baseline is the real git HEAD:src/usage/call-index-core.ts CallIndexPartition loaded from a temporary copy; it is not a model or an extrapolation.',
      bytes: 'estimatedBytes is the sum of CallIndexPartition.usage().bytes, the same conservative retained-budget ledger used by SessionCallIndex.',
      wiring: 'Each capped scenario constructs every CallIndexPartition with maxBytes=64 MiB and a shared 64 MiB reserve callback, matching SessionCallIndex.stage() rather than the partition-local 8 MB default.',
    },
    scenarios: {
      'other-heavy-32x4096': {
        description: '32 sessions x 4096 events: 1 call + 4095 ignorable other events per session, shared 64 MiB ledger.',
        comparisonBasis: 'baselineFullBudget',
        baselineCappedNote: 'baseline is the 64 MiB capacity red control (13/32 complete); do not use its partial memory as a reduction baseline.',
        new: collected['other-heavy-32x4096/new'],
        baseline: collected['other-heavy-32x4096/baseline'],
        baselineFullBudget: collected['other-heavy-32x4096/baseline-full'],
      },
      'call-dense-32x1024': {
        description: '32 sessions x 1024 call/result pairs, shared 64 MiB ledger.',
        comparisonBasis: 'baselineFullBudget',
        baselineCappedNote: 'baseline is the 64 MiB capacity red control (13/32 complete); do not use its partial memory as a reduction baseline.',
        memoryInterpretation: 'Estimated budget is lower than baselineFullBudget, but actual heapUsed+external/RSS need not decrease and elapsedMs may be higher; consult each field separately.',
        new: collected['call-dense-32x1024/new'],
        baseline: collected['call-dense-32x1024/baseline'],
        baselineFullBudget: collected['call-dense-32x1024/baseline-full'],
      },
      'budget-strict': collected['budget-strict'],
      'equivalence-mixed': collected['equivalence-mixed'],
    },
  }
  for (const name of ['other-heavy-32x4096', 'call-dense-32x1024']) {
    for (const variant of ['new', 'baseline', 'baselineFullBudget']) {
      const entry = report.scenarios[name][variant]
      entry.bytesPerEvent = Math.round((entry.estimatedBytes / entry.events) * 100) / 100
    }
  }
  report.assertions = {
    otherHeavyNewAllComplete: report.scenarios['other-heavy-32x4096'].new.completeSessions === 32,
    otherHeavyBaselineDoesNotAllComplete: report.scenarios['other-heavy-32x4096'].baseline.completeSessions < 32,
    otherHeavyBaselineFullAllComplete: report.scenarios['other-heavy-32x4096'].baselineFullBudget.completeSessions === 32,
    otherHeavyNewEstimatedBytesLower: report.scenarios['other-heavy-32x4096'].new.estimatedBytes < report.scenarios['other-heavy-32x4096'].baselineFullBudget.estimatedBytes,
    otherHeavyRowsMatchFullBaseline: report.scenarios['other-heavy-32x4096'].new.rows === report.scenarios['other-heavy-32x4096'].baselineFullBudget.rows,
    callDenseNewAllComplete: report.scenarios['call-dense-32x1024'].new.completeSessions === 32,
    callDenseBaselineFullAllComplete: report.scenarios['call-dense-32x1024'].baselineFullBudget.completeSessions === 32,
    callDenseNewEstimatedBytesLower: report.scenarios['call-dense-32x1024'].new.estimatedBytes < report.scenarios['call-dense-32x1024'].baselineFullBudget.estimatedBytes,
    callDenseRowsMatchFullBaseline: report.scenarios['call-dense-32x1024'].new.rows === report.scenarios['call-dense-32x1024'].baselineFullBudget.rows,
    budgetStrictWithinBudget: report.scenarios['budget-strict'].withinBudget && report.scenarios['budget-strict'].rejectedReason === 'index-capacity',
    differentialMatched: report.scenarios['equivalence-mixed'].matched === true,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify({
    out: outPath,
    generatedAt: report.generatedAt,
    command: report.command,
    invocation: report.invocation,
    assertions: report.assertions,
    otherHeavy: {
      new: { complete: report.scenarios['other-heavy-32x4096'].new.completeSessions, estimatedBytes: report.scenarios['other-heavy-32x4096'].new.estimatedBytes, memoryDelta: report.scenarios['other-heavy-32x4096'].new.memoryDelta },
      baseline: { complete: report.scenarios['other-heavy-32x4096'].baseline.completeSessions, estimatedBytes: report.scenarios['other-heavy-32x4096'].baseline.estimatedBytes, memoryDelta: report.scenarios['other-heavy-32x4096'].baseline.memoryDelta },
    },
    callDense: {
      new: { complete: report.scenarios['call-dense-32x1024'].new.completeSessions, estimatedBytes: report.scenarios['call-dense-32x1024'].new.estimatedBytes, memoryDelta: report.scenarios['call-dense-32x1024'].new.memoryDelta },
      baseline: { complete: report.scenarios['call-dense-32x1024'].baseline.completeSessions, estimatedBytes: report.scenarios['call-dense-32x1024'].baseline.estimatedBytes, memoryDelta: report.scenarios['call-dense-32x1024'].baseline.memoryDelta },
    },
  }, null, 2) + '\n')
}

await main()
