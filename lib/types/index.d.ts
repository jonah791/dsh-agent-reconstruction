/**
 * dsh-agent-reconstruction — IO 壳层。
 *
 * **唯一作用**：把我自己写下的重建包读出来、**原样**注入为动态上下文快照。
 *
 * 落位机制（**2026-10-09 实测修正**，初版注释按 2026-09-23 的猜测写错了）：
 * `ctx.systemPrompt.context()` 的贡献由 agent-loop 在**每个 step**（每次模型请求）开头物化为
 * 一条 `user/message` 快照——`step/start` 之后紧跟一条 `user/message`。
 *   - 读数：会话 54776 事件里含 runtime-context 前缀的 `user/message` **7332** 条，
 *     而 `step/start` **7327** 条、`turn/start` 仅 **419** 条 ⇒ **每 step 一条，不是每 turn 一条**。
 *   - 旧快照**不被物理移除**：前缀里的 `supersedes earlier runtime-context snapshots` 是
 *     **语义**声明（告诉模型以最新的为准），不是替换。判据：同一条快照的 `as-of：距今 N 小时`
 *     在历史里保留着各自当时的值（2.8 → 2.9 → 3.0 都在），若被替换则只剩最新值。
 *   - 复现它的**不是**本件文本变化：秒级时间戳的同侪贡献（`dsh-time-awareness`）每 step 都变，
 *     整条快照随之重建，**本件的 4882 字符被顺带重发**。
 * ⇒ 成本 ≈ 本件字符数 × step 数（平均 **17.5 step/turn**），**初版的「包不变就不重复占空间」是错的**。
 * 缓解见下方 `lastDelivered`：文本与上次相同即返回空串（对两种模型都安全——旧快照本就在历史里）。
 *
 * 三条不可越约束在本层的落地：
 *  ① **决策权不交给框架**：只读字节、原样注入。判定与渲染在 `packet.ts`（纯层，可离线测）。
 *  ② **不假装绝对**：每次调用都落一行侧车（`injected` / `missing` / `oversize` / `error`），
 *     外加启动自报 `ready`——「装了」与「在工作」在观测上必须长得不一样。
 *  ③ **骨架与血肉分层**：本件不识别包内容，不做任何改写。
 *
 * 反定位：不写包（归我）· 不校验包（归 `check-packet.mjs`）· 不做生成式摘要。
 *
 * ⚠ 已知边界（v0.1）：**不区分会话类型**——子代理会话同样会拿到这份快照。是否该收窄成
 * 「只主会话」留作下一步的探测项（侧车已经记下每次调用的 `scope`，可据它判定影响面）。
 *
 * @module dsh-agent-reconstruction
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** 插件名（与 `cordis.patch.yml` 的 id `agent-reconstruction` 对齐）。 */
export declare const name = "agent-reconstruction";
/** 只依赖系统提示词装配服务（声明式，不用 `ctx.get()` 探测——探测会与加载顺序赛跑）。 */
export declare const inject: readonly ["systemPrompt"];
export interface Config {
    enabled: boolean;
    /** 包的绝对路径；**留空即响亮失败**（不猜路径——猜出来的路径就是下一个腐化锚点） */
    packetPath: string;
    /** 字符预算；超过则拒注入正文（不截断） */
    maxChars: number;
    /** 动态上下文的排序位（越大越靠后） */
    order: number;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    enabled: z<boolean, boolean, "defined">;
    packetPath: z<string, string, "defined">;
    maxChars: z<number, number, "defined">;
    order: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: z<boolean, boolean, "defined">;
    packetPath: z<string, string, "defined">;
    maxChars: z<number, number, "defined">;
    order: z<number, number, "defined">;
}>>, "plain">;
export declare function apply(ctx: Context, config: Config): void;
