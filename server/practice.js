// 跟读、独白（PRD 3.4、3.5）
import { all, get, run, getSettings } from './db.js';
import { planPosition, isUnlocked, UNLOCK_SQL, unlockArgs } from './cards.js';
import * as llm from './services/llm.js';
import { align, fluency } from './services/score.js';
import { todayStr } from './util/date.js';
import { logEvent } from './activity.js';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

export function recordingWords(id) {
  const r = get('SELECT words FROM recording WHERE id = ?', [id]);
  return r ? parse(r.words, []) : null;
}
function saveMetrics(id, f) {
  run('UPDATE recording SET wpm = ?, long_pauses = ?, fillers = ? WHERE id = ?', [f.wpm, f.longPauses, f.fillers, id]);
}

// ---- 跟读 ----
export function shadowList() {
  const pos = planPosition();
  return all("SELECT * FROM content_item WHERE type = 'shadow' ORDER BY week, day, id").map((r) => {
    const x = parse(r.extra, {});
    return { id: r.id, week: r.week, day: r.day || 1, title: r.zh, sentences: x.sentences || [], source: x.source || '', date: x.date || '', locked: !isUnlocked(r.week, r.day, pos) };
  });
}

/** 跟读评分：recordingId 的识别结果对比 reference 原文 */
export function scoreShadow(recordingId, reference) {
  const words = recordingWords(recordingId);
  if (!words) return null;
  const f = fluency(words);
  saveMetrics(recordingId, f);
  logEvent('shadow');
  return { ...align(reference, words), ...f };
}

// ---- 独白 ----
export function topicList() {
  const pos = planPosition();
  // 每个话题最近一次练习的日期，用来优先给没说过的
  const doneAt = {};
  for (const s of all("SELECT started_at, metrics FROM session WHERE module = 'mono' ORDER BY id")) {
    const id = parse(s.metrics, {}).topicId;
    if (id) doneAt[id] = s.started_at;
  }
  return all(`SELECT * FROM content_item WHERE type = 'topic' AND ${UNLOCK_SQL} ORDER BY week DESC, day DESC, id`, unlockArgs(pos)).map((r) => ({
    id: r.id, week: r.week, day: r.day || 1, zh: r.zh, en: r.en, hints: parse(r.extra, {}).hints || [], doneAt: doneAt[r.id] || '',
  }));
}

export async function scoreMono(topicId, recordingId) {
  const topic = get("SELECT * FROM content_item WHERE id = ? AND type = 'topic'", [topicId]);
  const rec = get('SELECT * FROM recording WHERE id = ?', [recordingId]);
  if (!topic || !rec) return null;
  const words = parse(rec.words, []);
  const f = fluency(words);
  saveMetrics(recordingId, f);
  let rw = { rewrite: '', phrases: [], comment_zh: '' };
  if (rec.transcript?.trim()) {
    rw = await llm.chatJSON([
      { role: 'system', content: `You are an English speaking coach for a Chinese adult learner.
The learner spoke for about one minute on the topic "${topic.en}". Below is the speech-recognition transcript (it may contain recognition errors).
1. Rewrite it into natural, fluent spoken American English at a similar length and a B1–B2 level. Keep their meaning and personal details; do not add new facts.
2. Pick 3 useful phrases from your rewrite for them to learn, each with a Simplified Chinese meaning.
3. Write one encouraging sentence of feedback in Simplified Chinese (one strength + one thing to improve).
Respond ONLY with JSON: {"rewrite": "...", "phrases": [{"en": "...", "zh": "..."}], "comment_zh": "..."}` },
      { role: 'user', content: rec.transcript },
    ], { model: getSettings().llmModel, temperature: 0.4, kind: 'mono' }, (t) => ({ rewrite: t, phrases: [], comment_zh: '' }));
  }
  const result = { topicId, transcript: rec.transcript || '', ...f, rewrite: rw.rewrite || '', phrases: (rw.phrases || []).slice(0, 5), comment_zh: rw.comment_zh || '' };
  const { dayNo } = planPosition();
  run("INSERT INTO session (day_no, module, started_at, ended_at, metrics) VALUES (?, 'mono', ?, datetime('now','localtime'), ?)",
    [dayNo, todayStr(), JSON.stringify({ ...result, recordingId })]);
  logEvent('mono');
  return result;
}
