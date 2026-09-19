// 数据维护：导出全部数据、按设置清理过期录音（PRD 3.10、6.1）
import fs from 'node:fs';
import path from 'node:path';
import { all, run, getSettings } from './db.js';
import { config } from './config.js';

const TABLES = ['settings', 'plan_day', 'daily_log', 'session', 'card', 'recording', 'roleplay', 'note', 'assessment', 'notion_sync'];

export function exportAll() {
  const out = { app: 'speak90', exportedAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) out.tables[t] = all(`SELECT * FROM ${t}`);
  const tok = out.tables.settings.find((r) => r.key === 'notionToken');
  if (tok) tok.value = '""'; // 不导出 Notion Token
  return out;
}

/** 删除超过 N 天的录音文件（识别文字和指标保留，只删音频） */
export function cleanupAudio(days = getSettings().audioKeepDays) {
  if (!days || days <= 0) return 0;
  const dir = path.join(config.dataDir, 'audio');
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - days * 86400000;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.rmSync(p);
        run('UPDATE recording SET audio_path = NULL WHERE audio_path = ?', [path.join('audio', f)]);
        n++;
      }
    } catch { /* 忽略单个文件错误 */ }
  }
  return n;
}
