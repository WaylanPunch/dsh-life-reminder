import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-api-home-'))
const { apply, DEFAULTS } = await import('../index.js')

// 启动插件，但把 boot tick 的 setTimeout 换成记录器，避免测试进程被挂住
const routes = {}
let bootTick = null
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms) => {
  if (ms === 3000 && !bootTick) {
    bootTick = fn
    return 0
  }
  return realSetTimeout(fn, ms)
}
apply(
  {
    timer: { interval: () => () => {} },
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } },
    get: () => undefined,
    connection: undefined,
    effect: () => {},
  },
  {}
)
globalThis.setTimeout = realSetTimeout

const configRoute = routes['/dsh-life-reminder/api/config']
const i18nRoute = routes['/dsh-life-reminder/api/i18n']

function call(handler, method, body, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.headers = { host }
    const res = {
      statusCode: 200,
      writeHead(code) { this.statusCode = code },
      end(s) { resolve(s ? JSON.parse(s) : { statusCode: this.statusCode }) },
    }
    handler(req, res)
    if (body !== undefined) setImmediate(() => { req.emit('data', Buffer.from(body)); req.emit('end') })
  })
}

const get = () => call(configRoute, 'GET')
const post = (body, host) => call(configRoute, 'POST', body, host)

test('GET 返回配置、默认值与状态', async () => {
  const j = await get()
  assert.equal(j.ok, true)
  assert.deepEqual(j.defaults, DEFAULTS)
  assert.equal(j.config.reminders.sleep.mode, 'times')
  assert.deepEqual(Object.keys(j.state).sort(), ['exercise', 'eye', 'meal', 'rest', 'sleep', 'water'])
})

test('非回环地址被拒绝', async () => {
  const j = await call(configRoute, 'GET', undefined, 'evil.example.com')
  assert.equal(j.ok, false)
})

test('空 / 缺 config 的 POST 被拒绝，且不改动配置', async () => {
  const before = await get()
  for (const body of ['', '{}', JSON.stringify({ config: {} }), JSON.stringify({ reminders: {} })]) {
    const j = await post(body)
    assert.equal(j.ok, false, '应拒绝: ' + body)
  }
  const after = await get()
  assert.deepEqual(after.config, before.config)
})

test('非法 JSON 返回 400', async () => {
  const j = await post('{not json')
  assert.equal(j.ok, false)
})

test('部分更新只影响传入的项', async () => {
  const j = await post(JSON.stringify({ config: { reminders: { water: { interval: 15 } } } }))
  assert.equal(j.ok, true)
  assert.equal(j.config.reminders.water.interval, 15)
  assert.equal(j.config.reminders.eye.interval, DEFAULTS.reminders.eye.interval) // 未被打回默认值
  assert.deepEqual(j.config.reminders.sleep.times, ['23:00'])
})

test('部分更新会落盘', async () => {
  await post(JSON.stringify({ config: { reminders: { eye: { interval: 45 } } } }))
  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.DSH_HOME, 'life-reminder.config.json'), 'utf8'))
  assert.equal(onDisk.reminders.eye.interval, 45)
})

test('通过 API 写入的时间点会被归一化', async () => {
  const j = await post(JSON.stringify({ config: { reminders: { sleep: { times: ['9:00', '09:00', '10:30'] } } } }))
  assert.deepEqual(j.config.reminders.sleep.times, ['09:00', '10:30'])
})

test('PUT 不被允许', async () => {
  const j = await call(configRoute, 'PUT', '{}')
  assert.equal(j.ok, false)
})

test('i18n 路由下发中英语言包', async () => {
  const j = await call(i18nRoute, 'GET')
  assert.equal(j.ok, true)
  assert.deepEqual(j.missing, [])
  assert.equal(typeof j.locales.zh['reminder.title'], 'string')
  assert.equal(typeof j.locales.en['reminder.title'], 'string')
  assert.equal(typeof j.locales.zh['reminder.bodies'].water, 'string')
})

test('i18n 路由只接受 GET', async () => {
  const j = await call(i18nRoute, 'POST', '{}')
  assert.equal(j.ok, false)
})
