// 跟读 / 独白评分（纯本地计算，PRD 3.4、3.5、5.2）。结果仅作练习参考，不是音素级发音评测
export const LONG_PAUSE_MS = 2000;
export const UNSURE_PROB = 0.5;
const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'ah', 'hmm', 'mm', 'uhm']);

export const norm = (w) => w.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']/g, '');

// 缩写展开：I'm 和 I am、don't 和 do not 视为相同（whisper 两种写法都可能出现）
const CONTR = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is',
  "it's": 'it is', "that's": 'that is', "what's": 'what is', "there's": 'there is', "here's": 'here is', "let's": 'let us',
  "i've": 'i have', "you've": 'you have', "we've": 'we have', "i'll": 'i will', "you'll": 'you will', "we'll": 'we will',
  "it'll": 'it will', "that'll": 'that will', "i'd": 'i would', "you'd": 'you would', "don't": 'do not', "doesn't": 'does not',
  "didn't": 'did not', "can't": 'can not', "cannot": 'can not', "won't": 'will not', "isn't": 'is not', "aren't": 'are not',
  "wasn't": 'was not', "weren't": 'were not', "couldn't": 'could not', "wouldn't": 'would not', "shouldn't": 'should not',
  "haven't": 'have not', "hasn't": 'has not', "work's": 'work has',
};
const expand = (n) => (CONTR[n] || n).split(' ');
/** 返回展开后的词元，parent 指向原词序号 */
export const tokenize = (text) => text.split(/\s+/).filter((w) => norm(w))
  .flatMap((w, parent) => expand(norm(w)).map((n) => ({ raw: w, n, parent })));

/**
 * 原文与识别结果逐词对齐（编辑距离回溯）。
 * 返回 { align: [{ word, status: ok|unsure|missed|wrong, heard? }], completeness, missed, wrong }
 */
export function align(reference, words) {
  const ref = tokenize(reference);
  const hyp = words.filter((w) => norm(w.word)).flatMap((w) => expand(norm(w.word)).map((n) => ({ ...w, n })));
  const R = ref.length; const H = hyp.length;
  const d = Array.from({ length: R + 1 }, (_, i) => Array.from({ length: H + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= H; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1].n === hyp[j - 1].n ? 0 : 1));
    }
  }
  const out = [];
  let i = R; let j = H;
  while (i > 0) {
    if (j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1].n === hyp[j - 1].n ? 0 : 1)) {
      const same = ref[i - 1].n === hyp[j - 1].n;
      out.unshift({ word: ref[i - 1].raw, status: same ? (hyp[j - 1].prob < UNSURE_PROB ? 'unsure' : 'ok') : 'wrong', ...(same ? {} : { heard: hyp[j - 1].word }) });
      i--; j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      j--; // 多说的词，忽略
    } else {
      out.unshift({ word: ref[i - 1].raw, status: 'missed' });
      i--;
    }
  }
  // 展开的词元合并回原词：取最差的状态
  const RANK = { ok: 0, unsure: 1, wrong: 2, missed: 3 };
  const merged = [];
  out.forEach((w, k) => {
    const p = ref[k].parent;
    if (merged[p]) {
      if (RANK[w.status] > RANK[merged[p].status]) merged[p] = { ...merged[p], status: w.status, heard: w.heard };
    } else merged[p] = { ...w };
  });
  const good = merged.filter((w) => w.status === 'ok' || w.status === 'unsure').length;
  return {
    align: merged,
    completeness: merged.length ? Math.round((good / merged.length) * 100) : 0,
    missed: merged.filter((w) => w.status === 'missed').map((w) => w.word),
    wrong: merged.filter((w) => w.status === 'wrong').map((w) => ({ word: w.word, heard: w.heard })),
  };
}

/** 流利度：语速（词/分钟）、>2 秒停顿次数、最长停顿、口头禅次数 */
export function fluency(words) {
  const ws = words.filter((w) => norm(w.word));
  if (!ws.length) return { wpm: 0, longPauses: 0, maxPauseMs: 0, fillers: 0, words: 0, durationMs: 0 };
  let longPauses = 0; let maxPauseMs = 0;
  for (let k = 1; k < ws.length; k++) {
    const gap = ws[k].start - ws[k - 1].end;
    if (gap > maxPauseMs) maxPauseMs = gap;
    if (gap > LONG_PAUSE_MS) longPauses++;
  }
  const fillers = ws.filter((w) => FILLERS.has(norm(w.word))).length;
  const durationMs = Math.max(1, ws[ws.length - 1].end - ws[0].start);
  const spoken = ws.length - fillers;
  return { wpm: Math.round(spoken / (durationMs / 60000)), longPauses, maxPauseMs, fillers, words: spoken, durationMs };
}

/** 合并多段录音的流利度（对话复盘用） */
export function mergeFluency(list) {
  const f = list.filter((x) => x.words > 0);
  if (!f.length) return null;
  const words = f.reduce((n, x) => n + x.words, 0);
  const ms = f.reduce((n, x) => n + x.durationMs, 0);
  return {
    wpm: Math.round(words / (ms / 60000)),
    longPauses: f.reduce((n, x) => n + x.longPauses, 0),
    fillers: f.reduce((n, x) => n + x.fillers, 0),
    segments: f.length,
  };
}
