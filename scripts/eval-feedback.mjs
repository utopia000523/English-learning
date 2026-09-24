// 对话点评评测：用 evals/feedback.json 里的例句跑真实模型，看点评有没有乱改、有没有漏判。
// 用法：node scripts/eval-feedback.mjs [--model qwen2.5:14b] [--runs 3] [--only fix-wechat]
// 改点评提示词（server/roleplay.js 的 judgeLine）前后各跑一次，对比结果。结果另存到 data/evals/。
import fs from 'node:fs';
import path from 'node:path';
import { config, DEFAULT_SETTINGS } from '../server/config.js';
import { judgeLine } from '../server/roleplay.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const model = arg('model', DEFAULT_SETTINGS.llmModel);
const runs = Math.max(1, Number(arg('runs', 1)));
const only = arg('only', '');

const scenes = {};
for (const f of fs.readdirSync(path.join(config.root, 'content')).filter((f) => /^week.*\.json$/.test(f))) {
  for (const s of JSON.parse(fs.readFileSync(path.join(config.root, 'content', f), 'utf8')).scenes || []) scenes[s.id] = s;
}
const { cases } = JSON.parse(fs.readFileSync(path.join(config.root, 'evals', 'feedback.json'), 'utf8'));
const picked = cases.filter((c) => !only || c.id.includes(only));

// 判一次结果：返回 null = 通过，否则是失败原因
function grade(c, fb) {
  if (c.expect === 'ok') return fb.ok ? null : `不该改，却改成「${fb.better}」（${fb.issue_zh}）`;
  if (fb.ok) return '有问题却判为「表达自然」';
  for (const re of c.better_must || []) if (!new RegExp(re, 'i').test(fb.better)) return `改写「${fb.better}」缺少 /${re}/`;
  for (const re of c.better_not || []) if (new RegExp(re, 'i').test(fb.better)) return `改写「${fb.better}」不该出现 /${re}/`;
  if (!fb.issue_zh) return '没有中文说明';
  return null;
}

console.log(`模型 ${model} · ${picked.length} 条 × ${runs} 次\n`);
const results = [];
for (const c of picked) {
  const sc = scenes[c.scene];
  if (!sc) { console.log(`✖ ${c.id}：找不到场景 ${c.scene}`); results.push({ id: c.id, expect: c.expect, pass: 0, fails: ['场景不存在'] }); continue; }
  const fails = [];
  for (let i = 0; i < runs; i++) {
    const fb = await judgeLine(sc, c.ai, c.learner, model);
    const why = grade(c, fb);
    if (why) fails.push(why);
  }
  const pass = runs - fails.length;
  console.log(`${pass === runs ? '✔' : pass ? '△' : '✖'} ${c.id}  ${pass}/${runs}  ${c.learner}`);
  for (const why of [...new Set(fails)]) console.log(`    ${why}`);
  results.push({ id: c.id, expect: c.expect, pass, fails });
}

const sum = (expect) => {
  const rs = results.filter((r) => r.expect === expect);
  return `${rs.reduce((n, r) => n + r.pass, 0)}/${rs.length * runs}`;
};
console.log(`\n该放过的放过了 ${sum('ok')}　该指出的指出了 ${sum('fix')}`);

const out = path.join(config.dataDir, 'evals', `feedback-${model.replace(/[^\w.-]/g, '_')}-${new Date().toISOString().slice(0, 16).replace(/:/g, '')}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model, runs, results }, null, 2));
console.log(`详细结果：${path.relative(config.root, out)}`);
