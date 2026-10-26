/**
 * dsh-life-reminder —— 日常生活提醒插件（客户端侧）
 *
 * 一个“小宠物”式的浮动圆形图标（可鼠标拖动位置，位置记在 localStorage），
 * 点击打开提醒设置面板：
 *   · 每类提醒（喝水/吃饭/锻炼/休息/睡眠/护眼）可单独开关
 *   · 每类提醒二选一模式：按间隔分钟数，或每天一个/多个时间点（HH:MM）
 *   · 安静时段配置
 *   · 中英文手动切换
 * 配置通过同源 HTTP 路由 /dsh-life-reminder/api/config 与宿主半读写，
 * 持久化在 ~/.dsh/life-reminder.config.json。
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
    const LANG_KEY = 'dsh-life-reminder-lang';
    const POS_KEY = 'dsh-life-reminder-pos';
    const PET_SIZE = 56;

    // ─────────────────────────────────────────────────────────────────
    // 双语文本
    // ─────────────────────────────────────────────────────────────────
    const TEXTS = {
      en: {
        title: 'Life Reminder',
        tip: 'Take good care of yourself.',
        dismiss: 'Close',
        langLabel: 'Language',
        langEn: 'English',
        langZh: '中文',
        water: { title: 'Drink Water', body: 'Remember to drink a glass of water and stay hydrated.' },
        meal:  { title: 'Have a Meal',  body: "It's time to eat. Don't work on an empty stomach." },
        exercise: { title: 'Exercise', body: 'Stretch and move your body. Do some light exercise.' },
        rest:  { title: 'Take a Rest',  body: 'Give your eyes and brain a break. Step away from the screen for a few minutes.' },
        sleep: { title: 'Go to Sleep',  body: "It's getting late. Time to get ready for bed and get a good rest." },
        eye:   { title: 'Eye Care',     body: 'Look away from the screen and gaze into the distance. Give your eyes a rest.' },
        configTitle: 'Reminder Settings',
        enabled: 'On',
        intervalMode: 'By interval',
        timesMode: 'At times',
        every: 'Every',
        minutesUnit: 'min',
        atTimes: 'At',
        addTime: '+ Add time',
        removeTime: 'Remove',
        quietTitle: 'Quiet hours',
        quietEnable: 'Enable quiet hours',
        quietStart: 'Start',
        quietEnd: 'End',
        quietHint: 'Outside sleep, reminders are postponed until quiet hours end.',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved ✓',
        saveFail: 'Save failed: ',
        loadFail: 'Could not load settings: ',
        loading: 'Loading…',
        nextAt: 'Next',
        noNext: 'Not scheduled',
        timesHint: 'Multiple times supported, e.g. 09:00, 12:30, 18:00.',
      },
      zh: {
        title: '生活提醒',
        tip: '到了照顾好自己的时间。',
        dismiss: '关闭',
        langLabel: '语言',
        langEn: 'English',
        langZh: '中文',
        water: { title: '喝水', body: '记得喝一杯水，保持身体水分充足。' },
        meal:  { title: '吃饭', body: '该吃饭了，不要饿着肚子工作。' },
        exercise: { title: '锻炼', body: '伸伸懒腰，活动活动身体，做点简单的运动。' },
        rest:  { title: '休息', body: '眼睛和大脑也需要休息，远离屏幕几分钟。' },
        sleep: { title: '睡觉', body: '已经不早了，准备睡觉吧，早点休息对身体更好。' },
        eye:   { title: '护眼', body: '远离屏幕，望向远处，给眼睛放松。' },
        configTitle: '生活提醒设置',
        enabled: '开启',
        intervalMode: '按间隔',
        timesMode: '按时间点',
        every: '每',
        minutesUnit: '分钟',
        atTimes: '每天',
        addTime: '+ 添加时间',
        removeTime: '删除',
        quietTitle: '安静时段',
        quietEnable: '启用安静时段',
        quietStart: '开始',
        quietEnd: '结束',
        quietHint: '安静时段内除睡眠提醒外，其余提醒顺延到时段结束。',
        save: '保存',
        saving: '保存中…',
        saved: '已保存 ✓',
        saveFail: '保存失败：',
        loadFail: '读取设置失败：',
        loading: '读取中…',
        nextAt: '下次',
        noNext: '未排期',
        timesHint: '可设置多个时间点，例如 09:00、12:30、18:00。',
      },
    };

    const TYPE_META = [
      { id: 'water',   icon: '💧' },
      { id: 'meal',    icon: '🍽️' },
      { id: 'exercise',icon: '🏃' },
      { id: 'rest',    icon: '☕' },
      { id: 'sleep',   icon: '😴' },
      { id: 'eye',     icon: '👁️' },
    ];

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
    function normalizeClientConfig(c) {
      const base = { reminders: {}, quietHours: { enable: false, start: '22:00', end: '08:00' } };
      for (const m of TYPE_META) {
        const raw = c?.reminders?.[m.id] || {};
        base.reminders[m.id] = {
          enabled: raw.enabled !== false,
          mode: raw.mode === 'times' ? 'times' : 'interval',
          interval: Number.isFinite(Number(raw.interval)) ? Math.min(1440, Math.max(1, Math.round(Number(raw.interval)))) : 60,
          times: Array.isArray(raw.times) ? raw.times.map(String) : [],
        };
      }
      if (c?.quietHours) {
        base.quietHours = {
          enable: c.quietHours.enable === true,
          start: /^\d{1,2}:\d{2}$/.test(String(c.quietHours.start)) ? c.quietHours.start : '22:00',
          end: /^\d{1,2}:\d{2}$/.test(String(c.quietHours.end)) ? c.quietHours.end : '08:00',
        };
      }
      return base;
    }

    // ─────────────────────────────────────────────────────────────────
    // 设置面板
    // ─────────────────────────────────────────────────────────────────
    function ConfigPanel({ onClose, lang, onLangChange, t }) {
      const [config, setConfig] = useState(null);
      const [states, setStates] = useState({});
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);
      const [msg, setMsg] = useState('');

      useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setMsg('');
        fetch(API, { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((j) => {
            if (cancelled) return;
            if (!j || !j.ok) throw new Error((j && j.error) || 'bad response');
            setConfig(normalizeClientConfig(j.config));
            setStates(j.state || {});
          })
          .catch((e) => { if (!cancelled) setMsg(t.loadFail + e.message); })
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
      }, [t]);

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
          setConfig(normalizeClientConfig(j.config));
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
      if (config) {
        for (const m of TYPE_META) {
          const r = config.reminders[m.id];
          const label = t[m.id];
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
                }, label.title),
                h('label', {
                  style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
                }, [
                  h('input', {
                    key: 'en',
                    type: 'checkbox',
                    checked: r.enabled,
                    onChange: (e) => setReminder(m.id, { enabled: e.target.checked }),
                  }),
                  t.enabled,
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
          loading
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
            h('button', { type: 'button', onClick: () => onLangChange('en'), style: btnStyle(lang === 'en') }, t.langEn),
            h('button', { type: 'button', onClick: () => onLangChange('zh'), style: btnStyle(lang === 'zh') }, t.langZh),
            h('span', { style: { flex: 1 } }),
            msg ? h('span', {
              style: { fontSize: '12px', color: msg === t.saved ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-error-primary)' },
            }, msg) : null,
            h('button', {
              type: 'button',
              onClick: save,
              disabled: loading || saving || !config,
              style: {
                background: 'var(--dsw-alias-brand-primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 18px',
                fontSize: '13px',
                cursor: loading || saving ? 'default' : 'pointer',
                opacity: loading || saving || !config ? 0.5 : 1,
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
      const dragRef = useRef(null);

      useEffect(() => {
        const onResize = () => setPos((p) => clampPos(p));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);

      const t = TEXTS[lang] || TEXTS.zh;

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
