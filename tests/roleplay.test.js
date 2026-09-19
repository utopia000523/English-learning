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
  for (let i = 0; i < 8; i++) r = await json(await post(`/roleplay/${rp.id}/turn`, { text: i === 7 ? 'Nice talking to you, bye!' : `hello ${i}` }));
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

test('打中文：英文说法只出现在点评卡，点评不是「表达自然」', async () => {
  const rp = await (await post('/roleplay', { sceneId: 'w01-s2' })).json();
  const a = await (await post(`/roleplay/${rp.id}/turn`, { text: '不太好，最近工作太忙了' })).json();
  assert.equal(a.messages.at(-1).coach, ''); // 不在 AI 回复下重复显示
  const fb = await (await post(`/roleplay/${rp.id}/feedback`, { index: a.messages.length - 2 })).json();
  assert.equal(fb.ok, false);
  assert.equal(fb.better, "Not great, work's been really busy lately.");
});

test('单独任务检查：返回已完成任务并保存', async () => {
  const rp = await (await post('/roleplay', { sceneId: 'w01-s1' })).json();
  await post(`/roleplay/${rp.id}/turn`, { text: "I work in product at a tech company. What do you do? Anyway, see you around!" });
  const t = await (await post(`/roleplay/${rp.id}/tasks`)).json();
  assert.deepEqual(t.tasksDone, [1, 2, 3, 4]);
  const again = await (await fetch(base + `/roleplay/${rp.id}`)).json();
  assert.deepEqual(again.tasksDone, [1, 2, 3, 4]);
});

test('道别类任务：没说告别的话不算完成', async () => {
  const rp = await (await post('/roleplay', { sceneId: 'w01-s1' })).json();
  await post(`/roleplay/${rp.id}/turn`, { text: 'Nice to meet you. I work in product. What do you do?' });
  const t = await (await post(`/roleplay/${rp.id}/tasks`)).json();
  assert.ok(!t.tasksDone.includes(4));
  await post(`/roleplay/${rp.id}/turn`, { text: 'It was great talking to you, see you around!' });
  const t2 = await (await post(`/roleplay/${rp.id}/tasks`)).json();
  assert.ok(t2.tasksDone.includes(4));
});

test('参数校验', async () => {
  assert.equal((await post('/roleplay', { sceneId: 'nope' })).status, 404);
  assert.equal((await post('/roleplay/1/turn', { text: ' ' })).status, 400);
});

test('追问「How about you?」算作问对方工作（任务 match 规则）', async () => {
  const { matchedTasks } = await import('../server/roleplay.js');
  const fs = await import('node:fs');
  const sc = JSON.parse(fs.readFileSync(new URL('../content/week01.json', import.meta.url))).scenes.find((s) => s.id === 'w01-s1');
  const say = (t) => [{ role: 'assistant', content: 'What do you do?' }, { role: 'user', content: t }];
  assert.deepEqual(matchedTasks(sc, say("Great! I work in product at a tech company in Shenzhen. How about you?")), [3]);
  assert.deepEqual(matchedTasks(sc, say('What do you do for work?')), [3]);
  assert.deepEqual(matchedTasks(sc, say('I work in product.')), []);
});
