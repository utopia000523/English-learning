import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-mt-'));
process.env.SPEAK90_DATA_DIR = tmp;
const { createApp } = await import('../server/index.js');
const { cleanupAudio } = await import('../server/maintenance.js');

let server; let base;
before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'mt.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('导出：包含各表，不含 Notion Token', async () => {
  await fetch(base + '/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notionToken: 'secret_x' }) });
  const r = await fetch(base + '/export');
  assert.match(r.headers.get('content-disposition'), /attachment/);
  const d = await r.json();
  assert.ok(d.tables.card.length > 0);
  assert.ok(!JSON.stringify(d).includes('secret_x'));
});

test('录音清理：只删超过保留天数的文件', () => {
  const dir = path.join(tmp, 'audio'); fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'old.wav'); const fresh = path.join(dir, 'new.wav');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'x');
  const t = (Date.now() - 40 * 86400000) / 1000; fs.utimesSync(old, t, t);
  assert.equal(cleanupAudio(30), 1);
  assert.ok(!fs.existsSync(old) && fs.existsSync(fresh));
  assert.equal(cleanupAudio(0), 0);
});
