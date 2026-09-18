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
  assert.equal((await post('/lookup', { text: '' })).status, 400);
});

test('笔记本：加入、去重、搜索、筛选、删除', async () => {
  const a = await (await post('/notes', { en: 'hectic', zh: '忙乱的', source: '表达卡', context: "Work's been pretty hectic lately." })).json();
  const dup = await (await post('/notes', { en: 'Hectic' })).json();
  assert.equal(dup.duplicate, true);
  await post('/notes', { en: 'grab lunch', zh: '随便吃个午饭', source: 'AI 对话' });
  assert.equal((await (await fetch(base + '/notes')).json()).length, 2);
  assert.equal((await (await fetch(base + '/notes?q=' + encodeURIComponent('忙乱'))).json()).length, 1);
  assert.equal((await (await fetch(base + '/notes?source=' + encodeURIComponent('AI 对话'))).json()).length, 1);
  assert.equal((await fetch(base + '/notes/' + a.id, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(base + '/notes')).json()).length, 1);
});
