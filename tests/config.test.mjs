/**
 * 壳层配置分支的回归测试。
 *
 * 存在理由：A7（「空 `packetPath` ⇒ 响亮失败」）原本要靠「改 profile 配置 + 重启两次」验证——
 * 那是一次性、昂贵、且**不留防线**的做法。这条分支是 `apply()` 里的一小段决定，
 * 用假 ctx 直接驱动它即可，于是把一次性验证升级成**永久回归夹具**。
 *
 * 覆盖：① 空 `packetPath` 与只有空白的 `packetPath` 都必须**不注册贡献**且落 `error`；
 *      ② `enabled:false` 落 `disabled`；③ 正常配置注册一次贡献并落 `ready`。
 *
 * 隔离：`trace()` 按 `process.env.DSH_HOME` 写侧车 ⇒ 每个用例给一个临时目录，不碰真侧车。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { apply } = await import('../lib/index.js')

/** 假 ctx + 隔离的侧车目录；返回可断言的调用计数与侧车行。 */
function harness() {
  const home = mkdtempSync(join(tmpdir(), 'ar-config-'))
  process.env.DSH_HOME = home
  const calls = { context: 0, warn: 0, effect: 0 }
  const ctx = {
    systemPrompt: {
      context: () => {
        calls.context += 1
        return () => {}
      },
    },
    effect: () => {
      calls.effect += 1
    },
    logger: {
      warn: () => {
        calls.warn += 1
      },
    },
  }
  const tracePath = join(home, 'packet-inject-trace.jsonl')
  const lines = () =>
    existsSync(tracePath)
      ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []
  return { ctx, calls, lines }
}

test('A7 · packetPath 为空 ⇒ 不注册贡献，落 error: no-packet-path', () => {
  const h = harness()
  apply(h.ctx, { enabled: true, packetPath: '', maxChars: 8000, order: 905 })
  assert.equal(h.calls.context, 0, '空路径不许注册任何上下文贡献')
  const l = h.lines()
  assert.equal(l.length, 1)
  assert.equal(l[0].stage, 'error')
  assert.equal(l[0].reason, 'no-packet-path')
  assert.equal(h.calls.warn, 1, '响亮失败必须同时留日志')
})

test('A7 · packetPath 只有空白 ⇒ 同一条响亮失败（trim 后判）', () => {
  const h = harness()
  apply(h.ctx, { enabled: true, packetPath: '   \t ', maxChars: 8000, order: 905 })
  assert.equal(h.calls.context, 0)
  assert.equal(h.lines()[0].reason, 'no-packet-path')
})

test('enabled=false ⇒ 不注册贡献，落 disabled', () => {
  const h = harness()
  apply(h.ctx, { enabled: false, packetPath: 'C:\\whatever\\p.md', maxChars: 8000, order: 905 })
  assert.equal(h.calls.context, 0)
  assert.equal(h.lines()[0].stage, 'disabled')
})

test('正常配置 ⇒ 注册恰好一次贡献，落 ready 且携带 order', () => {
  const h = harness()
  apply(h.ctx, { enabled: true, packetPath: 'C:\\nope\\does-not-exist.md', maxChars: 8000, order: 905 })
  assert.equal(h.calls.context, 1)
  assert.equal(h.calls.effect, 1, '注册的贡献必须挂上注销 effect')
  const ready = h.lines().find((x) => x.stage === 'ready')
  assert.ok(ready, '必须落 ready 自报（否则「没加载」与「加载了没被调用」不可区分）')
  assert.equal(ready.order, 905)
})
