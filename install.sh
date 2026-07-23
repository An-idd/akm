#!/bin/sh
# stillyou 一键安装：curl -fsSL https://raw.githubusercontent.com/An-idd/stillyou/main/install.sh | sh
set -e
REPO="An-idd/stillyou"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  T=darwin-arm64 ;;
  Darwin-x86_64) T=darwin-x64 ;;
  Linux-x86_64)  T=linux-x64 ;;
  *) echo "暂不支持该平台: $(uname -s) $(uname -m)（可从源码构建，见 README）"; exit 1 ;;
esac
DIR="${STILLYOU_INSTALL_DIR:-$HOME/.stillyou/bin}"
mkdir -p "$DIR"
echo "下载 stillyou ($T)…"
curl -fsSL "https://github.com/$REPO/releases/latest/download/stillyou-$T" -o "$DIR/stillyou"
chmod +x "$DIR/stillyou"
"$DIR/stillyou" version
echo
echo "✅ 已安装：$DIR/stillyou"
echo "下一步：$DIR/stillyou init    # 选账本位置 + 注册 hooks，完成"
echo "（可选）加入 PATH：export PATH=\"$DIR:\$PATH\""
