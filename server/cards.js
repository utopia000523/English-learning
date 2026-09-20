// 表达卡数据访问
import { all, get, run, getSettings, updateSettings } from './db.js';
import { todayStr, diffDays } from './util/date.js';
import { schedule, preview } from './services/srs.js';
import { logEvent } from './activity.js';
import { ipaOf } from './services/ipa.js';

/** 第几天、第几周。首次使用时以当天为第 1 天（入门测评在阶段 6 会重设） */
export function planPosition(today = todayStr()) {
  let { startDate } = getSettings();
  if (!startDate) startDate = updateSettings({ startDate: today }).startDate;
  const dayNo = Math.max(1, diffDays(startDate, today) + 1);
  const week = Math.min(12, Math.ceil(dayNo / 7));
  const dayInWeek = dayNo > 84 ? 7 : ((dayNo - 1) % 7) + 1; // 1–6 学新内容，7 复习日
  return { startDate, dayNo, week, dayInWeek };
}

/** 按天解锁：之前的周全部可用；本周到今天为止（第 7 天复习日时整周可用） */
export const UNLOCK_SQL = '(week < ? OR (week = ? AND COALESCE(day, 1) <= ?))';
export const unlockArgs = (pos) => [pos.week, pos.week, pos.dayInWeek];
export const isUnlocked = (week, day, pos) => week < pos.week || (week === pos.week && (day || 1) <= pos.dayInWeek);

const toClient = (c, isNew = false) => ({
  id: c.id, en: c.en, zh: c.zh, example: c.example, note: c.note || '', ipa: c.source === '雅思' ? ipaOf(c.en) || '' : '', scene: c.scene, week: c.week,
  source: c.source, isNew, preview: preview(c),
});

export function stats(pos) {
  return {
    mastered: get('SELECT COUNT(*) n FROM card WHERE mastered = 1').n,
    learning: get('SELECT COUNT(*) n FROM card WHERE introduced_at IS NOT NULL AND mastered = 0').n,
    newLeft: get(`SELECT COUNT(*) n FROM card WHERE introduced_at IS NULL AND ${UNLOCK_SQL}`, unlockArgs(pos)).n,
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
  const fresh = all(`SELECT * FROM card WHERE introduced_at IS NULL AND ${UNLOCK_SQL} ORDER BY week, day, id LIMIT ?`, [...unlockArgs(pos), limit]);
  return {
    ...pos,
    reviewedToday,
    cards: [...due.map((c) => toClient(c)), ...fresh.map((c) => toClient(c, true))],
    stats: stats(pos),
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
  const { week, dayInWeek } = planPosition(today);
  const { lastId } = run('INSERT INTO card (en, zh, example, source, scene, week, day) VALUES (?,?,?,?,?,?,?)',
    [en, zh, example, source, scene, week, Math.min(dayInWeek, 6)]);
  return toClient(get('SELECT * FROM card WHERE id = ?', [lastId]), true);
}
