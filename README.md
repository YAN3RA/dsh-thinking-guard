# dsh-thinking-guard

一个 DSH 插件：把**能力目录与按需调用**（Capability Menu 思路）和 **Agent 效率守卫**（重复/循环调用提醒）整合在一起。当前版本 **0.1.19**。

## 它做什么

- `meta_search` 按需查找能力，`meta_invoke` 调用能力；工具与技能按 Resident / On-demand / Disabled 三档分层，Disabled 会在执行入口拒绝调用，不只是隐藏 Schema。
- Guard 按 Agent / Turn 隔离，用工具签名与 Step 的结果/错误指纹做重复与 A-B 循环检测；只在证据满足门槛时对匹配调用局部拒绝一次，**不停止整个 Turn**。
- 设置页提供四个页面：总览、防循环、调用统计、能力目录。

## 它不做什么

- 不做工具结果压缩与原文恢复——那是 [dsh-plugin-save-token](https://github.com/YAN3RA/dsh-plugin-save-token) 的职责。
- 不做模型 / Provider / 完整会话管理——那是 DSH 宿主的职责。
- 不读取、保存或输出隐藏思维链。

## 宿主兼容性

- **实测版本：DSH 0.2.2-rc.1**。本插件的开发、类型检查与测试都以该版本为基线（`devDependencies` 中 `@deepseek-ai/dsh-*` 均为 `0.2.2-rc.1`，`node_modules/@deepseek-ai/dsh-tools` 实测也是 `0.2.2-rc.1`）。
- `peerDependencies` 声明的范围是 `^0.2.0 || ^0.2.1-rc.3 || ^0.2.2-rc.1`。范围内**除 0.2.2-rc.1 以外的版本均未实测**，属于理论兼容，不代表已验证可用。
- 只有 `0.2.2-rc.1` 上跑过完整检查；其他 0.2.x 版本请按「提示 DSH 版本不兼容」一节的流程自行评估风险。

## 安装

一条命令：

```bash
dsh plugin --profile desktop add dsh-thinking-guard
```

装完**重启 DSH**。

### 指定版本 / 升级

```bash
dsh plugin --profile desktop add dsh-thinking-guard@0.1.19   # 锁定版本
dsh plugin --profile desktop add dsh-thinking-guard           # 升到最新
```

### 不支持的安装来源

| 来源 | 结果 | 原因 |
|---|---|---|
| `git+https://…` / `github:owner/repo` | ❌ | 仓库不含 `lib/`，pnpm 需现场跑 `prepare` 构建，而 pnpm 默认拦截 git 依赖的构建脚本 |
| `link:<本地目录>` | ⚠️ 能装不推荐 | 软链到源码目录，peer 依赖不从目标 `node_modules` 解析 |


## 升级

重跑方式一 / 方式二即可。脚本会比对当前 pin 与最新附件：

- 一致 → 只重装同样的字节，`bundles` 不动
- 不一致 → 打印 `from:` / `to:`，走 `dsh plugin add` 换版本

手动升级就是把方式三第 2 条的 URL 换成新版本的哈希附件再跑一次。

## 配置

默认 Guard 模式为 `normal`。Guard 的行为由三个开关各自独立控制：

- `duplicateDetection`：精确重复提醒。开启后，同一操作及相同结果/错误指纹构成的连续重复达到第 3/5/8 次时给出提醒。
- `alternatingCycleDetection`：交替循环识别。开启后，识别有证据的 A-B 交替循环并给出提醒；它与 `duplicateDetection` 互相独立，关掉其一不影响另一个。
- `noProgressProtection`：局部拒绝的总闸。关闭时 Guard 仍然提醒，但**绝不拒绝任何调用**；只有开启、且相同操作及结果/错误指纹满足门槛时，才通过 `tools.guard` 对匹配调用局部拒绝一次，不停止整个 Turn。

Quick / Normal / Deep 里的 `soft*` / `hard*` 阈值（Step、Tool 次数、Duration）只是兼容字段与计数口径，**不产生提醒，也不停止任务**。`stepLimitMode: hard-stop` 会归一为 `warn-only`，`duplicateHardBlock: true` 会归一为 `false`，启动时分别记录弃用提示。配置位于插件 root entry 的 `config.guard`，状态按 Agent / Turn 隔离。

## 文档入口

本文件就是代码仓的 README（工作区里位于 `01_Source_Code/README.md`）。其余文档在**工作区根**，不随仓库发布：

| 想做的事 | 去哪 |
|---|---|
| 找任意文档 | 根目录 `PROJECT_INDEX.md` |
| 看现在做到哪 / 接手 | 根目录 `HANDOFF.md` |
| 长期规则与开发规范 | 根目录 `AGENTS.md` |
| 查架构与模块方案 | 见项目层 `02_Design/` 下的方案文档（不在本仓库内） |
| 查历史与归档 | 根目录 `04_Docs/02_history/README.md` |

## 目录约定

- 本目录是**唯一代码仓**（独立 git，远端 `YAN3RA/dsh-thinking-guard`）。
- 仓库只发布**源码 + 测试 + 本 README**。`AGENTS.md` / `PROJECT_INDEX.md` / `HANDOFF.md` 与 `docs/` 均为本地保留，不提交。

## 来源与许可

本项目基于 Capability Menu 实现，并按 Apache License 2.0 发布。详见 [LICENSE](LICENSE)。
