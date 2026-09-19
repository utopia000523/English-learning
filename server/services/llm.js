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
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`Ollama ${pathname} 返回 ${res.status} ${detail.slice(0, 200)}`), { status: res.status, detail });
  }
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
const noThink = new Set();

export async function chat(messages, { model, temperature = 0.7, json = false, kind = '' } = {}) {
  if (process.env.SPEAK90_FAKE_LLM) return { content: fakeReply(kind) }; // 仅测试用
  const body = {
    model, messages, stream: false,
    format: json ? 'json' : undefined,
    options: { temperature },
    keep_alive: '30m', // 练习期间模型常驻内存，避免每次重新加载
  };
  // 关闭「先思考再回答」（Gemma 4、Qwen3 等支持思考的模型默认会先写很长的推理，导致很慢）
  if (!noThink.has(model)) {
    try {
      const data = await ollama('/api/chat', { ...body, think: false });
      return { content: data.message?.content ?? '' };
    } catch (e) {
      if (!(e.status === 400 && /think/i.test(e.detail || ''))) throw e;
      noThink.add(model); // 该模型不支持 think 参数，之后不再传
    }
  }
  const data = await ollama('/api/chat', body);
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
  if (kind === 'tasks') return JSON.stringify({ done: [1, 2, 3, 4] });
  if (kind === 'translate') return JSON.stringify({ en: "Not great, work's been really busy lately." });
  if (kind === 'lookup') {
    return JSON.stringify({ zh: '忙乱的', pos: 'adj.', usage_zh: '形容事情多、节奏快、忙得团团转', example: 'It was a hectic day.', example_zh: '那天忙得不可开交。' });
  }
  if (kind === 'mono') {
    return JSON.stringify({ rewrite: 'Last weekend I went to Dameisha with a couple of friends.', phrases: [{ en: 'a couple of friends', zh: '几个朋友' }], comment_zh: '说得很完整，注意用过去时。' });
  }
  if (kind === 'feedback') {
    return JSON.stringify({ ok: false, better: 'How do you know so much about both?', issue_zh: 'familiar 是形容词，要说 be familiar with', zh: '你怎么对两者都这么了解？' });
  }
  if (kind === 'review') {
    return JSON.stringify({ comment_zh: '任务都完成了，表达基本清楚。', fixes: [{ you: 'Can I have a oat latte?', better: 'Can I get an oat latte?', zh: '我要一杯燕麦拿铁。' }] });
  }
  return JSON.stringify({ reply: 'Sure! Anything else?', reply_zh: '好的！还需要别的吗？', coach: 'Nice to meet you', completed: [1, 2, 3, 4] });
}
