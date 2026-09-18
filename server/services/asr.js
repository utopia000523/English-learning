// 语音识别：whisper.cpp（whisper-cli）。输出文字 + 词级时间戳和置信度
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { config } from '../config.js';

export function findBinary() {
  for (const bin of ['whisper-cli', 'whisper-cpp']) {
    try { return execFileSync('which', [bin]).toString().trim(); } catch { /* 继续 */ }
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
      if (fs.existsSync(path.join(dir, bin))) return path.join(dir, bin);
    }
  }
  return null;
}

export function status(modelFile) {
  if (process.env.SPEAK90_FAKE_ASR) return { ok: true, detail: '测试用假识别' };
  const bin = findBinary();
  const modelPath = path.join(config.modelsDir, modelFile);
  if (!bin) return { ok: false, detail: '未安装 whisper.cpp', fix: '终端执行：brew install whisper-cpp' };
  if (!fs.existsSync(modelPath)) return { ok: false, detail: `缺少模型 models/${modelFile}`, fix: '运行 scripts/start.sh，按提示下载模型' };
  return { ok: true, detail: `whisper.cpp · ${modelFile.replace(/^ggml-|\.bin$/g, '')}` };
}

const run = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
    err ? reject(Object.assign(new Error('语音识别失败：' + (stderr || err.message).slice(-200)), { code: 'ASR_FAILED' })) : resolve(stdout));
});

/** 把 whisper 的子词 token 合并成单词（以空格开头的 token 视为新词） */
export function tokensToWords(transcription) {
  const words = [];
  for (const seg of transcription || []) {
    for (const t of seg.tokens || []) {
      const text = t.text || '';
      if (!text.trim() || text.startsWith('[_') || text.startsWith('<|')) continue;
      const start = t.offsets?.from ?? 0; const end = t.offsets?.to ?? start;
      const last = words[words.length - 1];
      if (text.startsWith(' ') || !last) words.push({ word: text.trim(), start, end, prob: t.p ?? 1, n: 1 });
      else { last.word += text; last.end = end; last.prob = Math.min(last.prob, t.p ?? 1); last.n++; }
    }
  }
  return words.map(({ n, ...w }) => ({ ...w, prob: Math.round(w.prob * 100) / 100 }));
}

/** 返回 { text, words: [{ word, start, end, prob }] }，时间单位毫秒 */
export async function transcribe(audioPath, { modelFile }) {
  if (process.env.SPEAK90_FAKE_ASR) {
    return { text: 'Hi, I am Utopia.', words: [{ word: 'Hi,', start: 0, end: 300, prob: 0.95 }, { word: 'I', start: 350, end: 450, prob: 0.9 }, { word: 'am', start: 450, end: 600, prob: 0.9 }, { word: 'Utopia.', start: 600, end: 1100, prob: 0.6 }] };
  }
  const st = status(modelFile);
  if (!st.ok) throw Object.assign(new Error(`语音识别未就绪：${st.detail}。${st.fix || ''}`), { code: 'ASR_UNAVAILABLE' });
  const outBase = path.join(os.tmpdir(), `speak90-asr-${Date.now()}`);
  const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));
  await run(findBinary(), ['-m', path.join(config.modelsDir, modelFile), '-f', audioPath, '-l', 'en', '-ojf', '-of', outBase, '-np', '-t', threads]);
  const json = JSON.parse(fs.readFileSync(outBase + '.json', 'utf8'));
  fs.rmSync(outBase + '.json', { force: true });
  const text = (json.transcription || []).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { text, words: tokensToWords(json.transcription) };
}
