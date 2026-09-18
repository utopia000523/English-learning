// 划词查询与笔记本（PRD 3.7）
import { all, get, run, getSettings } from './db.js';
import * as llm from './services/llm.js';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const toClient = (r) => ({ id: r.id, en: r.en, zh: r.zh, source: r.source, scene: r.scene, context: r.context || '',
  detail: parse(r.detail, {}), createdAt: r.created_at, starred: !!r.starred, synced: !!r.synced });

/** 结合上下文解释一个词或短语 */
export async function lookup(text, context = '') {
  const out = await llm.chatJSON([
    { role: 'system', content: `You are an English–Chinese dictionary for a Chinese adult learner.
Explain the selected English word or phrase AS USED in the given sentence.
Respond ONLY with JSON:
{"zh": "简体中文意思（这句里的意思，简短）", "pos": "词性或类型，如 adj. / phrasal verb / idiom", "usage_zh": "一句简体中文说明用法或语气，不超过40字", "example": "one short natural everyday example sentence", "example_zh": "例句的简体中文"}` },
    { role: 'user', content: `Selected: ${text}\nSentence: ${context || text}` },
  ], { model: getSettings().llmModel, temperature: 0.2, kind: 'lookup' }, () => ({ zh: '' }));
  return { text, zh: out.zh || '', pos: out.pos || '', usage_zh: out.usage_zh || '', example: out.example || '', example_zh: out.example_zh || '' };
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
