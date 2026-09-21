// 表达卡数据访问
import { all, get, run, getSettings, updateSettings } from './db.js';
import { todayStr, diffDays } from './util/date.js';
import { schedule, preview } from './services/srs.js';
import { logEvent } from './activity.js';
import { ipaOf } from './services/ipa.js';
import * as llm from './services/llm.js';

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

/** 自己先说：检查学习者写的 / 说的英文能不能表达这张卡的意思 */
export async function checkAnswer(id, text) {
  const card = get('SELECT * FROM card WHERE id = ?', [id]);
  if (!card) return null;
  const said = String(text || '').trim();
  if (!said) return { verdict: 'wrong', zh: '还没有输入内容。' };
  const out = await llm.chatJSON([
    { role: 'system', content: `You judge whether a Chinese adult learner's English says what they meant, in everyday spoken English.
Meaning (Chinese): ${card.zh}
One natural way to say it: ${card.en}
Many other wordings are fine. Judge the learner's sentence on meaning and naturalness, NOT on matching the reference. Ignore capitalization, punctuation and obvious typing slips.
"ok" = says the meaning and sounds natural; "close" = understandable but not natural or slightly off; "wrong" = does not say the meaning, or is clearly ungrammatical.
Respond ONLY with JSON: {"verdict": "ok|close|wrong", "zh": "一句简体中文点评，不超过40字", "better": "如果不是 ok，给一个更自然的说法，否则空字符串"}` },
    { role: 'user', content: said },
  ], { model: getSettings().llmModel, temperature: 0, kind: 'check' }, () => ({ verdict: 'close', zh: '本地模型没返回结果，先自己对照背面吧。', better: '' }));
  const verdict = ['ok', 'close', 'wrong'].includes(out.verdict) ? out.verdict : 'close';
  return { verdict, zh: out.zh || '', better: verdict === 'ok' ? '' : out.better || '' };
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
