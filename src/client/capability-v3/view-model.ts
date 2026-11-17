/**
 * 能力菜单 v3 · 档位切换的数据层。
 *
 * WHY THIS MODULE: 上游 0.2.0 的 `capabilityPolicy` 远程面没有 0.1.27 里的
 * `moveCapabilities` 意图接口，只有 `getConfig()` / `updateConfig(partial)`
 * 这对整表读写。页面需要「把某些 id 移到某一档」，于是把它收成一个纯函数加
 * 一次远程往返：语义与上游 `CapabilitySection.tsx` 里那段循环切换逐行等价
 * （读该 kind 的三档列表 → 从三档全部摘掉 → 追加进目标档 → 只回写该 kind），
 * 但抽成可单测的纯函数，免得每个调用点各写一遍整表重建。
 *
 * 一个必须保留的既有行为：服务端分类器里通配规则（`mcp__x__*`）与
 * `server:<name>` 规则的优先级高于我们刚写入的单条精确规则，因此「写了却没
 * 生效」是可能发生的。{@link overriddenIds} 让页面回读快照后把这种情况说出来，
 * 而不是静默显示一个没动过的档位。
 */
import {
  unwrap,
  withTransientRetry,
  type CapabilityPolicyRemote,
  type CapabilityRow,
} from '../store.ts'

/** 档位机器值，与 `src/policy.ts` 的 `CapabilityClass` 一致。 */
export const TIERS = ['resident', 'on-demand', 'disabled'] as const

export type Tier = (typeof TIERS)[number]

export type CapabilityKind = 'tool' | 'skill'

/**
 * 一类能力的三档规则列表，对应 `src/policy.ts` 的 `CapabilitySetConfig`：
 * 键名带连字符（`'on-demand'`）是上游配置的真实字段名，不是笔误。
 */
export interface TierLists {
  resident: string[]
  'on-demand': string[]
  disabled: string[]
}

export interface TierMoveRequest {
  readonly kind: CapabilityKind
  readonly ids: readonly string[]
  /** 目标档位。 */
  readonly target: Tier
}

/** 点击循环顺序：常驻 → 按需 → 禁用 → 常驻（沿用 0.1.27 的 NEXT_CLASS）。 */
const NEXT_TIER: Record<Tier, Tier> = {
  resident: 'on-demand',
  'on-demand': 'disabled',
  disabled: 'resident',
}

/** 下一档；档位标签点击后的目标。 */
export function nextTier(current: Tier): Tier {
  return NEXT_TIER[current]
}

/** `getConfig()` 返回对象里该 kind 对应的顶层键。 */
export function configKeyFor(kind: CapabilityKind): 'tools' | 'skills' {
  return kind === 'skill' ? 'skills' : 'tools'
}

/**
 * 把 `getConfig()` 里的未知值收成三档字符串数组。
 *
 * 远程面把 config 声明为 `Record<string, unknown>`，所以这里必须真校验：一份
 * 被手写坏掉的配置（某档写成字符串、含非字符串项）只会丢掉那一档的坏项，
 * 不该让整次点击抛错。
 */
export function readTierLists(set: unknown): TierLists {
  const record = set !== null && typeof set === 'object' && !Array.isArray(set)
    ? set as Record<string, unknown>
    : {}
  const lists: TierLists = { resident: [], 'on-demand': [], disabled: [] }
  for (const tier of TIERS) {
    const raw = record[tier]
    lists[tier] = Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
  }
  return lists
}

/**
 * 把 `ids` 移到 `target` 档：先从三档里全部摘掉，再追加到目标档末尾。
 *
 * 其余规则保持原顺序。顺序不影响分类结果（分类器按档位优先级判定），但保序让
 * 「查看目录」弹窗里的规则列表稳定可读，也让磁盘 diff 只包含真正移动的那几行。
 * 重复 id 先去重，避免一次点击把同一个名字写进列表两次。
 */
export function moveIdsIntoTier(lists: TierLists, ids: readonly string[], target: Tier): TierLists {
  const wanted = [...new Set(ids)]
  const wantedSet = new Set(wanted)
  const next: TierLists = { resident: [], 'on-demand': [], disabled: [] }
  for (const tier of TIERS) {
    next[tier] = lists[tier].filter(entry => !wantedSet.has(entry))
  }
  next[target] = [...next[target], ...wanted]
  return next
}

/**
 * 移动没有生效的 id：回读快照后 class 仍不是 `target` 的那些。
 *
 * 用于「分类未生效：N 个能力被更高优先级规则覆盖」这句提示——通配规则或
 * `server:<name>` 规则会盖过刚写入的精确规则，静默会让人以为点击丢了。
 */
export function overriddenIds(
  ids: readonly string[],
  target: Tier,
  rows: readonly CapabilityRow[],
): string[] {
  return ids.filter(id => rows.find(row => row.id === id)?.class !== target)
}

/**
 * 把一组 id 移到目标档，返回实际写回的三档列表。
 *
 * 读-改-写是一次远程往返，窗口期压到「读后立即写」：上游没有意图级接口，无法
 * 做到服务端原子，另一窗口在同一瞬间的并发移动可能被这次回写覆盖（与上游自己
 * 的整表写入是同一取舍）。写入失败原样抛出——服务端会先校验再提交，例如把
 * `meta_search` 移出常驻会被 fail-loud 拒绝，那属于要显示给操作者的错误，不能
 * 被误读成「被规则覆盖」。
 */
export async function moveCapabilities(
  remote: CapabilityPolicyRemote,
  request: TierMoveRequest,
): Promise<TierLists> {
  const { kind, ids, target } = request
  const key = configKeyFor(kind)
  const config = await withTransientRetry(async () => unwrap(await remote.getConfig(), 'capabilityPolicy.getConfig'))
  const lists = moveIdsIntoTier(readTierLists(config[key]), ids, target)
  unwrap(await remote.updateConfig({ [key]: lists }), 'capabilityPolicy.updateConfig')
  return lists
}
