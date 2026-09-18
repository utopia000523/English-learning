// 对话 / 改写 / 复盘：统一走这里。当前实现 = 本地 Ollama；以后接云端只改本文件
import { config } from '../config.js';

async function ollama(pathname, body, timeoutMs = 90000) {
  let res;
  try {
    res = await fetch(config.ollamaUrl + pathname, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timeout = e.name === 'TimeoutError';
    throw Object.assign(new Error(timeout ? '对话模型响应超时，请稍后再试' : '对话模型未就绪：请打开 Ollama，并到「设置」检查'), { code: 'LLM_UNAVAILABLE' });
  }
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
export async function chat(messages, { model, temperature = 0.7, json = false, kind = '' } = {}) {
  if (process.env.SPEAK90_FAKE_LLM) return { content: fakeReply(kind) }; // 仅测试用
  const data = await ollama('/api/chat', {
    model, messages, stream: false,
    format: json ? 'json' : undefined,
    options: { temperature },
  });
  return { content: data.message?.content ?? '' };
}

/** 要求模型输出 JSON，解析失败时返回 fallback(原文) */
export async function chatJSON(messages, opts = {}, fallback = (text) => ({ text })) {
  const { content } = await chat(messages, { ...opts, json: true });
  try { return JSON.parse(content); } catch {
    const m = content.match(/\{[\s\S]*\}/);
    try { return m ? JSON.parse(m[0]) : fallback(content); } catch { return fallback(content); }
  }
}

function fakeReply(kind) {
  if (kind === 'review') {
    return JSON.stringify({ comment_zh: '任务都完成了，表达基本清楚。', fixes: [{ you: 'Can I have a oat latte?', better: 'Can I get an oat latte?', zh: '我要一杯燕麦拿铁。' }] });
  }
  return JSON.stringify({ reply: 'Sure! Anything else?', reply_zh: '好的！还需要别的吗？', coach: '', completed: [1, 2, 3, 4] });
}
