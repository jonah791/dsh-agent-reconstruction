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
export declare const UNKNOWN = "\u672A\u77E5";
/** 注入文本的首行：明写「原样」，好让读到的人一眼知道这未经加工。 */
export declare const INJECT_HEADER = "\u4EE5\u4E0B\u662F\u6211\u4E0A\u4E00\u6B21\u5199\u4E0B\u7684\u91CD\u5EFA\u5305\uFF0C\u539F\u6837\u6CE8\u5165\uFF08\u672A\u6458\u8981\u3001\u672A\u6539\u5199\u3001\u672A\u8865\u9ED8\u8BA4\u503C\uFF09\uFF1A";
export interface PacketFacts {
    /** 文件是否存在 */
    exists: boolean;
    /** 正文字符数 */
    chars: number;
    /** frontmatter 的 `as-of` 原始字符串；取不到给 `null` */
    asOf: string | null;
}
export interface RenderOptions {
    /** 字符预算；超过则**拒注入正文**（不截断） */
    maxChars: number;
    /** 现在（ms）——由注入方现算「距今」，不采信包里的相对时间 */
    nowMs: number;
    /** 包的路径，写进状态行便于人工核对 */
    path: string;
}
export type Stage = 'injected' | 'missing' | 'oversize';
export interface RenderResult {
    stage: Stage;
    /** 要注入的文本；`missing` / `oversize` 时是**状态行**（不含正文） */
    text: string;
    /** `injected` 时等于正文长度；否则 0 */
    bodyChars: number;
    ageHours: number | null;
}
/**
 * 从包文本里取第一段 frontmatter 的某个键。
 * ⚠ 不是 YAML 解析器——只按行找 `key:`，因为本件**不需要**理解包的语义。
 *
 * ⚠ **先找闭合的 `---` 再搜键**：frontmatter 未闭合时，键值可能散在正文里，
 * 那时给出一个「看起来像 as-of」的值会产生**误导性的距今读数**（§5.9 读数纪律）。
 * 宁可少认，不可给错——认不出就是 `null`，注入文本会如实写「未知」。
 */
export declare function frontmatterValue(text: string, key: string): string | null;
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
export declare function scopeLabel(value: unknown, ordinalOf: (o: object) => number): string;
/** `as-of` 距现在多少小时；取不到或解析不了给 `null`（不猜）。 */
export declare function ageHours(asOf: string | null, nowMs: number): number | null;
/** 「距今」那一行。解析不了就照实说，并把原样值列出来。 */
export declare function ageText(asOf: string | null, nowMs: number): string;
/**
 * 渲染要注入的文本（**纯函数**）。
 *
 * 三个分支都在测试里有尸体样本：`missing` / `oversize` 必须**一个字都不含正文**，
 * `injected` 必须**逐字包含正文**。
 */
export declare function renderInjection(facts: PacketFacts, body: string, opts: RenderOptions): RenderResult;
