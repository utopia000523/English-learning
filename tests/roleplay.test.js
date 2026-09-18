// 用假模型（SPEAK90_FAKE_LLM）测试对话流程，不需要 Ollama
process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';

let server; let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-rp-'));
const json = (r) => r.json();
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'r.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('场景列表：第 1 周可练，第 2 周起未解锁', async () => {
  const list = await json(await fetch(base + '/roleplay/scenes'));
  assert.equal(list.length, 6);
  assert.ok(list.filter((s) => s.week === 1).every((s) => s.status === 'open'));
  assert.ok(list.filter((s) => s.week > 1).every((s) => s.status === 'locked'));
});

test('对话流程：开场 → 8 轮 → 任务完成 → 复盘通关', async () => {
  const rp = await json(await post('/roleplay', { sceneId: 'w01-s1' }));
  assert.equal(rp.messages[0].role, 'assistant');
  let r;
  for (let i = 0; i < 8; i++) r = await json(await post(`/roleplay/${rp.id}/turn`, { text: `hello ${i}` }));
  assert.equal(r.turns, 8);
  assert.deepEqual(r.tasksDone, [1, 2, 3, 4]);
  const fin = await json(await post(`/roleplay/${rp.id}/finish`));
  assert.equal(fin.passed, true);
  assert.ok(fin.review.fixes.length >= 1);
  const list = await json(await fetch(base + '/roleplay/scenes'));
  assert.equal(list.find((s) => s.id === 'w01-s1').status, 'passed');
});

test('轮数不足不通关', async () => {
  const rp = await json(await post('/roleplay', { sceneId: 'w01-s2' }));
  await post(`/roleplay/${rp.id}/turn`, { text: 'hi' });
  const fin = await json(await post(`/roleplay/${rp.id}/finish`));
  assert.equal(fin.passed, false);
});

test('英文正常发言不出现「可以说」提示；打中文才出现', async () => {
  const rp = await (await post('/roleplay', { sceneId: 'w01-s1' })).json();
  const a = await (await post(`/roleplay/${rp.id}/turn`, { text: 'Hi, nice to meet you!' })).json();
  assert.equal(a.messages.at(-1).coach, '');
});

test('单句点评：返回更地道说法；复盘汇总所有问题句', async () => {
  const rp = await (await post('/roleplay', { sceneId: 'w01-s1' })).json();
  const a = await (await post(`/roleplay/${rp.id}/turn`, { text: 'how do you familiar to both of them?' })).json();
  const fb = await (await post(`/roleplay/${rp.id}/feedback`, { index: a.messages.length - 2 })).json();
  assert.equal(fb.ok, false);
  assert.ok(fb.better && fb.issue_zh);
  assert.equal((await post(`/roleplay/${rp.id}/feedback`, { index: 0 })).status, 400);
  await post(`/roleplay/${rp.id}/turn`, { text: 'second line' });
  const fin = await (await post(`/roleplay/${rp.id}/finish`)).json();
  assert.equal(fin.review.fixes.length, 2);
  assert.ok(fin.review.comment_zh);
});

test('打中文：「可以说」是这句中文的英文，点评不是「表达自然」', async () => {
  const rp = await (await post('/roleplay', { sceneId: 'w01-s2' })).json();
  const a = await (await post(`/roleplay/${rp.id}/turn`, { text: '不太好，最近工作太忙了' })).json();
  assert.equal(a.messages.at(-1).coach, "Not great, work's been really busy lately.");
  const fb = await (await post(`/roleplay/${rp.id}/feedback`, { index: a.messages.length - 2 })).json();
  assert.equal(fb.ok, false);
  assert.equal(fb.better, "Not great, work's been really busy lately.");
});

test('参数校验', async () => {
  assert.equal((await post('/roleplay', { sceneId: 'nope' })).status, 404);
  assert.equal((await post('/roleplay/1/turn', { text: ' ' })).status, 400);
});
