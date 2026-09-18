// SQLite（sql.js，纯 WebAssembly，无需编译原生模块）。数据保存为 data/speak90.db 单文件
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { config, DEFAULT_SETTINGS } from './config.js';

const require = createRequire(import.meta.url);
let db;
let dbFile;
let saveTimer;

export async function initDb(file = path.join(config.dataDir, 'speak90.db')) {
  const SQL = await initSqlJs({ locateFile: (f) => require.resolve(`sql.js/dist/${f}`) });
  dbFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db.run(schema);
  migrate();
  saveNow();
  return db;
}

// 已有数据库的增量字段（新库在 schema.sql 里也有）。只加不删
const COLUMNS = {
  card: ['content_id TEXT', 'introduced_at TEXT', 'reviewed_at TEXT', 'last_rating INTEGER'],
  content_scene: ['data TEXT'],
  roleplay: ['ended_at TEXT', 'feedback TEXT'],
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
  if (db && dbFile) fs.writeFileSync(dbFile, Buffer.from(db.export()));
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
