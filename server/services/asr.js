// 语音识别：whisper.cpp（whisper-cli）。阶段 4 实现 transcribe()
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../config.js';

export function findBinary() {
  for (const bin of ['whisper-cli', 'whisper-cpp']) {
    try { return execFileSync('which', [bin]).toString().trim(); } catch { /* 继续 */ }
  }
  return null;
}

export function status(modelFile) {
  const bin = findBinary();
  const modelPath = path.join(config.modelsDir, modelFile);
  if (!bin) return { ok: false, detail: '未安装 whisper.cpp', fix: '终端执行：brew install whisper-cpp' };
  if (!fs.existsSync(modelPath)) return { ok: false, detail: `缺少模型 models/${modelFile}`, fix: '运行 scripts/start.sh，按提示下载模型' };
  return { ok: true, detail: `whisper.cpp · ${modelFile.replace(/^ggml-|\.bin$/g, '')}` };
}

/** 返回 { text, words: [{ word, start, end, prob }] }，阶段 4 实现 */
export async function transcribe(/* audioPath, { modelFile } */) {
  throw Object.assign(new Error('语音识别将在阶段 4 实现'), { code: 'NOT_IMPLEMENTED' });
}
