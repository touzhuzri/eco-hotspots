#!/usr/bin/env bash
# 世界树 · 离线启动器
#
# 优先使用系统 Node >= 18；否则自动解压包内 Node 22.14.0 到 .runtime/node。
# 然后交给 start.sh。
#
# 用法：
#   ./install-offline.sh            # 前台启动（面板推荐）
#   ./install-offline.sh daemon     # 后台启动
#   ./install-offline.sh stop
#   ./install-offline.sh status
#   ./install-offline.sh restart
#
# 可选：
#   SITE_PORT=41018 ./install-offline.sh
#   CLAIM_FILE=/var/lib/eco-hotspots/claims.jsonl ./install-offline.sh
#   USE_BUNDLED_NODE=1 ./install-offline.sh    # 强制使用包内 Node

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

ACTION="${1:-start}"

chmod +x start.sh deploy/preflight.sh 2>/dev/null || true

# stop 不依赖 Node，直接交给 start.sh
if [ "$ACTION" = "stop" ]; then
  exec "$ROOT/start.sh" stop
fi

need_bundled=1
if [ "${USE_BUNDLED_NODE:-0}" != "1" ] && command -v node >/dev/null 2>&1; then
  ver="$(node -v 2>/dev/null | sed 's/^v//')"
  major="${ver%%.*}"
  if [ -n "$major" ] && [ "$major" -ge 18 ] 2>/dev/null; then
    need_bundled=0
    info "使用系统 Node：$(command -v node) ($(node -v))"
  fi
fi

if [ "$need_bundled" = "1" ]; then
  ARCH="$(uname -m 2>/dev/null || echo unknown)"
  case "$ARCH" in
    x86_64|amd64)
      NODE_TGZ="$ROOT/runtime/node-v22.14.0-linux-x64.tar.gz"
      ;;
    aarch64|arm64)
      NODE_TGZ="$ROOT/runtime/node-v22.14.0-linux-arm64.tar.gz"
      ;;
    *)
      die "不支持的 CPU 架构：$ARCH；请安装 Node 18+ 后重试"
      ;;
  esac

  [ -f "$NODE_TGZ" ] || die "缺少包内 Node：$NODE_TGZ"
  command -v tar >/dev/null 2>&1 \
    || die "缺少 tar，无法解压包内 Node。请安装 Node 18+，或在电脑上解压 runtime 后上传 .runtime/node"

  NODE_DIR="$ROOT/.runtime/node"
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    info "正在解压包内 Node 22.14.0（$ARCH）……"
    mkdir -p "$NODE_DIR"
    tar -xzf "$NODE_TGZ" -C "$NODE_DIR" --strip-components=1
  fi
  export PATH="$NODE_DIR/bin:$PATH"
  info "使用包内 Node：$(node -v)"
fi

# 基本文件检查
[ -f "$ROOT/start.sh" ] || die "缺少 start.sh"
[ -f "$ROOT/deploy/site-server.mjs" ] || die "缺少 deploy/site-server.mjs"
[ -f "$ROOT/deploy/claim-server.mjs" ] || die "缺少 deploy/claim-server.mjs"
[ -f "$ROOT/data/curated/lotus-eco.json" ] || die "缺少 data/curated/lotus-eco.json"

if [ -z "${CLAIM_FILE:-}" ]; then
  info "提示：使用默认账本 $ROOT/claims.jsonl；长期部署建议用 CLAIM_FILE 指向独立可备份目录。"
fi

if [ -z "${SITE_PORT:-}" ] && [ -n "${PORT:-}" ]; then
  info "检测到面板 PORT=$PORT；start.sh 会使用它。"
fi

info "启动参数：SITE_PORT=${SITE_PORT:-${PORT:-${SERVER_PORT:-5173}}} CLAIM_FILE=${CLAIM_FILE:-$ROOT/claims.jsonl}"
exec "$ROOT/start.sh" "$ACTION"
