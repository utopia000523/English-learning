import { getSettings } from './db.js';
import * as notion from './services/notion.js';
import { ratioOf } from './plan.js';
import * as ielts from './ielts.js';

let running = false;
export async function autoSync() {
  const s = getSettings();
  // 雅思词汇：填了数据库就拉取，和「自动同步」开关无关
  if (s.notionToken && s.ieltsDb) { try { await ielts.pull(); } catch { /* 断网或出错时下次再试 */ } }
  if (running || !s.notionAutoSync || !s.notionToken || !s.notionNotesDb) return;
  running = true;
  try { await notion.sync(ratioOf); } catch { /* 断网或出错时下次再试 */ }
  running = false;
}
