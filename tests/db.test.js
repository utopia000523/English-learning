import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speak90-db-'));
process.env.SPEAK90_DATA_DIR = tmp;
const { initDb, saveNow, backupDb, updateSettings, getSettings } = await import('../server/db.js');
const { todayStr } = await import('../server/util/date.js');

const file = path.join(tmp, 'db.db');
const backups = path.join(tmp, 'backups');
const today = path.join(backups, `speak90-${todayStr()}.db`);

test('启动时留当天备份，保存不留临时文件', async () => {
  await initDb(file);
  saveNow();
  assert.ok(fs.existsSync(file) && fs.existsSync(today));
  assert.ok(!fs.existsSync(file + '.tmp'));
});

test('备份只保留最近 7 份', () => {
  for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(backups, `speak90-2020-01-0${i}.db`), 'x');
  backupDb(7);
  const left = fs.readdirSync(backups).sort();
  assert.equal(left.length, 7);
  assert.equal(left.at(-1), path.basename(today));
  assert.ok(!left.includes('speak90-2020-01-01.db'));
});

test('数据库文件损坏：改名保留，并从最近的备份恢复', async () => {
  updateSettings({ dailyMinutes: 45 });
  fs.unlinkSync(today);
  backupDb();
  fs.writeFileSync(file, 'this is not a database, just garbage bytes '.repeat(200));
  await initDb(file);
  assert.equal(getSettings().dailyMinutes, 45);
  assert.ok(fs.readdirSync(tmp).some((f) => f.startsWith('db.db.corrupt-')));
});
