process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';
import { weightedPick } from '../server/plan.js';

let server; let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-plan-'));
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const get = async (u) => (await fetch(base + u)).json();

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'pl.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('按权重不放回抽取，不重复', () => {
  const picks = weightedPick({ a: 1, b: 1, c: 1 }, 2);
  assert.equal(picks.length, 2);
  assert.notEqual(picks[0], picks[1]);
  assert.deepEqual(weightedPick({ a: 1, b: 0 }, 2), ['a']);
});

test('今日课程：热身 + 两个不重复随机 + 收尾（周日为复习日）', async () => {
  const p = await get('/plan/today');
  const sunday = new Date().getDay() === 0;
  if (sunday) { assert.deepEqual(p.slots.map((s) => s.module), ['cards', 'review']); return; }
  assert.equal(p.slots.length, 4);
  assert.equal(p.slots[0].module, 'cards');
  assert.equal(p.slots[3].module, 'review');
  assert.notEqual(p.slots[1].module, p.slots[2].module);
  assert.ok(!['cards', 'review'].includes(p.slots[1].module));
  assert.equal(p.total, 30);
});

test('换一个只能一次；收尾完成后状态为已完成', async () => {
  if (new Date().getDay() === 0) return;
  const a = await post('/plan/swap');
  assert.equal(a.status, 200);
  assert.equal((await post('/plan/swap')).status, 400);
  const w = await (await post('/plan/wrap')).json();
  assert.equal(w.slots.at(-1).status, 'done');
  assert.ok(w.done >= 5);
});

test('表达卡复习计入活动与连续打卡；日历与进度可用', async () => {
  await post('/cards/1/review', { rating: 3 });
  const p = await get('/plan/today');
  assert.equal(p.streak, 1);
  assert.notEqual(p.slots[0].status, 'todo');
  const plan = await get('/plan');
  assert.equal(plan.days.length, 90);
  assert.ok(plan.days[0].ratio > 0);
  const pr = await get('/progress');
  assert.equal(pr.streak, 1);
  assert.equal(pr.scenesTotal, 6);
});
