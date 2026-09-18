// 每日活动计数（用于每日课程完成度、日历、连续打卡）
import { run } from './db.js';
import { todayStr } from './util/date.js';

export function logEvent(module, n = 1, date = todayStr()) {
  run(`INSERT INTO daily_log (date, module, count) VALUES (?,?,?)
       ON CONFLICT(date, module) DO UPDATE SET count = count + excluded.count`, [date, module, n]);
}
