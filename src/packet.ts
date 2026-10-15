/**
 * dsh-agent-reconstruction — 纯决策层。
 *
 * 只做判定与渲染，**不碰文件系统**（IO 在 `index.ts`），因此可离线测。
 *
 * 三条不可越约束在本层的落地：
 *
 *  ① **决策权不交给框架**：本层只**渲染给定的字节**——不摘要、不改写、不补默认值。
 *     `renderInjection` 的 `injected` 分支保证 `body` **逐字出现**在返回值里；这条
 *     由测试里的「逐字包含」断言钉住，是「不改写」的可证伪形式。
 *  ② **不假装绝对**：状态是显式枚举（`injected` / `missing` / `oversize`），没有
 *     「大概能行」；`as-of` 解析不了就写 `未知` 并把原样值列出来，**不猜**。
 *  ③ **骨架与血肉分层**：本件**不解析包内容**（不认 §1–§8、不动一个字），只为算
 *     「距今多久」取一个 `as-of`，其余原样透传。
 *
 * 反定位：不做校验（归 `check-packet.mjs`）· 不写包（归我）· 不做生成式摘要
 * （归模型侧，且违反约束①）。
 *
 * @module packet
 */

/** 取不到值时写进文本的显式占位（不猜）。 */
export const UNKNOWN = '未知'

/** 注入文本的首行：明写「原样」，好让读到的人一眼知道这未经加工。 */
export const INJECT_HEADER = '以下是我上一次写下的重建包，原样注入（未摘要、未改写、未补默认值）：'

export interface PacketFacts {
  /** 文件是否存在 */
  exists: boolean
  /** 正文字符数 */
  chars: number
  /** frontmatter 的 `as-of` 原始字符串；取不到给 `null` */
  asOf: string | null
}

export interface RenderOptions {
  /** 字符预算；超过则**拒注入正文**（不截断） */
  maxChars: number
  /** 现在（ms）——由注入方现算「距今」，不采信包里的相对时间 */
  nowMs: number
  /** 包的路径，写进状态行便于人工核对 */
  path: string
}

export type Stage = 'injected' | 'missing' | 'oversize'

export interface RenderResult {
  stage: Stage
  /** 要注入的文本；`missing` / `oversize` 时是**状态行**（不含正文） */
  text: string
  /** `injected` 时等于正文长度；否则 0 */
  bodyChars: number
  ageHours: number | null
}

/**
 * 从包文本里取第一段 frontmatter 的某个键。
 * ⚠ 不是 YAML 解析器——只按行找 `key:`，因为本件**不需要**理解包的语义。
 *
 * ⚠ **先找闭合的 `---` 再搜键**：frontmatter 未闭合时，键值可能散在正文里，
 * 那时给出一个「看起来像 as-of」的值会产生**误导性的距今读数**（§5.9 读数纪律）。
 * 宁可少认，不可给错——认不出就是 `null`，注入文本会如实写「未知」。
 */
export function frontmatterValue(text: string, key: string): string | null {
  const lines = String(text ?? '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return null
  const re = new RegExp(`^${key}:[ \\t]*(.*)$`)
  for (let i = 1; i < end; i++) {
    const m = re.exec(lines[i] ?? '')
    if (m) {
      const v = (m[1] ?? '').trim()
      return v === '' ? null : v
    }
  }
  return null
}

/**
 * 把 `assembly.scope` 渲染成**可读且稳定**的短标签——它只进侧车，**绝不抛错**。
 *
 * 三代演进（每一代的失效都是实测抓到的）：
 *  v0.1 `String(scope)` ⇒ 所有会话都记成 `"[object Object]"`，「按 scope 量影响面」拿不到数据。
 *  v0.2 `JSON.stringify(scope)` ⇒ 实测退化成 `"unserializable(circular)"`——**从一种无用串换成另一种无用串**。
 *  v0.3（本版）**不再试图读字段**：`ScopeKey` 的定义就是 `export type ScopeKey = object`
 *      （`@deepseek-ai/dsh-scope` · `lib/types/index.d.ts:11`）——它是**不透明载体键**，
 *      **没有可读字段可读**。⇒ 改用**对象身份**：同一对象永远同一个序号。
 *
 * @param value - `assembly.scope`（`ScopeKey = object`，可为 `undefined` ⇒ 全局注册层）
 * @param ordinalOf - 对象 → 稳定序号；调用方持有 WeakMap 与计数器，本函数保持**纯**
 */
export function scopeLabel(value: unknown, ordinalOf: (o: object) => number): string {
  if (value === undefined) return 'global'
  if (value === null) return 'null'
  if (typeof value === 'object' || typeof value === 'function') return `scope#${ordinalOf(value as object)}`
  if (typeof value === 'symbol') return value.toString()
  return String(value)
}

/** `as-of` 距现在多少小时；取不到或解析不了给 `null`（不猜）。 */
export function ageHours(asOf: string | null, nowMs: number): number | null {
  if (asOf === null) return null
  const t = Date.parse(asOf)
  if (Number.isNaN(t)) return null
  return (nowMs - t) / 3_600_000
}

/** 「距今」那一行。解析不了就照实说，并把原样值列出来。 */
export function ageText(asOf: string | null, nowMs: number): string {
  const h = ageHours(asOf, nowMs)
  if (h === null) return `as-of：${UNKNOWN}（无法解析；原样值：${asOf ?? '缺失'}）`
  const note = h < 0 ? '（**在未来**——时钟或包有问题，请先怀疑这一点）' : ''
  return `as-of：距今 ${h.toFixed(1)} 小时${note}`
}

/**
 * 渲染要注入的文本（**纯函数**）。
 *
 * 三个分支都在测试里有尸体样本：`missing` / `oversize` 必须**一个字都不含正文**，
 * `injected` 必须**逐字包含正文**。
 */
export function renderInjection(facts: PacketFacts, body: string, opts: RenderOptions): RenderResult {
  if (!facts.exists) {
    return {
      stage: 'missing',
      text: `重建包：不存在（${opts.path}）——本轮没有来自上一个我的材料。`,
      bodyChars: 0,
      ageHours: null,
    }
  }
  if (facts.chars > opts.maxChars) {
    return {
      stage: 'oversize',
      text: `重建包：超预算未注入（${facts.chars} > ${opts.maxChars} 字符，${opts.path}）——不截断，因为截断会静默改内容。`,
      bodyChars: 0,
      ageHours: ageHours(facts.asOf, opts.nowMs),
    }
  }
  return {
    stage: 'injected',
    text: `${INJECT_HEADER}\n${ageText(facts.asOf, opts.nowMs)}\n\n${body}`,
    bodyChars: body.length,
    ageHours: ageHours(facts.asOf, opts.nowMs),
  }
}
