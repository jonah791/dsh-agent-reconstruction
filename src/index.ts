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

import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'
// 声明合并：`ctx.systemPrompt` 由 `@deepseek-ai/dsh-system-prompt` 提供，该包必须进入编译单元。
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { frontmatterValue, renderInjection, scopeLabel } from './packet.js'

/** 插件名（与 `cordis.patch.yml` 的 id `agent-reconstruction` 对齐）。 */
export const name = 'agent-reconstruction'

/** 只依赖系统提示词装配服务（声明式，不用 `ctx.get()` 探测——探测会与加载顺序赛跑）。 */
export const inject = ['systemPrompt'] as const

export interface Config {
  enabled: boolean
  /** 包的绝对路径；**留空即响亮失败**（不猜路径——猜出来的路径就是下一个腐化锚点） */
  packetPath: string
  /** 字符预算；超过则拒注入正文（不截断） */
  maxChars: number
  /** 动态上下文的排序位（越大越靠后） */
  order: number
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  packetPath: z.string().default(''),
  maxChars: z.number().default(8000),
  order: z.number().default(905),
})

interface TraceLine {
  /** `suppressed` = 本轮文本与上次相同、刻意返回空串（见 `lastDelivered`）。 */
  stage: 'ready' | 'injected' | 'suppressed' | 'missing' | 'oversize' | 'error' | 'disabled'
  [key: string]: unknown
}

/** 侧车轨迹：一行一阶段，可 tail/grep。观测失败**绝不影响主流程**（§5.24）。 */
function trace(line: TraceLine): void {
  try {
    const dir = process.env.DSH_HOME ?? ''
    if (dir === '') return
    appendFileSync(join(dir, 'packet-inject-trace.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), plugin: name, ...line })}\n`)
  } catch {
    // 观测面坏掉不许反噬主流程（静默，但有意的：这里没有更好的上报通道）。
  }
}

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) {
    trace({ stage: 'disabled' })
    return
  }
  if (config.packetPath.trim() === '') {
    // 响亮失败：不注册任何贡献，并且**留下证据**。留空默认值等于静默空转。
    trace({ stage: 'error', reason: 'no-packet-path' })
    ctx.logger?.warn?.('[agent-reconstruction] packetPath 为空：未注册注入（请检查挂载配置）')
    return
  }

  const packetPath = config.packetPath

  /**
   * 已交付文本的记忆，**按会话隔离**（跨会话共用一个槽会让第二个会话拿到空串而永远收不到包）。
   *
   * 为什么要去重：同侪贡献（`dsh-time-awareness` 的秒级时间戳）每 step 都变 ⇒ 整条 runtime-context
   * 快照每 step 重建，本件若照旧返回全文，4882 字符就被**顺带重发**一次（实测每 step 一次，
   * 平均 17.5 step/turn）。文本没变 ⇒ 历史里已经有一份，返回空串即省下这份重复。
   *
   * 安全性不押在「取代」语义上：旧快照不被移除（已证）⇒ 不返也不会丢；即便将来行为变成物理替换，
   * 包一改文本即变、立刻重新交付，最坏是「变化前的那些 step 看不到包」——而它们本就在上文里。
   */
  const lastDelivered = new Map<string, string>()

  /**
   * `scope` 对象 → **稳定序号**。为什么要这么绕：`ScopeKey` 的定义就是 `object`
   * （`@deepseek-ai/dsh-scope` · `lib/types/index.d.ts:11`）——它是**不透明载体键**，
   * 没有可读字段。`String()` 给 `[object Object]`、`JSON.stringify` 给
   * `unserializable(circular)`，都等于没记（两代都实测过）。
   * ⇒ 唯一可用的身份就是**对象本身**：WeakMap 记序，同一对象永远同一号；
   *   于是侧车可以直接回答「这个插件一共服务了几个不同的 scope」。
   */
  const scopeIds = new WeakMap<object, number>()
  let scopeSeq = 0
  const ordinalOf = (o: object): number => {
    const seen = scopeIds.get(o)
    if (seen !== undefined) return seen
    scopeSeq += 1
    scopeIds.set(o, scopeSeq)
    return scopeSeq
  }

  /**
   * 统一出口：文本与上次相同则返空串并落 `suppressed`，否则落该 stage 并记住文本。
   *
   * `textChars` 由本函数统一记（= 本次渲染出来的文本长度）——**不再用含糊的 `chars`**：
   * 旧版 `chars` 在 `injected` 行记的是**包文件长度**、在 `suppressed` 行记的是**渲染文本长度**，
   * 同名字段两个量（实测差 52 = 包装行），会污染以后每一次用它做的判断。
   */
  const deliver = (text: string, stage: TraceLine['stage'], extra: Record<string, unknown>, scope: string): string => {
    const textChars = text.length
    if (lastDelivered.get(scope) === text) {
      trace({ stage: 'suppressed', scope, path: packetPath, textChars })
      return ''
    }
    lastDelivered.set(scope, text)
    trace({ stage, scope, path: packetPath, textChars, ...extra })
    return text
  }

  const dispose = ctx.systemPrompt.context({
    name: 'agent-reconstruction',
    order: config.order,
    text: (assembly) => {
      const scope = scopeLabel(assembly?.scope, ordinalOf)
      try {
        statSync(packetPath)
      } catch {
        const r = renderInjection({ exists: false, chars: 0, asOf: null }, '', {
          maxChars: config.maxChars,
          nowMs: Date.now(),
          path: packetPath,
        })
        return deliver(r.text, r.stage, {}, scope)
      }

      let body = ''
      try {
        body = readFileSync(packetPath, 'utf8')
      } catch (err) {
        const text = `重建包：读取失败（${packetPath}）——本轮没有来自上一个我的材料。`
        return deliver(text, 'error', { reason: String((err as Error)?.message ?? err) }, scope)
      }

      const r = renderInjection({ exists: true, chars: body.length, asOf: frontmatterValue(body, 'as-of') }, body, {
        maxChars: config.maxChars,
        nowMs: Date.now(),
        path: packetPath,
      })
      return deliver(r.text, r.stage, { bodyChars: r.bodyChars, ageHours: r.ageHours }, scope)
    },
  })

  ctx.effect(() => dispose, 'agent-reconstruction.context')

  // 启动自报：没有这一行，「没加载」与「加载了但从未被调用」在外部观测上完全一样。
  // `build` = **本模块产物的 mtime**（§5.22 五问①「线上跑的是哪个构建」）。
  // 它同时是「热重载到底重载了什么」的判据：改代码 + 重建后，若 ready 行的 `build` 变了
  // 而进程**没有**重启，即证热重载覆盖代码；若 `build` 不变，则代码只在重启时更新。
  let build = 'unknown'
  try {
    build = String(Math.round(statSync(fileURLToPath(import.meta.url)).mtimeMs))
  } catch {
    // 观测失败不反噬主流程；'unknown' 本身也是读数（它说明自证面坏了）。
  }
  trace({ stage: 'ready', build, order: config.order, maxChars: config.maxChars, packetPath })
}
