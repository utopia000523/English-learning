import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, nextInterval } from '../server/services/srs.js';

const T = '2026-09-18';
const fresh = { interval_days: 0, streak: 0 };

test('新卡：没想起 → 次日；想起但卡 → 2 天；脱口而出 → 3 天', () => {
  assert.equal(schedule(fresh, 1, T).due_date, '2026-09-19');
  assert.equal(nextInterval(fresh, 2), 2);
  assert.equal(nextInterval(fresh, 3), 3);
});

test('想起但卡 ×1.2 会逐步变长，不会卡在 1 天', () => {
  let c = { interval_days: 1, streak: 0 };
  const seq = [];
  for (let i = 0; i < 4; i++) { c = { ...c, ...schedule(c, 2, T) }; seq.push(c.interval_days); }
  assert.deepEqual(seq, [2, 3, 4, 5]);
});

test('连续 3 次脱口而出且间隔 ≥ 14 天记为熟练；之后没想起取消熟练', () => {
  let c = { ...fresh };
  for (let i = 0; i < 3; i++) c = { ...c, ...schedule(c, 3, T) };
  assert.equal(c.interval_days, 20);
  assert.equal(c.streak, 3);
  assert.equal(c.mastered, 1);
  c = { ...c, ...schedule(c, 1, T) };
  assert.equal(c.mastered, 0);
  assert.equal(c.streak, 0);
});
