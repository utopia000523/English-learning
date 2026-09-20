// 雅思词汇导入：从 Notion「IELTS Listening Daily」数据库读每天的 ④ Vocabulary 表格，生成表达卡（来源「雅思」）。
// 每个页面的每个词只导入一次（card.content_id = ielts:<页面ID>:<词>）；和已有卡片英文相同的词跳过。
import { get, run, getSettings, updateSettings } from './db.js';
import { call } from './services/notion.js';
import { planPosition } from './cards.js';
import { todayStr } from './util/date.js';

export const idOf = (input) => {
  const m = String(input || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : '';
};
const plain = (rich) => (rich || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();

async function children(token, id) {
  const out = [];
  let cursor;
  do {
    const j = await call(token, `/v1/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    out.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** 找「Vocabulary」标题后的第一个表格，按表头把列对上：词 / 中文 / 搭配 / 例句 */
export async function vocabOf(token, pageId) {
  const blocks = await children(token, pageId);
  const h = blocks.findIndex((b) => /^heading_/.test(b.type) && /vocabulary|词汇/i.test(plain(b[b.type]?.rich_text)));
  if (h < 0) return [];
  const table = blocks.slice(h + 1).find((b) => b.type === 'table' || /^heading_/.test(b.type));
  if (!table || table.type !== 'table') return [];
  const rows = (await children(token, table.id)).filter((r) => r.type === 'table_row').map((r) => r.table_row.cells.map(plain));
  if (!rows.length) return [];
  const head = rows[0].map((x) => x.toLowerCase());
  const col = (re, fallback) => { const i = head.findIndex((x) => re.test(x)); return i >= 0 ? i : fallback; };
  const c = { en: col(/word|phrase|词/, 0), zh: col(/中文|释义|meaning|chinese/, 1), co: col(/colloc|搭配/, 2), ex: col(/example|例句/, 3) };
  return rows.slice(1).map((r) => ({ en: r[c.en] || '', zh: r[c.zh] || '', collocations: r[c.co] || '', example: r[c.ex] || '' }))
    .filter((w) => w.en);
}

let running = false;
/** 拉取最近的雅思页面并导入词汇。返回 { pages, added } */
export async function pull(today = todayStr()) {
  const s = getSettings();
  const db = idOf(s.ieltsDb);
  if (!s.notionToken || !db) throw Object.assign(new Error('先在设置里填写 Notion Token 和雅思数据库链接'), { code: 'NOTION_ERROR' });
  if (running) return { pages: 0, added: 0 };
  running = true;
  try {
    const q = await call(s.notionToken, `/v1/databases/${db}/query`, 'POST', { page_size: 14, sorts: [{ timestamp: 'created_time', direction: 'descending' }] });
    const { week, dayInWeek } = planPosition(today);
    const done = [...(getSettings().ieltsPages || [])];
    let pages = 0; let added = 0;
    for (const p of (q.results || []).reverse()) {
      const pid = p.id.replace(/-/g, '');
      if (done.includes(pid)) continue; // 这一天已导入过
      const words = await vocabOf(s.notionToken, p.id);
      if (!words.length) continue;
      const title = plain(Object.values(p.properties || {}).find((v) => v.type === 'title')?.title);
      const topic = plain(p.properties?.Topic?.select ? [{ plain_text: p.properties.Topic.select.name }] : p.properties?.Topic?.rich_text);
      const scene = `雅思 · ${topic || title.split('|')[1]?.trim() || '词汇'}`;
      pages++;
      for (const w of words) {
        if (get('SELECT 1 FROM card WHERE lower(en) = lower(?)', [w.en])) continue;
        run('INSERT INTO card (content_id, en, zh, example, note, source, scene, week, day) VALUES (?,?,?,?,?,?,?,?,?)',
          [`ielts:${pid}:${w.en.toLowerCase()}`, w.en, w.zh, w.example, w.collocations ? `搭配：${w.collocations}` : '', '雅思', scene, week, Math.min(dayInWeek, 6)]);
        added++;
      }
      done.push(pid);
    }
    updateSettings({ ieltsPages: done.slice(-200), ieltsLastPull: new Date().toLocaleString('zh-CN', { hour12: false }) });
    return { pages, added };
  } finally { running = false; }
}
