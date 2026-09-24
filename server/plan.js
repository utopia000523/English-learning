// 每日课程与学习进度（PRD 2.1–2.3、3.1、3.6、3.8）
import { all, get, run } from './db.js';
import { planPosition, todayQueue, stats as cardStats } from './cards.js';
import { todayStr, addDays } from './util/date.js';
import { fluency } from './services/score.js';
import * as assessment from './assessment.js';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

export const THEMES = ['自我介绍与近况', '日常闲聊', '吃饭点餐', '接待客户与介绍公司', '购物', '电话与约时间',
  '出行与旅行', '开会与讨论', '表达观点', '讲一段经历', '解决问题', '综合复盘'];
export const PHASES = [
  { no: 1, name: '敢开口', weeks: '1–4', focus: '句型和跟读为主', weights: { cards: 35, shadow: 35, roleplay: 15, mono: 15 } },
  { no: 2, name: '能对话', weeks: '5–8', focus: '场景对话为主', weights: { cards: 25, shadow: 20, roleplay: 40, mono: 15 } },
  { no: 3, name: '说得久', weeks: '9–12', focus: '独白和观点', weights: { cards: 20, shadow: 15, roleplay: 35, mono: 30 } },
];
export const phaseOf = (week) => (week <= 4 ? 1 : week <= 8 ? 2 : 3);
const RANDOM = ['shadow', 'roleplay', 'mono']; // 热身已是表达卡，中间随机不再抽表达卡
const MIN = { cards: 5, shadow: 10, roleplay: 10, mono: 10, review: 5 };
const SHADOW_DONE = 5; // 跟读评分满 5 句算完成

/** 按权重不放回抽取 n 个 */
export function weightedPick(weights, n, rand = Math.random) {
  const pool = Object.entries(weights).filter(([, w]) => w > 0);
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total; let k = 0;
    while (k < pool.length - 1 && r >= pool[k][1]) { r -= pool[k][1]; k++; }
    out.push(pool[k][0]); pool.splice(k, 1);
  }
  return out;
}

/** 近 2 天课程里出现过的模块 */
function recentModules(dayNo) {
  return new Set(all('SELECT modules FROM plan_day WHERE day_no IN (?, ?)', [dayNo - 1, dayNo - 2])
    .flatMap((r) => parse(r.modules, []).map((s) => s.module)));
}

function randomWeights(week, dayNo, exclude = []) {
  const recent = recentModules(dayNo);
  const base = PHASES[phaseOf(week) - 1].weights;
  const w = {};
  for (const m of RANDOM) if (!exclude.includes(m)) w[m] = base[m] * (recent.has(m) ? 1 : 2); // 连续 2 天没出现 ×2
  return w;
}

/** 某周某天的内容（场景 / 跟读 / 话题），没有就返回 undefined */
const sceneOfDay = (week, day) => get('SELECT id, title FROM content_scene WHERE week = ? AND day = ? ORDER BY id', [week, day]);
const reviewSceneOf = (week) => get("SELECT id, title FROM content_scene WHERE week = ? AND level = 'review'", [week]);
// 只排内置内容；雅思跟读（id 以 ielts: 开头）在跟读页自选
const itemOfDay = (type, week, day) => get("SELECT id, zh FROM content_item WHERE type = ? AND week = ? AND day = ? AND id NOT LIKE 'ielts:%' ORDER BY id", [type, week, day]);

function generate(today) {
  const { dayNo, week, dayInWeek } = planPosition(today);
  const cardsTarget = Math.min(todayQueue(today).cards.length, 30);
  const scene = sceneOfDay(week, dayInWeek);
  let slots;
  if (dayInWeek === 7) {
    // 每周第 7 天：复习日。有周复习对话时加在中间（把本周话题和薄弱表达串成一段长对话）
    const rv = reviewSceneOf(week);
    slots = [
      { slot: 'warmup', module: 'cards', label: '复习日' },
      ...(rv ? [{ slot: 'scene', module: 'roleplay', label: '本周综合对话', sceneId: rv.id }] : []),
      { slot: 'wrap', module: 'review', label: '本周错句重说' },
    ];
  } else if (scene) {
    // 第 1–6 天：表达卡热身 → 当天场景对话（第 6 天是挑战）→ 跟读 / 独白随机一项 → 收尾
    // 跟读和独白轮着来：本周谁用得少就选谁，一样多时按阶段权重随机
    const used = { shadow: 0, mono: 0 };
    for (const r of all('SELECT modules FROM plan_day WHERE day_no >= ? AND day_no < ?', [dayNo - dayInWeek + 1, dayNo]))
      for (const s of parse(r.modules, [])) if (s.module in used) used[s.module]++;
    const pick = used.shadow === used.mono ? weightedPick(randomWeights(week, dayNo, ['roleplay']), 1)[0]
      : used.shadow < used.mono ? 'shadow' : 'mono';
    slots = [
      { slot: 'warmup', module: 'cards', label: '热身' },
      { slot: 'scene', module: 'roleplay', label: dayInWeek === 6 ? '通关挑战' : '今日场景', sceneId: scene.id },
      { slot: 'b', module: pick, label: '随机' },
      { slot: 'wrap', module: 'review', label: '收尾' },
    ];
  } else {
    // 这周还没有按天的内容：沿用随机两项
    const picks = weightedPick(randomWeights(week, dayNo), 2);
    slots = [
      { slot: 'warmup', module: 'cards', label: '热身' },
      { slot: 'a', module: picks[0], label: '随机' },
      { slot: 'b', module: picks[1], label: '随机' },
      { slot: 'wrap', module: 'review', label: '收尾' },
    ];
  }
  run(`INSERT INTO plan_day (day_no, date, phase, week, modules, cards_target) VALUES (?,?,?,?,?,?)
       ON CONFLICT(day_no) DO UPDATE SET date=excluded.date, phase=excluded.phase, week=excluded.week,
       modules=excluded.modules, cards_target=excluded.cards_target, swapped=0, wrap_done=0`,
    [dayNo, today, phaseOf(week), week, JSON.stringify(slots), cardsTarget]);
  return get('SELECT * FROM plan_day WHERE day_no = ?', [dayNo]);
}

const count = (date, module) => get('SELECT count FROM daily_log WHERE date = ? AND module = ?', [date, module])?.count || 0;

/** 某一天某个模块的状态：done / doing / todo */
function statusOf(slot, row, isToday) {
  const d = row.date;
  switch (slot.module) {
    case 'cards': {
      const n = count(d, 'cards');
      if ((isToday && todayQueue(d).cards.length === 0) || (row.cards_target > 0 && n >= row.cards_target)) return 'done';
      return n > 0 ? 'doing' : 'todo';
    }
    case 'roleplay': {
      const cond = slot.sceneId ? ' AND scene_id = ?' : '';
      const args = slot.sceneId ? [slot.sceneId] : [];
      if (get(`SELECT COUNT(*) n FROM roleplay WHERE ended_at LIKE ?${cond}`, [d + '%', ...args]).n) return 'done';
      return get(`SELECT COUNT(*) n FROM roleplay WHERE created_at LIKE ?${cond}`, [d + '%', ...args]).n ? 'doing' : 'todo';
    }
    case 'shadow': { const n = count(d, 'shadow'); return n >= SHADOW_DONE ? 'done' : n > 0 ? 'doing' : 'todo'; }
    case 'mono': return count(d, 'mono') > 0 ? 'done' : 'todo';
    case 'review': return row.wrap_done ? 'done' : 'todo';
    default: return 'todo';
  }
}

function withStatus(row, isToday) {
  const slots = parse(row.modules, []).map((s) => ({ ...s, minutes: s.module === 'cards' && s.label === '复习日' ? 10 : s.label === '本周综合对话' ? 20 : MIN[s.module], status: statusOf(s, row, isToday) }));
  const total = slots.reduce((n, s) => n + s.minutes, 0);
  const done = slots.filter((s) => s.status === 'done').reduce((n, s) => n + s.minutes, 0);
  return { slots, total, done, ratio: total ? done / total : 0 };
}

/** 今天推荐练的场景 / 跟读 / 话题：优先当天的内容；这周没有按天内容时，退回本周第一个没通关的场景 */
function suggestions(pos) {
  const d = Math.min(pos.dayInWeek, 6);
  const scenes = all('SELECT id, title FROM content_scene WHERE week = ? ORDER BY day, id', [pos.week]);
  const scene = sceneOfDay(pos.week, d) ||
    scenes.find((s) => !get('SELECT COUNT(*) n FROM roleplay WHERE scene_id = ? AND passed = 1', [s.id]).n) || scenes[0];
  const shadow = itemOfDay('shadow', pos.week, d) || get("SELECT id, zh FROM content_item WHERE type = 'shadow' AND week = ? AND id NOT LIKE 'ielts:%' ORDER BY day, id", [pos.week]);
  const topic = itemOfDay('topic', pos.week, d);
  return { scene, shadow, topic };
}

export function todayPlan(today = todayStr()) {
  const pos = planPosition(today);
  let row = get('SELECT * FROM plan_day WHERE day_no = ?', [pos.dayNo]);
  // 旧版课程（没有「今日场景」/「本周综合对话」）且当天有对应内容：按新规则重排
  const hasScene = row && parse(row.modules, []).some((s) => s.slot === 'scene');
  const stale = row && !hasScene && (pos.dayInWeek < 7 ? sceneOfDay(pos.week, pos.dayInWeek) : reviewSceneOf(pos.week));
  if (!row || row.date !== today || stale) row = generate(today);
  const st = withStatus(row, true);
  const sug = suggestions(pos);
  const q = todayQueue(today);
  const title = (id) => get('SELECT title FROM content_scene WHERE id = ?', [id])?.title || '';
  st.slots = st.slots.map((s) => ({
    ...s,
    detail: s.module === 'cards' ? `${q.cards.length} 张待复习` :
      s.module === 'roleplay' ? (s.sceneId ? title(s.sceneId) : sug.scene?.title) || '' :
      s.module === 'shadow' ? sug.shadow?.zh || '' : s.module === 'mono' ? (sug.topic ? `${sug.topic.zh} · 1 分钟` : '随机话题 1 分钟') : '错句回顾，存入笔记',
    sceneId: s.sceneId || (s.module === 'roleplay' ? sug.scene?.id : undefined),
    shadowId: s.module === 'shadow' ? sug.shadow?.id : undefined,
    topicId: s.module === 'mono' ? sug.topic?.id : undefined,
  }));
  return { ...pos, phase: phaseOf(pos.week), theme: THEMES[pos.week - 1], swapped: !!row.swapped, ...st, streak: streak(today), assessmentDue: assessment.due() };
}

/** 换一个：每天 1 次，重抽第一个还没开始的随机模块 */
export function swap(today = todayStr()) {
  const plan = todayPlan(today);
  if (plan.swapped) return { error: '今天已经换过一次了' };
  const target = plan.slots.find((s) => (s.slot === 'a' || s.slot === 'b') && s.label === '随机' && s.status === 'todo');
  if (!target) return { error: '没有可以换的练习（已开始或已完成）' };
  const used = plan.slots.map((s) => s.module);
  const [pick] = weightedPick(randomWeights(plan.week, plan.dayNo, used), 1);
  if (!pick) return { error: '没有其他练习可换' };
  const row = get('SELECT * FROM plan_day WHERE day_no = ?', [plan.dayNo]);
  const slots = parse(row.modules, []).map((s) => (s.slot === target.slot ? { slot: s.slot, module: pick, label: '随机' } : s));
  run('UPDATE plan_day SET modules = ?, swapped = 1 WHERE day_no = ?', [JSON.stringify(slots), plan.dayNo]);
  return todayPlan(today);
}

/** 收尾：今天对话里的问题句、独白里值得学的表达 */
export function wrapItems(today = todayStr()) {
  const items = [];
  for (const rp of all('SELECT * FROM roleplay WHERE created_at LIKE ?', [today + '%'])) {
    const msgs = parse(rp.messages, []); const fb = parse(rp.feedback, {});
    for (const [i, f] of Object.entries(fb)) if (f && !f.ok) items.push({ from: 'AI 对话', you: msgs[i]?.content || '', en: f.better, zh: f.zh || '', note: f.issue_zh || '' });
  }
  for (const s of all("SELECT metrics FROM session WHERE module = 'mono' AND started_at = ?", [today])) {
    for (const p of parse(s.metrics, {}).phrases || []) items.push({ from: '独白', you: '', en: p.en, zh: p.zh, note: '' });
  }
  return items;
}
export function finishWrap(today = todayStr()) {
  const { dayNo } = planPosition(today);
  todayPlan(today);
  run('UPDATE plan_day SET wrap_done = 1 WHERE day_no = ?', [dayNo]);
  return todayPlan(today);
}

/** 连续打卡天数：到今天（或昨天）为止每天都有练习 */
export function streak(today = todayStr()) {
  const days = new Set(all('SELECT DISTINCT date FROM daily_log').map((r) => r.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

/** 学习计划页：90 天日历 + 12 周路线 */
export function planOverview(today = todayStr()) {
  const pos = planPosition(today);
  const rows = new Map(all('SELECT * FROM plan_day').map((r) => [r.day_no, r]));
  const days = Array.from({ length: 90 }, (_, i) => {
    const r = rows.get(i + 1);
    return { dayNo: i + 1, date: addDays(pos.startDate, i), ratio: r ? withStatus(r, r.date === today).ratio : 0 };
  });
  const weekDone = (w) => days.filter((d) => Math.ceil(d.dayNo / 7) === w).reduce((n, d) => n + d.ratio, 0) / 7;
  return {
    ...pos, phase: phaseOf(pos.week), phases: PHASES.map((p) => ({ ...p, progress: [1, 2, 3, 4].map((k) => weekDone((p.no - 1) * 4 + k)).reduce((a, b) => a + b, 0) / 4 })),
    days, weeks: THEMES.map((t, i) => ({ week: i + 1, theme: t, hasContent: !!get('SELECT 1 FROM content_scene WHERE week = ?', [i + 1]) })),
  };
}

/** 某天完成度（Notion 同步用） */
export function ratioOf(date) {
  const r = get('SELECT * FROM plan_day WHERE date = ?', [date]);
  return r ? withStatus(r, date === todayStr()).ratio : 0;
}

/** 进度页（PRD 1.1、3.8） */
export function progress(today = todayStr()) {
  const pos = planPosition(today);
  const monos = all("SELECT started_at, metrics FROM session WHERE module = 'mono' ORDER BY id").map((s) => ({ date: s.started_at, ...parse(s.metrics, {}) }));
  const trend = monos.map((m) => ({ date: m.date, wpm: m.wpm, longPauses: m.longPauses, fillers: m.fillers }));
  const last = trend.slice(-3);
  const avg = (k) => (last.length ? Math.round(last.reduce((n, x) => n + (x[k] || 0), 0) / last.length) : null);
  let speakMs = 0;
  for (const r of all('SELECT words FROM recording')) speakMs += fluency(parse(r.words, [])).durationMs || 0;
  const cs = cardStats(pos);
  const scenesTotal = get('SELECT COUNT(*) n FROM content_scene').n;
  const scenesPassed = get('SELECT COUNT(DISTINCT scene_id) n FROM roleplay WHERE passed = 1').n;
  const st = streak(today);
  const speakMin = Math.round(speakMs / 60000);
  return {
    ...pos, streak: st, speakMin, mastered: cs.mastered, learning: cs.learning, scenesPassed, scenesTotal,
    wpm: avg('wpm'), longPauses: avg('longPauses'), trend,
    notes: get('SELECT COUNT(*) n FROM note').n,
    assessments: assessment.list(), assessmentDue: assessment.due(),
    badges: [
      { name: '连续 7 天', got: st >= 7 }, { name: '连续 30 天', got: st >= 30 }, { name: '首次通关', got: scenesPassed >= 1 },
      { name: '50 张熟练卡', got: cs.mastered >= 50 }, { name: '开口 100 分钟', got: speakMin >= 100 },
      { name: '语速破百', got: (avg('wpm') || 0) >= 100 }, { name: '全场景通关', got: scenesTotal > 0 && scenesPassed >= scenesTotal },
    ],
  };
}
