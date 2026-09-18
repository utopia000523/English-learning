// 表达卡数据访问
import { all, get, run, getSettings, updateSettings } from './db.js';
import { todayStr, diffDays } from './util/date.js';
import { schedule, preview } from './services/srs.js';
import { logEvent } from './activity.js';

/** 第几天、第几周。首次使用时以当天为第 1 天（入门测评在阶段 6 会重设） */
export function planPosition(today = todayStr()) {
  let { startDate } = getSettings();
  if (!startDate) startDate = updateSettings({ startDate: today }).startDate;
  const dayNo = Math.max(1, diffDays(startDate, today) + 1);
  return { startDate, dayNo, week: Math.min(12, Math.ceil(dayNo / 7)) };
}

const toClient = (c, isNew = false) => ({
  id: c.id, en: c.en, zh: c.zh, example: c.example, scene: c.scene, week: c.week,
  source: c.source, isNew, preview: preview(c),
});

export function stats(week) {
  return {
    mastered: get('SELECT COUNT(*) n FROM card WHERE mastered = 1').n,
    learning: get('SELECT COUNT(*) n FROM card WHERE introduced_at IS NOT NULL AND mastered = 0').n,
    newLeft: get('SELECT COUNT(*) n FROM card WHERE introduced_at IS NULL AND week <= ?', [week]).n,
  };
}

/**
 * 今日队列：先到期复习卡，再补当天新卡。
 * 上限来自设置：cardsNewPerDay（每日新卡）、cardsDailyMax（每日总张数，0 = 不限）
 */
export function todayQueue(today = todayStr()) {
  const pos = planPosition(today);
  const { cardsNewPerDay, cardsDailyMax } = getSettings();
  const reviewedToday = get('SELECT COUNT(*) n FROM card WHERE reviewed_at = ?', [today]).n;
  const room = cardsDailyMax > 0 ? Math.max(0, cardsDailyMax - reviewedToday) : Infinity;
  const due = all('SELECT * FROM card WHERE introduced_at IS NOT NULL AND due_date <= ? ORDER BY due_date, id', [today])
    .slice(0, room === Infinity ? undefined : room);
  const introducedToday = get('SELECT COUNT(*) n FROM card WHERE introduced_at = ?', [today]).n;
  const limit = Math.max(0, Math.min(cardsNewPerDay - introducedToday, room - due.length));
  const fresh = all('SELECT * FROM card WHERE introduced_at IS NULL AND week <= ? ORDER BY week, id LIMIT ?', [pos.week, limit]);
  return {
    ...pos,
    reviewedToday,
    cards: [...due.map((c) => toClient(c)), ...fresh.map((c) => toClient(c, true))],
    stats: stats(pos.week),
  };
}

export function reviewCard(id, rating, today = todayStr()) {
  const card = get('SELECT * FROM card WHERE id = ?', [id]);
  if (!card) return null;
  const u = schedule(card, rating, today);
  run(`UPDATE card SET interval_days=?, streak=?, due_date=?, mastered=?, last_rating=?, reviewed_at=?,
       introduced_at = COALESCE(introduced_at, ?) WHERE id = ?`,
    [u.interval_days, u.streak, u.due_date, u.mastered, u.last_rating, u.reviewed_at, today, id]);
  logEvent('cards', 1, today);
  return toClient(get('SELECT * FROM card WHERE id = ?', [id]));
}

/** 手动添加 / 从对话复盘、独白改写加入（阶段 3、4 复用） */
export function addCard({ en, zh = '', example = '', source = '手动', scene = '' }, today = todayStr()) {
  const { week } = planPosition(today);
  const { lastId } = run('INSERT INTO card (en, zh, example, source, scene, week) VALUES (?,?,?,?,?,?)',
    [en, zh, example, source, scene, week]);
  return toClient(get('SELECT * FROM card WHERE id = ?', [lastId]), true);
}
