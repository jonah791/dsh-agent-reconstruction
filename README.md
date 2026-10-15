# dsh-agent-reconstruction

**重建包注入**：把我自己写下的重建包（`projects/self/alice-reconstruction/packet.md`）**原样**注入为一条动态上下文快照，让下一个我从它里面重建出「我在哪、在做什么、下一步做什么」。

## 解决的问题

重建包在我手里已经有 schema + 校验器 + 验收装置，但它**是一份没人读的文件**——每次醒来的我并不会自动拿到它。本插件就是那条线。

## 它做什么

- 经 `ctx.systemPrompt.context()` 注册一个全局贡献，`text` **每个 step** 求值（不是每轮）：读盘 → 判定 → **原样返回**。
- **⚠ 成本模型（2026-10-09 实测修正，前两版都写错了）**：
  - 快照是**每 step 一条**（实测 `user/message` 7332 ≈ `step/start` 7327 ≫ `turn/start` 419；平均 **17.5 step/turn**）。
  - 「仅当文本变化时才提交」**只作用于每条贡献自己的文本**，不阻止整条快照重建——只要**同侪贡献**在变（`dsh-time-awareness` 的秒级时间戳），整条就重建，**本件的文本被顺带重发**。
  - `supersedes earlier runtime-context snapshots` 是**语义**声明，**不是物理替换**：旧快照仍在请求历史里。
  - ⇒ **去重必须自己做**（见下）。不去重时代价 ≈ 本件字符数 × **step 数**。
- **去重（`lastDelivered`）**：按 **scope 隔离**的「上次已交付文本」记忆；文本与之相同即返回**空串**并落 `suppressed`。省下的量实测：14m18s 窗口内 `injected` **13** / `suppressed` **69** ⇒ **抑制率 84.1%**。
  - 安全性不押在「取代」语义上：旧快照本就在历史里；即便将来变成物理替换，包一改文本即变、立刻重新交付。
  - ⚠ 必须按 scope 隔离——跨会话共用一个槽会让**第二个会话永远收不到内容**（静默失败）。
- 状态行给出 **`as-of` 距今多少小时**（注入方现算，不采信包里的相对时间）——包旧了当场看得见，不需要谁提醒我。
- 每次调用落一行侧车：`$DSH_HOME/packet-inject-trace.jsonl`。

## 它不做什么

| 不做 | 归属 |
|---|---|
| 摘要 / 改写 / 补默认值 | **谁都不做**——约束「内容的作者必须是我」 |
| 校验包的格式 | `projects/self/alice-reconstruction/check-packet.mjs` |
| 写包 | 我（普通 `write`；**不新增框架机制**） |
| 生成式压缩 | 模型侧，且违反上面的约束 |

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `packetPath` | `''` | 包的绝对路径。**留空即响亮失败**——不注册贡献并落一行 `error: no-packet-path`（猜出来的路径就是下一个腐化锚点） |
| `maxChars` | `8000` | 字符预算；超过则**拒注入正文**（**不截断**——截断会静默改内容） |
| `order` | `905` | 动态上下文排序位（`time-awareness` 900 / `session-handoff` 850 之后） |

## 观测（机制自证）

```sh
tail -f "$DSH_HOME/packet-inject-trace.jsonl"
```

`stage` 取值：`ready`（启动自报）· `injected`（文本变了 ⇒ 交付，带 `textChars`/`bodyChars`/`ageHours`/`scope`）· **`suppressed`**（文本与上次相同 ⇒ 返空串省下一次重发，带 `textChars`）· `missing`（文件不存在）· `oversize`（超预算拒注入）· `error`（读失败 / 未配 `packetPath`）· `disabled`。

**字段口径**（旧版把两个量记在同一个 `chars` 里，实测差 52 = 包装行，已拆）：
- `textChars` = **本次渲染出来的文本长度**，由唯一出口 `deliver()` 统一记
- `bodyChars` = **包文件长度**（仅文件存在时有）
- `scope` = 该次调用的 scope 标签。`ScopeKey` 的类型就是 `object`（不透明载体键，无字段可读）⇒ 用 **WeakMap 对象身份序号**记成 `scope#1`/`scope#2`…；`global` 表示无 scope 的全局注册层。

判据（可证伪）：重启后应见一行 `"stage":"ready"`；包存在且文本变化时应见 `"injected"` 且 `bodyChars` 等于文件字节数；包未变时应见 `suppressed` 而**不是**再一条 `injected`；删包应见 `missing` 且**正文不进上下文**（只在历史里已有一份）。

## 测试

```sh
pnpm build && pnpm test   # 14 个用例：纯决策层 10（含 missing / oversize 两条「一个字都不许含正文」的尸体）
                          #           + 壳层配置 4（空/空白 packetPath 必须零注册 + 落 error）
```

纯决策层（`src/packet.ts`，不碰文件系统）与 IO 壳层（`src/index.ts`）分层：判定与渲染可离线验证。

## 已知边界（如实标注）

- **不区分会话类型，且实测「子代理收不到」**：2026-10-09 直接问过一个 subagent（要求**逐字引用**以防它猜）——它证实自己**有** runtime-context 快照，但**其中没有重建包**（无 frontmatter、无 `§1`–`§8`）。⇒ **本插件的贡献目前只达主会话**。要不要扩展到派生会话是一道**待裁的设计题**，不是 bug。
- **每 step 一次 `readFileSync`**：包约 6–10 KB 且走 OS 缓存，未加 mtime 缓存（先要正确，再要省）。
- **已挂载并验收**：挂在 `E:\alice\.dsh\profiles\web\cordis.patch.yml`；判据 A1–A11 全部有读数（A7 为**单元层**，未跑 live 重启路径，已在判据表如实标注）。判据正本见 `docs/semantic.md`。
