import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';

let server; let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-cards-'));
const json = (r) => r.json();
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'c.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const put = (u, b) => fetch(base + u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

test('按天解锁：第 1 天只给第 1 周第 1 天的 8 张新卡', async () => {
  const q = await json(await fetch(base + '/cards/today'));
  assert.equal(q.cards.length, 8);
  assert.ok(q.cards.every((c) => c.week === 1));
});

test('按设置限制：新卡 5 张', async () => {
  await put('/settings', { cardsNewPerDay: 5 });
  const q = await json(await fetch(base + '/cards/today'));
  assert.equal(q.dayNo, 1);
  assert.equal(q.week, 1);
  assert.equal(q.cards.length, 5);
  assert.ok(q.cards.every((c) => c.isNew && c.week === 1));
  assert.equal(q.stats.newLeft, 8);
});

test('自评后当天不再出现，新卡额度已用', async () => {
  const q = await json(await fetch(base + '/cards/today'));
  for (const c of q.cards) assert.equal((await post(`/cards/${c.id}/review`, { rating: 3 })).status, 200);
  const q2 = await json(await fetch(base + '/cards/today'));
  assert.equal(q2.cards.length, 0);
  assert.equal(q2.reviewedToday, 5);
  assert.equal(q2.stats.learning, 5);
});

test('每日总张数上限：已练 5 张、总数 7 → 还剩 2 张', async () => {
  await put('/settings', { cardsNewPerDay: 30, cardsDailyMax: 7 });
  const q = await json(await fetch(base + '/cards/today'));
  assert.equal(q.cards.length, 2);
  await put('/settings', { cardsDailyMax: 0 });
});

test('参数校验', async () => {
  assert.equal((await post('/cards/1/review', { rating: 5 })).status, 400);
  assert.equal((await post('/cards/99999/review', { rating: 1 })).status, 404);
  assert.equal((await post('/cards', { en: ' ' })).status, 400);
});

test('手动添加卡片', async () => {
  const c = await json(await post('/cards', { en: 'Light ice, please.', zh: '少冰', source: 'AI 对话' }));
  assert.equal(c.en, 'Light ice, please.');
});
