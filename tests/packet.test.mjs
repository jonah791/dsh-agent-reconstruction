/**
 * 纯决策层测试：`lib/packet.js`。
 *
 * 纪律：**每条判据都要有尸体样本**（喂已知坏输入、证明它会按设计亮）。
 * 本件的三个分支必须两两可分——`missing`/`oversize` **一个字都不许含正文**，
 * `injected` **必须逐字含正文**。这一对是「原样注入」的可证伪形式。
 *
 * 运行：`pnpm build && pnpm test`（从 `lib/` 导入 ⇒ 必须先构建）。
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { INJECT_HEADER, UNKNOWN, ageHours, ageText, frontmatterValue, renderInjection, scopeLabel } from '../lib/packet.js'

test('scopeLabel：不透明对象走**身份序号**，原生标量原样透传，**绝不抛错**', () => {
  // 假序号器：与壳层同构（WeakMap + 计数）
  const ids = new Map()
  let seq = 0
  const ordinalOf = (o) => {
    if (!ids.has(o)) ids.set(o, ++seq)
    return ids.get(o)
  }

  assert.equal(scopeLabel(undefined, ordinalOf), 'global', '无 scope = 全局注册层')
  assert.equal(scopeLabel(null, ordinalOf), 'null')
  assert.equal(scopeLabel('abc', ordinalOf), 'abc', '字符串原样透传（不占序号）')
  assert.equal(scopeLabel(42, ordinalOf), '42')

  // 核心：`ScopeKey = object`（不透明载体键）⇒ 唯一可用身份就是对象本身
  const a = {}
  const b = {}
  assert.equal(scopeLabel(a, ordinalOf), 'scope#1')
  assert.equal(scopeLabel(b, ordinalOf), 'scope#2')
  assert.equal(scopeLabel(a, ordinalOf), 'scope#1', '同一对象必须永远同一号')

  // 尸体样本：上一代（JSON.stringify）正是在这里退化成无用串的
  const circular = { name: 'x' }
  circular.self = circular
  assert.equal(scopeLabel(circular, ordinalOf), 'scope#3', '循环引用不再是问题——本实现根本不序列化')
  const boom = Object.create(null)
  Object.defineProperty(boom, 'bad', { enumerable: true, get() { throw new Error('boom') } })
  assert.doesNotThrow(() => scopeLabel(boom, ordinalOf), '「读属性就抛」的对象也不许炸——本实现不读属性')
})

const BODY = `---
packet: alice-reconstruction
version: 2
as-of: 2026-10-09T01:57:50+08:00
---

## §1 我是谁（指针）

> 正本：\`E:\\alice\\AGENTS.md\`。
`
const NOW = Date.parse('2026-10-09T02:00:00+08:00')
const OPTS = { maxChars: 8000, nowMs: NOW, path: 'X:\\packet.md' }

test('injected：正文**逐字**出现在注入文本里（「不改写」的可证伪形式）', () => {
  const r = renderInjection({ exists: true, chars: BODY.length, asOf: '2026-10-09T01:57:50+08:00' }, BODY, OPTS)
  assert.equal(r.stage, 'injected')
  assert.ok(r.text.includes(BODY), '注入文本必须逐字包含正文')
  assert.equal(r.bodyChars, BODY.length)
  assert.ok(r.text.startsWith(INJECT_HEADER))
})

test('missing：文件不存在 ⇒ 状态行，且**一个字都不含正文**', () => {
  const r = renderInjection({ exists: false, chars: 0, asOf: null }, BODY, OPTS)
  assert.equal(r.stage, 'missing')
  assert.ok(!r.text.includes('§1 我是谁'), 'missing 分支不许夹带正文')
  assert.ok(!r.text.includes(BODY))
  assert.equal(r.bodyChars, 0)
})

test('oversize：超预算 ⇒ 拒注入正文（**不截断**），一个字都不含', () => {
  const r = renderInjection({ exists: true, chars: BODY.length, asOf: null }, BODY, { ...OPTS, maxChars: BODY.length - 1 })
  assert.equal(r.stage, 'oversize')
  assert.ok(!r.text.includes('§1 我是谁'), 'oversize 分支不许夹带正文，也不许截断后的残片')
  assert.ok(!r.text.includes('## §'))
  assert.equal(r.bodyChars, 0)
  assert.ok(r.text.includes(String(BODY.length)), '状态行要说清实际字符数')
})

test('边界：chars === maxChars ⇒ injected（不是 oversize）', () => {
  const r = renderInjection({ exists: true, chars: BODY.length, asOf: null }, BODY, { ...OPTS, maxChars: BODY.length })
  assert.equal(r.stage, 'injected')
  assert.ok(r.text.includes(BODY))
})

test('as-of 解析不了 ⇒ 写「未知」并把原样值列出来（不猜）', () => {
  const r = renderInjection({ exists: true, chars: BODY.length, asOf: '不是时间' }, BODY, OPTS)
  assert.equal(r.stage, 'injected')
  assert.ok(r.text.includes(UNKNOWN))
  assert.ok(r.text.includes('不是时间'), '解析不了要把原样值交出去，人才好诊断')
  assert.equal(r.ageHours, null)
})

test('as-of 在未来 ⇒ 显式标注（不静默算成负数）', () => {
  const r = renderInjection({ exists: true, chars: BODY.length, asOf: '2026-10-10T00:00:00+08:00' }, BODY, OPTS)
  assert.equal(r.stage, 'injected')
  assert.ok(r.text.includes('在未来'))
})

test('ageHours：可解析给数、不可解析给 null', () => {
  assert.equal(ageHours(null, NOW), null)
  assert.equal(ageHours('坏值', NOW), null)
  const h = ageHours('2026-10-09T01:00:00+08:00', NOW)
  assert.ok(h !== null && Math.abs(h - 1) < 1e-6, `应为 1 小时，实为 ${String(h)}`)
})

test('frontmatterValue：三态可分（取到 / 无 frontmatter / 键为空）', () => {
  assert.equal(frontmatterValue(BODY, 'version'), '2')
  assert.equal(frontmatterValue(BODY, 'as-of'), '2026-10-09T01:57:50+08:00')
  assert.equal(frontmatterValue('# 没有 frontmatter\n', 'version'), null)
  assert.equal(frontmatterValue('---\nversion:\n---\n', 'version'), null, '空值给 null 而不是空串')
  assert.equal(frontmatterValue('---\nversion: 2\n', 'version'), null, '未闭合的 frontmatter 不算数')
})

test('ageText 与 ageHours 同源（不许两处各算一套）', () => {
  const t = ageText('2026-10-09T01:00:00+08:00', NOW)
  assert.ok(t.includes(ageHours('2026-10-09T01:00:00+08:00', NOW).toFixed(1)))
})
