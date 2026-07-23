#!/usr/bin/env bash
# 把 stillyou 二进制放进插件 bin/。优先取本机已装的，其次从源码 bun 构建。
# ponytail: GitHub Releases 下载通道等仓库发布后再加
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$PLUGIN_ROOT/bin"

if command -v stillyou >/dev/null 2>&1; then
  cp "$(command -v stillyou)" "$PLUGIN_ROOT/bin/stillyou"
elif [ -f "$HOME/.stillyou/bin/stillyou" ]; then
  cp "$HOME/.stillyou/bin/stillyou" "$PLUGIN_ROOT/bin/stillyou"
elif command -v bun >/dev/null 2>&1 && [ -f "$PLUGIN_ROOT/../cli/src/main.ts" ]; then
  bun build --compile "$PLUGIN_ROOT/../cli/src/main.ts" --outfile "$PLUGIN_ROOT/bin/stillyou"
else
  echo "找不到 stillyou 二进制，也没有 bun 可构建。先装 bun（https://bun.sh）再跑一次。" >&2
  exit 1
fi
echo "stillyou 二进制就位：$PLUGIN_ROOT/bin/stillyou"
echo "初始化账本：$PLUGIN_ROOT/bin/stillyou init"
