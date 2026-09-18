// 用本地假 Notion 服务测试同步流程
import http from 'node:http';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const calls = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'id-' + calls.length, object: 'x' }));
  });
});
await new Promise((r) => fake.listen(0, r));
process.env.NOTION_API_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.SPEAK90_FAKE_LLM = '1';
const { createApp } = await import('../server/index.js');

let server; let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-notion-'));
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'nt.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fake.close(); });

test('没配置时同步报错', async () => {
  assert.equal((await post('/notion/sync')).status, 400);
});

test('创建数据库 → 同步笔记和每日记录 → 无变化不重复同步', async () => {
  await fetch(base + '/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notionToken: 'secret_test' }) });
  assert.equal((await post('/notion/setup', { parent: 'abc' })).status, 400);
  const s = await (await post('/notion/setup', { parent: 'https://www.notion.so/My-Page-0123456789abcdef0123456789abcdef' })).json();
  assert.ok(s.notionNotesDb && s.notionLogDb);
  assert.equal(calls.filter((c) => c.url === '/v1/databases').length, 2);
  assert.equal(calls[0].body.parent.page_id, '0123456789abcdef0123456789abcdef');
  assert.equal(calls[0].auth, 'Bearer secret_test');

  await post('/notes', { en: 'hectic', zh: '忙乱的', source: '表达卡' });
  await post('/cards/1/review', { rating: 3 });
  const r = await (await post('/notion/sync')).json();
  assert.equal(r.notes, 1);
  assert.equal(r.days, 1);
  const pagePost = calls.find((c) => c.url === '/v1/pages' && c.body.properties.英文);
  assert.equal(pagePost.body.properties.音标.rich_text[0].text.content, '/ˈhɛktɪk/');
  const r2 = await (await post('/notion/sync')).json();
  assert.deepEqual([r2.notes, r2.days], [0, 0]);
  await post('/cards/2/review', { rating: 3 });
  const r3 = await (await post('/notion/sync')).json();
  assert.equal(r3.days, 1);
  assert.ok(calls.some((c) => c.method === 'PATCH'));
});
