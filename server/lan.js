// 手机通过局域网 / 蒲公英等虚拟局域网访问：额外开一个 https 端口（手机浏览器只有 https 才允许录音）。
// 这个端口对局域网开放，所以要访问码：打开一次带 ?key= 的网址或输入访问码后，用 cookie 记住一年。
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';

const COOKIE = 'speak90_key';
const cookieOf = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('='))
  .find(([k]) => k === name)?.[1] || '';
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** 读取或生成 6 位数字访问码（存在 data/certs/access-key.txt，不进数据库、不经接口返回） */
export function accessKey(dir) {
  const f = path.join(dir, 'access-key.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  fs.mkdirSync(dir, { recursive: true });
  const key = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  fs.writeFileSync(f, key + '\n', { mode: 0o600 });
  return key;
}

const page = (wrong) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>开口 90 天</title><style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#faf9f5;color:#1f1e1d;display:grid;place-items:center;min-height:100vh;margin:0}
form{text-align:center;padding:24px}h1{font-size:22px}input{font-size:24px;letter-spacing:6px;text-align:center;width:180px;padding:10px;border:1px solid #e6e3d9;border-radius:10px}
button{display:block;margin:16px auto 0;font-size:16px;padding:10px 28px;border:none;border-radius:10px;background:#c6613f;color:#fff}p{color:#6b6a66;font-size:14px}</style></head>
<body><form method="get" action="/"><h1>开口 90 天</h1><p>输入 Mac 启动窗口里显示的 6 位访问码</p>
<input name="key" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus>${wrong ? '<p style="color:#b9533f">访问码不对</p>' : ''}<button>进入</button></form></body></html>`;

/** 访问码检查：cookie 对就放行；?key= 对就写 cookie 并跳回去；同一 IP 连续输错 10 次锁 10 分钟 */
export function accessGate(key) {
  const fails = new Map();
  return (req, res, next) => {
    if (same(cookieOf(req, COOKIE), key)) return next();
    const ip = req.socket.remoteAddress || '';
    const f = fails.get(ip);
    if (f && f.n >= 10 && Date.now() - f.t < 10 * 60 * 1000) return res.status(429).type('html').send(page(true));
    const given = String(req.query.key || '');
    if (given && same(given, key)) {
      fails.delete(ip);
      res.setHeader('Set-Cookie', `${COOKIE}=${key}; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax`);
      return res.redirect(302, '/#/today');
    }
    if (given) fails.set(ip, { n: (f?.n || 0) + 1, t: Date.now() });
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '需要访问码' });
    return res.status(401).type('html').send(page(Boolean(given)));
  };
}

/** 有证书就开 https 端口（0.0.0.0），返回访问码；没有证书返回 null */
export function startLan(app, { port, certFile, keyFile, dataDir }) {
  if (!port || !fs.existsSync(certFile) || !fs.existsSync(keyFile)) return null;
  const key = accessKey(path.join(dataDir, 'certs'));
  const outer = express();
  outer.use(accessGate(key));
  outer.use(app);
  https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, outer)
    .on('error', (e) => console.log(`手机访问端口 ${port} 启动失败：${e.message}`))
    .listen(port, '0.0.0.0');
  return key;
}
