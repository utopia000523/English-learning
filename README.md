# 开口 90 天（Speak90）

本地运行的英语口语练习工具：AI 情景对话、表达卡、跟读、独白，90 天计划。所有练习能力在本机运行，只有 Notion 同步需要联网。

## 使用（macOS）

```bash
bash scripts/start.sh
```

首次运行会检查并提示安装：Node.js 20+、Ollama 及对话模型、whisper.cpp 及语音识别模型。然后自动打开 http://localhost:5173 。

## 给接手开发者（WorkBuddy 等）

**开始前必读，按顺序：**

1. `开发进度.md`：当前做到哪一步、下一步做什么、已知问题。**以它为准继续。**
2. `docs/PRD.md`：需求文档（规则、数据、验收标准）。
3. `docs/prototype.html`：界面原型，浏览器直接打开。视觉和交互以它为准。

**开发约定：**

- 按 `开发进度.md` 里的阶段顺序开发，每完成一个阶段：程序能跑、`npm test` 通过、更新 `开发进度.md`、`git commit`。
- AI 能力只通过 `server/services/` 下的统一接口调用（`llm` / `asr` / `score` / `notion`），页面和路由里不要直接调用 Ollama 或 whisper。
- 朗读在浏览器端：`web/src/services/tts.js`（Web Speech API + macOS 系统声音）。
- 数据库结构改动写在 `server/schema.sql`（只加表/加字段，不删），并在 `开发进度.md` 记录。
- 样式在 `web/src/styles.css`，来自原型，保持一致。不要引入其他 UI 框架。
- 不要提交 `node_modules/`、`dist/`、`data/*.db`、`models/*.bin`。

**常用命令：**

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发模式（页面 5173，接口 5180，热更新） |
| `npm run build` | 构建页面到 `dist/` |
| `npm start` | 正式运行（5173 同时提供页面和接口） |
| `npm test` | 运行接口测试 |

**目录：**

```
server/            本地服务（Express）
  config.js        路径、端口、默认设置
  db.js            SQLite（sql.js，纯 JS，无需编译）
  schema.sql       表结构（PRD 6.1）
  routes/api.js    接口
  services/        llm / asr / score / notion 统一接口
web/               前端（React + Vite）
  src/pages/       各页面
  src/services/    api.js 请求封装、tts.js 朗读
scripts/start.sh   启动脚本（阶段 6 增加 uninstall.sh）
tests/             接口测试（node --test）
data/              本地数据库和录音（不提交）
models/            语音识别模型（不提交）
docs/              PRD 与原型
```
