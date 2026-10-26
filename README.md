# dsh-life-reminder

DeepSeek Harness（DSH）插件：在界面右下角放一只可拖动的小鲸鱼，按时提醒你喝水、吃饭、锻炼、休息、睡觉、护眼。

![设置面板截图](./Screenshot%202026-10-26%20111150.png)

## 特性

- 6 类提醒：喝水 / 吃饭 / 锻炼 / 休息 / 睡眠 / 护眼，各自独立开关
- 每类提醒两种模式二选一：
  - **按间隔**：每 N 分钟一次（1 ≤ N ≤ 1440）
  - **按时间点**：每天一到多个时刻（`HH:MM`，支持多个）
- 安静时段（跨零点）：期间除睡眠提醒外，其余顺延到时段结束
- 浮动小宠物可拖动，位置记在 `localStorage`
- 中英文界面，手动切换并记忆
- 配置持久化到磁盘，重启后仍在

## 安装

把本目录放到 DSH 的 `plugins/` 下即可，`cordis.patch.yml` 会自动把插件插进 profile 配置树：

```yaml
- insert:
    - id: dsh-life-reminder
      name: dsh-life-reminder
      config: {}
```

## 使用

点击浮动小鲸鱼打开设置面板；拖动它可改变位置。面板中每类提醒可单独开关、切换模式、调整间隔或时间点。

## 配置

| 提醒 | 默认模式 | 默认值 |
| --- | --- | --- |
| 喝水 water | 间隔 | 60 分钟 |
| 吃饭 meal | 间隔 | 240 分钟 |
| 锻炼 exercise | 间隔 | 480 分钟 |
| 休息 rest | 间隔 | 120 分钟 |
| 睡眠 sleep | 时间点 | 23:00 |
| 护眼 eye | 间隔 | 30 分钟 |

安静时段默认关闭（`22:00` – `08:00`）。`start === end` 会被视为无效配置并强制关闭，否则安静时段会覆盖全天。

配置文件：`$DSH_HOME/life-reminder.config.json`，缺省 `$DSH_HOME` 时为 `~/.dsh/life-reminder.config.json`。
任何来源（面板 / 工具 / 文件）的写入都会先经 `normalizeConfig` 收敛：间隔夹到 1..1440、时间点补零去重并按分钟排序、时间点模式至少保留一个时刻。

## Agent 工具

| 工具 | 说明 |
| --- | --- |
| `life_reminder_view` | 查看各类提醒状态、模式、下次时间与最近记录 |
| `life_reminder_toggle` | 开关某类提醒 |
| `life_reminder_set` | 设置某类提醒（间隔分钟数 / 时间点数组） |
| `life_reminder_snooze` | 延迟某类提醒 N 分钟 |
| `life_reminder_done` | 标记完成并重算下次时间 |

插件还会向系统提示注入一行 `[Life Reminder] ...`，让模型在下一轮对话里顺带提醒用户。

## HTTP 接口（仅本机回环）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-life-reminder/api/config` | 返回 `{ ok, config, defaults, configPath, state }` |
| `POST` | `/dsh-life-reminder/api/config` | 提交 `{ config }`，**部分更新**（未提及的项保持原值）；空 payload 返回 400 |
| `GET` | `/dsh-life-reminder/api/i18n` | 返回 `{ ok, locales: { zh, en }, missing }` |

非回环来源返回 403。

## 目录结构

```text
.
├── index.js            宿主侧：调度 / 配置 / HTTP / 工具 / 系统提示
├── client.js           客户端：浮动小宠物 + 设置面板
├── locale/*.json       文案唯一来源（宿主读文件，客户端走 /api/i18n）
├── cordis.patch.yml    DSH bundle patch
├── icon.svg            插件图标
└── tests/              node:test 单测
```

## 开发

```bash
npm test          # node --test tests/*.test.mjs
```

约定：

- **文案单一来源**：所有界面文案只写在 `locale/zh.json` 与 `locale/en.json`，客户端不再内置文案表（仅保留离线首屏用的极简 fallback）。新增语言包键时中英必须成对，测试会校验键集合一致。
- **默认值单一来源**：`DEFAULTS` 只存在于 `index.js`，通过 `GET /api/config` 的 `defaults` 字段下发给客户端。
- 纯逻辑（`normalizeConfig` / `nextAtForTimes` / `computeNextAt` / `isInQuietHours` / `rebuildState`）均已导出，新增规则请补单测。

## 已知限制

- 提醒触发后只在系统提示里出现，**需要 agent 下一轮对话才真正说出口**；浮动小宠物目前不会弹气泡（计划中）。
- 调度状态（`nextAt` / `lastFired`）只在内存，重启后重新排期；`snooze` 不落盘。
- `POST` 保存成功后响应不含最新 `state`，面板里的"下次提醒"需重新打开才刷新。

## License

MIT
