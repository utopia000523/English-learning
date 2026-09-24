// 雅思词汇导入：本地假 Notion 返回一页 IELTS Listening Daily（④ Vocabulary 表格）
import http from 'node:http';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const rt = (s) => [{ plain_text: s }];
const row = (...c) => ({ type: 'table_row', table_row: { cells: c.map(rt) } });
const routes = {
  'POST /v1/databases/0123456789abcdef0123456789abcdef/query': { results: [{ id: 'page-1', properties: { Title: { type: 'title', title: rt('2026-09-20 | Business | Shorter Meetings') }, Topic: { type: 'select', select: { name: 'Business' } } } },
    { id: 'page-2', properties: { Title: { type: 'title', title: rt('2026-09-23 | Environment | City Planning') }, Topic: { type: 'select', select: { name: 'Environment' } } } }] },
  // ChatGPT 有时不用表格，用段落写词汇
  'GET /v1/blocks/page-2/children?page_size=100': { results: [
    { type: 'heading_1', heading_1: { rich_text: rt('① Listening') } },
    { type: 'heading_3', heading_3: { rich_text: rt('Part 1') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Speaker A: Good morning, everyone. Today we are looking at how cities plan for bad weather.') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Speaker B: Many older cities were not built to be resilient. Their drains fill up after one heavy storm.') } },
    { id: 'tog', type: 'toggle', has_children: true, toggle: { rich_text: rt('Part 2') } },
    { type: 'heading_1', heading_1: { rich_text: rt('② Questions') } },
    { type: 'paragraph', paragraph: { rich_text: rt('1. Why do the planners prefer parks over walls?') } },
    { type: 'heading_1', heading_1: { rich_text: rt('④ Vocabulary') } },
    { type: 'paragraph', paragraph: { rich_text: rt('resilient — 有韧性的；能迅速恢复的') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Common collocations: resilient system; remain resilient') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Original example: “The new design makes the network more resilient.”') } },
    { type: 'paragraph', paragraph: { rich_text: rt('trade-off — 权衡；取舍') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Common collocations: a trade-off between A and B') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Original example: “Every design choice involves a trade-off.”') } },
    { type: 'heading_1', heading_1: { rich_text: rt('⑤ Review') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Review note: 这里不是词汇') } },
  ] },
  'GET /v1/blocks/tog/children?page_size=100': { results: [
    { type: 'paragraph', paragraph: { rich_text: rt('Speaker A: Building higher walls is one option, but it is expensive. There is always a trade-off between cost and safety.') } },
    { type: 'paragraph', paragraph: { rich_text: rt('（中文翻译：这一行不该出现在跟读里）') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Speaker B: That is why planners now add parks that can hold water for a few hours. A park like this makes the whole area more resilient. Residents also get more green space on dry days. Everyone wins in the long run.') } },
  ] },
  'GET /v1/blocks/page-1/children?page_size=100': { results: [
    { type: 'heading_2', heading_2: { rich_text: rt('① Listening') } },
    { type: 'paragraph', paragraph: { rich_text: rt('Over the past decade...') } },
    { type: 'heading_2', heading_2: { rich_text: rt('④ Vocabulary') } },
    { id: 'tbl', type: 'table', has_children: true },
    { type: 'heading_2', heading_2: { rich_text: rt('⑤ Review') } },
  ] },
  'GET /v1/blocks/tbl/children?page_size=100': { results: [
    row('Word / Phrase', '中文释义', 'Common Collocations', 'Original Example'),
    row('straightforward', '简单明了的', 'a straightforward solution', 'The logic appears straightforward.'),
    row('impose', '强加；实施', 'impose a limit', 'When time limits are imposed...'),
  ] },
};
let hits = 0;
const fake = http.createServer((req, res) => {
  hits++;
  const body = routes[`${req.method} ${req.url}`];
  res.statusCode = body ? 200 : 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body || { message: 'not found ' + req.url }));
});
await new Promise((r) => fake.listen(0, r));
process.env.NOTION_API_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.SPEAK90_FAKE_LLM = '1';
const { createApp } = await import('../server/index.js');

let server; let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-ielts-'));
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const put = (b) => fetch(base + '/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'ie.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fake.close(); });

test('没填数据库时报错', async () => {
  assert.equal((await post('/ielts/pull')).status, 400);
});

test('导入 ④ Vocabulary（表格和段落两种写法）→ 表达卡（来源雅思、原文例句、搭配、音标），不重复导入', async () => {
  await put({ notionToken: 'secret_x', ieltsDb: 'https://app.notion.com/p/0123456789abcdef0123456789abcdef?v=fedcba9876543210fedcba9876543210' });
  const r = await (await post('/ielts/pull')).json();
  assert.deepEqual(r, { pages: 2, added: 4, shadows: 1, questions: 6 });
  const q = await (await fetch(base + '/cards/today')).json();
  const c = q.cards.find((x) => x.en === 'straightforward');
  assert.ok(c && c.isNew);
  assert.equal(c.zh, '简单明了的');
  assert.equal(c.example, 'The logic appears straightforward.');
  assert.equal(c.note, '搭配：a straightforward solution');
  assert.equal(c.source, '雅思');
  assert.equal(c.scene, '雅思 · Business');
  assert.ok(c.ipa.startsWith('/'));
  const p = q.cards.find((x) => x.en === 'resilient');
  assert.equal(p.zh, '有韧性的；能迅速恢复的');
  assert.equal(p.example, 'The new design makes the network more resilient.');
  assert.equal(p.note, '搭配：resilient system; remain resilient');
  assert.equal(p.scene, '雅思 · Environment');
  assert.ok(q.cards.some((x) => x.en === 'trade-off'));
  const before = hits;
  assert.deepEqual(await (await post('/ielts/pull')).json(), { pages: 0, added: 0, shadows: 0, questions: 0 });
  assert.equal(hits - before, 1); // 只查了列表，没再读页面
});

test('① Listening 原文 → 雅思跟读：含生词的句子优先，按原文顺序，去掉说话人和中文行，不进每日课程', async () => {
  const list = await (await fetch(base + '/shadow')).json();
  const m = list.find((x) => x.source === 'ielts');
  assert.ok(m && !m.locked);
  assert.equal(m.title, '雅思跟读 · Environment');
  assert.equal(m.date, '2026-09-23');
  assert.equal(m.sentences.length, 6);
  assert.ok(m.sentences.every((x) => !/Speaker|中文|Why do the planners/.test(x.en)));
  const withWord = m.sentences.filter((x) => x.zh.startsWith('生词：'));
  assert.deepEqual(withWord.map((x) => x.en), [
    'Many older cities were not built to be resilient.',
    'There is always a trade-off between cost and safety.',
    'A park like this makes the whole area more resilient.',
  ]);
  assert.equal(withWord[1].zh, '生词：trade-off 权衡');
  assert.ok(list.filter((x) => x.source === 'ielts').length === 1); // page-1 原文太短，不生成
  const plan = await (await fetch(base + '/plan/today')).json();
  assert.ok(!JSON.stringify(plan).includes('ielts:'));
});

test('拆句与挑句：缩写不拆开，词尾变化和短语中间隔词都能匹配', async () => {
  const { splitSentences, pickShadowSentences, vocabMatcher } = await import('../server/ielts.js');
  assert.deepEqual(splitSentences(['(Audio script)', 'Man: Dr. Chen moved here in 2019. It cost 3.5 million dollars!', '陈医生 2019 年搬来。']),
    ['Dr. Chen moved here in 2019.', 'It cost 3.5 million dollars!']);
  assert.ok(vocabMatcher('impose').test('Limits were imposed last year.'));
  assert.ok(vocabMatcher('take sth into account').test('We take the weather into account.'));
  assert.equal(vocabMatcher('resilient').test('resistance'), false);
  const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is a plain line here.`);
  text[9] = 'The rules were imposed without any warning.';
  const picked = pickShadowSentences(text, [{ en: 'impose', zh: '强加' }]);
  assert.equal(picked.length, 6);
  assert.equal(picked.at(-1).zh, '生词：impose 强加'); // 按原文顺序，含生词的第 10 句排最后
  assert.equal(pickShadowSentences(['Too short.'], []), null);
});

test('雅思独白：每页 3 个 Part 3 问题进独白话题（带中文、生词提示），不合格的问题丢掉，不进每日课程', async () => {
  const list = await (await fetch(base + '/mono/topics')).json();
  const qs = list.filter((t) => t.source === 'ielts');
  assert.equal(qs.length, 6); // 两页各 3 个，假模型第 4 个「太短」被丢掉
  const env = qs.filter((t) => t.group === 'Environment');
  assert.equal(env.length, 3);
  assert.equal(env[0].date, '2026-09-23');
  assert.ok(env.every((t) => /\?$/.test(t.en) && /[\u4e00-\u9fff]/.test(t.zh)));
  assert.deepEqual(env[0].hints, ['resilient', 'trade-off']);
  assert.ok(list.some((t) => t.source !== 'ielts')); // 日常话题还在
  const plan = await (await fetch(base + '/plan/today')).json();
  assert.ok(!JSON.stringify(plan).includes('ielts:'));
});
