#!/bin/bash
# 开口 90 天 一键卸载（PRD 3.11）
# 用法：在项目文件夹运行  bash scripts/uninstall.sh          正式卸载（每一步都会先问你）
#                         bash scripts/uninstall.sh --dry-run 只列出会删除什么，不删除
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
ask() { [ $DRY = 1 ] && return 1; read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }
size() { [ -e "$1" ] && du -sh "$1" 2>/dev/null | cut -f1 || echo "不存在"; }
run() { if [ $DRY = 1 ]; then echo "  （演示）$*"; else "$@"; fi; }

echo "== 开口 90 天 · 卸载"
[ $DRY = 1 ] && echo "（--dry-run 模式：只列出，不会删除任何东西）"
echo
echo "将从这台电脑删除以下内容："
echo "  1. 学习数据（表达卡、笔记、练习记录、录音） data/          $(size data)"
echo "  2. 语音识别模型                               models/        $(size models)"
echo "  3. 程序依赖和构建文件                         node_modules/ dist/  $(size node_modules) / $(size dist)"
echo "  另外会逐项询问：Ollama 里的模型、Ollama 本身、whisper.cpp、整个项目文件夹（代码）。"
echo
echo "不会删除："
echo "  · Notion 里已同步的数据（如需清除，请在 Notion 里手动删除「口语笔记」「每日练习记录」）"
echo "  · macOS 系统朗读声音（如需删除：系统设置 → 辅助功能 → 朗读内容 → 管理声音）"
echo

# 1) 先导出备份
if [ -d node_modules ] && [ -f data/speak90.db ]; then
  if ask "删除前先把学习数据导出到「下载」文件夹备份？（推荐）"; then
    OUT="$HOME/Downloads/speak90-backup-$(date +%Y%m%d-%H%M).json"
    node --input-type=module -e "
      const db = await import('$ROOT/server/db.js'); await db.initDb();
      const { exportAll } = await import('$ROOT/server/maintenance.js');
      (await import('node:fs')).writeFileSync('$OUT', JSON.stringify(exportAll(), null, 1));
    " && echo "  已导出：$OUT"
  fi
fi

if [ $DRY = 0 ]; then
  read -r -p "确认删除上面 1–3 项？请输入「删除」两个字确认：" c
  [ "$c" = "删除" ] || { echo "已取消，没有删除任何东西。"; exit 0; }
fi

# 停止正在运行的本地服务
PIDS=$(lsof -ti tcp:${PORT:-5173} -sTCP:LISTEN 2>/dev/null); [ -n "$PIDS" ] && [ $DRY = 0 ] && kill $PIDS && echo "  已停止本地服务"

echo "== 删除学习数据、模型和依赖"
run rm -rf "$ROOT/data" "$ROOT/models" "$ROOT/node_modules" "$ROOT/dist"

# 2) Ollama 模型
if command -v ollama >/dev/null; then
  echo "== Ollama 里的模型（可能也被其他软件使用，逐个确认）"
  ollama list 2>/dev/null | awk 'NR>1 {print $1, $3, $4}' | while read -r name sz unit; do
    [ -z "$name" ] && continue
    echo "  $name（$sz $unit）"
    if ask "  删除 $name？" </dev/tty; then run ollama rm "$name"; fi
  done
  if ask "卸载 Ollama 应用本身？（删除 /Applications/Ollama.app 和 ~/.ollama）"; then
    pkill -x Ollama 2>/dev/null
    run rm -rf /Applications/Ollama.app "$HOME/.ollama"
  fi
fi

# 3) whisper.cpp
if command -v brew >/dev/null && brew list whisper-cpp >/dev/null 2>&1; then
  if ask "卸载 whisper.cpp（brew uninstall whisper-cpp）？"; then run brew uninstall whisper-cpp; fi
fi

# 4) 项目文件夹
if ask "删除整个项目文件夹（包括代码、文档）$ROOT？"; then
  cd .. && run rm -rf "$ROOT" && echo "  已删除项目文件夹"
fi

echo
echo "== 完成"
echo "Notion 里的数据和系统朗读声音没有删除，需要的话请手动处理。"
