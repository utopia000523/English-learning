// AI 情景对话（PRD 3.2）
import { all, get, run, getSettings } from './db.js';
import { planPosition } from './cards.js';
import * as llm from './services/llm.js';
import { fluency, mergeFluency } from './services/score.js';

export const PASS_TURNS = 8; // 通关：任务全部完成 且 用户发言 ≥ 8 轮

const sceneOf = (row) => row && { ...JSON.parse(row.data), week: row.week };
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

export function listScenes() {
  const { week } = planPosition();
  return all('SELECT * FROM content_scene ORDER BY week, level DESC, id').map((r) => {
    const sc = sceneOf(r);
    const passed = get('SELECT COUNT(*) n FROM roleplay WHERE scene_id = ? AND passed = 1', [r.id]).n > 0;
    const tried = get('SELECT COUNT(*) n FROM roleplay WHERE scene_id = ?', [r.id]).n > 0;
    return {
      id: sc.id, week: r.week, title: sc.title, level: sc.level, roleZh: sc.role_zh,
      status: r.week > week ? 'locked' : passed ? 'passed' : tried ? 'tried' : 'open',
    };
  });
}

function view(rp) {
  const scene = sceneOf(get('SELECT * FROM content_scene WHERE id = ?', [rp.scene_id]));
  const messages = parse(rp.messages, []);
  const done = parse(rp.tasks_done, []);
  return {
    id: rp.id, scene, messages, tasksDone: done,
    turns: messages.filter((m) => m.role === 'user').length,
    feedback: parse(rp.feedback, {}),
    passTurns: PASS_TURNS, review: parse(rp.review, null), passed: !!rp.passed, ended: !!rp.ended_at,
  };
}

export function start(sceneId) {
  const row = get('SELECT * FROM content_scene WHERE id = ?', [sceneId]);
  if (!row) return null;
  const sc = sceneOf(row);
  const messages = [{ role: 'assistant', content: sc.opening, zh: sc.opening_zh }];
  const { lastId } = run('INSERT INTO roleplay (scene_id, messages, tasks_done) VALUES (?,?,?)', [sceneId, JSON.stringify(messages), '[]']);
  return view(get('SELECT * FROM roleplay WHERE id = ?', [lastId]));
}

export const load = (id) => { const r = get('SELECT * FROM roleplay WHERE id = ?', [id]); return r && view(r); };

function systemPrompt(sc) {
  const level = sc.level === 'advanced'
    ? 'Use natural everyday American English with a few common idioms, and ask natural follow-up questions.'
    : 'Use simple, common words and short sentences.';
  return `You are ${sc.persona}. Stay in character in a realistic role-play.
You are talking with an adult Chinese learner of English who reads well but is slow at speaking.
Rules:
- Keep every reply under 20 words. Ask at most one question per reply. ${level}
- Never correct the learner's grammar during the conversation; just respond naturally.
- ONLY if the learner writes Chinese or explicitly asks how to say something, put a short natural English phrase they can use in "coach", and in "reply" briefly encourage them to try saying it. In every other case "coach" MUST be an empty string, even if the learner's English has small mistakes.
- Gently steer the conversation so the learner gets chances to complete their tasks, but do not list the tasks.
The learner's tasks (numbered):
${sc.tasks.map((t, i) => `${i + 1}. ${t.check}`).join('\n')}
After each learner message, list the numbers of ALL tasks the learner has completed so far in the whole conversation.
Respond ONLY with JSON: {"reply": "your in-character reply", "reply_zh": "Simplified Chinese translation of reply", "coach": "", "completed": [numbers]}`;
}

export async function turn(id, text, recordingId) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  const messages = [...v.messages, { role: 'user', content: text, ...(recordingId ? { recordingId: Number(recordingId) } : {}) }];
  const out = await llm.chatJSON(
    [{ role: 'system', content: systemPrompt(v.scene) }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    { model: getSettings().llmModel, kind: 'turn' },
    (t) => ({ reply: t, completed: [] }),
  );
  const n = v.scene.tasks.length;
  const done = [...new Set([...v.tasksDone, ...(out.completed || []).map(Number).filter((x) => x >= 1 && x <= n)])].sort();
  // 兜底：用户没打中文、也没问“怎么说”时，不显示「可以说…」提示
  const askedHelp = /[\u4e00-\u9fff]/.test(text) || /how (do|can|would|should) (i|you) say|what('s| is) .* in english/i.test(text);
  messages.push({ role: 'assistant', content: String(out.reply || '').trim(), zh: out.reply_zh || '', coach: askedHelp ? (out.coach || '') : '' });
  run('UPDATE roleplay SET messages = ?, tasks_done = ? WHERE id = ?', [JSON.stringify(messages), JSON.stringify(done), id]);
  return load(id);
}

/** 单句点评：检查第 index 条（用户消息）是否自然，结果存入 roleplay.feedback[index] */
export async function feedback(id, index) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  const msg = v.messages[index];
  if (!msg || msg.role !== 'user') return undefined;
  if (v.feedback[index]) return v.feedback[index];
  const prev = [...v.messages.slice(0, index)].reverse().find((m) => m.role === 'assistant');
  const out = await llm.chatJSON([
    { role: 'system', content: `You are an English coach for a Chinese adult learning everyday spoken English.
Check ONE line the learner said in a role-play. Judge only whether it is grammatical and natural spoken English in this context.
Ignore capitalization, punctuation, spacing and obvious typing slips. Do not rewrite lines that are already natural just to make them fancier.
If the line is fine, respond {"ok": true}.
Otherwise respond {"ok": false, "better": "the most natural way to say what the learner meant", "issue_zh": "用一句简体中文说明问题（语法、用词或中式英语），不超过40字", "zh": "better 的简体中文意思"}.
If the learner wrote Chinese, "better" is natural English for it and "issue_zh" is "用英语可以这样说".
Respond ONLY with JSON.` },
    { role: 'user', content: `Scene: ${v.scene.title}
${v.scene.role} said: ${prev?.content || ''}
Learner said: ${msg.content}` },
  ], { model: getSettings().llmModel, temperature: 0.2, kind: 'feedback' }, () => ({ ok: true }));
  const ok = out.ok === true || out.ok === 'true' || !out.better || out.better.trim().toLowerCase() === msg.content.trim().toLowerCase();
  const fb = ok ? { ok: true } : { ok: false, better: out.better.trim(), issue_zh: out.issue_zh || '', zh: out.zh || '' };
  // 读最新值再写，避免并发点评互相覆盖
  const cur = parse(get('SELECT feedback FROM roleplay WHERE id = ?', [id]).feedback, {});
  cur[index] = fb;
  run('UPDATE roleplay SET feedback = ? WHERE id = ?', [JSON.stringify(cur), id]);
  return fb;
}

export async function finish(id) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  let review = { comment_zh: '', fixes: [] };
  if (v.turns > 0) {
    // 补齐还没点评的句子，然后汇总所有需要改进的句子
    const idx = v.messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
    for (const i of idx) if (!v.feedback[i]) await feedback(id, i);
    const fbs = parse(get('SELECT feedback FROM roleplay WHERE id = ?', [id]).feedback, {});
    review.fixes = idx.filter((i) => fbs[i] && !fbs[i].ok)
      .map((i) => ({ you: v.messages[i].content, better: fbs[i].better, issue_zh: fbs[i].issue_zh, zh: fbs[i].zh }));
    const transcript = v.messages.map((m) => `${m.role === 'user' ? 'Learner' : v.scene.role}: ${m.content}`).join('\n');
    const c = await llm.chatJSON([
      { role: 'system', content: `You are a friendly English speaking coach for a Chinese adult learner. Read this role-play (scene: ${v.scene.title}) and write ONE encouraging sentence of overall feedback in Simplified Chinese (what went well + one thing to work on). Respond ONLY with JSON: {"comment_zh": "..."}` },
      { role: 'user', content: transcript },
    ], { model: getSettings().llmModel, temperature: 0.3, kind: 'review' }, () => ({ comment_zh: '' }));
    review.comment_zh = c.comment_zh || '';
    // 流利度：只统计用语音说的句子
    const flu = v.messages.filter((m) => m.role === 'user' && m.recordingId)
      .map((m) => parse(get('SELECT words FROM recording WHERE id = ?', [m.recordingId])?.words, []))
      .map((w) => fluency(w));
    review.fluency = mergeFluency(flu);
  }
  const passed = v.tasksDone.length === v.scene.tasks.length && v.turns >= PASS_TURNS ? 1 : 0;
  run("UPDATE roleplay SET review = ?, passed = ?, ended_at = datetime('now','localtime') WHERE id = ?", [JSON.stringify(review), passed, id]);
  return load(id);
}
