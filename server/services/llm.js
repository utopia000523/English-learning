// 对话 / 改写 / 复盘：统一走这里。当前实现 = 本地 Ollama；以后接云端只改本文件
import { config } from '../config.js';

async function ollama(pathname, body, timeoutMs = 60000) {
  const res = await fetch(config.ollamaUrl + pathname, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama ${pathname} 返回 ${res.status}`);
  return res.json();
}

export async function status(model) {
  try {
    const { models = [] } = await ollama('/api/tags', null, 2000);
    const names = models.map((m) => m.name);
    const has = names.some((n) => n === model || n === `${model}:latest`);
    return has
      ? { ok: true, detail: `Ollama · ${model}` }
      : { ok: false, detail: `Ollama 已运行，但未下载模型 ${model}`, fix: `终端执行：ollama pull ${model}` };
  } catch {
    return { ok: false, detail: 'Ollama 未运行或未安装', fix: '安装 Ollama（ollama.com）并打开它' };
  }
}

/**
 * messages: [{ role: 'system'|'user'|'assistant', content }]
 * 返回 { content }
 */
export async function chat(messages, { model, temperature = 0.7, json = false } = {}) {
  const data = await ollama('/api/chat', {
    model, messages, stream: false,
    format: json ? 'json' : undefined,
    options: { temperature },
  });
  return { content: data.message?.content ?? '' };
}
