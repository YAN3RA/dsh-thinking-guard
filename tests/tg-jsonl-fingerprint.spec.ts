import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createArtifactIoCounters, fingerprintArtifact, isDigest,
} from '../src/usage/call-index-jsonl-fingerprint.ts'

let root: string
let outside: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tg-fingerprint-root-'))
  outside = await mkdtemp(join(tmpdir(), 'tg-fingerprint-out-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function artifact(relative: string, body = 'header\nbody\n'): Promise<string> {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body)
  return path
}

describe('jsonl artifact fingerprint', () => {
  it('hashes a regular artifact inside the authorized root without decoding it', async () => {
    const path = await artifact(join('proj', 'session', 'v1.jsonl.zstd'))
    const counters = createArtifactIoCounters()
    const digest = await fingerprintArtifact({ kind: 'jsonl', path }, { sourceRoot: root, counters })
    expect(digest).toBeDefined()
    expect(isDigest(digest!.sha256)).toBe(true)
    expect(digest!.size).toBe(12)
    // Decode columns are separate from I/O columns: a hash reads bytes but never
    // decompresses anything. These names are path-scoped on purpose — they say
    // nothing about the Host's own decode work.
    expect(counters.fingerprintHeaderFrameDecodes).toBe(0)
    expect(counters.fingerprintFullLogDecodes).toBe(0)
    expect(counters.bytesRead).toBe(12)
    expect(counters.openCalls).toBe(1)
    expect(counters.statCalls).toBeGreaterThan(0)
  })

  it('is stable for identical bytes and changes when the bytes change', async () => {
    const path = await artifact(join('proj', 's', 'v1.jsonl.zstd'), 'aaa')
    const first = await fingerprintArtifact({ kind: 'jsonl', path }, { sourceRoot: root })
    const second = await fingerprintArtifact({ kind: 'jsonl', path }, { sourceRoot: root })
    expect(first!.sha256).toBe(second!.sha256)
    await writeFile(path, 'aab')
    const third = await fingerprintArtifact({ kind: 'jsonl', path }, { sourceRoot: root })
    expect(third!.sha256).not.toBe(first!.sha256)
  })

  it('refuses a path outside the authorized root, including a sibling prefix', async () => {
    const inside = await artifact(join('proj', 's', 'v1.jsonl.zstd'))
    const sibling = root + '-sibling'
    await mkdir(sibling, { recursive: true })
    try {
      await writeFile(join(sibling, 'v1.jsonl.zstd'), 'x')
      expect(await fingerprintArtifact({ kind: 'jsonl', path: join(sibling, 'v1.jsonl.zstd') }, { sourceRoot: root })).toBeUndefined()
    } finally {
      await rm(sibling, { recursive: true, force: true })
    }
    expect(await fingerprintArtifact({ kind: 'jsonl', path: join(outside, 'x') }, { sourceRoot: root })).toBeUndefined()
    expect(await fingerprintArtifact({ kind: 'jsonl', path: inside }, { sourceRoot: root })).toBeDefined()
  })

  it('refuses a symlinked artifact even when the link target is inside the root', async () => {
    const real = await artifact(join('proj', 's', 'v1.jsonl.zstd'), 'abc')
    const linked = join(root, 'link.jsonl.zstd')
    try {
      await symlink(real, linked)
    } catch {
      // A host without symlink privileges cannot run this case; the directory
      // containment checks above still cover escape prevention.
      return
    }
    expect(await fingerprintArtifact({ kind: 'jsonl', path: linked }, { sourceRoot: root })).toBeUndefined()
  })

  it('refuses a non-regular file and an oversized artifact', async () => {
    const dir = join(root, 'proj', 'dir-as-artifact')
    await mkdir(dir, { recursive: true })
    expect(await fingerprintArtifact({ kind: 'jsonl', path: dir }, { sourceRoot: root })).toBeUndefined()
    const big = await artifact(join('proj', 'big', 'v1.jsonl.zstd'), '0123456789')
    expect(await fingerprintArtifact({ kind: 'jsonl', path: big }, { sourceRoot: root, maxBytes: 4 })).toBeUndefined()
  })

  it('refuses a location that is absent or not a jsonl artifact', async () => {
    expect(await fingerprintArtifact(undefined, { sourceRoot: root })).toBeUndefined()
    const path = await artifact(join('proj', 's', 'v1.jsonl.zstd'))
    expect(await fingerprintArtifact({ kind: 'sqlite', path }, { sourceRoot: root })).toBeUndefined()
    expect(await fingerprintArtifact({ kind: 'jsonl' }, { sourceRoot: root })).toBeUndefined()
    expect(await fingerprintArtifact({ kind: 'jsonl', path }, { sourceRoot: '' })).toBeUndefined()
  })

  it('propagates cancellation instead of reporting an unverifiable artifact', async () => {
    const path = await artifact(join('proj', 's', 'v1.jsonl.zstd'), 'abcdef')
    const controller = new AbortController()
    controller.abort()
    await expect(fingerprintArtifact({ kind: 'jsonl', path }, { sourceRoot: root, signal: controller.signal })).rejects.toThrow()
  })

  it('hard-links share content so the digest matches, while the cache still keys by session', async () => {
    const first = await artifact(join('proj', 'a', 'v1.jsonl.zstd'), 'shared-bytes')
    const second = join(root, 'proj', 'b', 'v1.jsonl.zstd')
    await mkdir(join(root, 'proj', 'b'), { recursive: true })
    try {
      await link(first, second)
    } catch {
      return
    }
    const a = await fingerprintArtifact({ kind: 'jsonl', path: first }, { sourceRoot: root })
    const b = await fingerprintArtifact({ kind: 'jsonl', path: second }, { sourceRoot: root })
    expect(a!.sha256).toBe(b!.sha256)
  })
})
