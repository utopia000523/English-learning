process.env.SPEAK90_FAKE_ASR = '1';
process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-asr-'));
process.env.SPEAK90_DATA_DIR = tmp; // 录音写到临时目录，不污染 data/
const { createApp } = await import('../server/index.js');
const { tokensToWords } = await import('../server/services/asr.js');

let server; let base;

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'a.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('whisper 子词合并成单词，取最低置信度', () => {
  const w = tokensToWords([{ tokens: [
    { text: '[_BEG_]', offsets: { from: 0, to: 0 }, p: 1 },
    { text: ' Hel', offsets: { from: 0, to: 200 }, p: 0.9 },
    { text: 'lo', offsets: { from: 200, to: 400 }, p: 0.7 },
    { text: ' there', offsets: { from: 450, to: 800 }, p: 0.95 },
  ] }]);
  assert.deepEqual(w.map((x) => x.word), ['Hello', 'there']);
  assert.equal(w[0].prob, 0.7);
  assert.equal(w[0].end, 400);
});

test('上传录音 → 识别文字并存档', async () => {
  const r = await fetch(base + '/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(3200) });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.ok(d.id > 0);
  assert.equal(d.text, 'Hi, I am Utopia.');
  assert.equal(d.words.length, 4);
});

test('空录音返回 400', async () => {
  const r = await fetch(base + '/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(0) });
  assert.equal(r.status, 400);
});
