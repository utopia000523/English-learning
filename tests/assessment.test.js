process.env.SPEAK90_FAKE_ASR = '1';
process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-as-'));
process.env.SPEAK90_DATA_DIR = tmp;
const { createApp } = await import('../server/index.js');

let server; let base;
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const rec = async () => (await (await fetch(base + '/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(3200) })).json()).id;

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'as.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('首次需要入门测评；提交后不再提示，进度页有记录', async () => {
  const a = await (await fetch(base + '/assessment')).json();
  assert.equal(a.due, 0);
  assert.equal(a.test.shadow.length, 3);
  const r = await (await post('/assessment', { shadow: [await rec(), await rec(), await rec()], mono: await rec(), answers: [await rec(), await rec(), await rec()] })).json();
  assert.equal(r.milestone, 0);
  assert.ok(r.wpm > 0);
  assert.equal((await (await fetch(base + '/assessment')).json()).due, null);
  const p = await (await fetch(base + '/progress')).json();
  assert.equal(p.assessments.length, 1);
  assert.equal((await (await fetch(base + '/plan/today')).json()).assessmentDue, null);
});

test('数据不完整返回 400', async () => {
  assert.equal((await post('/assessment', { shadow: [] })).status, 400);
});
