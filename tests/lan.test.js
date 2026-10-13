// 手机局域网访问的访问码（server/lan.js）：没有访问码进不来，?key= 对了写 cookie，连续输错锁定
import http from 'node:http';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { accessGate, accessKey } from '../server/lan.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-lan-'));
let server; let base; let key;
before(async () => {
  key = accessKey(tmp);
  const app = express();
  app.use(accessGate(key));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.send('home'));
  await new Promise((r) => { server = http.createServer(app).listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('访问码：6 位数字，存在文件里，重复读取不变', () => {
  assert.match(key, /^\d{6}$/);
  assert.equal(accessKey(tmp), key);
});

test('没有访问码：页面给输入框，接口 401', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 401);
  assert.match(await r.text(), /访问码/);
  assert.equal((await fetch(base + '/api/ping')).status, 401);
});

test('?key= 正确：写 cookie 并跳到今日；带 cookie 正常访问', async () => {
  const r = await fetch(`${base}/?key=${key}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/#/today');
  assert.match(r.headers.get('set-cookie'), new RegExp(`speak90_key=${key}`));
  const ok = await fetch(base + '/api/ping', { headers: { cookie: `speak90_key=${key}` } });
  assert.equal(ok.status, 200);
});

test('连续输错 10 次锁定，期间正确访问码也进不来', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await fetch(`${base}/?key=x${i}`)).status, 401);
  assert.equal((await fetch(`${base}/?key=${key}`, { redirect: 'manual' })).status, 429);
});
