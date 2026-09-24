// 雅思词汇导入：从 Notion「IELTS Listening Daily」数据库读每天的 ④ Vocabulary 表格，生成表达卡（来源「雅思」）。
// 每个页面的每个词只导入一次（card.content_id = ielts:<页面ID>:<词>）；和已有卡片英文相同的词跳过。
// 雅思跟读：从 ① Listening 原文挑含当天生词的 6–8 句，生成跟读材料（content_item id = ielts:<页面ID>，type = shadow）。
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

const isHeading = (b) => /^heading_/.test(b.type);
const headingText = (b) => plain(b[b.type]?.rich_text);

/** 读一页：④ Vocabulary 的词汇和 ① Listening 的原文 */
export async function readPage(token, pageId) {
  const blocks = await children(token, pageId);
  return { vocab: await vocabIn(token, blocks), listening: await listeningIn(token, blocks) };
}
export const vocabOf = async (token, pageId) => (await readPage(token, pageId)).vocab;

/**
 * 读「Vocabulary」这一节：有表格按表头对列（词 / 中文 / 搭配 / 例句）；
 * 没有表格时按段落读（ChatGPT 有时这样写）：「word — 中文」+「Common collocations: …」+「Original example: …」
 */
async function vocabIn(token, blocks) {
  const h = blocks.findIndex((b) => isHeading(b) && /vocabulary|词汇/i.test(headingText(b)));
  if (h < 0) return [];
  const end = blocks.findIndex((b, i) => i > h && isHeading(b));
  const section = blocks.slice(h + 1, end < 0 ? undefined : end);
  const table = section.find((b) => b.type === 'table');
  if (!table) return parseVocabLines(section.flatMap((b) => plain(b[b.type]?.rich_text).split('\n')));
  const rows = (await children(token, table.id)).filter((r) => r.type === 'table_row').map((r) => r.table_row.cells.map(plain));
  if (!rows.length) return [];
  const head = rows[0].map((x) => x.toLowerCase());
  const col = (re, fallback) => { const i = head.findIndex((x) => re.test(x)); return i >= 0 ? i : fallback; };
  const c = { en: col(/word|phrase|词/, 0), zh: col(/中文|释义|meaning|chinese/, 1), co: col(/colloc|搭配/, 2), ex: col(/example|例句/, 3) };
  return rows.slice(1).map((r) => ({ en: r[c.en] || '', zh: r[c.zh] || '', collocations: r[c.co] || '', example: r[c.ex] || '' }))
    .filter((w) => w.en);
}

const hasZh = (t) => /[\u4e00-\u9fff]/.test(t);
const unquote = (t) => t.trim().replace(/^[“"‘']+|[”"’']+$/g, '').trim();

/** 段落格式的词汇：一行「英文 — 中文」开始一个词，后面的搭配、例句行归到这个词 */
export function parseVocabLines(lines) {
  const out = [];
  for (const raw of lines) {
    const l = raw.replace(/\*\*/g, '').trim();
    if (!l) continue;
    const co = l.match(/^(?:common\s+)?collocations?\s*[:：]\s*(.+)$/i);
    const ex = l.match(/^original\s+(?:example|idea|sentence)s?\s*[:：]\s*(.+)$/i);
    if (co || ex) {
      if (out.length) out.at(-1)[co ? 'collocations' : 'example'] = co ? co[1].trim() : unquote(ex[1]);
      continue;
    }
    // 「word — 中文」「1. word - 中文」「word: 中文」；英文里的连字符（trade-off）两边没有空格，不会被拆开
    const w = l.replace(/^(?:\d+[.)]|[-•·])\s*/, '').match(/^(.+?)\s+[—–-]{1,2}\s+(.+)$/) || l.match(/^([^:：]+?)\s*[:：]\s*(.+)$/);
    if (w && /[a-z]/i.test(w[1]) && !hasZh(w[1]) && hasZh(w[2])) out.push({ en: w[1].trim(), zh: w[2].trim(), collocations: '', example: '' });
  }
  return out;
}

// ---- 雅思跟读 ----
const TEXT_TYPES = ['paragraph', 'quote', 'callout', 'toggle', 'bulleted_list_item', 'numbered_list_item'];

/**
 * 「Listening」这一节的原文，每段一行。这一节到下一个同级或更高级标题、或下一个带序号（②③…）的标题为止，
 * 中间的小标题（如 Part 1）算在里面；折叠块、引用、标注里的内容也读（最多两层）。
 */
async function listeningIn(token, blocks) {
  const h = blocks.findIndex((b) => isHeading(b) && /listening|听力/i.test(headingText(b)));
  if (h < 0) return [];
  const level = Number(blocks[h].type.slice(-1));
  const end = blocks.findIndex((b, i) => i > h && isHeading(b) && (Number(b.type.slice(-1)) <= level || /^[②-⑩]/.test(headingText(b))));
  const lines = [];
  const walk = async (list, depth) => {
    for (const b of list) {
      if (TEXT_TYPES.includes(b.type)) lines.push(...plain(b[b.type]?.rich_text).split('\n'));
      if (b.has_children && b.id && depth < 2 && b.type !== 'table') await walk(await children(token, b.id), depth + 1);
    }
  };
  await walk(blocks.slice(h + 1, end < 0 ? undefined : end), 0);
  return lines;
}

/** 原文 → 句子：去掉「Speaker A:」这类说话人标签、中文行（翻译）、只有括号的行（如 (Audio script)） */
export function splitSentences(lines) {
  const out = [];
  for (const raw of lines) {
    const l = raw.replace(/\*\*/g, '').replace(/^\s*[A-Z][\w .'-]{0,20}:\s+/, '').trim();
    if (!l || hasZh(l) || /^[(\[].*[)\]]$/.test(l)) continue;
    out.push(...l.split(/(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|e\.g|i\.e|etc)\.)(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/).map((x) => x.trim()).filter(Boolean));
  }
  return out;
}

// 词汇 → 匹配原文的正则：每个词允许词尾变化（impose → imposed），短语中间最多隔两个词（take sth into account）
const SKIP = new Set(['sb', 'sth', 'someone', 'something', 'somebody', "one's", 'a', 'an', 'the']);
export function vocabMatcher(en) {
  const tokens = String(en).toLowerCase().split(/[^a-z']+/).filter((t) => t && !SKIP.has(t));
  if (!tokens.length) return null;
  const stem = (t) => (t.length > 4 ? t.replace(/(e|y)$/, '') : t);
  return new RegExp(`\\b${tokens.map((t) => `${stem(t)}[a-z']*`).join("[\\s-]+(?:[a-z']+\\s+){0,2}")}\\b`, 'i');
}

const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

/**
 * 挑跟读句子：优先含生词多的句子（最多 max 句），不够 min 句时用原文里长度适中的句子补齐，按原文顺序排。
 * 每句的中文一行写这句里的生词和释义。少于 3 句返回 null（原文太短或没找到）。
 */
export function pickShadowSentences(sentences, vocab, { min = 6, max = 8 } = {}) {
  const matchers = vocab.map((w) => ({ w, re: vocabMatcher(w.en) })).filter((m) => m.re);
  const cand = sentences.map((en, i) => ({ en, i, hits: matchers.filter((m) => m.re.test(en)).map((m) => m.w) }))
    .filter((c) => { const n = wordCount(c.en); return n >= 4 && n <= 40; });
  const chosen = cand.filter((c) => c.hits.length).sort((a, b) => b.hits.length - a.hits.length || a.i - b.i).slice(0, max);
  for (const c of cand) {
    if (chosen.length >= min) break;
    const n = wordCount(c.en);
    if (!chosen.includes(c) && n >= 6 && n <= 25) chosen.push(c);
  }
  if (chosen.length < 3) return null;
  const meaning = (zh) => zh.split(/[；;，,]/)[0].trim();
  return chosen.sort((a, b) => a.i - b.i).map((c) => ({
    en: c.en, zh: c.hits.length ? `生词：${c.hits.map((w) => `${w.en} ${meaning(w.zh)}`).join('；')}` : '',
  }));
}

let running = false;
/** 拉取最近的雅思页面，导入词汇并生成跟读材料。返回 { pages, added, shadows } */
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
    const shadowDone = [...(getSettings().ieltsShadowPages || [])];
    const day = Math.min(dayInWeek, 6);
    let pages = 0; let added = 0; let shadows = 0;
    for (const p of (q.results || []).reverse()) {
      const pid = p.id.replace(/-/g, '');
      const vocabDone = done.includes(pid);
      if (vocabDone && shadowDone.includes(pid)) continue; // 这一天已导入过
      const { vocab: words, listening } = await readPage(s.notionToken, p.id);
      if (!words.length) continue; // 还没写完，下次再看
      const title = plain(Object.values(p.properties || {}).find((v) => v.type === 'title')?.title);
      const topicName = plain(p.properties?.Topic?.select ? [{ plain_text: p.properties.Topic.select.name }] : p.properties?.Topic?.rich_text)
        || title.split('|')[1]?.trim();
      if (!vocabDone) {
        const scene = `雅思 · ${topicName || '词汇'}`;
        pages++;
        for (const w of words) {
          if (get('SELECT 1 FROM card WHERE lower(en) = lower(?)', [w.en])) continue;
          run('INSERT INTO card (content_id, en, zh, example, note, source, scene, week, day) VALUES (?,?,?,?,?,?,?,?,?)',
            [`ielts:${pid}:${w.en.toLowerCase()}`, w.en, w.zh, w.example, w.collocations ? `搭配：${w.collocations}` : '', '雅思', scene, week, day]);
          added++;
        }
        done.push(pid);
      }
      if (!shadowDone.includes(pid)) {
        const sentences = pickShadowSentences(splitSentences(listening), words);
        if (sentences && !get('SELECT 1 FROM content_item WHERE id = ?', [`ielts:${pid}`])) {
          const date = p.properties?.Date?.date?.start || title.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
          const name = `雅思跟读 · ${topicName || '听力原文'}`;
          run("INSERT INTO content_item (id, week, type, en, zh, extra, approved, day) VALUES (?,?,'shadow',?,?,?,1,?)",
            [`ielts:${pid}`, week, name, name, JSON.stringify({ sentences, source: 'ielts', date }), day]);
          shadows++;
        }
        shadowDone.push(pid);
      }
    }
    updateSettings({ ieltsPages: done.slice(-200), ieltsShadowPages: shadowDone.slice(-200), ieltsLastPull: new Date().toLocaleString('zh-CN', { hour12: false }) });
    return { pages, added, shadows };
  } finally { running = false; }
}
