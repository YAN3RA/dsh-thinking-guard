# 🛡️ 思考节流（DSH Thinking Guard）

[![npm 版本](https://img.shields.io/npm/v/dsh-thinking-guard)](https://www.npmjs.com/package/dsh-thinking-guard) [![DSH 插件 · Cordis](https://img.shields.io/badge/DSH_plugin-Cordis-4D6BFE)](https://github.com/topics/dsh-plugin) [![许可证 Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/YAN3RA/dsh-thinking-guard/blob/main/LICENSE)

**当前版本：0.4.3；修复 PTC / Code Mode 下重复调用未被“局部拒绝”的问题，并纳入上游 #33（禁用 MCP 服务时裁剪其说明段）。** [npm 安装包](https://www.npmjs.com/package/dsh-thinking-guard) · [GitHub Releases](https://github.com/YAN3RA/dsh-thinking-guard/releases) · [问题反馈](https://github.com/YAN3RA/dsh-thinking-guard/issues)

> **DSH 插件声明：** 本项目是为 **DeepSeek Harness（DSH）** 开发的社区维护、非官方 **Cordis 型插件**，不是独立应用，也不是用来冒充插件的 Skill 说明文件。安装与运行需要 DSH 宿主。


**让 AI 执行更有边界，让工具调用更清晰，让重复思考少一些。**

一个为 **DeepSeek Harness（DSH）** 设计的执行管理插件。

通过统一的设置入口，管理工具与技能的调用方式、查看执行保护状态，并对重复调用和无进展循环进行提醒与保护。

<p align="center">
  <strong>一个入口 · 三个功能页面 · 统一管理 AI 执行过程</strong>
</p>

---

## ✨ 为什么需要思考节流？

当 AI Agent 能够调用越来越多的工具、技能和 MCP 服务时，执行过程也可能变得越来越复杂：

- 🔁 **重复调用：** AI 反复调用相同工具，执行过程迟迟没有推进。
- 🔄 **循环执行：** 多个工具交替调用，形成重复的执行循环。
- 🧩 **能力过载：** 工具和技能越来越多，难以判断哪些应该常驻、哪些应该按需使用。
- 📊 **运行不透明：** 缺少直观的执行保护状态和运行数据，难以判断插件是否正常工作。

思考节流希望解决的不是限制 AI 能力，而是让执行过程更清晰、更可控。

## 🚀 核心功能

### 01 · 📊 总览

**快速了解当前执行保护与能力管理状态。**

通过统一的总览页面查看插件运行情况，不必在多个设置页面和日志之间来回切换。

- 查看执行保护相关计数。
- 查看保护功能的启用状态。
- 查看工具与技能的能力目录分布。
- 通过诊断信息了解当前运行状态。

### 02 · 🛡️ 思考限制

**识别重复执行，减少无效调用。**

提供三类相互独立的执行保护机制：

| 保护机制 | 主要作用 |
| --- | --- |
| 相同调用提醒 | 识别重复的相同工具调用 |
| 交替循环识别 | 识别多个工具之间反复交替的调用模式 |
| 无进展保护 | 识别缺少有效推进的重复执行 |

你可以分别启用或关闭三种保护机制，并调整重复调用提醒阈值（默认第 3 / 5 / 8 次）。三个开关按智能体 / 回合隔离，不跨会话继承；开关与阈值配置本身会保存在本机。

**设计原则：提醒优先，保护适度。**

- 不以简单的步骤数量作为主要限制方式。
- 只有在满足明确判定条件时才触发保护。
- 保护机制只针对符合条件的调用进行局部处理。
- 不主动结束整个 AI 任务，不以保护机制替代 Agent 的正常执行流程。

### 03 · 🧰 能力菜单

**让工具与技能按照实际需求工作。**

统一管理工具和技能的使用方式，减少不必要的常驻能力。

| 使用模式 | 说明 |
| --- | --- |
| 🟢 常驻 | 保持能力常驻，适合高频使用的工具或技能 |
| 🟡 按需 | 根据任务需要选择性调用 |
| ⚪ 禁用 | 暂时不使用该能力 |

支持查看和管理工具、技能相关目录，以及注册的 MCP 服务器与技能目录。

> 合理管理能力菜单，有助于减少不必要的能力暴露，让 Agent 更专注于当前任务。

---

## 🧭 如何使用

安装完成并重启 DSH 后：

1. 打开 **设置**。
2. 进入 **思考节流**。
3. 根据需要选择对应页面。

| 页面 | 推荐用途 |
| --- | --- |
| 📊 总览 | 查看当前运行情况与诊断信息 |
| 🛡️ 思考限制 | 配置重复调用、交替循环和无进展保护 |
| 🧰 能力菜单 | 管理工具与技能的使用模式 |

**初次使用建议：**

- 先进入总览，了解当前状态。
- 根据实际任务类型配置思考限制。
- 将低频能力调整为按需使用。
- 不确定某项能力是否需要时，先保留现状，观察实际使用情况后再调整。

## 🔧 宿主与兼容范围

- 先安装并启动 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，确保终端可执行 `dsh`。
- 当前 DSH peer 声明范围为 `^0.2.1-rc.3 || ^0.2.2-rc.1`，其他 Cordis / React 依赖以包清单为准。
- 0.4.1 的自动测试为 **33 个测试文件 / 431 个用例**；已用独立 DSH Web CLI **0.2.2-rc.3** 验证实际包、公开 RPC、跨进程统计清零与设置页。
- 这不代表对所有 peer 版本、生产 Electron 热重载、物理触屏或屏幕阅读器组合的完整兼容保证。升级后请完整重启宿主。

## 📦 安装

### 安装插件

在终端中执行：

```bash
dsh plugin --profile desktop add dsh-thinking-guard
```

安装完成后，重启 DeepSeek Harness。

随后即可在设置中找到 **思考节流**。

### 安装指定版本

首次安装指定版本：

```bash
dsh plugin --profile desktop add dsh-thinking-guard@0.4.3
```

`desktop` 是桌面客户端常用 profile；使用其他 profile 时，请将其替换为实际名称。

### 更新插件

已安装旧版时，可在 DSH 插件管理页更新；终端方式如下（由你手动执行）：

```bash
dsh plugin --profile desktop remove dsh-thinking-guard
dsh plugin --profile desktop add dsh-thinking-guard@0.4.3
```

随后**完整退出并重新打开 DeepSeek Harness**，而不是只刷新页面。正常升级保留开关与阈值；运行统计按 0.4.1 起的规则在宿主重启后清零。不要为了升级主动删除本机配置或旧统计文件。

npm 是首选渠道，包内已含构建后的 `lib/`，无需为正常安装手动构建源码。无法访问 npm 时，可从对应 [GitHub Release](https://github.com/YAN3RA/dsh-thinking-guard/releases) 下载预构建 `.tgz`，再执行：

```bash
dsh plugin --profile desktop add "<本地下载的插件包.tgz>" --ignore-scripts
```

备用包请使用**固定版本的 Release 附件**，不要把带版本文件名拼到 `releases/latest/download/`，以免下一版发布后失效。

项目版本与发布记录：

- GitHub：[YAN3RA/dsh-thinking-guard](https://github.com/YAN3RA/dsh-thinking-guard)
- npm：[dsh-thinking-guard](https://www.npmjs.com/package/dsh-thinking-guard)

---

## 🔒 隐私与数据

思考节流遵循尽量减少数据收集的原则。

- 仅记录执行保护相关的次数与时间信息。
- 不记录工具调用参数、工具返回结果或聊天内容。
- 不读取会话历史。
- 运行计数仅在本次 DSH 启动的内存中累计，重启后清零，不再恢复或写入旧统计文件；保护开关与阈值配置仍保存在本机。

**你的任务内容不应该成为执行统计的必要条件。**

### 安全与权限声明

- 本插件**不是纯只读插件**：修改开关、阈值、能力分档或注册 MCP / 技能目录会改变对应本机配置；请仅在理解影响后操作。
- 不增加额外模型请求来生成统计，也不以简单次数直接终止整个任务；提醒 / 局部拒绝仅在实际检测条件满足时触发。
- 注册外部 MCP 服务及调用工具的网络、权限和数据去向，仍由宿主、所配置服务和用户授权决定；本文不作“绝不联网”或“所有服务均可信”的保证。
- 本项目由社区独立维护，与 DeepSeek 官方不存在官方插件或安全认证关系；徽章仅标识适用生态或制作归属，不表示官方背书。

---

## ❓ 常见问题

<details>
<summary><strong>安装完成后，为什么设置里没有出现思考节流？</strong></summary>

安装插件后需要重启 DeepSeek Harness，而不只是刷新当前页面。

</details>

<details>
<summary><strong>总览中的计数为什么是 0？</strong></summary>

0.4.1 起统计仅覆盖本次 DSH 启动期间，完整重启后为 0 是预期行为。只有检测器实际观察到的调用才会计入；不是聊天消息数或历史会话总量。没有提醒或拒绝也不代表挂载失败，请结合“插件挂载”和诊断状态判断。

</details>

<details>
<summary><strong>开启思考限制后，AI 会不会直接停止任务？</strong></summary>

思考节流的设计原则是提醒优先、局部保护，不以简单的调用次数或步骤数量直接终止整个任务。

具体保护行为取决于对应机制是否满足触发条件。

</details>

<details>
<summary><strong>是否需要关闭不常用的工具和技能？</strong></summary>

不必一次性关闭所有低频能力。

建议根据实际使用频率进行管理：高频能力保持常驻，低频能力按需使用，确认不再需要的能力再禁用。

</details>

<details>
<summary><strong>升级插件会清空原有配置吗？</strong></summary>

插件包含旧版本设置迁移逻辑。正常升级时不需要手动重新配置；如果遇到异常，建议先备份相关配置，再进行排查。

</details>

<details>
<summary><strong>如何回退到旧版本？</strong></summary>

可以重新安装指定版本，例如：

```bash
dsh plugin --profile desktop remove dsh-thinking-guard
dsh plugin --profile desktop add dsh-thinking-guard@0.3.5
```

回退后重启 DeepSeek Harness。

</details>

---

## 🙏 致谢与项目来源  
  
本项目基于 [PKUfudawei/dsh-capability-menu](https://github.com/PKUfudawei/dsh-capability-menu) 进行扩展与开发。  
  
感谢原作者 **PKUfudawei** 的开源贡献，为本项目提供了能力菜单相关的基础实现与设计思路。  
  
本项目在此基础上持续迭代，围绕 DeepSeek Harness 的执行保护、能力管理与使用体验进行扩展和优化。  
  
感谢所有开源项目作者与社区贡献者的分享和支持！

## 📄 许可证与声明

本项目按 [Apache License 2.0](https://github.com/YAN3RA/dsh-thinking-guard/blob/main/LICENSE) 分发。保留上游许可证、版权及来源声明；原许可证中的 `Copyright 2026 Dawei Fu` 保持不变。新增维护与扩展不表示原作者或 DeepSeek 官方为本分支的修改提供背书。

反馈问题时请说明插件版本、DSH 版本与复现步骤，勿在公开 Issue 上传凭据、完整聊天记录或未经脱敏的配置。

---

<p align="center">
  <strong>让 AI 少一些无效循环，多一些有效推进。</strong>
  <br />
  <sub>DSH Thinking Guard · 为更清晰、更可控的 Agent 执行体验而设计</sub>
</p>

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
