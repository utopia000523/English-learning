// SQLite（sql.js，纯 WebAssembly，无需编译原生模块）。数据保存为 data/speak90.db 单文件
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { config, DEFAULT_SETTINGS } from './config.js';
import { todayStr } from './util/date.js';

const require = createRequire(import.meta.url);
let db;
let dbFile;
let saveTimer;

export async function initDb(file = path.join(config.dataDir, 'speak90.db')) {
  const SQL = await initSqlJs({ locateFile: (f) => require.resolve(`sql.js/dist/${f}`) });
  dbFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db = open(SQL, schema);
  backupDb(); // 每天第一次启动留一份（迁移之前的状态）
  migrate();
  saveNow();
  return db;
}

// 打开数据库；文件损坏时改名保留，并从最近一份备份恢复（没有备份就新建）
function open(SQL, schema) {
  const load = (buf) => { const d = buf ? new SQL.Database(buf) : new SQL.Database(); d.run(schema); return d; };
  if (!fs.existsSync(dbFile)) return load();
  try {
    return load(fs.readFileSync(dbFile));
  } catch (e) {
    const bad = `${dbFile}.corrupt-${Date.now()}`;
    fs.renameSync(dbFile, bad);
    const latest = backupFiles().at(-1);
    console.warn(`数据库文件无法读取（${e.message}），已改名为 ${path.basename(bad)}。` +
      (latest ? `已从备份 ${latest} 恢复。` : '没有可用备份，已新建空数据库。'));
    return latest ? load(fs.readFileSync(path.join(backupDir(), latest))) : load();
  }
}

// ---- 备份：data/backups/speak90-YYYY-MM-DD.db，每天一份，保留最近 keep 份 ----
const backupDir = () => path.join(path.dirname(dbFile), 'backups');
const backupFiles = () => (fs.existsSync(backupDir()) ? fs.readdirSync(backupDir()) : [])
  .filter((f) => /^speak90-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();

export function backupDb(keep = 7) {
  if (!db || !dbFile) return null;
  fs.mkdirSync(backupDir(), { recursive: true });
  const target = path.join(backupDir(), `speak90-${todayStr()}.db`);
  if (!fs.existsSync(target)) writeAtomic(target, Buffer.from(db.export()));
  for (const f of backupFiles().slice(0, -keep)) fs.unlinkSync(path.join(backupDir(), f));
  return target;
}

// 先写临时文件再改名替换：写到一半断电或崩溃，原文件仍然完好
function writeAtomic(file, buf) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

// 已有数据库的增量字段（新库在 schema.sql 里也有）。只加不删
const COLUMNS = {
  card: ['content_id TEXT', 'introduced_at TEXT', 'reviewed_at TEXT', 'last_rating INTEGER', 'day INTEGER DEFAULT 1', 'note TEXT'],
  content_scene: ['data TEXT', 'day INTEGER DEFAULT 1'],
  content_item: ['day INTEGER DEFAULT 1'],
  roleplay: ['ended_at TEXT', 'feedback TEXT', 'state TEXT'],
  note: ['context TEXT', 'detail TEXT'],
  plan_day: ['cards_target INTEGER DEFAULT 0', 'wrap_done INTEGER DEFAULT 0'],
};
function migrate() {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = all(`PRAGMA table_info(${table})`).map((r) => r.name);
    for (const def of cols) if (!have.includes(def.split(' ')[0])) db.run(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  }
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
export const get = (sql, params = []) => all(sql, params)[0];
export function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
  return { lastId: get('SELECT last_insert_rowid() AS id').id };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
export function saveNow() {
  if (db && dbFile) writeAtomic(dbFile, Buffer.from(db.export()));
}

// ---- 设置 ----
export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = JSON.parse(r.value);
  return s;
}
export function updateSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
  }
  return getSettings();
}
