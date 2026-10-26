import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-cfg-home-'))
const { normalizeConfig, mergeConfig, parseHHMM, fmtHHMM, DEFAULTS, REMINDER_TYPES, loadLocale, reminderText } =
  await import('../index.js')

const typeIds = REMINDER_TYPES.map((t) => t.id)

test('parseHHMM 接受合法时间并拒绝越界', () => {
  assert.equal(parseHHMM('09:30'), 570)
  assert.equal(parseHHMM('9:30'), 570)
  assert.equal(parseHHMM('23:59'), 1439)
  assert.equal(parseHHMM('24:00'), null)
  assert.equal(parseHHMM('12:60'), null)
  assert.equal(parseHHMM('7:5'), null)
  assert.equal(parseHHMM(''), null)
  assert.equal(parseHHMM(null), null)
})

test('fmtHHMM 始终补零', () => {
  assert.equal(fmtHHMM(0), '00:00')
  assert.equal(fmtHHMM(570), '09:30')
  assert.equal(fmtHHMM(1439), '23:59')
})

test('normalizeConfig 空输入落到默认值', () => {
  const c = normalizeConfig()
  assert.deepEqual(typeIds, Object.keys(c.reminders))
  assert.equal(c.reminders.water.interval, 60)
  assert.equal(c.reminders.sleep.mode, 'times')
  assert.deepEqual(c.reminders.sleep.times, ['23:00'])
  assert.equal(c.quietHours.enable, false)
})

test('interval 被夹到 1..1440 且取整', () => {
  const c = normalizeConfig({ reminders: { water: { interval: 0 }, meal: { interval: 9999 }, eye: { interval: 30.6 } } })
  assert.equal(c.reminders.water.interval, 1)
  assert.equal(c.reminders.meal.interval, 1440)
  assert.equal(c.reminders.eye.interval, 31)
})

test('times 补零、去重、按分钟排序', () => {
  const c = normalizeConfig({ reminders: { sleep: { mode: 'times', times: ['9:00', '09:00', '10:30', '7:5', ' 08:15 '] } } })
  assert.deepEqual(c.reminders.sleep.times, ['08:15', '09:00', '10:30'])
})

test('times 模式没有合法时间点时给出兜底，不会静默失效', () => {
  const c = normalizeConfig({ reminders: { sleep: { mode: 'times', times: ['oops'] } } })
  assert.equal(c.reminders.sleep.mode, 'times')
  assert.deepEqual(c.reminders.sleep.times, ['23:00'])
})

test('未知 / 非法 mode 退回 interval', () => {
  const c = normalizeConfig({ reminders: { water: { mode: 'nope' } } })
  assert.equal(c.reminders.water.mode, 'interval')
})

test('enabled 仅 false 关闭，缺省视为开启', () => {
  const c = normalizeConfig({ reminders: { water: { enabled: false }, meal: {} } })
  assert.equal(c.reminders.water.enabled, false)
  assert.equal(c.reminders.meal.enabled, true)
})

test('安静时段 start === end 视为无效并关闭', () => {
  const c = normalizeConfig({ quietHours: { enable: true, start: '22:00', end: '22:00' } })
  assert.equal(c.quietHours.enable, false)
})

test('安静时段跨零点与补零', () => {
  const c = normalizeConfig({ quietHours: { enable: true, start: '22:00', end: '8:00' } })
  assert.equal(c.quietHours.enable, true)
  assert.equal(c.quietHours.start, '22:00')
  assert.equal(c.quietHours.end, '08:00')
})

test('非法安静时段时间回落到默认值', () => {
  const c = normalizeConfig({ quietHours: { enable: true, start: 'x', end: '99:99' } })
  assert.equal(c.quietHours.start, DEFAULTS.quietHours.start)
  assert.equal(c.quietHours.end, DEFAULTS.quietHours.end)
})

test('mergeConfig 深合并对象、数组整体替换', () => {
  const merged = mergeConfig({ a: { b: 1, c: 2 }, list: [1, 2] }, { a: { c: 3 }, list: [9] })
  assert.deepEqual(merged, { a: { b: 1, c: 3 }, list: [9] })
})

test('语言包可读取且中英键一致', () => {
  const zh = loadLocale('zh')
  const en = loadLocale('en')
  assert.ok(zh && en)
  const keys = (o) => Object.keys(o).sort()
  assert.deepEqual(keys(zh), keys(en))
  for (const id of typeIds) {
    assert.equal(typeof zh['reminder.' + id], 'string')
    assert.equal(typeof zh['reminder.bodies'][id], 'string')
    assert.equal(typeof zh['reminder.labels'][id], 'string')
  }
})

test('reminderText 从语言包取文案，未知语言回落中文', () => {
  const zh = reminderText('water', 'zh')
  const en = reminderText('water', 'en')
  assert.equal(zh.title, loadLocale('zh')['reminder.water'])
  assert.equal(en.title, loadLocale('en')['reminder.water'])
  assert.ok(zh.body && en.body && zh.body !== en.body)
  assert.equal(reminderText('water', 'klingon').title, zh.title)
})
