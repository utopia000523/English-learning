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
// 内置内容有几周（每周 6 个场景、6 组跟读），加新一周不用改测试
const WEEKS = fs.readdirSync(new URL('../content', import.meta.url)).filter((f) => /^week\d+\.json$/.test(f)).length;

let server; let base;
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const record = async () => (await fetch(base + '/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(3200) })).json();

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'p.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('跟读材料：每周 6 组，第 1 天只解锁第 1 组', async () => {
  const l = await (await fetch(base + '/shadow')).json();
  assert.equal(l.length, 6 * WEEKS);
  assert.deepEqual(l.filter((m) => !m.locked).map((m) => m.id), ['w01-sh1']);
  assert.ok(l.every((m) => m.sentences.length >= 5 && m.day >= 1 && m.day <= 6));
});

test('跟读评分', async () => {
  const rec = await record();
  const r = await (await post('/shadow/score', { recordingId: rec.id, reference: "Hi, I'm Utopia. Nice to meet you." })).json();
  assert.ok(r.completeness > 0 && r.completeness < 100);
  assert.ok(r.missed.includes('Nice'));
});

test('独白：话题只给已解锁的天；改写与流利度', async () => {
  const t = await (await fetch(base + '/mono/topics')).json();
  assert.deepEqual(t.map((x) => x.id), ['w01-t1']);
  assert.equal(t[0].doneAt, ''); // 还没练过
  const rec = await record();
  const r = await (await post('/mono', { topicId: t[0].id, recordingId: rec.id })).json();
  assert.ok(r.rewrite && r.phrases.length && r.wpm > 0);
});

test('参数校验', async () => {
  assert.equal((await post('/shadow/score', { recordingId: 1 })).status, 400);
  assert.equal((await post('/mono', { topicId: 'x', recordingId: 999 })).status, 404);
});
