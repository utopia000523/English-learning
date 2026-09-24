process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';

let server; let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-notes-'));
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'n.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('划词查询返回释义和例句', async () => {
  const r = await (await post('/lookup', { text: 'hectic', context: "Work's been pretty hectic lately." })).json();
  assert.ok(r.zh && r.example);
  assert.equal(r.ipa, '/ˈhɛktɪk/');
  assert.equal((await post('/lookup', { text: '' })).status, 400);
});

test('笔记本：加入、去重、搜索、筛选、删除', async () => {
  const a = await (await post('/notes', { en: 'hectic', zh: '忙乱的', source: '表达卡', context: "Work's been pretty hectic lately." })).json();
  assert.equal(a.ipa, '/ˈhɛktɪk/');
  const dup = await (await post('/notes', { en: 'Hectic' })).json();
  assert.equal(dup.duplicate, true);
  await post('/notes', { en: 'grab lunch', zh: '随便吃个午饭', source: 'AI 对话' });
  assert.equal((await (await fetch(base + '/notes')).json()).length, 2);
  assert.equal((await (await fetch(base + '/notes?q=' + encodeURIComponent('忙乱'))).json()).length, 1);
  assert.equal((await (await fetch(base + '/notes?source=' + encodeURIComponent('AI 对话'))).json()).length, 1);
  assert.equal((await fetch(base + '/notes/' + a.id, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(base + '/notes')).json()).length, 1);
});

test('例句必须真的用到所查的词', async () => {
  const { mentions } = await import('../server/notes.js');
  assert.ok(mentions('been up to', 'What are you up to tonight?'));
  assert.ok(mentions('been up to', "I haven't been up to much."));
  assert.ok(!mentions('been up to', "I've just been working a lot lately.")); // 这是回答，不是例句
  assert.ok(mentions('hectic', 'It was a hectic week.'));
  assert.ok(!mentions('hectic', 'Work has been really busy.'));
  assert.ok(mentions('impose', 'They imposed a limit on meetings.'));
  const r = await (await post('/lookup', { text: 'been up to', context: 'What have you been up to lately?' })).json();
  assert.ok(!r.example || mentions('been up to', r.example));
});

test('查词缓存：第二次直接命中，不再调模型', async () => {
  const one = await (await post('/lookup', { text: 'hectic', context: "Work's been pretty hectic lately." })).json();
  const two = await (await post('/lookup', { text: 'hectic', context: "Work's been pretty hectic lately." })).json();
  assert.deepEqual(one, two);
  const ipa = await (await fetch(base + '/ipa?text=hectic')).json();
  assert.equal(ipa.ipa, '/ˈhɛktɪk/');
});

test('没有中文释义的笔记（查词结果还没回来就点了加入）：后台自动补上', async () => {
  const n = await (await post('/notes', { en: 'walk me through', zh: '', source: 'AI 对话', context: 'Could you walk me through the plan?' })).json();
  assert.equal(n.zh, '');
  let zh = '';
  for (let i = 0; i < 20 && !zh; i++) {
    await new Promise((r) => setTimeout(r, 50));
    zh = (await (await fetch(base + '/notes?q=' + encodeURIComponent('walk me'))).json())[0]?.zh;
  }
  assert.ok(zh, '中文释义应被补上');
});
