// Notion 单向同步（本地 → Notion，PRD 3.9、6.2）。使用 API 版本 2022-06-28（数据库由本工具创建，均为单数据源）
import { all, get, run, getSettings, updateSettings } from '../db.js';
import { ipaOf } from './ipa.js';
import { addDays } from '../util/date.js';
import { fluency } from './score.js';

const BASE = () => process.env.NOTION_API_URL || 'https://api.notion.com';
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const text = (s) => [{ type: 'text', text: { content: String(s || '').slice(0, 1900) } }];

async function call(token, path, method = 'GET', body) {
  let res;
  try {
    res = await fetch(BASE() + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error('当前无法连接 Notion，联网后会自动补同步'), { code: 'NOTION_OFFLINE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Notion 返回错误：${data.message || res.status}`), { code: 'NOTION_ERROR', status: res.status });
  return data;
}

export async function status(settings) {
  if (!settings.notionToken) return { ok: false, detail: '未配置', fix: '在「设置 → Notion 同步」填写 Token', optional: true };
  try {
    await call(settings.notionToken, '/v1/users/me');
    if (!settings.notionNotesDb) return { ok: false, detail: 'Token 有效，还没创建数据库', fix: '在「设置 → Notion 同步」填父页面链接并点「创建数据库」', optional: true };
    return { ok: true, detail: `已连接${settings.notionLastSync ? ` · 上次同步 ${settings.notionLastSync}` : ''}` };
  } catch (e) {
    return { ok: false, detail: e.code === 'NOTION_OFFLINE' ? '当前无法联网，同步会排队' : 'Token 无效或没有权限', optional: true };
  }
}

/** 从页面链接或 ID 里取出 32 位页面 ID */
export function parsePageId(input) {
  const m = String(input || '').replace(/-/g, '').match(/[0-9a-f]{32}(?![0-9a-f])/i);
  return m ? m[0] : null;
}

/** 在父页面下创建「口语笔记」「每日练习记录」两个数据库 */
export async function setup(parentInput) {
  const s = getSettings();
  if (!s.notionToken) throw Object.assign(new Error('请先填写 Notion Token'), { code: 'NOTION_ERROR' });
  const parent = parsePageId(parentInput);
  if (!parent) throw Object.assign(new Error('没有识别出页面 ID，请粘贴完整的 Notion 页面链接'), { code: 'NOTION_ERROR' });
  const sel = (names) => ({ select: { options: names.map((name) => ({ name })) } });
  const notes = await call(s.notionToken, '/v1/databases', 'POST', {
    parent: { type: 'page_id', page_id: parent },
    title: text('口语笔记'),
    properties: {
      英文: { title: {} }, 中文: { rich_text: {} }, 音标: { rich_text: {} }, 词性: { rich_text: {} },
      来源: sel(['表达卡', 'AI 对话', '跟读', '独白', '手动', '其他']), 原句: { rich_text: {} }, 日期: { date: {} },
    },
  });
  const log = await call(s.notionToken, '/v1/databases', 'POST', {
    parent: { type: 'page_id', page_id: parent },
    title: text('每日练习记录'),
    properties: {
      标题: { title: {} }, 日期: { date: {} },
      练习模块: { multi_select: { options: ['表达卡', 'AI 对话', '跟读', '独白'].map((name) => ({ name })) } },
      完成度: { number: { format: 'percent' } }, 表达卡复习: { number: {} }, 对话轮数: { number: {} },
      跟读句数: { number: {} }, 独白次数: { number: {} }, 开口分钟: { number: {} },
    },
  });
  run('UPDATE note SET synced = 0, notion_page_id = NULL');
  run('DELETE FROM notion_sync');
  return updateSettings({ notionParentPage: parent, notionNotesDb: notes.id, notionLogDb: log.id });
}

function dayRecord(date, ratio) {
  const c = (m) => get('SELECT count FROM daily_log WHERE date = ? AND module = ?', [date, m])?.count || 0;
  let ms = 0;
  for (const r of all('SELECT words FROM recording WHERE created_at LIKE ?', [date + '%'])) ms += fluency(parse(r.words, [])).durationMs || 0;
  const rec = { cards: c('cards'), turns: c('roleplay_turn'), shadow: c('shadow'), mono: c('mono'), speakMin: Math.round(ms / 6000) / 10, ratio: Math.round(ratio * 100) / 100 };
  rec.modules = [rec.cards && '表达卡', (rec.turns || c('roleplay')) && 'AI 对话', rec.shadow && '跟读', rec.mono && '独白'].filter(Boolean);
  return rec;
}

/** 同步：未同步的笔记 + 有练习的每天记录（内容有变化才更新） */
export async function sync(ratioOf = () => 0) {
  const s = getSettings();
  if (!s.notionToken || !s.notionNotesDb || !s.notionLogDb) throw Object.assign(new Error('请先在设置页配置 Notion 并创建数据库'), { code: 'NOTION_ERROR' });
  let notes = 0; let days = 0;
  for (const n of all('SELECT * FROM note WHERE synced = 0 ORDER BY id')) {
    const d = parse(n.detail, {});
    const page = await call(s.notionToken, '/v1/pages', 'POST', {
      parent: { database_id: s.notionNotesDb },
      properties: {
        英文: { title: text(n.en) }, 中文: { rich_text: text(n.zh) }, 音标: { rich_text: text(ipaOf(n.en) || '') },
        词性: { rich_text: text(d.pos || '') }, 来源: { select: { name: n.source || '其他' } }, 原句: { rich_text: text(n.context) },
        日期: { date: { start: (n.created_at || '').slice(0, 10) || null } },
      },
    });
    run('UPDATE note SET synced = 1, notion_page_id = ? WHERE id = ?', [page.id, n.id]);
    notes++;
  }
  const start = s.startDate;
  for (const { date } of all('SELECT DISTINCT date FROM daily_log ORDER BY date')) {
    const dayNo = start ? Math.round((new Date(date) - new Date(start)) / 86400000) + 1 : 0;
    const rec = dayRecord(date, ratioOf(date));
    const hash = JSON.stringify(rec);
    const prev = get('SELECT * FROM notion_sync WHERE date = ?', [date]);
    if (prev?.hash === hash) continue;
    const props = {
      标题: { title: text(`第 ${dayNo} 天 · ${date.slice(5).replace('-', '/')}`) }, 日期: { date: { start: date } },
      练习模块: { multi_select: rec.modules.map((name) => ({ name })) }, 完成度: { number: rec.ratio },
      表达卡复习: { number: rec.cards }, 对话轮数: { number: rec.turns }, 跟读句数: { number: rec.shadow },
      独白次数: { number: rec.mono }, 开口分钟: { number: rec.speakMin },
    };
    if (prev) await call(s.notionToken, `/v1/pages/${prev.page_id}`, 'PATCH', { properties: props });
    else {
      const page = await call(s.notionToken, '/v1/pages', 'POST', { parent: { database_id: s.notionLogDb }, properties: props });
      run('INSERT INTO notion_sync (date, page_id, hash) VALUES (?,?,?)', [date, page.id, hash]);
    }
    if (prev) run('UPDATE notion_sync SET hash = ? WHERE date = ?', [hash, date]);
    days++;
  }
  const now = new Date().toLocaleString('sv-SE').slice(5, 16);
  updateSettings({ notionLastSync: now });
  return { notes, days, at: now };
}

export const pendingCount = () => get('SELECT COUNT(*) n FROM note WHERE synced = 0').n;
export { addDays };
