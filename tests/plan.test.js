process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';
import { weightedPick } from '../server/plan.js';
// 内置内容有几周（每周 6 个场景、6 组跟读），加新一周不用改测试
const WEEKS = fs.readdirSync(new URL('../content', import.meta.url)).filter((f) => /^week\d+\.json$/.test(f)).length;

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

test('今日课程：热身 + 当天场景 + 跟读或独白 + 收尾', async () => {
  const p = await get('/plan/today');
  assert.equal(p.dayInWeek, 1);
  assert.deepEqual(p.slots.map((s) => s.module).filter((m) => m !== 'shadow' && m !== 'mono'), ['cards', 'roleplay', 'review']);
  assert.equal(p.slots[1].sceneId, 'w01-s1');
  assert.equal(p.slots[1].label, '今日场景');
  assert.ok(['shadow', 'mono'].includes(p.slots[2].module));
  if (p.slots[2].module === 'shadow') assert.equal(p.slots[2].shadowId, 'w01-sh1');
  else assert.equal(p.slots[2].topicId, 'w01-t1');
  assert.equal(p.total, 30);
});

test('换一个只能一次；收尾完成后状态为已完成', async () => {
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
  assert.equal(pr.scenesTotal, 7 * WEEKS); // 含周复习对话
});
