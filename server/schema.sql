-- 对应 PRD 6.1。新增字段请写在这里并在 开发进度.md 记录
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS plan_day (
  day_no INTEGER PRIMARY KEY, date TEXT, phase INTEGER, week INTEGER,
  modules TEXT, status TEXT DEFAULT 'todo', minutes_spent INTEGER DEFAULT 0, swapped INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day_no INTEGER, module TEXT,
  started_at TEXT, ended_at TEXT, metrics TEXT
);
CREATE TABLE IF NOT EXISTS card (
  id INTEGER PRIMARY KEY AUTOINCREMENT, en TEXT NOT NULL, zh TEXT, example TEXT,
  source TEXT, scene TEXT, week INTEGER, ease REAL DEFAULT 2.5, interval_days REAL DEFAULT 0,
  due_date TEXT, streak INTEGER DEFAULT 0, mastered INTEGER DEFAULT 0, notion_page_id TEXT,
  content_id TEXT, introduced_at TEXT, reviewed_at TEXT, last_rating INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS recording (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, audio_path TEXT, transcript TEXT,
  words TEXT, wpm REAL, long_pauses INTEGER, fillers INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS roleplay (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scene_id TEXT, messages TEXT, tasks_done TEXT,
  passed INTEGER DEFAULT 0, review TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), ended_at TEXT
);
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY AUTOINCREMENT, en TEXT NOT NULL, zh TEXT, source TEXT, scene TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), starred INTEGER DEFAULT 0,
  synced INTEGER DEFAULT 0, notion_page_id TEXT
);
CREATE TABLE IF NOT EXISTS assessment (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day_no INTEGER, wpm REAL, long_pauses INTEGER,
  fillers INTEGER, summary TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS content_scene (
  id TEXT PRIMARY KEY, week INTEGER, title TEXT, level TEXT, role TEXT, brief TEXT,
  tasks TEXT, hints TEXT, approved INTEGER DEFAULT 0, data TEXT
);
CREATE TABLE IF NOT EXISTS content_item (
  id TEXT PRIMARY KEY, week INTEGER, type TEXT, en TEXT, zh TEXT, extra TEXT, approved INTEGER DEFAULT 0
);
