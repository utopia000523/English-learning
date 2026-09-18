process.env.SPEAK90_FAKE_ASR = '1';
process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-pr-'));
process.env.SPEAK90_DATA_DIR = tmp;
const { createApp } = await import('../server/index.js');

let server; let base;
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const record = async () => (await fetch(base + '/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(3200) })).json();

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'p.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('跟读材料：6 组，第 1 周可用', async () => {
  const l = await (await fetch(base + '/shadow')).json();
  assert.equal(l.length, 6);
  assert.ok(l.filter((m) => m.week === 1).every((m) => !m.locked && m.sentences.length > 0));
});

test('跟读评分', async () => {
  const rec = await record();
  const r = await (await post('/shadow/score', { recordingId: rec.id, reference: "Hi, I'm Utopia. Nice to meet you." })).json();
  assert.ok(r.completeness > 0 && r.completeness < 100);
  assert.ok(r.missed.includes('Nice'));
});

test('独白：话题只给已解锁周；改写与流利度', async () => {
  const t = await (await fetch(base + '/mono/topics')).json();
  assert.equal(t.length, 5);
  const rec = await record();
  const r = await (await post('/mono', { topicId: t[0].id, recordingId: rec.id })).json();
  assert.ok(r.rewrite && r.phrases.length && r.wpm > 0);
});

test('参数校验', async () => {
  assert.equal((await post('/shadow/score', { recordingId: 1 })).status, 400);
  assert.equal((await post('/mono', { topicId: 'x', recordingId: 999 })).status, 404);
});
