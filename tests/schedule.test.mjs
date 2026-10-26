import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-sched-home-'))
const { normalizeConfig, nextAtForTimes, computeNextAt, isInQuietHours, rebuildState, fmtHHMM } =
  await import('../index.js')

const at = (h, m, day = 26) => new Date(2026, 9, day, h, m, 0, 0).getTime()
const hm = (ts) => fmtHHMM(Math.floor((ts - at(0, 0)) / 60000) % 1440)

/** 固定“当前时间”，用于依赖 new Date() / Date.now() 的逻辑 */
function withNow(ts, fn) {
  const Real = Date
  class Fixed extends Real {
    constructor(...args) {
      if (args.length === 0) super(ts)
      else super(...args)
    }
    static now() {
      return ts
    }
  }
  globalThis.Date = Fixed
  try {
    return fn()
  } finally {
    globalThis.Date = Real
  }
}

test('nextAtForTimes 取当天剩余的最近时间点', () => {
  const ts = nextAtForTimes(['09:00', '18:00'], at(10, 0))
  assert.equal(hm(ts), '18:00')
})

test('nextAtForTimes 当天已过则顺延到明天', () => {
  const ts = nextAtForTimes(['09:00'], at(10, 0))
  assert.equal(hm(ts), '09:00')
  assert.equal(new Date(ts).getDate(), 27)
})

test('nextAtForTimes 忽略非法项，全非法返回 null', () => {
  assert.equal(nextAtForTimes(['x', '25:00'], at(10, 0)), null)
  assert.equal(nextAtForTimes([], at(10, 0)), null)
  assert.equal(nextAtForTimes(['09:00', 'x'], at(8, 0)), at(9, 0))
})

test('computeNextAt 间隔模式按分钟推进，禁用返回 null', () => {
  const cfg = normalizeConfig({ reminders: { water: { interval: 30 }, meal: { enabled: false } } })
  assert.equal(computeNextAt(cfg, 'water', at(10, 0)), at(10, 30))
  assert.equal(computeNextAt(cfg, 'meal', at(10, 0)), null)
})

test('computeNextAt 时间点模式走 nextAtForTimes', () => {
  const cfg = normalizeConfig({ reminders: { sleep: { mode: 'times', times: ['23:00'] } } })
  assert.equal(computeNextAt(cfg, 'sleep', at(10, 0)), at(23, 0))
})

test('isInQuietHours 未启用恒为 false', () => {
  const cfg = normalizeConfig({ quietHours: { enable: false, start: '00:00', end: '23:59' } })
  assert.equal(withNow(at(10, 0), () => isInQuietHours(cfg)), false)
})

test('isInQuietHours 当日区间内外', () => {
  const cfg = normalizeConfig({ quietHours: { enable: true, start: '09:00', end: '18:00' } })
  assert.equal(withNow(at(8, 59), () => isInQuietHours(cfg)), false)
  assert.equal(withNow(at(9, 0), () => isInQuietHours(cfg)), true)
  assert.equal(withNow(at(17, 59), () => isInQuietHours(cfg)), true)
  assert.equal(withNow(at(18, 0), () => isInQuietHours(cfg)), false)
})

test('isInQuietHours 跨零点', () => {
  const cfg = normalizeConfig({ quietHours: { enable: true, start: '22:00', end: '08:00' } })
  assert.equal(withNow(at(23, 0), () => isInQuietHours(cfg)), true)
  assert.equal(withNow(at(3, 0), () => isInQuietHours(cfg)), true)
  assert.equal(withNow(at(12, 0), () => isInQuietHours(cfg)), false)
})

test('isInQuietHours 对 start === end 的无效配置不生效', () => {
  const cfg = normalizeConfig({ quietHours: { enable: true, start: '12:00', end: '12:00' } })
  assert.equal(withNow(at(12, 30), () => isInQuietHours(cfg)), false)
})

test('rebuildState 配置未变且下次时间在未来时保留原计划', () => {
  const cfg = normalizeConfig({ reminders: { water: { interval: 60 } } })
  const first = withNow(at(10, 0), () => rebuildState(cfg, null))
  const planned = first.water.nextAt
  // 用户只是打开设置又保存，plan 完全一致 → 不应重置计时
  const second = withNow(at(10, 20), () => rebuildState(cfg, first))
  assert.equal(second.water.nextAt, planned)
})

test('rebuildState 配置变化时重算下次时间', () => {
  const cfg = normalizeConfig({ reminders: { water: { interval: 60 } } })
  const first = withNow(at(10, 0), () => rebuildState(cfg, null))
  const changed = normalizeConfig({ reminders: { water: { interval: 15 } } })
  const second = withNow(at(10, 5), () => rebuildState(changed, first))
  assert.equal(second.water.nextAt, at(10, 20))
})

test('rebuildState 禁用的提醒不排期', () => {
  const cfg = normalizeConfig({ reminders: { water: { enabled: false } } })
  const st = withNow(at(10, 0), () => rebuildState(cfg, null))
  assert.equal(st.water.nextAt, null)
})

test('rebuildState 重新启用时立即排期', () => {
  const off = normalizeConfig({ reminders: { water: { enabled: false } } })
  const st1 = withNow(at(10, 0), () => rebuildState(off, null))
  const on = normalizeConfig({ reminders: { water: { enabled: true, interval: 30 } } })
  const st2 = withNow(at(10, 0), () => rebuildState(on, st1))
  assert.equal(st2.water.nextAt, at(10, 30))
})
