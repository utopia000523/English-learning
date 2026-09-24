// AI 情景对话（PRD 3.2）
import { all, get, run, getSettings } from './db.js';
import { planPosition, isUnlocked, UNLOCK_SQL, unlockArgs } from './cards.js';
import * as llm from './services/llm.js';
import { fluency, mergeFluency } from './services/score.js';
import { logEvent } from './activity.js';

export const PASS_TURNS = 8; // 通关：任务全部完成 且 用户发言 ≥ 8 轮
const STAGE_MAX_TURNS = 3; // 周复习对话：每段最多聊 3 轮就引到下一段，避免卡在一个话题
const TARGETS = 12; // 周复习对话：本周表达挑几个

// STRICT 任务（道别）兜底：用户确实说过告别类的话才算完成
const BYE = /\b(bye|goodbye|see (you|ya)|take care|catch you later|talk (to you )?(later|soon)|have to go|gotta go|got to go|nice (meeting|talking|chatting)|great (meeting|talking|chatting)|good talking|(was|it's been) (nice|great|good) (meeting|talking|chatting)|have a (good|nice|great|safe) (one|day|night|weekend|trip|flight)|safe travels)\b/i;
const saidBye = (messages) => messages.filter((m) => m.role === 'user').some((m) => BYE.test(m.content));

const sceneOf = (row) => row && { ...JSON.parse(row.data), week: row.week };
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

export function listScenes() {
  const pos = planPosition();
  return all('SELECT * FROM content_scene ORDER BY week, day, id').map((r) => {
    const sc = sceneOf(r);
    const passed = get('SELECT COUNT(*) n FROM roleplay WHERE scene_id = ? AND passed = 1', [r.id]).n > 0;
    const tried = get('SELECT COUNT(*) n FROM roleplay WHERE scene_id = ?', [r.id]).n > 0;
    return {
      id: sc.id, week: r.week, day: r.day || 1, title: sc.title, level: sc.level, roleZh: sc.role_zh,
      status: !isUnlocked(r.week, r.day, pos) ? 'locked' : passed ? 'passed' : tried ? 'tried' : 'open',
    };
  });
}

function view(rp) {
  const scene = sceneOf(get('SELECT * FROM content_scene WHERE id = ?', [rp.scene_id]));
  const messages = parse(rp.messages, []);
  const done = parse(rp.tasks_done, []);
  const state = parse(rp.state, null);
  const lines = messages.filter((m) => m.role === 'user').map((m) => m.content);
  return {
    id: rp.id, scene, messages, tasksDone: done,
    turns: lines.length,
    feedback: parse(rp.feedback, {}),
    passTurns: PASS_TURNS, review: parse(rp.review, null), passed: !!rp.passed, ended: !!rp.ended_at,
    state: state && { ...state, targets: state.targets.map((t) => ({ ...t, used: usedExpression(t.en, lines) })) },
  };
}

// ---- 周复习对话 ----

/**
 * 从本周表达卡里挑目标表达：优先没想起（1）→ 想起但卡（2）→ 学过没评 → 脱口而出（3）→ 还没学的；
 * 同样薄弱时各天轮流取，避免都挤在一天。按卡片所在的天分到对应的对话段
 */
export function pickTargets(week, stages, n = TARGETS) {
  const score = (c) => (c.introduced_at == null ? 4 : c.last_rating == null ? 2.5 : c.last_rating);
  // 看中文想英文：没有中文释义的卡不选（也不选雅思词汇）
  const cards = all("SELECT id, en, zh, day, last_rating, streak, introduced_at FROM card WHERE week = ? AND COALESCE(source, '') <> '雅思' AND COALESCE(zh, '') <> ''", [week])
    .sort((a, b) => score(a) - score(b) || (a.streak || 0) - (b.streak || 0) || a.id - b.id);
  const rank = {}; const seen = {};
  for (const c of cards) { const d = c.day || 1; rank[c.id] = seen[d] = (seen[d] ?? -1) + 1; }
  const stageOf = (day) => { const i = stages.findIndex((s) => s.day === day); return i >= 0 ? i : stages.length - 1; };
  return cards.sort((a, b) => score(a) - score(b) || rank[a.id] - rank[b.id] || (a.day || 1) - (b.day || 1)).slice(0, n)
    .map((c) => ({ cardId: c.id, en: c.en, zh: c.zh, stage: stageOf(c.day || 1) }))
    .sort((a, b) => a.stage - b.stage);
}

// 太常见、没有区分度的词：不算关键词（否则 “I know what you mean … today” 会被当成说了 “What brings you here today?”）
const STOP = new Set(("a an the i you we he she it they me my your our his her is are am was were be been to of in on at for and or so just do does did " +
  "can could would will that this there here with it's i'm you're we're what how why when where who get got go going have has had " +
  "really very today now some any all not no yes one up out about like as if then than too also please oh well by from into over back").split(' '));
const norm = (t) => String(t || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 学习者有没有用上某个表达：整句出现，或关键词（去掉 I / the / to 这类）有三分之二以上出现在同一句里。
 * 卡片有两句的（“Can I get you something to drink? Coffee or tea?”）说中其中一句就算
 */
export function usedExpression(en, lines) {
  const parts = [en, ...String(en).split(/[.?!]+/)].map(norm).filter(Boolean);
  const said = lines.map((l) => { const n = norm(l); return { n, set: new Set(n.split(' ')) }; });
  return parts.some((p) => {
    const words = p.split(' ');
    const key = words.filter((w) => !STOP.has(w));
    return said.some(({ n, set }) => {
      if (n.includes(p)) return true;
      const has = (ws) => ws.filter((w) => set.has(w)).length;
      // 关键词只有 1 个（“How was your trip over?” 只剩 trip）：关键词在，且整句大部分词也在
      if (key.length <= 1) return key.every((w) => set.has(w)) && has(words) >= Math.ceil(words.length * 0.6);
      return has(key) >= Math.ceil(key.length * 2 / 3);
    });
  });
}

/** 当前段的任务完成了、或这一段已经聊满 STAGE_MAX_TURNS 轮，就进入下一段 */
export function advanceStage(sc, state, done) {
  let { stage, stageTurns } = state;
  while (stage < sc.stages.length - 1 && (done.includes(stage + 1) || stageTurns >= STAGE_MAX_TURNS)) { stage++; stageTurns = 0; }
  return { ...state, stage, stageTurns };
}

function reviewPrompt(sc, state) {
  const k = state.stage; const cur = sc.stages[k];
  // 只提示当前段还没用上的表达
  const targets = state.targets.filter((t) => t.stage === k && !t.used).map((t) => `"${t.en}"`);
  return `
This is a longer, relaxed conversation (about 15 exchanges) that moves through these topics in order:
${sc.stages.map((s, i) => `${i + 1}. ${s.focus}`).join('\n')}
RIGHT NOW you are on topic ${k + 1}: ${cur.focus}
${k < sc.stages.length - 1 ? `As soon as ${cur.task.check}, move on naturally to topic ${k + 2}. Do not jump ahead before that.` : 'This is the last topic; let the learner wrap up the conversation.'}
${targets.length ? `The learner is practicing these phrases: ${targets.join(', ')}. Your job is to set up situations where THE LEARNER would naturally say them.
Do NOT use these phrases or close versions of them yourself, not even as questions to the learner.` : ''}`.trim();
}

export function start(sceneId) {
  const row = get('SELECT * FROM content_scene WHERE id = ?', [sceneId]);
  if (!row) return null;
  const sc = sceneOf(row);
  let state = null;
  if (sc.level === 'review') {
    // 周复习对话较长：今天没聊完的，回来接着聊
    const open = get("SELECT id FROM roleplay WHERE scene_id = ? AND ended_at IS NULL AND date(created_at) = date('now','localtime') ORDER BY id DESC", [sceneId]);
    if (open) return load(open.id);
    state = { targets: pickTargets(sc.week, sc.stages), stage: 0, stageTurns: 0 };
  }
  const messages = [{ role: 'assistant', content: sc.opening, zh: sc.opening_zh }];
  const { lastId } = run('INSERT INTO roleplay (scene_id, messages, tasks_done, state) VALUES (?,?,?,?)',
    [sceneId, JSON.stringify(messages), '[]', state && JSON.stringify(state)]);
  return view(get('SELECT * FROM roleplay WHERE id = ?', [lastId]));
}

export const load = (id) => { const r = get('SELECT * FROM roleplay WHERE id = ?', [id]); return r && view(r); };

function systemPrompt(sc, state) {
  const review = sc.level === 'review' && state;
  const level = sc.level === 'advanced' || review
    ? 'Use natural everyday American English with a few common idioms, and ask natural follow-up questions.'
    : 'Use simple, common words and short sentences.';
  return `You are ${sc.persona}. Stay in character in a realistic role-play.
You are talking with an adult Chinese learner of English who reads well but is slow at speaking.
Rules:
- Keep every reply under ${review ? 25 : 20} words. Ask at most one question per reply. ${level}
- Never correct the learner's grammar during the conversation; just respond naturally.
- If the learner writes in Chinese, understand it and reply naturally in English as usual.
- ONLY if the learner explicitly asks in English how to say something, put the English phrase they asked for in "coach". In every other case "coach" MUST be an empty string.
- Gently steer the conversation so the learner gets chances to complete their tasks, but do not list the tasks.
${review ? reviewPrompt(sc, state) + '\n' : ''}The learner's tasks (numbered):
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
  // 周复习对话：先按已完成的任务决定这一轮聊哪一段
  let state = v.state && advanceStage(v.scene, v.state, [...v.tasksDone, ...matchedTasks(v.scene, messages)]);
  if (state) state = { ...state, targets: state.targets.map((t) => ({ ...t, used: t.used || usedExpression(t.en, [text]) })) };
  const out = await llm.chatJSON(
    [{ role: 'system', content: systemPrompt(v.scene, state) }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    { model: getSettings().llmModel, kind: 'turn' },
    (t) => ({ reply: t, completed: [] }),
  );
  const n = v.scene.tasks.length;
  const bye = saidBye(messages);
  const done = [...new Set([...v.tasksDone, ...matchedTasks(v.scene, messages), ...(out.completed || []).map(Number)
    .filter((x) => x >= 1 && x <= n && (!v.scene.tasks[x - 1].strict || bye))])].sort((a, b) => a - b);
  // 「可以说」：只在英文里明确问“怎么说”时显示；中文输入的英文说法放在用户消息下的点评卡，不重复
  const askedHow = /how (do|can|would|should) (i|you) say|what('s| is) .* in english/i.test(text);
  const coach = !zhHelp && askedHow ? String(out.coach || '').trim() : '';
  messages.push({ role: 'assistant', content: String(out.reply || '').trim(), zh: out.reply_zh || '', coach });
  run('UPDATE roleplay SET messages = ?, tasks_done = ? WHERE id = ?', [JSON.stringify(messages), JSON.stringify(done), id]);
  if (state) {
    const { stage, stageTurns } = state;
    run('UPDATE roleplay SET state = ? WHERE id = ?', [JSON.stringify({ ...parse(rp.state, {}), stage, stageTurns: stageTurns + 1 }), id]);
  }
  logEvent('roleplay_turn');
  if (zhHelp) {
    const fb = parse(get('SELECT feedback FROM roleplay WHERE id = ?', [id]).feedback, {});
    fb[messages.length - 2] = { ok: false, better: zhHelp, issue_zh: '用英语可以这样说', zh: text };
    run('UPDATE roleplay SET feedback = ? WHERE id = ?', [JSON.stringify(fb), id]);
  }
  return load(id);
}

/** 任务检查：单独调用模型，只判断还没完成的任务（比在回复里顺带判断准确） */
/** 任务的 match（正则）命中即算完成，不依赖模型判断，用于「How about you?」这类模型容易漏判的追问 */
export function matchedTasks(scene, messages) {
  const lines = messages.filter((m) => m.role === 'user').map((m) => m.content);
  return scene.tasks.map((t, i) => (t.match || []).some((p) => lines.some((l) => new RegExp(p, 'i').test(l))) ? i + 1 : 0).filter(Boolean);
}

export async function checkTasks(id) {
  const rp = get('SELECT * FROM roleplay WHERE id = ?', [id]);
  if (!rp) return null;
  const v = view(rp);
  const pending = v.scene.tasks.map((t, i) => ({ n: i + 1, t })).filter((x) => !v.tasksDone.includes(x.n));
  if (!pending.length || !v.turns) return { tasksDone: v.tasksDone };
  const lines = v.messages.filter((m) => m.content).map((m) => `${m.role === 'user' ? 'Learner' : v.scene.role}: ${m.content}`).join('\n');
  const out = await llm.chatJSON([
    { role: 'system', content: `You check an English learner's role-play tasks. Scene: ${v.scene.title} (the other person is ${v.scene.role}).
For EACH task below, decide whether the learner has ALREADY done it in what they actually said. Judge by meaning, not exact words; one line can complete several tasks.
Read the learner's lines in context: a follow-up like "How about you?" or "And you?" asks the other person the same thing the learner just talked about (e.g. after the learner describes their job, it asks what the other person does).
Only the Learner's lines can complete tasks; the other person's lines are context.
Do NOT count a task just because it might happen later or the conversation is going well. Tasks marked (STRICT) only count if the learner literally did it (e.g. really said goodbye).
Tasks:
${pending.map((x) => `${x.n}. ${x.t.check}${x.t.strict ? ' (STRICT)' : ''}`).join('\n')}
Respond ONLY with JSON: {"done": [numbers of the tasks above that are accomplished]}` },
    { role: 'user', content: `The conversation so far:\n${lines}` },
  ], { model: getSettings().llmModel, temperature: 0, kind: 'tasks' }, () => ({ done: [] }));
  const said = saidBye(v.messages);
  const ok = new Set(pending.filter((x) => !x.t.strict || said).map((x) => x.n));
  const cur = parse(get('SELECT tasks_done FROM roleplay WHERE id = ?', [id]).tasks_done, []);
  const done = [...new Set([...cur, ...matchedTasks(v.scene, v.messages), ...(out.done || []).map(Number).filter((n) => ok.has(n))])].sort((a, b) => a - b);
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
  const fb = await judgeLine(v.scene, prev?.content || '', msg.content);
  // 读最新值再写，避免并发点评互相覆盖
  const cur = parse(get('SELECT feedback FROM roleplay WHERE id = ?', [id]).feedback, {});
  cur[index] = fb;
  run('UPDATE roleplay SET feedback = ? WHERE id = ?', [JSON.stringify(cur), id]);
  return fb;
}

// 点评一句话：{ok:true} 或 {ok:false, better, issue_zh, zh}。评测脚本 scripts/eval-feedback.mjs 也调用它
export async function judgeLine(scene, prevLine, line, model = getSettings().llmModel) {
  const out = await llm.chatJSON([
    { role: 'system', content: `You are an English coach for a Chinese adult learning everyday spoken English.
Check ONE line the learner said in a role-play. Judge only whether it is grammatical and natural spoken English in this context.
Ignore capitalization, punctuation, spacing and obvious typing slips. Do not rewrite lines that are already natural just to make them fancier.
If the line is fine, respond {"ok": true}.
Otherwise respond {"ok": false, "better": "the most natural way to say what the learner meant", "issue_zh": "用一句简体中文说明问题（语法、用词或中式英语），不超过40字", "zh": "better 的简体中文意思"}.
Rules for "better":
- It must be something a native speaker would REALLY say in this exact situation, not just grammatically correct English.
- Respect normal collocations and what each phrase is actually used with (e.g. "reach me at" takes a phone number or an email, not a username; a WeChat ID is "My WeChat ID is ..." or "Just save me as ...").
- Keep the learner's own meaning and register; keep it short and spoken, the kind of line that fits right after what the other person just said.
- If the learner's wording is a word-for-word translation from Chinese, say so in "issue_zh" and give what people actually say instead.
- Only fix what is actually wrong. If the learner's wording is already a correct, idiomatic option, respond {"ok": true} — never swap it for another wording just because that one is more common. For example "This is <name>" is the normal way to introduce yourself on a phone or video call, so do not "correct" it to "I'm <name>".
- Punctuation is not part of speaking: if the words are fine and only the punctuation, capitalization or sentence break is off (including a Chinese 。), respond {"ok": true}.
If the learner wrote Chinese, "better" is natural English for it and "issue_zh" is "用英语可以这样说".
Respond ONLY with JSON.` },
    { role: 'user', content: `Scene: ${scene.title} — ${scene.brief || ''}
${scene.role} said: ${prevLine}
Learner said: ${line}` },
  ], { model, temperature: 0.2, kind: 'feedback' }, () => ({ ok: true }));
  if (out.ok === true || out.ok === 'true' || !out.better) return { ok: true };
  return guardFeedback(line, { ok: false, better: String(out.better).trim(), issue_zh: out.issue_zh || '', zh: out.zh || '' });
}

const loose = (t) => String(t || '').toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9'@. ]/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
const FILLER = new Set(['and', 'so', 'yes', 'yeah', 'oh', 'well', 'um', 'uh']);
const words = (t) => loose(t).split(' ').filter((w) => w && !FILLER.has(w));

/**
 * 模型点评之后的代码兜底，压住提示词压不住的两类误判（评测集 ok-this-is-name*、fix-wechat-reach-me）：
 * 1. 学员用「This is + 名字」自我介绍，模型改成 I'm / I am / My name is + 名字：改回 This is；改完和原话只差标点、连词就算没问题。
 * 2. 模型把用户名（不是邮箱、电话）写成 reach me at / contact me at：换成留微信号的说法。
 */
export function guardFeedback(line, fb) {
  if (fb.ok) return fb;
  let { better, issue_zh: issue, zh } = fb;
  const intro = String(line).match(/\bthis is\s+([a-z][\w'-]*)/i);
  if (intro) {
    const name = intro[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    better = better.replace(new RegExp(`\\b(?:I'm|I am|My name is|Im)\\s+(${name})\\b`, 'i'), (_m, n) => `This is ${n}`);
  }
  const reach = better.match(/\b(?:you can )?(?:reach|contact) me at\s+([^\s,.!?]+)(?:\s+on\s+wechat)?/i);
  if (reach && !/@/.test(reach[1]) && (reach[1].match(/\d/g) || []).length < 5) {
    better = better.replace(reach[0], `${/^you can/i.test(reach[0]) ? 'You can a' : 'A'}dd me on WeChat. My WeChat ID is ${reach[1]}`);
    issue = '留微信号不用 reach me at（它后面接电话或邮箱），直接说 My WeChat ID is …';
    zh = `加我微信吧，我的微信号是 ${reach[1]}。`;
  }
  // 只差大小写、标点、断句或 and / so 这类连接词，不算问题
  if (words(better).join(' ') === words(line).join(' ')) return { ok: true };
  return { ok: false, better, issue_zh: meaningfulZh(issue) ? issue : '', zh: meaningfulZh(zh) ? zh : '' };
}

/** 模型偶尔只回一两个字（如「用」）当说明：少于 4 个字（不算标点空格）或没有中文就不显示 */
export const meaningfulZh = (t) => /[\u4e00-\u9fff]/.test(t || '') && String(t).replace(/[\s\p{P}]/gu, '').length >= 4;

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
    if (v.state) {
      const t = v.state.targets;
      review.targets = { used: t.filter((x) => x.used).length, total: t.length, missed: t.filter((x) => !x.used).map(({ en, zh }) => ({ en, zh })) };
    }
  }
  const passed = v.tasksDone.length === v.scene.tasks.length && v.turns >= v.passTurns ? 1 : 0;
  run("UPDATE roleplay SET review = ?, passed = ?, ended_at = datetime('now','localtime') WHERE id = ?", [JSON.stringify(review), passed, id]);
  logEvent('roleplay');
  return load(id);
}
