import { getSettings } from './db.js';
import * as notion from './services/notion.js';
import { ratioOf } from './plan.js';

let running = false;
export async function autoSync() {
  const s = getSettings();
  if (running || !s.notionAutoSync || !s.notionToken || !s.notionNotesDb) return;
  running = true;
  try { await notion.sync(ratioOf); } catch { /* 断网或出错时下次再试 */ }
  running = false;
}
