// 内置内容包导入：content/weekNN.json → content_item，并为表达卡生成 card 行（重复运行安全）
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { all, get, run } from './db.js';

export function importContent(dir = path.join(config.root, 'content')) {
  if (!fs.existsSync(dir)) return 0;
  let added = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^week\d+.*\.json$/.test(x)).sort()) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const it of pack.items || []) {
      run(`INSERT INTO content_item (id, week, type, en, zh, extra, approved, day) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET en=excluded.en, zh=excluded.zh, extra=excluded.extra, day=excluded.day`,
        [it.id, pack.week, it.type, it.en, it.zh, JSON.stringify({ example: it.example || '', theme: pack.theme }), pack.reviewed ? 1 : 0, it.day || 1]);
      if (it.type !== 'card') continue;
      const exist = get('SELECT id FROM card WHERE content_id = ?', [it.id]);
      if (exist) {
        // 内容修订同步到尚未开始学习的卡；已学过的卡不动，避免打乱复习
        run('UPDATE card SET en=?, zh=?, example=? WHERE id=? AND introduced_at IS NULL', [it.en, it.zh, it.example || '', exist.id]);
        run('UPDATE card SET day=? WHERE id=?', [it.day || 1, exist.id]);
      } else {
        run('INSERT INTO card (content_id, en, zh, example, source, scene, week, day) VALUES (?,?,?,?,?,?,?,?)',
          [it.id, it.en, it.zh, it.example || '', '内置', pack.theme, pack.week, it.day || 1]);
        added++;
      }
    }
    // 跟读材料、独白话题：存 content_item（type = shadow / topic），细节放 extra
    for (const sh of pack.shadow || []) {
      run(`INSERT INTO content_item (id, week, type, en, zh, extra, approved, day) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET week=excluded.week, en=excluded.en, zh=excluded.zh, extra=excluded.extra, day=excluded.day`,
        [sh.id, pack.week, 'shadow', sh.title, sh.title, JSON.stringify({ sentences: sh.sentences }), pack.reviewed ? 1 : 0, sh.day || 1]);
    }
    for (const t of pack.topics || []) {
      run(`INSERT INTO content_item (id, week, type, en, zh, extra, approved, day) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET week=excluded.week, en=excluded.en, zh=excluded.zh, extra=excluded.extra, day=excluded.day`,
        [t.id, pack.week, 'topic', t.en, t.zh, JSON.stringify({ hints: t.hints || [] }), pack.reviewed ? 1 : 0, t.day || 1]);
    }
    for (const sc of pack.scenes || []) upsertScene(sc, pack);
    // 周复习对话：第 7 天，按 review.stages 把本周话题串成一段长对话（roleplay.js 分段引导）
    if (pack.review?.stages?.length) upsertScene(reviewScene(pack), pack);
  }
  return added;
}

export function reviewScene(pack) {
  const rv = pack.review;
  return {
    ...rv, id: `w${String(pack.week).padStart(2, '0')}-review`, day: 7, level: 'review',
    title: rv.title || `周复习：${pack.theme}`, tasks: rv.stages.map((s) => s.task), hints: [],
  };
}

function upsertScene(sc, pack) {
  run(`INSERT INTO content_scene (id, week, title, level, role, brief, tasks, hints, approved, data, day) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET week=excluded.week, title=excluded.title, level=excluded.level, role=excluded.role,
       brief=excluded.brief, tasks=excluded.tasks, hints=excluded.hints, data=excluded.data, day=excluded.day`,
    [sc.id, pack.week, sc.title, sc.level, sc.role, sc.brief, JSON.stringify(sc.tasks), JSON.stringify(sc.hints || []),
      pack.reviewed ? 1 : 0, JSON.stringify(sc), sc.day || 1]);
}

export const themeOfWeek = (week) =>
  all('SELECT DISTINCT scene FROM card WHERE week = ? AND source = ?', [week, '内置'])[0]?.scene || '';
