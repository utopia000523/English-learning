import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';

let server; let base; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-'));

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'test.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('health 返回各服务状态', async () => {
  const r = await (await fetch(base + '/health')).json();
  for (const k of ['server', 'llm', 'asr', 'notion']) assert.ok(k in r, k);
  assert.equal(r.server.ok, true);
});

test('设置可读写，Token 不回传明文', async () => {
  const put = await (await fetch(base + '/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyMinutes: 45, notionToken: 'secret_x', unknownKey: 1 }),
  })).json();
  assert.equal(put.dailyMinutes, 45);
  assert.equal(put.notionTokenSet, true);
  assert.equal(put.notionToken, undefined);
  assert.equal(put.unknownKey, undefined);
});

test('数据库文件已写入', () => assert.ok(fs.existsSync(path.join(tmp, 'test.db'))));

test('未知接口返回 404', async () => {
  const r = await fetch(base + '/nope');
  assert.equal(r.status, 404);
});
