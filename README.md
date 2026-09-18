# 开口 90 天（Speak90）

本地运行的英语口语练习工具：AI 情景对话、表达卡、跟读、独白，90 天计划。所有练习能力在本机运行，只有 Notion 同步需要联网。

## 使用（macOS）

```bash
bash scripts/start.sh
```

首次运行会检查并提示安装：Node.js 20+、Ollama 及对话模型、whisper.cpp 及语音识别模型。然后自动打开 http://localhost:5173 。

## 如何添加学习内容

所有内置内容都在 **`content/`** 文件夹，一周一个文件。改完后**重新运行 `bash scripts/start.sh`** 即自动导入，已学过的卡片进度不受影响。

**文件命名：**必须以 `week` + 周数开头、`.json` 结尾，例如：

| 文件名 | 作用 |
|---|---|
| `week01.json` | 第 1 周的主内容 |
| `week04.json` | 新增第 4 周（到第 4 周才会出新卡） |
| `week03-work.json` | 给第 3 周追加一批卡片（比如工作主题），与 week03 一起出 |

周数决定**什么时候开始出这批新卡**：第 N 周的卡在学习计划进入第 N 周后才会出现。想马上就学，就写成当前周或更早的周数。

**表达卡格式**（复制已有文件改最方便）：

```json
{
  "week": 3,
  "theme": "工作寒暄",
  "reviewed": false,
  "items": [
    { "id": "w03-work-c01", "type": "card", "zh": "我来介绍一下我们的产品。", "en": "Let me walk you through our product.", "example": "Let me give you a quick overview." }
  ]
}
```

- `id`：全局唯一，不能和其他文件重复；**已导入的卡不要改 id**，否则会当成新卡。
- `zh` 正面中文，`en` 背面英文，`example` 显示在「也可以」一行（另一种说法），可留空。
- `theme` 显示在卡片左上角。
- 修改已有卡片的文字：直接改 JSON，只会同步到还没学过的卡。

**AI 对话场景**写在同一个文件的 `scenes` 数组里，格式见 `content/week01.json`。

**也可以让 AI 帮你写：**把上面的格式和主题（比如"展厅接待外宾，30 张"）发给 Claude 或 WorkBuddy，让它生成 JSON 文件放进 `content/`。

**音标数据：**`server/data/ipa_en_US.txt` 来自 [open-dict-data/ipa-dict](https://github.com/open-dict-data/ipa-dict)（MIT），用于笔记本和划词显示美式音标。

**暂不支持：**不按周解锁的「自选卡组」（单独每日额度、可暂停），已记入 `开发进度.md` 待办。

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
