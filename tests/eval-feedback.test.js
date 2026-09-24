import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'evals/feedback.json'), 'utf8'));

test('点评评测集：id 不重复、场景存在、正则能编译', () => {
  const sceneIds = new Set(fs.readdirSync(path.join(root, 'content')).filter((f) => /^week.*\.json$/.test(f))
    .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(root, 'content', f), 'utf8')).scenes || []).map((s) => s.id)));
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  for (const c of cases) {
    assert.ok(sceneIds.has(c.scene), `${c.id} 的场景 ${c.scene} 不存在`);
    assert.ok(['ok', 'fix'].includes(c.expect), c.id);
    for (const re of [...(c.better_must || []), ...(c.better_not || [])]) new RegExp(re, 'i');
  }
});

test('评测脚本能跑完（假模型）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-eval-'));
  const out = execFileSync(process.execPath, ['scripts/eval-feedback.mjs', '--only', 'fix-am-work'], {
    cwd: root, env: { ...process.env, SPEAK90_FAKE_LLM: '1', SPEAK90_DATA_DIR: tmp }, encoding: 'utf8',
  });
  assert.match(out, /该指出的指出了 \d+\/1/);
  assert.equal(fs.readdirSync(path.join(tmp, 'evals')).length, 1);
});
