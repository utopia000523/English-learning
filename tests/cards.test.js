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

test('首日：5 张第 1 周新卡', async () => {
  const q = await json(await fetch(base + '/cards/today'));
  assert.equal(q.dayNo, 1);
  assert.equal(q.week, 1);
  assert.equal(q.cards.length, 5);
  assert.ok(q.cards.every((c) => c.isNew && c.week === 1));
  assert.equal(q.stats.newLeft, 30);
});

test('自评后当天不再出现，新卡额度已用', async () => {
  const q = await json(await fetch(base + '/cards/today'));
  for (const c of q.cards) assert.equal((await post(`/cards/${c.id}/review`, { rating: 3 })).status, 200);
  const q2 = await json(await fetch(base + '/cards/today'));
  assert.equal(q2.cards.length, 0);
  assert.equal(q2.reviewedToday, 5);
  assert.equal(q2.stats.learning, 5);
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
