// 对话点评的代码兜底（roleplay.js guardFeedback）：压住模型反复出现的两类误判
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardFeedback } from '../server/roleplay.js';

const fb = (better) => ({ ok: false, better, issue_zh: '模型给的说明', zh: '模型给的中文' });

test('This is + 名字被改成 I\'m：改回 This is；只剩标点、连词差别时算没问题', () => {
  assert.deepEqual(guardFeedback("Yes, I can hear you. This is Alex, I'm in charge of the product.",
    fb("Yes, I can hear you. I'm Alex, and I'm in charge of the product.")), { ok: true });
  assert.deepEqual(guardFeedback("This is alex I'm in charge of the product。", fb("I'm Alex. I'm in charge of the product.")), { ok: true });
  assert.deepEqual(guardFeedback('This is Alex speaking.', fb('My name is Alex, speaking.')), { ok: true });
  // 别处真有错：保留修改，但自我介绍仍用 This is
  const r = guardFeedback('This is Alex, I charge the product.', fb("I'm Alex, and I'm in charge of the product."));
  assert.equal(r.ok, false);
  assert.equal(r.better, "This is Alex, and I'm in charge of the product.");
  assert.equal(r.issue_zh, '模型给的说明');
});

test('用户名写成 reach me at：换成留微信号的说法；电话、邮箱不动', () => {
  const r = guardFeedback('Please address me at alex123.', fb('You can reach me at alex123.'));
  assert.equal(r.ok, false);
  assert.equal(r.better, 'You can add me on WeChat. My WeChat ID is alex123.');
  assert.match(r.issue_zh, /WeChat ID/);
  assert.equal(r.zh, '加我微信吧，我的微信号是 alex123。');
  assert.equal(guardFeedback('Please address me at alex123.', fb('Contact me at alex123 on WeChat.')).better, 'Add me on WeChat. My WeChat ID is alex123.');
  assert.equal(guardFeedback('call me 13800138000', fb('You can reach me at 13800138000.')).better, 'You can reach me at 13800138000.');
  assert.equal(guardFeedback('email me', fb('You can reach me at alex@example.com.')).better, 'You can reach me at alex@example.com.');
});

test('其他正常的修改不受影响', () => {
  assert.deepEqual(guardFeedback('I go to school yesterday.', fb('I went to school yesterday.')), fb('I went to school yesterday.'));
  assert.deepEqual(guardFeedback('Nice to meet you', fb('Nice to meet you.')), { ok: true });
});
