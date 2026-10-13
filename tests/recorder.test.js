// 录音降采样：iPhone 按 48kHz 录，交给 whisper 前转成 16kHz
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downsample } from '../web/src/services/recorder.js';

test('48kHz → 16kHz：长度变为三分之一，按区间取平均', () => {
  const src = new Float32Array(48000).map((_, i) => (i % 3 === 0 ? 0.3 : 0.6));
  const out = downsample(src, 48000, 16000);
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-6);
});

test('44.1kHz 这类非整数倍也能转，采样率相同时原样返回', () => {
  const src = new Float32Array(44100).fill(0.25);
  const out = downsample(src, 44100, 16000);
  assert.equal(out.length, 16000);
  assert.ok(out.every((x) => Math.abs(x - 0.25) < 1e-6));
  assert.equal(downsample(src, 16000, 16000), src);
});
