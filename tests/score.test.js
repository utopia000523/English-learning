import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, fluency, mergeFluency } from '../server/services/score.js';

const W = (list) => list.map(([word, start, end, prob = 0.9]) => ({ word, start, end, prob }));

test('逐词对齐：读对、不确定、漏读、读错', () => {
  const r = align('Could I get that with oat milk instead?', W([
    ['Could', 0, 200], ['I', 200, 300], ['get', 300, 500], ['that', 500, 700, 0.3], ['oak', 800, 1000], ['milk', 1000, 1200], ['instead', 1200, 1600],
  ]));
  assert.deepEqual(r.align.map((w) => w.status), ['ok', 'ok', 'ok', 'unsure', 'missed', 'wrong', 'ok', 'ok']);
  assert.deepEqual(r.missed, ['with']);
  assert.equal(r.wrong[0].heard, 'oak');
  assert.equal(r.completeness, 75);
});

test('忽略大小写和标点、多说的词', () => {
  const r = align("Hi, I'm Utopia.", W([['hi', 0, 100], ['um', 100, 200], ["I'm", 200, 300], ['utopia', 300, 600]]));
  assert.equal(r.completeness, 100);
});

test("缩写：I'm 与 I am 视为相同", () => {
  const r = align("Hi, I'm Utopia.", W([['Hi', 0, 100], ['I', 100, 200], ['am', 200, 300], ['Utopia', 300, 600]]));
  assert.equal(r.completeness, 100);
  assert.equal(r.align.length, 3);
});

test('流利度：语速、长停顿、口头禅', () => {
  const f = fluency(W([['I', 0, 200], ['um', 300, 500], ['went', 3000, 3300], ['home', 3400, 6000]]));
  assert.equal(f.longPauses, 1);
  assert.equal(f.fillers, 1);
  assert.equal(f.words, 3);
  assert.equal(f.wpm, 30);
  assert.equal(mergeFluency([f, fluency([])]).segments, 1);
});
