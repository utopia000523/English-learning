// 表达卡间隔复习（PRD 3.3，简化版 SM-2）。纯函数，便于测试
import { addDays } from '../util/date.js';

export const RATING = { AGAIN: 1, HARD: 2, EASY: 3 }; // 没想起 / 想起但卡 / 脱口而出

/** 计算自评后的下一次间隔（天） */
export function nextInterval(card, rating) {
  const base = card.interval_days > 0 ? card.interval_days : 1; // 起点 1 天
  if (rating === RATING.AGAIN) return 1;                          // 当天会话内再出一次 + 次日
  if (rating === RATING.HARD) return Math.max(1, Math.ceil(base * 1.2));
  return Math.max(1, Math.round(base * 2.5));
}

/** 返回要写回数据库的字段 */
export function schedule(card, rating, today) {
  const interval = nextInterval(card, rating);
  const streak = rating === RATING.EASY ? (card.streak || 0) + 1 : 0;
  return {
    interval_days: interval,
    streak,
    due_date: addDays(today, interval),
    mastered: streak >= 3 && interval >= 14 ? 1 : 0, // 连续 3 次脱口而出且间隔 ≥ 14 天
    last_rating: rating,
    reviewed_at: today,
  };
}

/** 三个按钮下方显示的预估 */
export const preview = (card) => ({
  [RATING.HARD]: nextInterval(card, RATING.HARD),
  [RATING.EASY]: nextInterval(card, RATING.EASY),
});
