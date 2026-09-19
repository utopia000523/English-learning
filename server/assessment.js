// 测评（PRD 2.4）：入门测评 + 第 30 / 60 / 90 天复测。题型固定，便于前后对比
import { all, get, run } from './db.js';
import { planPosition } from './cards.js';
import { align, fluency, mergeFluency } from './services/score.js';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

export const TEST = {
  shadow: ['Hi, nice to meet you.', 'I work at a tech company in Shenzhen.', 'Could you say that again, please?'],
  mono: { zh: '用 1 分钟介绍你自己', en: 'Introduce yourself in one minute.', hints: ['your name', 'your job', 'your hobbies'] },
  questions: [
    { en: "How's your day going so far?", zh: '你今天过得怎么样？' },
    { en: 'What do you usually do on weekends?', zh: '你周末一般做什么？' },
    { en: 'Why do you want to improve your English?', zh: '你为什么想提高英语？' },
  ],
};
export const MILESTONES = [0, 30, 60, 90];

const words = (id) => parse(get('SELECT words FROM recording WHERE id = ?', [id])?.words, []);

export function list() {
  return all('SELECT * FROM assessment ORDER BY day_no').map((r) => ({
    milestone: r.day_no, wpm: r.wpm, longPauses: r.long_pauses, fillers: r.fillers, createdAt: r.created_at, ...parse(r.summary, {}),
  }));
}

/** 当前该做哪次测评：null = 暂时不用 */
export function due() {
  const { dayNo } = planPosition();
  const done = new Set(all('SELECT day_no FROM assessment').map((r) => r.day_no));
  if (!done.has(0)) return 0;
  return MILESTONES.filter((m) => m > 0 && dayNo >= m && !done.has(m)).pop() ?? null;
}

/**
 * body: { shadow: [recordingId x3], mono: recordingId, answers: [recordingId x3] }
 * 指标：独白的语速 / 长停顿 / 口头禅（与 PRD 1.1 目标对应）；另存跟读完整度、问答的平均语速
 */
export function submit(body) {
  const milestone = due() ?? MILESTONES.filter((m) => m <= planPosition().dayNo).pop();
  const shadow = (body.shadow || []).map((id, i) => align(TEST.shadow[i] || '', words(id)).completeness);
  const mono = fluency(words(body.mono));
  const qa = mergeFluency((body.answers || []).map((id) => fluency(words(id))));
  const summary = {
    shadowAvg: shadow.length ? Math.round(shadow.reduce((a, b) => a + b, 0) / shadow.length) : null,
    shadow, monoWords: mono.words, qaWpm: qa?.wpm ?? null, qaLongPauses: qa?.longPauses ?? null,
  };
  run('DELETE FROM assessment WHERE day_no = ?', [milestone]);
  run('INSERT INTO assessment (day_no, wpm, long_pauses, fillers, summary) VALUES (?,?,?,?,?)',
    [milestone, mono.wpm, mono.longPauses, mono.fillers, JSON.stringify(summary)]);
  return list().find((a) => a.milestone === milestone);
}
