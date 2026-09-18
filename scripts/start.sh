#!/bin/bash
# 开口 90 天 启动脚本（macOS）。用法：在项目目录执行  bash scripts/start.sh
set -e
cd "$(dirname "$0")/.."
PORT=${PORT:-5173}
ask() { read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }

echo "== 检查 Node.js"
if ! command -v node >/dev/null; then
  echo "未安装 Node.js。请到 https://nodejs.org 下载 LTS 版安装，或执行 brew install node，然后重新运行本脚本。"; exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then echo "Node.js 版本过低（当前 $(node -v)，需要 20 以上）"; exit 1; fi

echo "== 安装依赖"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then npm install; touch node_modules; fi

echo "== 检查对话模型（Ollama）"
MODEL=$(node -e "import('./server/db.js').then(async m=>{await m.initDb();console.log(m.getSettings().llmModel)})" 2>/dev/null || echo "qwen2.5:7b")
if ! command -v ollama >/dev/null; then
  echo "  未安装 Ollama：请到 https://ollama.com 下载安装并打开。AI 对话/改写在此之前不可用。"
elif ! curl -s http://127.0.0.1:11434/api/tags >/dev/null; then
  echo "  Ollama 未运行：请打开 Ollama 应用后重试。"
elif ! ollama list | awk '{print $1}' | grep -qx "$MODEL\|$MODEL:latest"; then
  if ask "  未下载模型 $MODEL（约 5GB），现在下载？"; then ollama pull "$MODEL"; fi
else echo "  已就绪：$MODEL"; fi

echo "== 检查语音识别（whisper.cpp）"
if ! command -v whisper-cli >/dev/null && ! command -v whisper-cpp >/dev/null; then
  echo "  未安装 whisper.cpp：执行 brew install whisper-cpp（跟读/独白/语音输入需要，阶段 4 起使用）"
fi
mkdir -p models
if [ ! -f models/ggml-small.en.bin ]; then
  if ask "  未下载语音识别模型 small.en（约 466MB），现在下载？"; then
    curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
  fi
fi

echo "== 构建页面"
if [ ! -f dist/index.html ] || [ -n "$(find web package.json -newer dist/index.html -type f 2>/dev/null | head -1)" ]; then npm run build; fi

echo "== 启动：http://localhost:$PORT"
(sleep 1.5 && open "http://localhost:$PORT") &
PORT=$PORT node server/index.js
