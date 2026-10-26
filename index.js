/**
 * dsh-life-reminder —— 日常生活提醒插件（宿主侧）
 *
 * 职责：
 *   1. 定时检查各类提醒是否到点（喝水 / 吃饭 / 锻炼 / 休息 / 睡眠 / 护眼）
 *   2. 通过 HTTP 路由给 Client 半边（浮动小宠物图标）读写配置：
 *        GET  /dsh-life-reminder/api/config
 *        POST /dsh-life-reminder/api/config
 *      配置持久化到 ~/.dsh/life-reminder.config.json（重启后仍在）
 *   3. 向 agent 暴露管理工具：查看/开关/延迟/设置提醒
 *   4. 向系统提示注入提醒上下文
 *
 * 配置结构（每种提醒二选一模式）：
 *   reminders.water: { enabled, mode: 'interval'|'times', interval: 分钟, times: ['HH:MM', ...] }
 *   quietHours: { enable, start: 'HH:MM', end: 'HH:MM' }
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'life-reminder.config.json')

// ─────────────────────────────────────────────────────────────────────────────
// 默认配置
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  reminders: {
    water:    { enabled: true, mode: 'interval', interval: 60,  times: [] },
    meal:     { enabled: true, mode: 'interval', interval: 240, times: [] },
    exercise: { enabled: true, mode: 'interval', interval: 480, times: [] },
    rest:     { enabled: true, mode: 'interval', interval: 120, times: [] },
    sleep:    { enabled: true, mode: 'times',    interval: 1440, times: ['23:00'] },
    eye:      { enabled: true, mode: 'interval', interval: 30,  times: [] },
  },
  quietHours: {
    enable: false,
    start: '22:00',
    end: '08:00',
  },
}

const REMINDER_TYPES = [
  { id: 'water',    labelKey: 'reminder.water' },
  { id: 'meal',     labelKey: 'reminder.meal' },
  { id: 'exercise', labelKey: 'reminder.exercise' },
  { id: 'rest',     labelKey: 'reminder.rest' },
  { id: 'sleep',    labelKey: 'reminder.sleep' },
  { id: 'eye',      labelKey: 'reminder.eye' },
]

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────
function mergeConfig(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeConfig(base[k] ?? {}, v) : v
  }
  return out
}

function parseHHMM(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return h * 60 + mi
}

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function isInQuietHours(cfg) {
  if (!cfg.quietHours || !cfg.quietHours.enable) return false
  const start = parseHHMM(cfg.quietHours.start)
  const end = parseHHMM(cfg.quietHours.end)
  if (start === null || end === null) return false
  const now = nowMinutes()
  if (start < end) return now >= start && now < end
  return now >= start || now < end
}

/**
 * 把任意（用户/工具/文件）输入规整成合法配置：
 *   - interval 限制在 1..1440 分钟
 *   - times 只保留合法 HH:MM，去重排序
 *   - times 模式下至少保留一个时间点
 *   - 睡眠默认 times 模式
 */
function normalizeConfig(input) {
  const merged = mergeConfig(DEFAULTS, input || {})
  const out = {
    reminders: {},
    quietHours: {
      enable: merged.quietHours?.enable === true,
      start: parseHHMM(merged.quietHours?.start) !== null ? merged.quietHours.start : DEFAULTS.quietHours.start,
      end: parseHHMM(merged.quietHours?.end) !== null ? merged.quietHours.end : DEFAULTS.quietHours.end,
    },
  }
  for (const t of REMINDER_TYPES) {
    const def = DEFAULTS.reminders[t.id]
    const raw = merged.reminders?.[t.id] ?? def
    const mode = raw.mode === 'times' ? 'times' : 'interval'
    const intervalRaw = Number(raw.interval)
    const interval = Number.isFinite(intervalRaw) ? Math.min(1440, Math.max(1, Math.round(intervalRaw))) : def.interval
    let times = Array.isArray(raw.times)
      ? Array.from(new Set(raw.times.map((s) => String(s).trim()).filter((s) => parseHHMM(s) !== null))).sort()
      : []
    if (mode === 'times' && times.length === 0) {
      times = def.times && def.times.length ? def.times.slice() : ['09:00']
    }
    out.reminders[t.id] = {
      enabled: raw.enabled !== false,
      mode,
      interval,
      times,
    }
  }
  return out
}

function readConfigFile() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return normalizeConfig(DEFAULTS)
  }
}

function writeConfigFile(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n')
    return true
  } catch (e) {
    console.error('[life-reminder] 写配置失败：' + (e?.message ?? e))
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 提醒调度状态
// ─────────────────────────────────────────────────────────────────────────────

/** 下一次命中的时间点（时间点模式）：从 fromMs 之后最近的一个 times 项 */
function nextAtForTimes(times, fromMs) {
  const mins = (times || []).map(parseHHMM).filter((v) => v !== null)
  if (mins.length === 0) return null
  const from = new Date(fromMs)
  let best = null
  for (const m of mins) {
    const d = new Date(from)
    d.setHours(Math.floor(m / 60), m % 60, 0, 0)
    if (d.getTime() <= fromMs) d.setDate(d.getDate() + 1)
    const ts = d.getTime()
    if (best === null || ts < best) best = ts
  }
  return best
}

function computeNextAt(cfg, type, fromMs) {
  const r = cfg.reminders[type]
  if (!r || !r.enabled) return null
  if (r.mode === 'times') return nextAtForTimes(r.times, fromMs)
  return fromMs + r.interval * 60 * 1000
}

/** 按当前配置重建所有提醒的下次触发时间 */
function rebuildState(cfg, prevState) {
  const now = Date.now()
  const state = {}
  for (const t of REMINDER_TYPES) {
    const r = cfg.reminders[t.id]
    if (!r || !r.enabled) {
      state[t.id] = { nextAt: null, lastFired: null, lastScheduled: null }
      continue
    }
    const prev = prevState?.[t.id]
    // 配置没变且下次时间还在未来 → 保留原计划（避免保存设置就重置计时）
    const sameShape =
      prev &&
      prev.nextAt !== null &&
      prev.nextAt > now &&
      prev.plan &&
      prev.plan.mode === r.mode &&
      prev.plan.interval === r.interval &&
      JSON.stringify(prev.plan.times) === JSON.stringify(r.times)
    if (sameShape) {
      state[t.id] = { ...prev }
    } else {
      state[t.id] = {
        nextAt: computeNextAt(cfg, t.id, now),
        lastFired: prev?.lastFired ?? null,
        lastScheduled: null,
        plan: { mode: r.mode, interval: r.interval, times: r.times.slice() },
      }
    }
  }
  return state
}

// ─────────────────────────────────────────────────────────────────────────────
// 提醒文案
// ─────────────────────────────────────────────────────────────────────────────
const TITLES_ZH = {
  water: '该喝水啦！', meal: '该吃饭啦！', exercise: '该锻炼啦！',
  rest: '该休息啦！', sleep: '该睡觉啦！', eye: '该护眼啦！',
}
const TITLES_EN = {
  water: 'Time to drink water!', meal: 'Time to eat!', exercise: 'Time to exercise!',
  rest: 'Time to rest!', sleep: 'Time to sleep!', eye: 'Time for eye care!',
}
const BODIES_ZH = {
  water: '记得喝一杯水，保持身体水分充足哦。',
  meal: '该吃饭了，不要饿着肚子工作，好好休息一下再继续。',
  exercise: '伸伸懒腰，活动活动身体，做点简单的运动吧。',
  rest: '眼睛和大脑也需要休息，远离屏幕几分钟，放松一下。',
  sleep: '已经不早了，准备睡觉吧，早点休息对身体更好。',
  eye: '护眼时间到了！远离屏幕，望向远处，给眼睛放松。',
}
const BODIES_EN = {
  water: 'Remember to drink a glass of water and stay hydrated.',
  meal: "It's time to eat. Don't work on an empty stomach—take a proper break.",
  exercise: 'Stretch and move your body. Do some light exercise.',
  rest: 'Give your eyes and brain a break. Step away from the screen for a few minutes.',
  sleep: "It's getting late. Time to get ready for bed and get a good rest.",
  eye: 'Eye care time! Look away from the screen and gaze into the distance.',
}

function reminderText(type, lang) {
  const titles = lang === 'en' ? TITLES_EN : TITLES_ZH
  const bodies = lang === 'en' ? BODIES_EN : BODIES_ZH
  return { title: titles[type], body: bodies[type] }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP 小工具
// ─────────────────────────────────────────────────────────────────────────────
function json(res, code, obj) {
  try {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(obj))
  } catch {}
}

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function isLoopbackReq(req) {
  const host = String(req.headers?.host ?? '').toLowerCase()
  const h = host.split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
}

// ─────────────────────────────────────────────────────────────────────────────
// Host 插件主体
// ─────────────────────────────────────────────────────────────────────────────
export const inject = ['timer', 'tools', 'systemPrompt', 'webServer', 'connection']

export function apply(ctx, config) {
  // 文件配置优先，其次 patch config，最后默认值
  const fileCfg = readConfigFile()
  const cfg = normalizeConfig(mergeConfig(fileCfg, config || {}))
  let state = rebuildState(cfg, null)

  // 最近触发的提醒（最近 50 条）
  const recentEvents = []
  const MAX_EVENTS = 50

  function addEvent(type, action, extra) {
    recentEvents.unshift({
      id: 'reminder-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      type,
      action,
      at: new Date().toISOString(),
      extra,
    })
    if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS
  }

  function fireReminder(type) {
    const s = state[type]
    if (!s || s.nextAt === null) return
    const now = Date.now()
    s.lastFired = now
    s.lastScheduled = s.nextAt
    addEvent(type, 'fired')
    const r = cfg.reminders[type]
    s.nextAt = r.mode === 'times'
      ? nextAtForTimes(r.times, now + 1000)
      : now + r.interval * 60 * 1000
    s.plan = { mode: r.mode, interval: r.interval, times: r.times.slice() }
  }

  /** 保存配置 → 重建状态 → 落盘 */
  function saveConfig(nextCfg) {
    const normalized = normalizeConfig(nextCfg)
    Object.assign(cfg, normalized)
    state = rebuildState(cfg, state)
    writeConfigFile(cfg)
    return cfg
  }

  // 向 agent 注入系统提示
  const systemPromptDisposer = ctx.systemPrompt.section({
    name: 'life-reminder',
    order: 900,
    render: () => {
      const now = Date.now()
      const due = []
      let next = null
      for (const t of REMINDER_TYPES) {
        const s = state[t.id]
        if (!s || s.nextAt === null) continue
        if (s.nextAt <= now) due.push(t.id)
        else if (next === null || s.nextAt < next) next = s.nextAt
      }
      if (due.length > 0) {
        return `[Life Reminder] Due now: ${due.join(', ')}. Please remind the user to take care of themselves.`
      }
      if (next !== null) {
        return `[Life Reminder] Next reminder in ${Math.max(1, Math.ceil((next - now) / 60000))} minutes.`
      }
      return '[Life Reminder] No active reminders.'
    },
  })

  // ─────────────────────────────────────────────────────────────────────
  // 工具：查看提醒状态
  // ─────────────────────────────────────────────────────────────────────
  const toolView = ctx.tools.register({
    name: 'life_reminder_view',
    title: 'View Life Reminders',
    description: '查看当前所有生活提醒的状态、模式、下次触发时间和最近记录。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          quietHours: { type: 'boolean' },
          reminders: { type: 'array', items: { type: 'object' } },
          recent: { type: 'array', items: { type: 'object' } },
        },
        required: ['ok'],
      },
      render: (result) => {
        if (!result.ok) return '查看生活提醒失败。'
        const due = (result.reminders || []).filter((r) => r.due).length
        return `生活提醒：${due} 项已到期，共 ${(result.reminders || []).length} 项。`
      },
    },
    execute: async () => {
      const now = Date.now()
      const entries = REMINDER_TYPES.map((t) => {
        const s = state[t.id]
        const r = cfg.reminders[t.id]
        return {
          type: t.id,
          enabled: !!r?.enabled,
          mode: r?.mode ?? 'interval',
          interval: r?.interval ?? null,
          times: r?.times ?? [],
          due: !!(s && s.nextAt !== null && s.nextAt <= now),
          nextAt: s?.nextAt ? new Date(s.nextAt).toISOString() : null,
          lastFired: s?.lastFired ? new Date(s.lastFired).toISOString() : null,
          minutesUntilNext: s?.nextAt ? Math.max(0, Math.ceil((s.nextAt - now) / 60000)) : null,
        }
      })
      return {
        ok: true,
        quietHours: isInQuietHours(cfg),
        reminders: entries,
        recent: recentEvents.slice().reverse(),
      }
    },
  })

  // ─────────────────────────────────────────────────────────────────────
  // 工具：开关某类提醒
  // ─────────────────────────────────────────────────────────────────────
  const toolToggle = ctx.tools.register({
    name: 'life_reminder_toggle',
    title: 'Toggle Life Reminder',
    description: '启用或禁用某类生活提醒。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: REMINDER_TYPES.map((t) => t.id) },
        enabled: { type: 'boolean' },
      },
      required: ['type', 'enabled'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          type: { type: 'string' },
          enabled: { type: 'boolean' },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (result) => {
        if (!result.ok) return '切换生活提醒失败：' + (result.error || '')
        return result.enabled ? '已开启该项生活提醒。' : '已关闭该项生活提醒。'
      },
    },
    execute: async ({ type, enabled }) => {
      if (!REMINDER_TYPES.some((t) => t.id === type)) return { ok: false, error: 'Unknown reminder type: ' + type }
      const next = JSON.parse(JSON.stringify(cfg))
      next.reminders[type].enabled = !!enabled
      saveConfig(next)
      addEvent(type, enabled ? 'enabled' : 'disabled')
      return { ok: true, type, enabled: !!enabled }
    },
  })

  // ─────────────────────────────────────────────────────────────────────
  // 工具：设置某类提醒（间隔模式 / 时间点模式）
  // ─────────────────────────────────────────────────────────────────────
  const toolSet = ctx.tools.register({
    name: 'life_reminder_set',
    title: 'Set Life Reminder',
    description: '设置某类提醒：间隔模式传 interval（分钟），时间点模式传 mode="times" 与 times（"HH:MM" 数组，可多个）。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: REMINDER_TYPES.map((t) => t.id) },
        mode: { type: 'string', enum: ['interval', 'times'] },
        interval: { type: 'number', minimum: 1, maximum: 1440 },
        times: { type: 'array', items: { type: 'string', pattern: '^\\d{1,2}:\\d{2}$' } },
      },
      required: ['type'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          type: { type: 'string' },
          mode: { type: 'string' },
          interval: { type: 'number' },
          times: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (result) => {
        if (!result.ok) return '设置生活提醒失败：' + (result.error || '')
        return result.mode === 'times'
          ? `已设置为每天 ${result.times.join('、')} 提醒。`
          : `已设置为每 ${result.interval} 分钟提醒。`
      },
    },
    execute: async ({ type, mode, interval, times }) => {
      const def = REMINDER_TYPES.find((t) => t.id === type)
      if (!def) return { ok: false, error: 'Unknown reminder type: ' + type }
      const next = JSON.parse(JSON.stringify(cfg))
      const r = next.reminders[type]
      if (mode) r.mode = mode === 'times' ? 'times' : 'interval'
      if (interval !== undefined) r.interval = interval
      if (Array.isArray(times)) r.times = times
      if (r.mode === 'times' && (!r.times || r.times.length === 0)) {
        return { ok: false, error: 'time-point mode requires at least one time (HH:MM)' }
      }
      const saved = saveConfig(next)
      addEvent(type, 'configured')
      return {
        ok: true,
        type,
        mode: saved.reminders[type].mode,
        interval: saved.reminders[type].interval,
        times: saved.reminders[type].times,
      }
    },
  })

  // ─────────────────────────────────────────────────────────────────────
  // 工具：延迟某类提醒
  // ─────────────────────────────────────────────────────────────────────
  const toolSnooze = ctx.tools.register({
    name: 'life_reminder_snooze',
    title: 'Snooze Life Reminder',
    description: '将某类提醒延迟指定分钟数。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: REMINDER_TYPES.map((t) => t.id) },
        minutes: { type: 'number', minimum: 1, maximum: 1440 },
      },
      required: ['type', 'minutes'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          type: { type: 'string' },
          minutes: { type: 'number' },
          nextAt: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (result) => {
        if (!result.ok) return '延迟生活提醒失败：' + (result.error || '')
        return `已将该项生活提醒延迟 ${result.minutes} 分钟。`
      },
    },
    execute: async ({ type, minutes }) => {
      const s = state[type]
      if (!s || s.nextAt === null) return { ok: false, error: 'Reminder not active: ' + type }
      s.nextAt = Date.now() + minutes * 60 * 1000
      addEvent(type, 'snoozed', minutes)
      return { ok: true, type, minutes, nextAt: new Date(s.nextAt).toISOString() }
    },
  })

  // ─────────────────────────────────────────────────────────────────────
  // 工具：标记某类提醒为已完成（重新计算下次时间）
  // ─────────────────────────────────────────────────────────────────────
  const toolDone = ctx.tools.register({
    name: 'life_reminder_done',
    title: 'Mark Life Reminder Done',
    description: '标记某类提醒为已完成，重新计算下次提醒时间。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: REMINDER_TYPES.map((t) => t.id) },
      },
      required: ['type'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          type: { type: 'string' },
          nextAt: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (result) => {
        if (!result.ok) return '标记生活提醒失败：' + (result.error || '')
        return '已标记该项生活提醒为完成。'
      },
    },
    execute: async ({ type }) => {
      const s = state[type]
      if (!s || s.nextAt === null) return { ok: false, error: 'Reminder not active: ' + type }
      const now = Date.now()
      s.lastFired = now
      s.nextAt = computeNextAt(cfg, type, now)
      s.plan = { mode: cfg.reminders[type].mode, interval: cfg.reminders[type].interval, times: cfg.reminders[type].times.slice() }
      addEvent(type, 'done')
      return { ok: true, type, nextAt: s.nextAt ? new Date(s.nextAt).toISOString() : null }
    },
  })

  // ─────────────────────────────────────────────────────────────────────
  // HTTP 路由：给 Client 浮动小宠物读写配置
  // ─────────────────────────────────────────────────────────────────────
  const disposers = []
  const route = (pathname, handler) => {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path: pathname,
        handler: async (req, res) => {
          if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
          try {
            const conn = ctx.get('connection') || ctx.connection
            if (conn && typeof conn.requestRejection === 'function') {
              const code = conn.requestRejection(req)
              if (code !== undefined && code !== null && code !== false) {
                res.statusCode = typeof code === 'number' ? code : 403
                res.end()
                return
              }
            }
            await handler(req, res)
          } catch (e) {
            json(res, 500, { ok: false, error: String(e?.message ?? e) })
          }
        },
      })
    )
  }

  route('/dsh-life-reminder/api/config', async (req, res) => {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        config: cfg,
        configPath: CONFIG_FILE,
        state: REMINDER_TYPES.reduce((acc, t) => {
          const s = state[t.id]
          acc[t.id] = {
            nextAt: s?.nextAt ? new Date(s.nextAt).toISOString() : null,
            lastFired: s?.lastFired ? new Date(s.lastFired).toISOString() : null,
          }
          return acc
        }, {}),
      })
      return
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
    const body = JSON.parse((await readBody(req)) || '{}')
    const incoming = (body && typeof body.config === 'object' && body.config) || body || {}
    const saved = saveConfig(incoming)
    json(res, 200, { ok: true, config: saved, configPath: CONFIG_FILE })
  })

  // ─────────────────────────────────────────────────────────────────────
  // 定时器：每 30 秒检查一次到点的提醒
  // ─────────────────────────────────────────────────────────────────────
  const TICK_MS = 30_000
  let stopped = false

  function tick() {
    if (stopped) return
    const now = Date.now()
    const quiet = isInQuietHours(cfg)
    for (const t of REMINDER_TYPES) {
      const s = state[t.id]
      if (!s || s.nextAt === null) continue
      if (s.nextAt > now) continue
      // 安静时段：睡眠提醒也提醒（不然永远叫不醒），其余跳过并顺延到安静时段结束
      if (quiet && t.id !== 'sleep') {
        const end = parseHHMM(cfg.quietHours.end)
        if (end !== null) {
          const d = new Date()
          d.setHours(Math.floor(end / 60), end % 60, 0, 0)
          if (d.getTime() <= now) d.setDate(d.getDate() + 1)
          s.nextAt = d.getTime()
        }
        continue
      }
      fireReminder(t.id)
    }
  }

  const timer = ctx.timer.interval(tick, TICK_MS)
  setTimeout(tick, 3000)

  // ─────────────────────────────────────────────────────────────────────
  // 清理：插件卸载时停止定时器、注销工具与路由、移除系统提示
  // ─────────────────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    stopped = true
    if (typeof timer === 'function') timer()
    toolView()
    toolToggle()
    toolSet()
    toolSnooze()
    toolDone()
    systemPromptDisposer()
    for (const d of disposers) { try { d() } catch {} }
  })

  try {
    console.log(`[life-reminder] 已启动 · 配置 ${CONFIG_FILE} · 路由 /dsh-life-reminder/api/config`)
  } catch {}
}
