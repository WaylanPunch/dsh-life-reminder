/**
 * dsh-life-reminder —— 日常生活提醒插件（客户端侧）
 *
 * 一个“小宠物”式的浮动圆形图标（可鼠标拖动位置，位置记在 localStorage），
 * 点击打开提醒设置面板：
 *   · 每类提醒（喝水/吃饭/锻炼/休息/睡眠/护眼）可单独开关
 *   · 每类提醒二选一模式：按间隔分钟数，或每天一个/多个时间点（HH:MM）
 *   · 安静时段配置
 *   · 中英文手动切换
 *
 * 配置通过同源 HTTP 路由 /dsh-life-reminder/api/config 与宿主半读写，
 * 持久化在 ~/.dsh/life-reminder.config.json。
 *
 * 文案单一来源：宿主 /dsh-life-reminder/api/i18n 下发的 locale/*.json
 * （本文件不再内置整套文案，仅保留离线首屏用的极简 fallback）。
 * 默认值同样由宿主 GET 响应的 defaults 字段下发，避免两端各存一份 DEFAULTS。
 *
 * 挂载位置：shell.overlay（frame-wide 浮动层，位于所有列之上，不随滚动容器滚动）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-life-reminder',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;

    const API = '/dsh-life-reminder/api/config';
    const API_I18N = '/dsh-life-reminder/api/i18n';
    const LANG_KEY = 'dsh-life-reminder-lang';
    const POS_KEY = 'dsh-life-reminder-pos';
    const I18N_KEY = 'dsh-life-reminder-i18n';
    const PET_SIZE = 56;

    const TYPE_META = [
      { id: 'water',   icon: '💧' },
      { id: 'meal',    icon: '🍽️' },
      { id: 'exercise',icon: '🏃' },
      { id: 'rest',    icon: '☕' },
      { id: 'sleep',   icon: '😴' },
      { id: 'eye',     icon: '👁️' },
    ];

    // ─────────────────────────────────────────────────────────────────
    // 文案：由宿主下发，本地只留一份极简 fallback（首屏 / 离线 / 语言包拉取失败）
    // ─────────────────────────────────────────────────────────────────
    function buildTexts(l) {
      const g = (k, fb = '') => (l && typeof l[k] === 'string' ? l[k] : fb);
      const types = {};
      for (const m of TYPE_META) {
        types[m.id] = {
          label: (l && l['reminder.labels'] && l['reminder.labels'][m.id]) || m.id,
          title: g('reminder.' + m.id),
          body: (l && l['reminder.bodies'] && l['reminder.bodies'][m.id]) || '',
        };
      }
      return {
        title: g('reminder.title', 'Life Reminder'),
        tip: g('reminder.tip'),
        dismiss: g('reminder.dismiss', 'Close'),
        langLabel: g('reminder.lang', 'Language'),
        configTitle: g('reminder.settings.title', 'Life Reminder'),
        on: g('reminder.on', 'On'),
        intervalMode: g('reminder.intervalMode'),
        timesMode: g('reminder.timesMode'),
        every: g('reminder.every'),
        minutesUnit: g('reminder.minutesUnit'),
        atTimes: g('reminder.atTimes'),
        addTime: g('reminder.addTime'),
        removeTime: g('reminder.removeTime'),
        timesHint: g('reminder.timesHint'),
        quietTitle: g('reminder.quietTitle'),
        quietEnable: g('reminder.quietEnable'),
        quietStart: g('reminder.quietStart'),
        quietEnd: g('reminder.quietEnd'),
        quietHint: g('reminder.quietHint'),
        save: g('reminder.save', 'Save'),
        saving: g('reminder.saving'),
        saved: g('reminder.saved'),
        saveFail: g('reminder.saveFail'),
        loadFail: g('reminder.loadFail'),
        loading: g('reminder.loading'),
        i18nFail: g('reminder.i18nFail'),
        nextAt: g('reminder.nextShort'),
        noNext: g('reminder.noNext'),
        types,
      };
    }

    const FALLBACK = {
      title: 'Life Reminder',
      configTitle: 'Life Reminder',
      tip: '',
      dismiss: 'Close',
      langLabel: 'Language',
      on: 'On',
      loading: 'Loading…',
      loadFail: 'Could not load settings: ',
      i18nFail: 'Could not load the language pack.',
      save: 'Save',
      types: TYPE_META.reduce((acc, m) => {
        acc[m.id] = { label: m.id, title: '', body: '' };
        return acc;
      }, {}),
    };

    function readCachedTexts() {
      try {
        const cached = JSON.parse(localStorage.getItem(I18N_KEY) || 'null');
        if (cached && cached.zh && cached.en) return cached;
      } catch {}
      return null;
    }

    function cacheTexts(texts) {
      try { localStorage.setItem(I18N_KEY, JSON.stringify(texts)); } catch {}
    }

    function getSavedLang() {
      try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved === 'zh' || saved === 'en') return saved;
      } catch {}
      return null;
    }

    function getLang() {
      const saved = getSavedLang();
      if (saved) return saved;
      const lang = (navigator.language || 'en').toLowerCase();
      return lang.startsWith('zh') ? 'zh' : 'en';
    }

    function setLang(lang) {
      try { localStorage.setItem(LANG_KEY, lang); } catch {}
    }

    // ─────────────────────────────────────────────────────────────────
    // 浮动宠物位置
    // ─────────────────────────────────────────────────────────────────
    function clampPos(p) {
      const maxX = Math.max(8, (window.innerWidth || 1200) - PET_SIZE - 8);
      const maxY = Math.max(8, (window.innerHeight || 800) - PET_SIZE - 8);
      return {
        x: Math.min(maxX, Math.max(8, p.x)),
        y: Math.min(maxY, Math.max(8, p.y)),
      };
    }

    function loadPos() {
      try {
        const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return clampPos(p);
      } catch {}
      return clampPos({
        x: (window.innerWidth || 1200) - PET_SIZE - 28,
        y: (window.innerHeight || 800) - PET_SIZE - 120,
      });
    }

    function savePos(p) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {}
    }

    // ─────────────────────────────────────────────────────────────────
    // 工具：把宿主返回的配置规整成 UI 想要的结构
    // ─────────────────────────────────────────────────────────────────

    /** 时间点补零为 HH:MM；无法解析时原样返回（保留用户正在输入的值） */
    function fmtTime(s) {
      const raw = String(s ?? '');
      const m = raw.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return raw;
      const h = Math.min(23, Math.max(0, Number(m[1])));
      const mi = Math.min(59, Math.max(0, Number(m[2])));
      return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
    }

    /** defaults 由宿主 GET 响应下发，客户端不自带默认值策略 */
    function normalizeClientConfig(c, defaults) {
      const d = defaults || {};
      const base = { reminders: {}, quietHours: { enable: false, start: '', end: '' } };
      for (const m of TYPE_META) {
        const raw = (c && c.reminders && c.reminders[m.id]) || {};
        const def = (d.reminders && d.reminders[m.id]) || {};
        base.reminders[m.id] = {
          enabled: raw.enabled !== false,
          mode: raw.mode === 'times' ? 'times' : 'interval',
          interval: Number.isFinite(Number(raw.interval))
            ? Math.min(1440, Math.max(1, Math.round(Number(raw.interval))))
            : (Number(def.interval) || 1),
          times: Array.isArray(raw.times) ? raw.times.map(fmtTime) : [],
        };
      }
      const qh = (c && c.quietHours) || {};
      const dq = (d && d.quietHours) || {};
      base.quietHours = {
        enable: qh.enable === true,
        start: qh.start || dq.start || '',
        end: qh.end || dq.end || '',
      };
      return base;
    }

    // ─────────────────────────────────────────────────────────────────
    // 设置面板
    // ─────────────────────────────────────────────────────────────────
    function ConfigPanel({ onClose, lang, onLangChange, t, ready, i18nError }) {
      const [config, setConfig] = useState(null);
      const [defaults, setDefaults] = useState(null);
      const [states, setStates] = useState({});
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);
      const [msg, setMsg] = useState('');

      // 文案对象每次切语言都是新引用，不能直接进依赖数组，
      // 否则切换语言会重新拉取配置、冲掉用户尚未保存的修改。用 ref 取当前文案。
      const tRef = useRef(t);
      tRef.current = t;

      useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setMsg('');
        fetch(API, { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((j) => {
            if (cancelled) return;
            if (!j || !j.ok) throw new Error((j && j.error) || 'bad response');
            setDefaults(j.defaults || null);
            setConfig(normalizeClientConfig(j.config, j.defaults));
            setStates(j.state || {});
          })
          .catch((e) => { if (!cancelled) setMsg(tRef.current.loadFail + e.message); })
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
      }, []);

      const setReminder = (id, patch) => {
        setConfig((c) => c && ({
          ...c,
          reminders: { ...c.reminders, [id]: { ...c.reminders[id], ...patch } },
        }));
      };
      const setReminderTimes = (id, times) => setReminder(id, { times });

      const save = async () => {
        if (!config) return;
        setSaving(true);
        setMsg('');
        try {
          const r = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ config }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
          setConfig(normalizeClientConfig(j.config, j.defaults || defaults));
          setMsg(t.saved);
        } catch (e) {
          setMsg(t.saveFail + e.message);
        } finally {
          setSaving(false);
        }
      };

      const fmtNext = (id) => {
        const iso = states?.[id]?.nextAt;
        if (!iso) return t.noNext;
        try {
          return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { return t.noNext; }
      };

      const timeInput = (value, onChange, key) =>
        h('input', {
          key,
          type: 'time',
          value: value,
          onChange: (e) => onChange(e.target.value),
          style: {
            background: 'transparent',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: '6px',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: '12px',
            padding: '3px 6px',
          },
        });

      const btnStyle = (active) => ({
        background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
        color: active ? '#ffffff' : 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '4px 10px',
        fontSize: '12px',
        cursor: 'pointer',
      });

      const rows = [];
      if (config && ready) {
        for (const m of TYPE_META) {
          const r = config.reminders[m.id];
          const meta = t.types[m.id] || { label: m.id };
          rows.push(
            h('div', {
              key: m.id,
              style: {
                padding: '12px 0',
                borderBottom: '1px solid var(--dsw-alias-border-l1)',
              },
            }, [
              h('div', {
                style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
              }, [
                h('span', { style: { fontSize: '22px', lineHeight: '1' } }, m.icon),
                h('span', {
                  style: {
                    fontWeight: '600',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: '14px',
                    minWidth: '70px',
                  },
                }, meta.label),
                h('label', {
                  style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
                }, [
                  h('input', {
                    key: 'en',
                    type: 'checkbox',
                    checked: r.enabled,
                    onChange: (e) => setReminder(m.id, { enabled: e.target.checked }),
                  }),
                  t.on,
                ]),
                h('span', { style: { flex: 1 } }),
                h('button', { type: 'button', style: btnStyle(r.mode === 'interval'), onClick: () => setReminder(m.id, { mode: 'interval' }) }, t.intervalMode),
                h('button', {
                  type: 'button',
                  style: btnStyle(r.mode === 'times'),
                  onClick: () => setReminder(m.id, { mode: 'times', times: r.times.length ? r.times : ['09:00'] }),
                }, t.timesMode),
              ]),
              r.mode === 'interval'
                ? h('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingLeft: '32px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
                  }, [
                    h('span', null, t.every),
                    h('input', {
                      type: 'number',
                      min: 1,
                      max: 1440,
                      value: r.interval,
                      onChange: (e) => setReminder(m.id, { interval: Math.max(1, Math.min(1440, Number(e.target.value) || 1)) }),
                      style: {
                        width: '72px',
                        background: 'transparent',
                        border: '1px solid var(--dsw-alias-border-l1)',
                        borderRadius: '6px',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: '12px',
                        padding: '3px 6px',
                      },
                    }),
                    h('span', null, t.minutesUnit),
                    h('span', { style: { marginLeft: 'auto' } }, t.nextAt + ' ' + fmtNext(m.id)),
                  ])
                : h('div', {
                    style: { marginTop: '8px', paddingLeft: '32px' },
                  }, [
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
                      h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t.atTimes),
                      ...r.times.map((tv, idx) =>
                        h('span', { key: 't' + idx, style: { display: 'inline-flex', alignItems: 'center', gap: '2px' } }, [
                          timeInput(tv, (v) => {
                            const next = r.times.slice();
                            next[idx] = v;
                            setReminderTimes(m.id, next);
                          }, 'i' + idx),
                          h('button', {
                            type: 'button',
                            title: t.removeTime,
                            onClick: () => setReminderTimes(m.id, r.times.filter((_, i) => i !== idx)),
                            style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '14px', padding: '0 2px' },
                          }, '×'),
                        ])
                      ),
                      h('button', {
                        type: 'button',
                        onClick: () => setReminderTimes(m.id, [...r.times, '09:00']),
                        style: { background: 'transparent', border: '1px dashed var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)', borderRadius: '6px', padding: '3px 8px', fontSize: '12px', cursor: 'pointer' },
                      }, t.addTime),
                    ]),
                    h('div', { style: { marginTop: '5px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, t.timesHint),
                  ]),
            ])
          );
        }

        // 安静时段
        rows.push(
          h('div', { key: 'quiet', style: { paddingTop: '14px' } }, [
            h('div', {
              style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' },
            }, [
              h('span', { style: { fontSize: '20px' } }, '🌙'),
              h('span', null, t.quietTitle),
              h('label', {
                style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: '400', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', marginLeft: 'auto' },
              }, [
                h('input', {
                  type: 'checkbox',
                  checked: config.quietHours.enable,
                  onChange: (e) => setConfig((c) => ({ ...c, quietHours: { ...c.quietHours, enable: e.target.checked } })),
                }),
                t.quietEnable,
              ]),
            ]),
            config.quietHours.enable
              ? h('div', {
                  style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingLeft: '32px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
                }, [
                  h('span', null, t.quietStart),
                  timeInput(config.quietHours.start, (v) => setConfig((c) => ({ ...c, quietHours: { ...c.quietHours, start: v } })), 'qs'),
                  h('span', null, t.quietEnd),
                  timeInput(config.quietHours.end, (v) => setConfig((c) => ({ ...c, quietHours: { ...c.quietHours, end: v } })), 'qe'),
                ])
              : null,
            config.quietHours.enable
              ? h('div', { style: { marginTop: '6px', paddingLeft: '32px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, t.quietHint)
              : null,
          ])
        );
      }

      return h('div', {
        style: {
          position: 'fixed',
          top: '0', left: '0', right: '0', bottom: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 4000,
        },
      }, [
        h('div', {
          key: 'backdrop',
          style: {
            position: 'absolute',
            top: '0', left: '0', right: '0', bottom: '0',
            background: 'rgba(0,0,0,0.35)',
          },
          onClick: onClose,
        }),
        h('div', {
          key: 'card',
          style: {
            position: 'relative',
            background: 'var(--dsw-alias-bg-layer-2)',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: '14px',
            padding: '20px 24px',
            width: 'min(560px, calc(100vw - 40px))',
            maxHeight: 'calc(100vh - 80px)',
            overflowY: 'auto',
            boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          },
        }, [
          h('div', {
            key: 'head',
            style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
          }, [
            h('span', { style: { fontSize: '24px' } }, '🐳'),
            h('h2', {
              style: { margin: 0, color: 'var(--dsw-alias-label-primary)', fontSize: '18px', fontWeight: '700', flex: 1 },
            }, t.configTitle),
            h('button', {
              type: 'button',
              onClick: onClose,
              'aria-label': t.dismiss,
              style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-secondary)', fontSize: '20px', cursor: 'pointer', lineHeight: '1' },
            }, '×'),
          ]),
          h('p', {
            key: 'tip',
            style: { margin: '0 0 6px 0', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' },
          }, t.tip),
          i18nError && !ready
            ? h('p', {
                key: 'i18nwarn',
                style: { margin: '0 0 6px 0', color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' },
              }, t.i18nFail)
            : null,
          loading || !ready
            ? h('div', { key: 'loading', style: { padding: '24px 0', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, t.loading)
            : rows,
          // 语言切换 + 操作
          h('div', {
            key: 'foot',
            style: {
              marginTop: '18px',
              paddingTop: '14px',
              borderTop: '1px solid var(--dsw-alias-border-l1)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            },
          }, [
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t.langLabel + ':'),
            h('button', { type: 'button', onClick: () => onLangChange('en'), style: btnStyle(lang === 'en') }, 'English'),
            h('button', { type: 'button', onClick: () => onLangChange('zh'), style: btnStyle(lang === 'zh') }, '中文'),
            h('span', { style: { flex: 1 } }),
            msg ? h('span', {
              style: { fontSize: '12px', color: msg === t.saved ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-error-primary)' },
            }, msg) : null,
            h('button', {
              type: 'button',
              onClick: save,
              disabled: loading || saving || !config || !ready,
              style: {
                background: 'var(--dsw-alias-brand-primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 18px',
                fontSize: '13px',
                cursor: loading || saving ? 'default' : 'pointer',
                opacity: loading || saving || !config || !ready ? 0.5 : 1,
              },
            }, saving ? t.saving : t.save),
          ]),
        ]),
      ]);
    }

    // ─────────────────────────────────────────────────────────────────
    // 浮动小宠物
    // ─────────────────────────────────────────────────────────────────
    const CSS = `
      @keyframes dshLifeBob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }
      .dsh-life-pet {
        position: fixed;
        width: ${PET_SIZE}px;
        height: ${PET_SIZE}px;
        border-radius: 50%;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        line-height: 1;
        cursor: grab;
        user-select: none;
        touch-action: none;
        z-index: 3900;
        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        box-shadow: 0 6px 18px rgba(0, 140, 255, 0.45), inset 0 1px 2px rgba(255,255,255,0.6);
        transition: box-shadow .2s ease;
      }
      .dsh-life-pet:hover { box-shadow: 0 8px 24px rgba(0, 140, 255, 0.6), inset 0 1px 2px rgba(255,255,255,0.6); }
      .dsh-life-pet:active { cursor: grabbing; }
      .dsh-life-pet .dsh-life-pet-emoji { animation: dshLifeBob 3.2s ease-in-out infinite; pointer-events: none; }
    `;

    function FloatingPet() {
      const [pos, setPos] = useState(loadPos);
      const [open, setOpen] = useState(false);
      const [lang, setLangState] = useState(getLang);
      const [texts, setTexts] = useState(readCachedTexts);
      const [i18nError, setI18nError] = useState(false);
      const dragRef = useRef(null);

      // 语言包只拉一次：localStorage 缓存兜住首屏，失败时面板显示提示而不是丢文案
      useEffect(() => {
        let cancelled = false;
        fetch(API_I18N, { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((j) => {
            if (cancelled) return;
            if (!j || !j.locales || !j.locales.zh || !j.locales.en) throw new Error('bad i18n response');
            const built = { zh: buildTexts(j.locales.zh), en: buildTexts(j.locales.en) };
            setTexts(built);
            setI18nError(false);
            cacheTexts(built);
          })
          .catch(() => { if (!cancelled) setI18nError(true); });
        return () => { cancelled = true; };
      }, []);

      useEffect(() => {
        const onResize = () => setPos((p) => clampPos(p));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);

      const t = (texts && texts[lang]) || FALLBACK;

      const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originX: pos.x,
          originY: pos.y,
          moved: false,
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      };

      const onPointerMove = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved) {
          setPos(clampPos({ x: d.originX + dx, y: d.originY + dy }));
        }
      };

      const endDrag = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        dragRef.current = null;
        if (d.moved) {
          setPos((p) => { savePos(p); return p; });
        } else {
          setOpen(true);
        }
      };

      const handleLangChange = (next) => {
        setLang(next);
        setLangState(next);
      };

      return h(React.Fragment || 'div', null, [
        h('style', { key: 'css' }, CSS),
        h('button', {
          key: 'pet',
          type: 'button',
          className: 'dsh-life-pet',
          'aria-label': t.title,
          title: t.title,
          style: { left: pos.x + 'px', top: pos.y + 'px' },
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
        }, [
          h('span', { key: 'e', className: 'dsh-life-pet-emoji', 'aria-hidden': true }, '🐳'),
        ]),
        open
          ? h(ConfigPanel, {
              key: 'panel',
              onClose: () => setOpen(false),
              lang,
              onLangChange: handleLangChange,
              t,
              ready: !!texts,
              i18nError,
            })
          : null,
      ]);
    }

    // ─────────────────────────────────────────────────────────────────
    // Slot 注册：shell.overlay（frame-wide 浮动层）
    // ─────────────────────────────────────────────────────────────────
    return {
      inject: ['slots'],
      apply(ctx) {
        const disposer = ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'life-reminder-floating', order: 40 },
            FloatingPet
          )
        );
        return () => { try { disposer() } catch {} };
      },
    };
  },
});
