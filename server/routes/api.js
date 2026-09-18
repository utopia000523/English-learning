import express from 'express';
import { getSettings, updateSettings } from '../db.js';
import * as llm from '../services/llm.js';
import * as asr from '../services/asr.js';
import * as notion from '../services/notion.js';
import { todayQueue, reviewCard, addCard } from '../cards.js';

export const api = express.Router();

// 本地服务状态（首页不显示，设置页显示）。朗读在浏览器端检测
api.get('/health', async (_req, res) => {
  const s = getSettings();
  const [llmSt, notionSt] = await Promise.all([llm.status(s.llmModel), notion.status(s)]);
  res.json({ server: { ok: true }, llm: llmSt, asr: asr.status(s.asrModel), notion: notionSt });
});

api.get('/settings', (_req, res) => {
  const { notionToken, ...rest } = getSettings();
  res.json({ ...rest, notionTokenSet: Boolean(notionToken) });
});
api.put('/settings', (req, res) => {
  const { notionToken, ...rest } = updateSettings(req.body || {});
  res.json({ ...rest, notionTokenSet: Boolean(notionToken) });
});

// 通用对话接口（阶段 3 在此基础上加场景提示词、复盘）
api.post('/llm/chat', async (req, res, next) => {
  try {
    const { messages, json } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages 必须是数组' });
    res.json(await llm.chat(messages, { model: getSettings().llmModel, json }));
  } catch (e) { next(e); }
});

// ---- 表达卡（PRD 3.3）----
api.get('/cards/today', (_req, res) => res.json(todayQueue()));
api.post('/cards/:id/review', (req, res) => {
  const rating = Number(req.body?.rating);
  if (![1, 2, 3].includes(rating)) return res.status(400).json({ error: 'rating 必须是 1/2/3' });
  const card = reviewCard(Number(req.params.id), rating);
  return card ? res.json(card) : res.status(404).json({ error: '卡片不存在' });
});
api.post('/cards', (req, res) => {
  if (!req.body?.en?.trim()) return res.status(400).json({ error: '英文不能为空' });
  res.json(addCard(req.body));
});
