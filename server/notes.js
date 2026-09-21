// 划词查询与笔记本（PRD 3.7）
import { all, get, run, getSettings } from './db.js';
import * as llm from './services/llm.js';
import { ipaOf } from './services/ipa.js';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const toClient = (r) => ({ id: r.id, en: r.en, zh: r.zh, ipa: ipaOf(r.en), source: r.source, scene: r.scene, context: r.context || '',
  detail: parse(r.detail, {}), createdAt: r.created_at, starred: !!r.starred, synced: !!r.synced });

const AUX = new Set(['be', 'been', 'being', 'am', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did', 'to', 'a', 'an', 'the', 'my', 'your', 'his', 'her', 'their', 'our', 'its']);
const stem = (w) => (w.length > 4 ? w.replace(/(ies|ied|ing|es|ed|s|d)$/, '') : w);

/** 例句里是否真的用到了所查的词/短语（允许变时态、人称，中间夹 1–2 个词） */
export function mentions(text, sentence) {
  const words = String(text).toLowerCase().match(/[a-z']+/g) || [];
  const key = words.filter((w) => !AUX.has(w));
  const use = key.length ? key : words;
  if (!use.length || !sentence) return false;
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(use.map((w) => `\\b${esc(stem(w))}\\w*`).join('(?:\\s+\\w+){0,2}\\s+'), 'i');
  return re.test(String(sentence));
}

export const ipaText = (t) => ipaOf(t) || '';

const cacheKey = (text, context) => `${text.trim().toLowerCase()}|${String(context).trim().toLowerCase().slice(0, 120)}`;

/** 结合上下文解释一个词或短语。查过的结果会缓存，第二次直接返回 */
export async function lookup(text, context = '') {
  const key = cacheKey(text, context);
  const hit = get('SELECT data FROM lookup_cache WHERE key = ?', [key]);
  if (hit) return parse(hit.data, null) || { text, ipa: ipaOf(text), zh: '' };
  const out = await llm.chatJSON([
    { role: 'system', content: `English–Chinese dictionary for a Chinese adult learner. Explain the selected word/phrase AS USED in the sentence. Be brief.
JSON only: {"zh": "中文意思，10字以内", "pos": "词性，如 adj. / phrasal verb", "usage_zh": "用法或语气，25字以内", "example": "one short everyday sentence (max 10 words) that USES the selected word or phrase itself (tense/person may change)", "example_zh": "例句中文"}` },
    { role: 'user', content: `Selected: ${text}\nSentence: ${context || text}` },
  ], { model: getSettings().llmModel, temperature: 0.2, kind: 'lookup', maxTokens: 220 }, () => ({ zh: '' }));
  // 例句里必须真的出现所查的词；模型给跑偏了就退回原句
  let example = String(out.example || '').trim();
  let exampleZh = out.example_zh || '';
  if (!mentions(text, example)) {
    example = mentions(text, context) ? String(context).trim() : '';
    exampleZh = '';
  }
  const info = { text, ipa: ipaOf(text), zh: out.zh || '', pos: out.pos || '', usage_zh: out.usage_zh || '', example, example_zh: exampleZh };
  if (info.zh) run('INSERT INTO lookup_cache (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data', [key, JSON.stringify(info)]);
  return info;
}

export function listNotes({ q = '', source = '' } = {}) {
  const like = `%${q.trim()}%`;
  return all(`SELECT * FROM note WHERE (? = '' OR en LIKE ? OR zh LIKE ? OR context LIKE ?) AND (? = '' OR source = ?)
              ORDER BY id DESC`, [q.trim(), like, like, like, source, source]).map(toClient);
}

export function addNote({ en, zh = '', source = '其他', scene = '', context = '', detail = {} }) {
  const dup = get('SELECT * FROM note WHERE lower(en) = lower(?)', [en.trim()]);
  if (dup) return { ...toClient(dup), duplicate: true };
  const { lastId } = run('INSERT INTO note (en, zh, source, scene, context, detail) VALUES (?,?,?,?,?,?)',
    [en.trim(), zh, source, scene, context, JSON.stringify(detail)]);
  return toClient(get('SELECT * FROM note WHERE id = ?', [lastId]));
}

export function deleteNote(id) {
  const n = get('SELECT id FROM note WHERE id = ?', [id]);
  if (n) run('DELETE FROM note WHERE id = ?', [id]);
  return !!n;
}
