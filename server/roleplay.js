// AI 情景对话（PRD 3.2）
import { all, get, run, getSettings } from './db.js';
import { planPosition } from './cards.js';
import * as llm from './services/llm.js';

export const PASS_TURNS = 8; // 通关：任务全部完成 且 用户发言 ≥ 8 轮

const sceneOf = (row) => row && { ...JSON.parse(row.data), week: row.week };
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

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
- If the learner writes Chinese or asks how to say something, put a short natural English phrase they can use in "coach", and in "reply" briefly encourage them to try saying it.
- Gently steer the conversation so the learner gets chances to complete their tasks, but do not list the tasks.
The learner's tasks (numbered):
${sc.tasks.map((t, i) => `${i + 1}. ${t.check}`).join('\n')}
After each learner message, list the numbers of ALL tasks the learner has completed so far in the whole conversation.
Respond ONLY with JSON: {"reply": "your in-character reply", "reply_zh": "Simplified Chinese translation of reply", "coach": "", "completed": [numbers]}`;
}

export async function turn(id, text) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  const messages = [...v.messages, { role: 'user', content: text }];
  const out = await llm.chatJSON(
    [{ role: 'system', content: systemPrompt(v.scene) }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    { model: getSettings().llmModel, kind: 'turn' },
    (t) => ({ reply: t, completed: [] }),
  );
  const n = v.scene.tasks.length;
  const done = [...new Set([...v.tasksDone, ...(out.completed || []).map(Number).filter((x) => x >= 1 && x <= n)])].sort();
  messages.push({ role: 'assistant', content: String(out.reply || '').trim(), zh: out.reply_zh || '', coach: out.coach || '' });
  run('UPDATE roleplay SET messages = ?, tasks_done = ? WHERE id = ?', [JSON.stringify(messages), JSON.stringify(done), id]);
  return load(id);
}

export async function finish(id) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  let review = { comment_zh: '', fixes: [] };
  if (v.turns > 0) {
    const transcript = v.messages.map((m) => `${m.role === 'user' ? 'Learner' : v.scene.role}: ${m.content}`).join('\n');
    review = await llm.chatJSON([
      { role: 'system', content: `You are a friendly English speaking coach for a Chinese adult learner.
Look at the learner's lines in this role-play (scene: ${v.scene.title}).
Pick 3 to 5 learner sentences that are wrong, unnatural, or were said in Chinese. For each, give a short natural American English version and its Simplified Chinese meaning.
If there are fewer problems, include lines that could sound more natural. Keep "you" exactly as the learner said it.
Also write one encouraging sentence of overall feedback in Simplified Chinese.
Respond ONLY with JSON: {"comment_zh": "...", "fixes": [{"you": "...", "better": "...", "zh": "..."}]}` },
      { role: 'user', content: transcript },
    ], { model: getSettings().llmModel, temperature: 0.3, kind: 'review' }, () => ({ comment_zh: '', fixes: [] }));
    review.fixes = (review.fixes || []).filter((f) => f && f.better).slice(0, 5);
  }
  const passed = v.tasksDone.length === v.scene.tasks.length && v.turns >= PASS_TURNS ? 1 : 0;
  run("UPDATE roleplay SET review = ?, passed = ?, ended_at = datetime('now','localtime') WHERE id = ?", [JSON.stringify(review), passed, id]);
  return load(id);
}
