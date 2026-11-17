# dsh-thinking-guard

一个 DSH 插件：把**能力目录与按需调用**（Capability Menu 思路）和 **Agent 效率守卫**（重复/循环调用提醒）整合在一起。

当前版本 **0.1.25**。

## 它做什么

- `meta_search` 按需查找能力，`meta_invoke` 调用能力。工具与技能按 **Resident / On-demand / Disabled** 三档分层：Resident 直接出现在模型工具列表里，On-demand 收起、需要时搜索后调用，Disabled 在**执行入口**拒绝，不只是隐藏 Schema。
- Guard 按 Agent / Turn 隔离，用工具签名与结果/错误指纹识别**重复调用**与 **A-B 交替循环**。只在证据满足门槛时对匹配调用局部拒绝一次，**不停止整个 Turn**。
- 设置页四个页面：总览、执行保护、工具与技能、调用明细，采用 **v3 数据看板**版式：趋势/环形/排行用手写 SVG，断点按**内容列宽度**（CSS 容器查询）而非视口，因此在设置面板固定的 564px 内容列里也是完整形态（D-044）。

## 安装

```bash
dsh plugin --profile desktop add dsh-thinking-guard
```

装完**重启 DSH**。

包已发布在 npm registry，普通包名就能装；包内含构建产物 `lib/`，不需要在 profile 里配 `allowBuilds`。

## 升级

```bash
dsh plugin --profile desktop add dsh-thinking-guard           # 升到最新
dsh plugin --profile desktop add dsh-thinking-guard@0.1.25    # 锁定某个版本
```

装完**重启 DSH**。

> 若当前是通过本地 `.tgz` 或 `file:` 来源安装的，直接 `add` **不会覆盖**已有来源——先 `remove` 再 `add`：
>
> ```bash
> dsh plugin --profile desktop remove dsh-thinking-guard
> dsh plugin --profile desktop add dsh-thinking-guard
> ```

## 配置

Guard 的行为由三个开关**各自独立**控制：

- `duplicateDetection`：精确重复提醒。同一操作及相同结果/错误指纹连续重复达到第 3/5/8 次时给出提醒。
- `alternatingCycleDetection`：交替循环识别。识别有证据的 A-B 交替循环并提醒；与 `duplicateDetection` 互相独立，关掉其一不影响另一个。
- `noProgressProtection`：局部拒绝的总闸。关闭时仍然提醒，但**绝不拒绝任何调用**；只有开启且证据满足门槛时，才通过 `tools.guard` 对匹配调用局部拒绝一次，不停止整个 Turn。

Quick / Normal / Deep 里的 `soft*` / `hard*` 阈值（Step、工具次数、时长）只是兼容字段与计数口径，**不产生提醒，也不停止任务**。`stepLimitMode: hard-stop` 归一为 `warn-only`，`duplicateHardBlock: true` 归一为 `false`，启动时分别记录弃用提示。配置位于插件 root entry 的 `config.guard`，状态按 Agent / Turn 隔离。

## 调用索引

设置页的「调用明细」与「总览」由本插件自己的调用索引提供：Host 侧读历史与实时事件，浏览器侧经宿主认证的 Remote 取元数据。

根 entry 的 `config.callIndex.scope` **默认是 `host-visible`**（D-029，2026-11-11 按操作者要求反转了 D-026 的 fail-closed 默认）。该范围是当前宿主官方会话服务可见的记录，**可能包含其他 Profile**。这不是按 Profile 或工作目录隔离，不主动挂载外部 Session 目录、不读私有会话文件。

```yaml
callIndex:
  scope: host-visible # 改回 disabled 即恢复 fail-closed：不索引历史
```

`callIndex.getIndexStatus()` 查询范围、覆盖及任务状态；`startIndex({mode:'full'|'incremental'})` 显式启动历史扫描并立即返回任务 ID；`cancelIndex({taskId})` 只取消匹配任务。访问标签或查询状态不会自动全量扫描。实时事件只发布元数据，不逐事件枚举历史。

`getSummary`、`listSessions`、`listCalls` 和 `getCallDetail` 经宿主认证的 Remote 提供元数据。列表默认 50 条、最多 200 条；使用 `snapshotId` 在同一过滤条件下共享冻结快照，后续页用 opaque cursor。缓存默认 60 秒、4 视图、8MiB 序列化元数据，另有 256 游标上限；过期/重扫/范围失效返回 `cursor-stale`，容量不足明确报错，不截断冒充全量。来源归属不确定时保留 unknown，不能把零条过滤结果当“从未使用”。

索引只在内存保存，重启后重建；调用参数、完整输出、正文和隐藏思维链不进入索引、Remote 或日志。历史读取仅在本机 Host 临时解码事件。事件覆盖 complete 只对应已枚举范围及截点，来源/PTC/Skill/拒绝分类的可解释程度另行标注。卸载会取消扫描、关闭句柄、移除 listener/timer 并清空查询视图。

## 宿主兼容性

- **基线版本：DSH 0.2.2-rc.1**（`devDependencies` 全部 pin 在该版本）。0.2.2-rc.3 上做过一次端到端兼容实测：20 个 peer 依赖范围全部满足、引用的导出与注册的 hook 名均在、设置页四个 Tab 与导航图标正常渲染。
- `peerDependencies` 声明范围 `^0.2.0 || ^0.2.1-rc.3 || ^0.2.2-rc.1`，**除 0.2.2-rc.1 与 0.2.2-rc.3 以外的版本均未实测**，属理论兼容，不代表已验证可用。
- 安装时 `dsh plugin add` 会比对宿主版本要求，不匹配会拒绝安装并打印放行命令。**那条命令会跳过兼容检查**，只在确认风险后执行。

## 权限与隐私

- 不读取、不保存、不输出隐藏思维链。
- Guard 只保留 SHA-256 签名与有界计数，不保存原始工具参数或结果。
- 工具结果的压缩与原文恢复由宿主或 Save Token 负责，本插件不重复实现。

## 来源与许可

基于 Capability Menu 实现，按 Apache License 2.0 发布。详见 [LICENSE](LICENSE)。
