// 读取一个 Notion 数据库的字段和最近几条内容，存到 data/notion-peek.json，方便开发时查看结构。
// 用法：node scripts/notion-peek.mjs <数据库链接或 ID>
// 需要：设置页已填 Notion token，且该数据库（或它的父页面）已在 Notion「连接」里添加本工具的集成。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2] || '';
const id = (input.match(/[0-9a-f]{32}/i) || input.match(/[0-9a-f-]{36}/i) || [])[0];
if (!id) { console.log('用法：node scripts/notion-peek.mjs <数据库链接>'); process.exit(1); }

const { default: initSqlJs } = await import('sql.js');
const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(path.join(root, 'data/speak90.db')));
const row = db.exec("SELECT value FROM settings WHERE key = 'notionToken'")[0];
const token = row ? JSON.parse(row.values[0][0]) : '';
if (!token) { console.log('设置页还没有填 Notion token'); process.exit(1); }

const H = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
const call = async (p, body) => {
  const r = await fetch('https://api.notion.com/v1' + p, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : { headers: H });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${j.message}`);
  return j;
};
const blocks = async (bid, depth = 0) => {
  const out = [];
  let cursor;
  do {
    const j = await call(`/blocks/${bid}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of j.results) {
      const rich = b[b.type]?.rich_text;
      const item = { type: b.type, text: rich ? rich.map((t) => t.plain_text).join('') : undefined };
      if (b.type === 'table_row') item.cells = b.table_row.cells.map((c) => c.map((t) => t.plain_text).join(''));
      if (b.has_children && depth < 3) item.children = await blocks(b.id, depth + 1);
      out.push(item);
    }
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
};

try {
  const d = await call(`/databases/${id}`);
  const q = await call(`/databases/${id}/query`, { page_size: 3, sorts: [{ timestamp: 'created_time', direction: 'descending' }] });
  const pages = [];
  for (const p of q.results) pages.push({ properties: p.properties, content: await blocks(p.id) });
  const out = { title: d.title?.map((t) => t.plain_text).join(''), properties: Object.fromEntries(Object.entries(d.properties).map(([k, v]) => [k, v.type])), pages };
  fs.writeFileSync(path.join(root, 'data/notion-peek.json'), JSON.stringify(out, null, 2));
  console.log(`完成：读到 ${pages.length} 条，已存到 data/notion-peek.json`);
} catch (e) {
  console.log('读取失败：', e.message);
  if (/404|Could not find/.test(e.message)) console.log('提示：在 Notion 打开数据库所在的页面 → 右上角「…」→「连接」，添加本工具的集成后再试。');
}
