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

echo "== 手机访问（Tailscale）"
# 手机浏览器要 https 才能录音：用 Tailscale 把 https://<这台 Mac>.ts.net 转发到本机服务，只有同一账号下的设备能访问
TS=$(command -v tailscale || true)
if [ -z "$TS" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; fi
if [ -z "$TS" ]; then
  echo "  未安装 Tailscale（只在电脑上用可以忽略）。想用手机练：见 README「在手机上使用」。"
else
  TS_INFO=$("$TS" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const host=(j.Self&&j.Self.DNSName||"").replace(/\.$/,"");console.log(j.BackendState==="Running"&&host?host+" "+((j.CertDomains||[]).length?"https":"nohttps"):"")}catch(e){console.log("")}})')
  TS_HOST=${TS_INFO% *}
  if [ -z "$TS_INFO" ]; then
    echo "  Tailscale 没有登录或没有连接：打开 Tailscale 登录后，重新运行本脚本。"
  elif [ "${TS_INFO#* }" != "https" ]; then
    echo "  还没开启 HTTPS 证书：打开 https://login.tailscale.com/admin/dns ，启用 MagicDNS 和 HTTPS Certificates，再重新运行本脚本。"
  elif "$TS" serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    echo "  手机打开：https://$TS_HOST （手机装 Tailscale 并登录同一账号；Safari 打开后「分享 → 添加到主屏幕」）"
  else
    echo "  开启 https 转发失败：手动执行 $TS serve --bg --https=443 http://127.0.0.1:$PORT 查看原因。"
  fi
fi

echo "== 启动：http://localhost:$PORT"
(sleep 1.5 && open "http://localhost:$PORT") &
# 服务运行期间不让 Mac 闲置休眠（手机才连得上）；合上盖子仍会休眠
if command -v caffeinate >/dev/null; then PORT=$PORT exec caffeinate -i node server/index.js; fi
PORT=$PORT node server/index.js
