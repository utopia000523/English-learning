// 音标（美式 IPA）：本地词典 server/data/ipa_en_US.txt（open-dict-data/ipa-dict，MIT），离线查询
import fs from 'node:fs';

let dict = null;
function load() {
  if (dict) return dict;
  dict = new Map();
  const file = new URL('../data/ipa_en_US.txt', import.meta.url);
  if (!fs.existsSync(file)) return dict;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [w, ipa] = line.split('\t');
    if (!w || !ipa) continue;
    // 取第一种读音；换成常见词典写法（ɹ→r，ɫ→l）
    const first = ipa.split(',')[0].trim().replace(/^\/|\/$/g, '').replace(/ɹ/g, 'r').replace(/ɫ/g, 'l');
    if (!dict.has(w.toLowerCase())) dict.set(w.toLowerCase(), first);
  }
  return dict;
}

/** 单词或短语的音标，如 "hectic" → "/ˈhɛktɪk/"；查不到的词返回 null */
export function ipaOf(text) {
  const d = load();
  const words = String(text).toLowerCase().replace(/[’]/g, "'").split(/\s+/).map((w) => w.replace(/^[^a-z']+|[^a-z']+$/g, '')).filter(Boolean);
  if (!words.length || words.length > 6) return null;
  const parts = words.map((w) => d.get(w) || d.get(w.replace(/'s$/, '')));
  if (parts.some((p) => !p)) return null;
  return `/${parts.join(' ')}/`;
}
