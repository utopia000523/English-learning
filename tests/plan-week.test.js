process.env.SPEAK90_FAKE_LLM = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/index.js';
import { todayPlan } from '../server/plan.js';
import { updateSettings } from '../server/db.js';

// PRD 第 8 节验收 3：连续 7 天模拟，每种随机模块至少出现 2 次
test('连续 7 天课程：对话 / 跟读 / 独白各至少 2 次（重复模拟 200 次）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-week-'));
  await createApp({ dbFile: path.join(tmp, 'w.db') });
  updateSettings({ startDate: '2026-09-14' }); // 周一
  const days = Array.from({ length: 7 }, (_, i) => `2026-09-${14 + i}`);
  let worst = Infinity;
  for (let r = 0; r < 200; r++) {
    const n = { roleplay: 0, shadow: 0, mono: 0 };
    for (const d of days) for (const s of todayPlan(d).slots) if (s.module in n) n[s.module]++;
    worst = Math.min(worst, ...Object.values(n));
  }
  assert.ok(worst >= 2, `最少的模块只出现了 ${worst} 次`);
});
