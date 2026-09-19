// AI 情景对话（PRD 3.2）
import { all, get, run, getSettings } from './db.js';
import { planPosition } from './cards.js';
import * as llm from './services/llm.js';
import { fluency, mergeFluency } from './services/score.js';
import { logEvent } from './activity.js';

export const PASS_TURNS = 8; // 通关：任务全部完成 且 用户发言 ≥ 8 轮

// STRICT 任务（道别）兜底：用户确实说过告别类的话才算完成
const BYE = /\b(bye|goodbye|see (you|ya)|take care|catch you later|talk (to you )?(later|soon)|have to go|gotta go|got to go|nice (meeting|talking|chatting)|great (meeting|talking|chatting)|good talking|(was|it's been) (nice|great|good) (meeting|talking|chatting)|have a (good|nice|great) (one|day|night|weekend))\b/i;
const saidBye = (messages) => messages.filter((m) => m.role === 'user').some((m) => BYE.test(m.content));

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
- If the learner writes in Chinese, understand it and reply naturally in English as usual.
- ONLY if the learner explicitly asks in English how to say something, put the English phrase they asked for in "coach". In every other case "coach" MUST be an empty string.
- Gently steer the conversation so the learner gets chances to complete their tasks, but do not list the tasks.
The learner's tasks (numbered):
${sc.tasks.map((t, i) => `${i + 1}. ${t.check}`).join('\n')}
After each learner message, list the numbers of ALL tasks the learner has completed so far in the whole conversation.
Respond ONLY with JSON: {"reply": "your in-character reply", "reply_zh": "Simplified Chinese translation of reply", "coach": "", "completed": [numbers]}`;
}

const hasCJK = (t) => /[\u4e00-\u9fff]/.test(t);

/** 把用户说的中文翻成在当前语境下自然的口语英文 */
async function translateLine(text, prevLine, scene) {
  const out = await llm.chatJSON([
    { role: 'system', content: `You help a Chinese learner in an English role-play (scene: ${scene.title}).
Translate what the LEARNER wants to say (written in Chinese, possibly mixed with English) into ONE short, natural spoken American English reply that fits the context.
Translate the learner's own words only — do not answer the other person or add new ideas.
Respond ONLY with JSON: {"en": "..."}` },
    { role: 'user', content: `${scene.role} said: ${prevLine}\nLearner wants to say: ${text}` },
  ], { model: getSettings().llmModel, temperature: 0.2, kind: 'translate' }, (t) => ({ en: t }));
  return String(out.en || '').trim();
}

export async function turn(id, text, recordingId) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  // 用户打中文：先翻译成英文，作为「可以说」提示和这句的点评
  const prevAI = [...v.messages].reverse().find((m) => m.role === 'assistant')?.content || '';
  const zhHelp = hasCJK(text) ? await translateLine(text, prevAI, v.scene) : '';
  const messages = [...v.messages, { role: 'user', content: text, ...(recordingId ? { recordingId: Number(recordingId) } : {}) }];
  const out = await llm.chatJSON(
    [{ role: 'system', content: systemPrompt(v.scene) }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    { model: getSettings().llmModel, kind: 'turn' },
    (t) => ({ reply: t, completed: [] }),
  );
  const n = v.scene.tasks.length;
  const bye = saidBye(messages);
  const done = [...new Set([...v.tasksDone, ...(out.completed || []).map(Number)
    .filter((x) => x >= 1 && x <= n && (!v.scene.tasks[x - 1].strict || bye))])].sort((a, b) => a - b);
  // 「可以说」：中文输入用翻译结果；英文里明确问“怎么说”才用模型给的；其余一律不显示
  const askedHow = /how (do|can|would|should) (i|you) say|what('s| is) .* in english/i.test(text);
  const coach = zhHelp || (askedHow ? String(out.coach || '').trim() : '');
  messages.push({ role: 'assistant', content: String(out.reply || '').trim(), zh: out.reply_zh || '', coach });
  run('UPDATE roleplay SET messages = ?, tasks_done = ? WHERE id = ?', [JSON.stringify(messages), JSON.stringify(done), id]);
  logEvent('roleplay_turn');
  if (zhHelp) {
    const fb = parse(get('SELECT feedback FROM roleplay WHERE id = ?', [id]).feedback, {});
    fb[messages.length - 2] = { ok: false, better: zhHelp, issue_zh: '用英语可以这样说', zh: text };
    run('UPDATE roleplay SET feedback = ? WHERE id = ?', [JSON.stringify(fb), id]);
  }
  return load(id);
}

/** 任务检查：单独调用模型，只判断还没完成的任务（比在回复里顺带判断准确） */
export async function checkTasks(id) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  const pending = v.scene.tasks.map((t, i) => ({ n: i + 1, t })).filter((x) => !v.tasksDone.includes(x.n));
  if (!pending.length || !v.turns) return { tasksDone: v.tasksDone };
  const lines = v.messages.filter((m) => m.role === 'user').map((m) => `- ${m.content}`).join('\n');
  const out = await llm.chatJSON([
    { role: 'system', content: `You check an English learner's role-play tasks. Scene: ${v.scene.title} (the other person is ${v.scene.role}).
For EACH task below, decide whether the learner has ALREADY done it in what they actually said. Judge by meaning, not exact words; one line can complete several tasks.
Do NOT count a task just because it might happen later or the conversation is going well. Tasks marked (STRICT) only count if the learner literally did it (e.g. really said goodbye).
Tasks:
${pending.map((x) => `${x.n}. ${x.t.check}${x.t.strict ? ' (STRICT)' : ''}`).join('\n')}
Respond ONLY with JSON: {"done": [numbers of the tasks above that are accomplished]}` },
    { role: 'user', content: `Everything the learner said:\n${lines}` },
  ], { model: getSettings().llmModel, temperature: 0, kind: 'tasks' }, () => ({ done: [] }));
  const said = saidBye(v.messages);
  const ok = new Set(pending.filter((x) => !x.t.strict || said).map((x) => x.n));
  const cur = parse(get('SELECT tasks_done FROM roleplay WHERE id = ?', [id]).tasks_done, []);
  const done = [...new Set([...cur, ...(out.done || []).map(Number).filter((n) => ok.has(n))])].sort((a, b) => a - b);
  run('UPDATE roleplay SET tasks_done = ? WHERE id = ?', [JSON.stringify(done), id]);
  return { tasksDone: done };
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
  const loose = (t) => String(t || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
  const ok = out.ok === true || out.ok === 'true' || !out.better || loose(out.better) === loose(msg.content); // 只差大小写或标点，不算问题
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
    await checkTasks(id);
    v.tasksDone = parse(get('SELECT tasks_done FROM roleplay WHERE id = ?', [id]).tasks_done, []);
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
  logEvent('roleplay');
  return load(id);
}
