import express from 'express';
import { getSettings, updateSettings } from '../db.js';
import * as llm from '../services/llm.js';
import * as asr from '../services/asr.js';
import * as notion from '../services/notion.js';
import { todayQueue, reviewCard, addCard } from '../cards.js';
import * as roleplay from '../roleplay.js';
import * as practice from '../practice.js';
import * as notes from '../notes.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { run as dbRun } from '../db.js';

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

// ---- AI 情景对话（PRD 3.2）----
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
api.get('/roleplay/scenes', (_req, res) => res.json(roleplay.listScenes()));
api.post('/roleplay', (req, res) => {
  const r = roleplay.start(req.body?.sceneId);
  return r ? res.json(r) : res.status(404).json({ error: '场景不存在' });
});
api.get('/roleplay/:id', (req, res) => {
  const r = roleplay.load(Number(req.params.id));
  return r ? res.json(r) : res.status(404).json({ error: '对话不存在' });
});
api.post('/roleplay/:id/turn', wrap(async (req, res) => {
  const text = req.body?.text?.trim();
  if (!text) return res.status(400).json({ error: '内容不能为空' });
  const r = await roleplay.turn(Number(req.params.id), text, req.body?.recordingId);
  return r ? res.json(r) : res.status(404).json({ error: '对话不存在' });
}));
api.post('/roleplay/:id/feedback', wrap(async (req, res) => {
  const fb = await roleplay.feedback(Number(req.params.id), Number(req.body?.index));
  if (fb === null) return res.status(404).json({ error: '对话不存在' });
  if (fb === undefined) return res.status(400).json({ error: '只能点评你说的话' });
  res.json(fb);
}));
api.post('/roleplay/:id/finish', wrap(async (req, res) => {
  const r = await roleplay.finish(Number(req.params.id));
  return r ? res.json(r) : res.status(404).json({ error: '对话不存在' });
}));

// ---- 语音识别：前端上传 16kHz 单声道 wav（PRD 5.2）----
api.post('/asr', express.raw({ type: ['audio/wav', 'application/octet-stream'], limit: '25mb' }), wrap(async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: '没有收到录音' });
  const dir = path.join(config.dataDir, 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`);
  fs.writeFileSync(file, req.body);
  const r = await asr.transcribe(file, { modelFile: getSettings().asrModel });
  const { lastId } = dbRun('INSERT INTO recording (audio_path, transcript, words) VALUES (?,?,?)',
    [path.relative(config.dataDir, file), r.text, JSON.stringify(r.words)]);
  res.json({ id: lastId, ...r });
}));

// ---- 跟读、独白（PRD 3.4、3.5）----
api.get('/shadow', (_req, res) => res.json(practice.shadowList()));
api.post('/shadow/score', (req, res) => {
  const { recordingId, reference } = req.body || {};
  if (!reference?.trim()) return res.status(400).json({ error: '缺少原文' });
  const r = practice.scoreShadow(Number(recordingId), reference);
  return r ? res.json(r) : res.status(404).json({ error: '录音不存在' });
});
api.get('/mono/topics', (_req, res) => res.json(practice.topicList()));
api.post('/mono', wrap(async (req, res) => {
  const r = await practice.scoreMono(req.body?.topicId, Number(req.body?.recordingId));
  return r ? res.json(r) : res.status(404).json({ error: '话题或录音不存在' });
}));

// ---- 划词查询、笔记本（PRD 3.7）----
api.post('/lookup', wrap(async (req, res) => {
  const text = req.body?.text?.trim();
  if (!text || text.length > 80) return res.status(400).json({ error: '请选择一个词或短语' });
  res.json(await notes.lookup(text, (req.body?.context || '').slice(0, 300)));
}));
api.get('/notes', (req, res) => res.json(notes.listNotes({ q: req.query.q || '', source: req.query.source || '' })));
api.post('/notes', (req, res) => {
  if (!req.body?.en?.trim()) return res.status(400).json({ error: '英文不能为空' });
  res.json(notes.addNote(req.body));
});
api.delete('/notes/:id', (req, res) => (notes.deleteNote(Number(req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: '笔记不存在' })));
