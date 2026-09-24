// 周复习对话（第 7 天）：用假模型测试，不需要 Ollama
process.env.SPEAK90_FAKE_LLM = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';
import { run, all } from '../server/db.js';
import { pickTargets, usedExpression, advanceStage } from '../server/roleplay.js';
import { todayStr, addDays } from '../server/util/date.js';

const WEEKS = fs.readdirSync(new URL('../content', import.meta.url)).filter((f) => /^week\d+\.json$/.test(f)).length;
const week1 = JSON.parse(fs.readFileSync(new URL('../content/week01.json', import.meta.url), 'utf8'));
const stages = week1.review.stages;

let server; let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-rv-'));
const json = (r) => r.json();
const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

before(async () => {
  const app = await createApp({ dbFile: path.join(tmp, 'rv.db') });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  // 今天 = 第 1 周第 7 天
  await fetch(base + '/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate: addDays(todayStr(), -6) }) });
});
after(() => server.close());

test('每周都有第 7 天的周复习场景，第 7 天解锁', async () => {
  const list = await json(await fetch(base + '/roleplay/scenes'));
  const rv = list.filter((s) => s.level === 'review');
  assert.equal(rv.length, WEEKS);
  assert.ok(rv.every((s) => s.day === 7 && /^w\d\d-review$/.test(s.id)));
  assert.equal(rv.find((s) => s.week === 1).status, 'open');
  assert.equal(rv.find((s) => s.week === 2).status, 'locked');
});

test('目标表达：优先挑没想起、想起但卡的卡', () => {
  const cards = all("SELECT id FROM card WHERE week = 1 AND source = '内置' ORDER BY id");
  const now = todayStr();
  for (const c of cards) run('UPDATE card SET introduced_at = ?, last_rating = 3 WHERE id = ?', [now, c.id]);
  const weak = [cards[40].id, cards[70].id]; const hard = cards[5].id;
  for (const id of weak) run('UPDATE card SET last_rating = 1 WHERE id = ?', [id]);
  run('UPDATE card SET last_rating = 2 WHERE id = ?', [hard]);
  const t = pickTargets(1, stages);
  assert.equal(t.length, 12);
  const ids = t.map((x) => x.cardId);
  for (const id of [...weak, hard]) assert.ok(ids.includes(id), `薄弱卡 ${id} 应被选中`);
  assert.ok(t.every((x) => x.stage >= 0 && x.stage < stages.length));
  // 同样熟练的卡各天轮流取，不挤在一天
  assert.ok(new Set(t.map((x) => x.stage)).size >= 5);
});

test('表达是否用上：整句、关键词、两句卡说中一句', () => {
  assert.ok(usedExpression('How was your trip over?', ['So how was your trip?']));
  assert.ok(usedExpression('Can I get you something to drink? Coffee or tea?', ['Coffee or tea?']));
  assert.ok(usedExpression("Sorry, you're breaking up.", ["sorry you’re breaking up"]));
  assert.ok(!usedExpression('Welcome to Shenzhen!', ['I live in Shenzhen.']));
  assert.ok(!usedExpression("Let's head to the meeting room first.", ['Where is the meeting?']));
  // 常见词不算关键词：只说了 what / today 不算用上
  assert.ok(!usedExpression('What brings you here today?', ['I know what you mean. See you today.']));
  assert.ok(usedExpression('What brings you here today?', ['So what brings you here?']));
  assert.ok(usedExpression('Really?', ['Really? That sounds fun.']));
});

test('分段：当前段任务完成或聊满 3 轮就进入下一段，最后一段不再前进', () => {
  const sc = { stages };
  assert.equal(advanceStage(sc, { stage: 0, stageTurns: 1 }, [1]).stage, 1);
  assert.equal(advanceStage(sc, { stage: 0, stageTurns: 1 }, []).stage, 0);
  assert.deepEqual(advanceStage(sc, { stage: 2, stageTurns: 3 }, []), { stage: 3, stageTurns: 0 });
  assert.equal(advanceStage(sc, { stage: 0, stageTurns: 0 }, [1, 2, 3]).stage, 3);
  assert.equal(advanceStage(sc, { stage: 5, stageTurns: 9 }, [1, 2, 3, 4, 5, 6]).stage, 5);
});

test('周复习对话：开始 → 离开再回来接着聊 → 推进分段 → 复盘统计本周表达', async () => {
  const rp = await json(await post('/roleplay', { sceneId: 'w01-review' }));
  assert.equal(rp.state.targets.length, 12);
  assert.equal(rp.state.stage, 0);
  assert.equal(rp.passTurns, 8);
  const again = await json(await post('/roleplay', { sceneId: 'w01-review' }));
  assert.equal(again.id, rp.id, '当天没结束的周复习对话应接着聊');
  const target = rp.state.targets[0].en;
  let r = await json(await post(`/roleplay/${rp.id}/turn`, { text: target }));
  assert.equal(r.state.stageTurns, 1);
  assert.ok(r.state.targets[0].used);
  r = await json(await post(`/roleplay/${rp.id}/turn`, { text: 'That sounds great.' }));
  assert.ok(r.state.stage >= 1, '假模型第一轮完成了任务 1–4，应进入后面的段');
  const done = await json(await post(`/roleplay/${rp.id}/finish`));
  assert.equal(done.review.targets.total, 12);
  assert.ok(done.review.targets.used >= 1);
  assert.equal(done.review.targets.missed.length, 12 - done.review.targets.used);
  const next = await json(await post('/roleplay', { sceneId: 'w01-review' }));
  assert.notEqual(next.id, rp.id, '结束后再开是新的一场');
});

test('复习日课程：复习卡 → 本周综合对话 20 分钟 → 错句重说', async () => {
  const p = await json(await fetch(base + '/plan/today'));
  assert.equal(p.dayInWeek, 7);
  assert.deepEqual(p.slots.map((s) => s.module), ['cards', 'roleplay', 'review']);
  assert.equal(p.slots[1].sceneId, 'w01-review');
  assert.equal(p.slots[1].label, '本周综合对话');
  assert.equal(p.slots[1].minutes, 20);
});
