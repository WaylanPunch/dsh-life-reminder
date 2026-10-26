# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [1.2.0] - 2026-10-26

### Added

- `GET /dsh-life-reminder/api/i18n`：宿主下发 `locale/*.json`，客户端 UI 文案改为运行时获取
- `GET /api/config` 响应新增 `defaults` 字段，默认值由宿主统一下发
- 单测 `tests/`（配置规范化、调度、HTTP 行为），`npm test` 运行
- `README.md`、`CHANGELOG.md`、`LICENSE`

### Changed

- 文案单一来源：删除宿主内的 `TITLES_*` / `BODIES_*` 常量与客户端内置的 `TEXTS` 表，统一收敛到 `locale/zh.json` / `locale/en.json`
- 客户端不再自带 `DEFAULTS`，改用宿主下发的 `defaults` 作为兜底
- 语言包拉取结果写入 `localStorage` 缓存，首屏与拉取失败时降级显示

## [1.1.1] - 2026-10-26

### Fixed

- `POST /api/config` 空 payload（空 body / 空 `config` / 缺 `config` 字段）会把整份配置重置为默认值；现在一律返回 400
- 保存配置以当前配置为基底做增量合并，部分更新不再把未提及的项打回默认值
- 面板切换语言会重新拉取配置，冲掉用户尚未保存的修改
- 时间点按字符串排序导致 `10:00` 排在 `9:00` 之前，且 `9:00` 与 `09:00` 被当成两个时刻（重复提醒）；现统一补零、按分钟去重排序
- 安静时段 `start === end` 会覆盖全天、使除睡眠外所有提醒永不触发；现视为无效配置并强制关闭
- 卸载时未清理启动用的 `setTimeout`，可能残留一次 tick

## [1.1.0] - 2026-10-26

### Added

- 6 类生活提醒（喝水 / 吃饭 / 锻炼 / 休息 / 睡眠 / 护眼），支持间隔与时间点两种模式
- 安静时段（跨零点）
- 浮动小宠物与设置面板，中英文切换
- 5 个 agent 工具：`view` / `toggle` / `set` / `snooze` / `done`
- 系统提示注入与配置持久化到 `~/.dsh/life-reminder.config.json`
