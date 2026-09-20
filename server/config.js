import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT || 5173),
  dataDir: process.env.SPEAK90_DATA_DIR || path.join(root, 'data'),
  modelsDir: path.join(root, 'models'),
  distDir: path.join(root, 'dist'),
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
};

// 可在「设置」页修改的默认值（存入 settings 表）
export const DEFAULT_SETTINGS = {
  llmModel: 'qwen2.5:7b',           // Ollama 对话模型，可改为其他 7B–8B 指令模型
  asrModel: 'ggml-small.en.bin',    // whisper.cpp 模型文件名，放在 models/ 下
  ttsVoice: '',                      // 空 = 自动选择系统美音女声
  ttsRate: 1.0,
  dailyMinutes: 30,
  cardsNewPerDay: 30,               // 表达卡：每日新卡上限
  cardsDailyMax: 0,                  // 表达卡：每日总张数上限（复习+新卡），0 = 不限
  practiceDays: [1, 2, 3, 4, 5, 6],  // 周一至周六，周日轻复习
  reminderTime: '21:00',
  startDate: '',                     // 第 1 天的日期，首次测评完成时写入
  notionToken: '',
  notionNotesDb: '',
  notionLogDb: '',
  notionAutoSync: true,
  notionParentPage: '',
  notionLastSync: '',
  ieltsDb: '',                       // 雅思数据库（IELTS Listening Daily）的 ID，从链接里取
  ieltsLastPull: '',
  ieltsPages: [],                    // 已导入过的雅思页面 ID
  audioKeepDays: 30,                 // 录音文件保留天数，0 = 一直保留
};
