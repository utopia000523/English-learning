// 内置内容包导入：content/weekNN.json → content_item，并为表达卡生成 card 行（重复运行安全）
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, run } from './db.js';

export function importContent(dir = path.join(config.root, 'content')) {
  if (!fs.existsSync(dir)) return 0;
  let added = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^week\d+\.json$/.test(x)).sort()) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const it of pack.items || []) {
      run(`INSERT INTO content_item (id, week, type, en, zh, extra, approved) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET en=excluded.en, zh=excluded.zh, extra=excluded.extra`,
        [it.id, pack.week, it.type, it.en, it.zh, JSON.stringify({ example: it.example || '', theme: pack.theme }), pack.reviewed ? 1 : 0]);
      if (it.type !== 'card') continue;
      const exist = get('SELECT id FROM card WHERE content_id = ?', [it.id]);
      if (exist) {
        // 内容修订同步到尚未开始学习的卡；已学过的卡不动，避免打乱复习
        run('UPDATE card SET en=?, zh=?, example=? WHERE id=? AND introduced_at IS NULL', [it.en, it.zh, it.example || '', exist.id]);
      } else {
        run('INSERT INTO card (content_id, en, zh, example, source, scene, week) VALUES (?,?,?,?,?,?,?)',
          [it.id, it.en, it.zh, it.example || '', '内置', pack.theme, pack.week]);
        added++;
      }
    }
  }
  return added;
}

export const themeOfWeek = (week) =>
  all('SELECT DISTINCT scene FROM card WHERE week = ? AND source = ?', [week, '内置'])[0]?.scene || '';
