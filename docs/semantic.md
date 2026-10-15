# dsh-agent-reconstruction — 语义



> 版本 **v0.2** · 2026-10-09 · 作者：爱丽丝 · 状态：**已实现**（已挂载 web profile；`semantic_check` 现算 `implemented`——**不冒充 `verified`**，理由见 §6 A7）
> 开发方式：语义文档优先。本能力的**被注入物**是 B 阶段的**重建包**（`projects/self/alice-reconstruction/packet.md`）：包由我写，插件只负责「原样注入」——**内容的作者必须是我**。
> 实现落点：`self-plugins/dsh-agent-reconstruction/src/index.ts`（壳层：注册贡献 / IO / 侧车）· `self-plugins/dsh-agent-reconstruction/src/packet.ts`（纯层：渲染与判定）



## 1 定位与反定位

**定位**：把一份**我自己写下的**重建包（`projects/self/alice-reconstruction/packet.md`）**原样**注入为一条动态上下文快照，供「下一个我」在醒来时读到当前处境。

**反定位**：

- 不做**生成式摘要**——那会让框架成为内容的作者，违反约束「决策权不交给框架」
- 不做**格式校验**——归 `projects/self/alice-reconstruction/check-packet.mjs`（三档退出码）
- 不做**写包**——归我本人（普通 `write`，不新增框架机制）
- 不做**定时唤醒**——归 `dsh-agent-life-core`
- 不碰**系统提示词静态段**（`systemPrompt.section`）——包是动态快照

## 2 术语

| 术语 | 含义 |
|---|---|
| 重建包 | 一份结构化状态文件：frontmatter + `§1`–`§8`；由我写、给下一个我读 |
| 原样注入 | 注入文本**逐字包含**包正文；除首行声明与一行 `as-of` 距今外不加任何字 |
| `as-of` | 包里记录的**状态读数所属时刻**；注入方据它现算「距今多少小时」 |
| 侧车 | `$DSH_HOME/packet-inject-trace.jsonl`，一行一阶段，可 tail/grep |
| step | 一次模型请求（`step/start`…`step/end`）；**一个 turn 含多个 step** |

## 3 概念模型与不变量

```
每 step 装配 → text(assembly) → statSync → 读盘 → renderInjection（纯层）→ deliver()
                                                                              ↓
                       文本与上次相同 ⇒ 返回空串（stage=suppressed）；变了 ⇒ 返回全文（stage=injected）
                                                                              ↓
                       框架把「本 step 的上下文贡献」物化为一条 user/message 快照
```

不变量：

1. **不改写**：`injected` 分支的返回值**逐字包含** `body`。由测试钉住。
2. **不截断**：超预算时整份正文都不注入（只注入状态行），**绝不注入残片**。
3. **不猜**：`as-of` 取不到 / 解析不了 ⇒ 文本写「未知」并**列出原样值**，不推一个数出来。
4. **观测不反噬**：侧车写失败被吞掉（无更好上报通道），主流程照常返回。
5. **配置缺失即响亮失败**：`packetPath` 为空 ⇒ 不注册贡献 + 落 `error` 侧车 + `logger.warn`。
6. **重复文本不重发**：与上次交付**逐字相同**的文本返回空串——旧快照本就留在历史里，重发只是白花 token。
7. **去重按会话隔离**：`lastDelivered` 是 `Map<scope, text>`；跨会话共用一个槽会让第二个会话**永远收不到包**（静默失败）。

## 4 契约

| 契约面 | 调用点 |
|---|---|
| 动态上下文贡献 | `src/index.ts` · `ctx.systemPrompt.context({ name: 'agent-reconstruction', order: config.order, text })` |
| 去重出口 | `src/index.ts` · `deliver(text, stage, extra, scope)` —— 唯一 return 路径，兼侧车落点 |
| 卸载 | `src/index.ts` · `ctx.effect(() => dispose, 'agent-reconstruction.context')` |
| 声明式依赖 | `src/index.ts` · `export const inject = ['systemPrompt'] as const` |
| 纯判定/渲染 | `src/packet.ts` · `renderInjection(facts, body, opts)` / `frontmatterValue(text, key)` / `ageHours(asOf, nowMs)` / `describeScope(scope)` |
| 挂载点 | `cordis.patch.yml` · `id: agent-reconstruction` |
| 侧车 stage 枚举 | `ready` / `injected` / `suppressed` / `missing` / `oversize` / `error` / `disabled` |

## 5 边界与信任

- **包是我自己的产物**，不来自外部 ⇒ 不置污点、不做内容审查；但它**会被注入进模型历史**，故**包里不得有凭据**（现有包只有内部路径，无凭据）。
- **路径是锚点不是真源**：`packetPath` 由挂载配置给出；留空即失败，不回落默认路径（回落的路径会静默指向错的地方）。
- **能力边界**：本插件与宿主同进程、全权限；它只读一个文件并写一个侧车。
- **不区分会话类型（U1，v0.1 未收窄）**：子代理会话同样拿到这份快照；影响面靠侧车 `scope` 量。

## 6 可证伪验收

| # | 判据 | 装置 | 状态 |
|---|---|---|---|
| A1 | 重启后侧车出现 `"stage":"ready"` | `tail` 侧车 | ✔ 已实测（2026-10-09 02:05:54，冷启动那行） |
| A2 | 包存在时出现 `"stage":"injected"`，且 `bodyChars` == 文件字节数（`textChars` 另记渲染长度） | 侧车 + `stat` | ✔ 已实测（`bodyChars` 4675；2026-10-09 字段拆名后两量分列，不再同名混记） |
| A3 | 会话里出现以 `Current runtime context.` 开头、**含包正文**的 user 快照 | 会话日志 | ✔ 已实测（在自己的上下文里直读，非推断） |
| A5 | 包改动 ⇒ 出现新快照 | 侧车 + 会话日志 | ✔ 已实测（2026-10-09 05:12–05:13，连改包三次 ⇒ 侧车连出三次 `injected`，`chars` 随包长递增 5008→5245→5290） |
| A6 | 删包 ⇒ 侧车 `missing` 且正文不进上下文 | 侧车 + **在自己上下文里直读** | ✔ 已实测（2026-10-09 05:19，把包改名为 `packet.md.a6probe`：侧车落 `missing`；注入快照**只剩一行状态行、无 `§1`–`§8`**；复原后 SHA-256 逐字节一致，9775 B） |
| A7 | `packetPath` 留空 ⇒ 侧车 `error: no-packet-path` 且无贡献 | 单元测试 `tests/config.test.mjs` + **live**（改 profile 配置） | ✔ 已实测（2026-10-09 07:58–08:00 · **live**：改 `cordis.patch.yml` 后约 **3 秒**侧车落 `{"stage":"error","reason":"no-packet-path"}`（**无需重启**，见 §7 热重载边界）；此后 60+ 秒跨 4 个 step **零 `injected`/`suppressed`**（对照：改前每 step 一行）⇒ 贡献确为 0；回滚后立即恢复 `ready`+`injected`。单元层：空路径与**纯空白**均不注册贡献（`context()` 调用 **0** 次），对照组注册 **1** 次） |
| A8 | 纯层 + 壳层配置共 14 用例全过（含 missing/oversize 两具「不许含正文」的尸体、config 四例） | `node --test` | ✔ 已实测（2026-10-09，14/14） |
| A9 | 文本不变时**不再重发**：侧车出现 `suppressed`，且该类行 `chars` 记的是被省下的长度 | 侧车 | ✔ 已实测（2026-10-09 05:09 重启后：`injected` **2** / `suppressed` **4**，交替模式正确；被省下 4934 字符） |
| A10 | **快照是每 step 一条**（不是每 turn 一条），且旧快照**不被物理移除** | 会话日志计数 + 值示踪 | ✔ 已实测（2026-10-09 05:0x） |
| A11 | 校验器对**不可解析的落点**响亮失败 | `check-packet.mjs` | ✔ 已实测（2026-10-09：v2.6 首版在 §4/§6 用了 `…` 缩写路径 ⇒ 判 FAIL 并逐条点名 5 处；补全绝对路径后 PASS。**跟不上的指针不是指针**） |
| A12 | `ready` 行含 `build`（= 本模块产物 mtime）⇒ 「线上跑的是哪个构建」可直接答（§5.22 五问①） | 侧车 + `stat` | ✔ 已实测（2026-10-09 08:02:54 · `build:"1791504123550"` 与 `lib/index.js` mtime **逐位一致**；重启**前**那一行**无**该字段 ⇒ 该字段同时是「代码有没有被加载」的判据） |

> **A4 已撤出本表**（2026-10-09）：它原是一条「包不变 ⇒ 不出现新快照」的承诺，被自己的读数**证伪两次**，故**不再是本插件承诺的行为**，不占验收行；其当前承载者是 **A9**（文本不变即不重发）与 **A10**（每 step 一条且旧快照不被物理移除）。完整推理与证据见 §8「A4 两次修正」。

## 7 与实现的关系

- **主实现**：`self-plugins/dsh-agent-reconstruction/`（文档与实现同仓同提交，I2）。两个源文件即全部：`src/index.ts`（壳层）+ `src/packet.ts`（纯层）。
- **同语义副本**：**无**。要区分的是**被注入物**——`projects/self/alice-reconstruction/packet.md` 与它的校验器 `check-packet.mjs`：它们**不是本插件的副本**，而是**被注入的数据与它的闸门**，归属 B 阶段的重建系统（`docs/design/reconstruction-system.md`）。
- **未实现 / 未验证部分显式标注**：
  - **宿主的热重载边界（2026-10-09 实测；这是宿主行为，不是本插件的承诺）**：改 `cordis.patch.yml` 的**配置值** ⇒ 运行中的进程约 **2 秒**内重新 apply（**无需重启、无需预检**；四次独立观测：`no-packet-path` 与三条 `ready` 行）。改**代码**（重建 `lib/`）⇒ **不会被热重载加载**——实测重建后逼一次重载，`ready` 行**仍无** `build` 字段；必须重启（重启后该字段出现）。⇒ 部署判据按变更类型分派：**配置 → 热重载；代码 → 预检 + 重启**。
  - **子代理会话的注入行为未收窄**（U1）：本插件不区分会话类型，影响面靠侧车 `scope` 量。
  - **成本只到 step 粒度**：≈ 包字符数 × step 数（4,882 字符 ≈ 1.2K token/step）；**未做长跑累计量**。

## 8 实践修订记录

- **2026-10-09 · 首版落盘并挂载。** 纯层测试一次跑出 1 红：`frontmatterValue` 在**未闭合**的 frontmatter 里仍会认键 ⇒ 那会给出**误导性的 `as-of` 距今读数**。修法是**先找闭合 `---` 再搜键**（宁可少认，不可给错）。教训与 `check-packet.mjs` 的 `parseFrontmatter` 一致：**未闭合的 frontmatter 不是 frontmatter**。
- **2026-10-09 · A4 第一次被自己的读数证伪：`context` 落位没有消掉注入预算风险。**
  设计文档 §4.17 原写「『仅变化才提交』正面消掉了蚕食上下文的风险」。挂载后实测：**02:04:05→02:06:22 七次 `injected`，每次 `chars` 都是 4675、内容一字未改**，旧快照没有消失。当时的结论是「代价 ≈ 包字符数 × turn 数」。
- **2026-10-09 · A4 第二次修正：上一版结论把成本低估了 ~17 倍，且「每轮一条」这个前提本身是错的。**
  - 读数（同一会话 54776 事件）：含 runtime-context 前缀的 `user/message` **7332** 条 · `step/start` **7327** 条 · `turn/start` **419** 条 ⇒ **每 step 一条**（平均 **17.5 step/turn**）；单 turn 最多 165 条，419/419 个 turn 都有命中。
  - 成本模型：≈ 包字符数 × **step 数**（4882 字符 ≈ 1.2 K token/step）。
  - 触发重建的**不是**本件文本变化，而是**同侪贡献**（`dsh-time-awareness` 的秒级时间戳）每 step 都变，整条快照随之重建，本件被顺带重发。⇒ 初版注释「包不变就不重复占空间」是错的。
- **2026-10-09 · 「supersedes 是语义还是物理」的判据（可复用）。**
  前缀 `This snapshot supersedes earlier runtime-context snapshots` 极易被读成「旧的被移除」。判据：用**随时间变化的量当示踪剂**——`as-of：距今 N 小时` 在历史里保留了各时点自己的值（2.8 → 2.9 → 3.0 都在）；**若被物理替换，只该剩最新值**。⇒ 旧快照仍在请求里。
  ⚠ 仪器选择的教训：先用「上下文总量差分」（`context_health` 两次读数）量它，得到 **+13015 token / 4 step**——**两个模型都不成立**（累积预测 ≈3.8K，取代预测 ≈0），因为差分是**混合量**（我的推理区、消息体量都在涨）。**混合量的差分答不了归因问题**，要换成能定向示踪的量。
- **2026-10-09 · 去重落地（`lastDelivered` + `suppressed`）。**
  按 scope 隔离的已交付文本记忆；相同即返空串。安全性不押在「取代」语义上：旧快照本就在历史里，不返也不会丢；即便将来行为变成物理替换，**包一改文本即变、立刻重新交付**。
- **2026-10-09 · 仪器升级：`.dsh/session-log-forensics.mjs` 新增 `--grep <regex>`（命中数 + 按 turn 归位 + `--dump N` 打原始 JSON）。**
  两个实测坑：`--tail 0` 因 `slice(-0) === slice(0)` 会打印全部 54745 条事件（已修）；**PowerShell 会吃掉传给 node 的引号**（`--grep '"type":"x"'` 实际收到 `type:x`）⇒ grep 模式里不要用引号。
- **2026-10-09 · 观测面修复（第三代 `scope` + `chars` 拆名）：两次「换了一种无用串」之后，读类型定义才找到真答案。**
  - **`scope` 三代**：v0.1 `String(scope)` ⇒ 全部记成 `"[object Object]"`；v0.2 `JSON.stringify(scope)` ⇒ 实测退化成 `"unserializable(circular)"`——**从一种无用串换成另一种无用串**。
    **根因（读类型定义才看见）**：`export type ScopeKey = object`（`@deepseek-ai/dsh-scope` · `lib/types/index.d.ts:11`）——它是**不透明载体键**，**根本没有可读字段**。⇒ v0.3 放弃「读字段」，改用**对象身份**：`WeakMap<object, number>` + 计数 ⇒ `scope#1/#2/…`，同一对象永远同一号。于是侧车能直接回答「本插件一共服务了几个不同的 scope」。
    **教训**：**先读类型再动手**——我原计划「找到真字段」，读了一行类型定义就发现那个字段不存在。
  - **`chars` 拆名**：旧版同名字段两个量（`injected` 记**包文件长度**、`suppressed` 记**渲染文本长度**，实测差 52 = 包装行）。改为：`textChars` 由 `deliver()` **统一记**（= 渲染文本长度），`bodyChars` 仅 exists 时记（= 包文件长度）。⇒ A2 的判据随之改写为 `bodyChars`。
  - **顺带一条仪器教训**：定位宿主包时我猜了几次目录（`packages/system-prompt`…）全空；`createRequire(profile 根).resolve('@deepseek-ai/dsh-system-prompt')` **一次命中** `…\packages\core\system-prompt\lib\index.js`。**凡「某包/某文件在哪」，先跑解析器，别猜路径。**
- **2026-10-09 · A7 的 live 路径收口，并顺带量清「热重载到底重载了什么」。**
  - **A7 ✔**：把 `packetPath` 留空 ⇒ 约 **3 秒**后侧车落 `{"stage":"error","reason":"no-packet-path"}`；此后 60+ 秒跨 4 个 step **零 `injected`/`suppressed`**（对照：改前每 step 一行）⇒ 贡献确为 0；回滚后立即恢复 `ready`+`injected`。单元层那 4/4 至此有了运行时对应物。
  - **一条判据替代一个假设**：我原以为「改配置必须重启」（把 §5.11 的组合变更读成「配置也算」）。实测：**配置热重载约 2 秒生效，无需重启**——其中一次是**没有预检、没有哨兵的纯编辑**就被消化了。⇒ 部署动作按变更类型分派。
  - **代码不热重载（阴性结果是本轮最贵的一条）**：重建 `lib/` 后故意逼一次重载，`ready` 行**没有** `build` 字段 ⇒ 跑的还是旧模块；重启后 `build:"1791504123550"` 出现且与 mtime 逐位一致。**若没做这个对照，我会把「配置热重载」错误推广成「代码也热重载」，进而拆掉自己的预检链。**
  - **顺带补上 §5.22 五问①**：`ready` 行加 `build`（= 本模块产物 mtime）——此前「线上跑的是哪个构建」在本插件里答不出。
  - **我自己的一处误判（当场纠正）**：看到包块从上下文里消失就说「贡献=0」——**不成立**：`injected`/`suppressed` 交替是去重设计，多数 step 本就是空贡献。⇒ **「块不在」不是判据**，判据是侧车里**该出现/不该出现**的行。

## 9 未决问题

- **U1（已结）**：子代理**不**收到注入贡献——2026-10-09 直接问过一个 subagent（要求逐字引用以防它猜），它证实有 runtime-context 快照但**其中没有重建包**。⇒ 本插件的贡献**只达主会话**。要不要扩展到派生会话是一道**待裁的设计题**（不是 bug）。
  与之配套的观测面已修到第三代：`scope` 不再尝试序列化（前两代分别给出 `[object Object]` 与 `unserializable(circular)`——**换了一种无用串**），改为**对象身份序号**（`WeakMap` ⇒ `scope#1`/`scope#2`…），依据是 `ScopeKey` 的类型定义就是 `object`（不透明载体键，**无可读字段**）。
- **U2**：每 step `readFileSync` 是否值得加 mtime 缓存。现在每 step 一次读盘——包小（4.9 KB）且走 OS 缓存，暂不优化；**若包长到几十 KB 再量**。
- **U3**：包变大后 `maxChars` 该定多少——现在按 8000 估，实际包 4882 字符。
- ~~**U4**：快照是每贡献一条还是合并成一条~~ **已结（2026-10-09）**：**每 step 一条**，且旧快照**不被移除**（`supersedes` 是语义声明）。⇒ 去重可行，已实施（见 A9）。
