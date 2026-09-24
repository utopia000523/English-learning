#!/bin/bash
# 开口 90 天 更新脚本：从 GitHub 拉取最新版，然后启动。
# 用法：在项目目录执行  bash scripts/update.sh          （更新到 master）
#                      bash scripts/update.sh <分支名>  （试用还没合并的分支）
set -e
cd "$(dirname "$0")/.."
BRANCH="${1:-master}"

# 有未提交的修改就停下，不覆盖本地改动（未跟踪文件不算，如 data/ 下的数据）
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "本地有未提交的修改，先处理再更新（暂存：git stash；或提交：git commit -am \"说明\"）："
  git status --short --untracked-files=no
  exit 1
fi

echo "== 拉取最新版（$BRANCH）"
git fetch origin
git switch "$BRANCH"
if ! git pull --ff-only origin "$BRANCH"; then
  echo "本地 $BRANCH 有云端没有的提交，无法自动更新。把上面的输出发给开发者处理。"
  exit 1
fi
echo "   当前版本：$(git log --oneline -1)"

exec bash scripts/start.sh
