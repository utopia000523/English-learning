import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { initDb, saveNow, backupDb } from './db.js';
import { api } from './routes/api.js';
import { importContent } from './content.js';

export async function createApp({ dbFile } = {}) {
  await initDb(dbFile);
  importContent();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

  if (fs.existsSync(config.distDir)) {
    app.use(express.static(config.distDir));
    app.get('*', (_req, res) => res.sendFile(path.join(config.distDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.code === 'NOT_IMPLEMENTED' ? 501 : err.code === 'NOTION_ERROR' ? 400 : err.code === 'NOTION_OFFLINE' ? 503 : ['LLM_UNAVAILABLE', 'ASR_UNAVAILABLE'].includes(err.code) ? 503 : 500;
    res.status(status).json({ error: err.message, code: err.code });
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createApp();
  app.listen(config.port, '127.0.0.1', () => {
    console.log(`开口 90 天 已启动：http://localhost:${config.port}`);
  });
  // 手机（局域网 / 蒲公英）：start.sh 生成了证书时，额外开 https 端口，带访问码
  const { startLan } = await import('./lan.js');
  const certs = path.join(config.dataDir, 'certs');
  const key = startLan(app, { port: Number(process.env.SPEAK90_HTTPS_PORT || 0), certFile: path.join(certs, 'cert.pem'), keyFile: path.join(certs, 'key.pem'), dataDir: config.dataDir });
  if (key) console.log(`手机访问码：${key}（第一次在手机上打开时输入，或直接用上面带 ?key= 的网址）`);
  // Notion 自动同步：每 10 分钟一次，未同步的内容自动排队（断网时跳过）
  const { autoSync } = await import('./autosync.js');
  const { cleanupAudio } = await import('./maintenance.js');
  cleanupAudio(); setInterval(cleanupAudio, 24 * 3600 * 1000); // 录音过期清理：启动时和每天一次
  setInterval(() => backupDb(), 3600 * 1000); // 数据库备份：每小时检查，当天已有就跳过（服务跨天运行时也能备份）
  setInterval(autoSync, 10 * 60 * 1000);
  setTimeout(autoSync, 30 * 1000);
  const { fillMissingZh } = await import('./notes.js');
  setTimeout(() => fillMissingZh().catch(() => {}), 20 * 1000); // 补上之前缺中文释义的笔记
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });
}
