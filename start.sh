#!/usr/bin/env bash
# 世界树 · 一键启动（可领养版本）
#
# 面板/容器（推荐）：
#   ./start.sh            前台运行，进程不退出
#
# 后台：
#   ./start.sh daemon     启动后返回
#
# 其他：
#   ./start.sh status
#   ./start.sh stop
#   ./start.sh restart
#
# 公开端口只有一个：SITE_PORT（默认 5173；面板若设置 $PORT 则优先使用 $PORT）。
# 领养 API 由 deploy/site-server.mjs 在同源 /api 反向代理到内部的 8788，
# 不需要额外暴露 8788。前端在 localhost:5173 开发时仍会直连 8788。
#
# 可用环境变量：
#   SITE_PORT=5173          公开站点端口
#   CLAIM_PORT=8788         内部领养服务端口
#   BIND_HOST=0.0.0.0        站点绑定地址
#   CLAIM_HOST=127.0.0.1     领养服务绑定地址（内部）
#   CLAIM_FILE=./claims.jsonl
#   ALLOW_ORIGIN=*
#
# Node 环境：优先使用 mise（项目 .mise.toml 指定 22.14.0），
# 若 shim 未配置版本会自动尝试 `mise install` 并重新进入脚本。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SITE_PORT="${SITE_PORT:-${PORT:-${SERVER_PORT:-5173}}}"
CLAIM_PORT="${CLAIM_PORT:-8788}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
CLAIM_HOST="${CLAIM_HOST:-127.0.0.1}"
CLAIM_FILE="${CLAIM_FILE:-$ROOT/claims.jsonl}"
ALLOW_ORIGIN="${ALLOW_ORIGIN:-*}"
ACTION="${1:-start}"

RUN_DIR="$ROOT/.run"
LOG_DIR="$ROOT/logs"
SITE_PID_FILE="$RUN_DIR/site.pid"
CLAIM_PID_FILE="$RUN_DIR/claim.pid"
SITE_LOG="$LOG_DIR/site.log"
CLAIM_LOG="$LOG_DIR/claim.log"

STARTED_SITE=0
STARTED_CLAIM=0

mkdir -p "$RUN_DIR" "$LOG_DIR"

info() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

is_alive() {
  local f="$1" pid
  [ -f "$f" ] || return 1
  pid="$(cat "$f" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

pid_of() {
  [ -f "$1" ] && cat "$1" 2>/dev/null || true
}

stop_one() {
  local name="$1" f="$2" pid
  if ! is_alive "$f"; then
    rm -f "$f"
    info "$name：未运行"
    return 0
  fi
  pid="$(cat "$f")"
  info "$name：停止 PID $pid"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    info "$name：仍在运行，强制结束"
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$f"
}

stop_all() {
  stop_one "领养服务" "$CLAIM_PID_FILE"
  stop_one "静态站点" "$SITE_PID_FILE"
}

local_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$ip" ] || ip="127.0.0.1"
  printf '%s' "$ip"
}

port_free() {
  # 连接探测；Windows 上重复 bind 会误判，容器/Linux 也统一用这种方式
  node -e '
    const net = require("node:net");
    const port = Number(process.argv[1]);
    const s = net.connect({ port, host: "127.0.0.1" });
    s.setTimeout(500);
    s.once("connect", () => { s.destroy(); process.exit(1); });
    s.once("timeout", () => { s.destroy(); process.exit(0); });
    s.once("error", () => process.exit(0));
  ' "$1" >/dev/null 2>&1
}

wait_http() {
  local url="$1" tries="${2:-80}"
  for ((i = 0; i < tries; i++)); do
    if node -e '
      fetch(process.argv[1], { signal: AbortSignal.timeout(1500) })
        .then((r) => process.exit(r.ok ? 0 : 1))
        .catch(() => process.exit(1));
    ' "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

show_status() {
  local ip claim_url site_url
  ip="$(local_ip)"
  claim_url="http://127.0.0.1:$SITE_PORT/api/claim/health"
  site_url="http://127.0.0.1:$SITE_PORT/"
  if is_alive "$SITE_PID_FILE"; then
    info "静态站点：运行中  PID $(pid_of "$SITE_PID_FILE")  http://$ip:$SITE_PORT/"
  elif wait_http "$site_url" 1; then
    info "静态站点：运行中（非本脚本启动）  http://$ip:$SITE_PORT/"
  else
    info "静态站点：未运行"
  fi
  if wait_http "$claim_url" 1; then
    info "领养服务：可用（同源 /api）  http://$ip:$SITE_PORT/api/claim/health"
  elif is_alive "$CLAIM_PID_FILE"; then
    info "领养服务：进程在运行但健康检查失败（检查 logs/claim.log）"
  else
    info "领养服务：不可用"
  fi
}

resolve_node() {
  if node -v >/dev/null 2>&1; then return 0; fi


  local c d
  for c in \
    "$HOME"/.local/share/mise/installs/node/*/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    /usr/local/bin/node \
    /usr/bin/node; do
    [ -x "$c" ] || continue
    if "$c" -v >/dev/null 2>&1; then
      d="$(dirname "$c")"
      PATH="$d:$PATH"
      export PATH
      info "使用 Node：$c ($("$c" -v))"
      return 0
    fi
  done

  if command -v mise >/dev/null 2>&1; then
    info "Node 未就绪，尝试通过 mise 准备 Node 22.14.0 ……"
    mise trust >/dev/null 2>&1 || true
    mise install node@22.14.0 >/dev/null 2>&1 || true
    hash -r 2>/dev/null || true
    if node -v >/dev/null 2>&1; then return 0; fi
    # 面板环境常见：shim 有、但没有全局默认版本
    mise use -g node@22.14.0 >/dev/null 2>&1 || true
    hash -r 2>/dev/null || true
    if node -v >/dev/null 2>&1; then return 0; fi
    if mise exec node@22.14.0 -- node -v >/dev/null 2>&1; then
      if [ "${ECO_NODE_REEXEC:-0}" = "1" ]; then
        die "mise 仍无法提供 node；请在服务器执行：mise use -g node@22.14.0"
      fi
      export ECO_NODE_REEXEC=1
      info "切换到 mise Node 22.14.0 后重新执行启动脚本"
      exec mise exec node@22.14.0 -- bash "$0" "$@"
    fi
  fi
  return 1
}

require_node() {
  resolve_node "$@" || die "未找到可用的 Node.js。请安装 Node 22，或执行：mise use -g node@22.14.0"
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' \
    || die "Node.js 版本过低（当前 $(node -v)），需要 18 或更高；推荐：mise use -g node@22.14.0"
}

start_services() {
  [ -f "$ROOT/deploy/site-server.mjs" ] || die "缺少 deploy/site-server.mjs"
  [ -f "$ROOT/deploy/claim-server.mjs" ] || die "缺少 deploy/claim-server.mjs"
  [ -f "$ROOT/data/curated/lotus-eco.json" ] || die "缺少 data/curated/lotus-eco.json"
  [ -f "$ROOT/data/curated/lotus-structures.json" ] \
    || info "提示：缺少 data/curated/lotus-structures.json，将只能加载精选节点"
  [ -f "$ROOT/data/molecules/facets.json.gz" ] \
    || info "提示：缺少 facets.json.gz，领养服务会退回 InChIKey 形状校验"
  [ -f "$ROOT/vendor/rdkit/RDKit_minimal.wasm" ] \
    || info "提示：缺少 vendor/rdkit，结构式将无法渲染"

  if is_alive "$SITE_PID_FILE" || is_alive "$CLAIM_PID_FILE"; then
    info "已有本脚本启动的实例："
    show_status
    return 0
  fi

  local claim_internal="http://127.0.0.1:$CLAIM_PORT/api/claim/health"
  local site_url="http://127.0.0.1:$SITE_PORT/"

  # ── 领养服务（只绑定内网） ──
  if port_free "$CLAIM_PORT"; then
    info "启动领养服务（内部 :$CLAIM_PORT）……"
    HOST="$CLAIM_HOST" \
    PORT="$CLAIM_PORT" \
    CLAIM_FILE="$CLAIM_FILE" \
    ALLOW_ORIGIN="$ALLOW_ORIGIN" \
    nohup node "$ROOT/deploy/claim-server.mjs" >>"$CLAIM_LOG" 2>&1 &
    echo $! >"$CLAIM_PID_FILE"
    STARTED_CLAIM=1
    if ! wait_http "$claim_internal" 120; then
      info "领养服务启动失败，最近日志："
      tail -n 40 "$CLAIM_LOG" 2>/dev/null || true
      stop_one "领养服务" "$CLAIM_PID_FILE"
      exit 1
    fi
  elif wait_http "$claim_internal" 3; then
    info "领养服务已在运行，复用内部 :$CLAIM_PORT"
  else
    die "内部端口 $CLAIM_PORT 被占用，且不是可用的领养服务"
  fi

  # ── 静态站 + /api 同源代理 ──
  if port_free "$SITE_PORT"; then
    info "启动站点 :$SITE_PORT（/api → 127.0.0.1:$CLAIM_PORT）……"
    HOST="$BIND_HOST" \
    SITE_PORT="$SITE_PORT" \
    CLAIM_PROXY="http://127.0.0.1:$CLAIM_PORT" \
    nohup node "$ROOT/deploy/site-server.mjs" >>"$SITE_LOG" 2>&1 &
    echo $! >"$SITE_PID_FILE"
    STARTED_SITE=1
    if ! wait_http "$site_url" 120; then
      info "静态站点启动失败，最近日志："
      tail -n 40 "$SITE_LOG" 2>/dev/null || true
      stop_all
      exit 1
    fi
  elif wait_http "$site_url" 3; then
    info "站点端口 $SITE_PORT 已有服务在运行，复用"
  else
    die "端口 $SITE_PORT 被占用，且 HTTP 检查失败"
  fi

  local ip
  ip="$(local_ip)"
  info ""
  info "启动完成（可领养版本，同源 /api）"
  info "  站点：    http://$ip:$SITE_PORT/"
  info "  领养 API：http://$ip:$SITE_PORT/api/claim/health"
  info "  账本：    $CLAIM_FILE"
  info "  日志：    $LOG_DIR/site.log"
  info "            $LOG_DIR/claim.log"
  info "  状态：    ./start.sh status"
  info "  停止：    ./start.sh stop"
  info ""
  info "对外只需放行 TCP $SITE_PORT；$CLAIM_PORT 只在容器/本机内部使用。"
  if [ -n "${PORT:-}" ]; then
    info "已优先采用面板环境变量 PORT=$PORT。"
  fi
}

wait_foreground() {
  trap 'info "收到停止信号"; stop_all; exit 0' INT TERM
  if [ "$STARTED_SITE" = "0" ] && [ "$STARTED_CLAIM" = "0" ]; then
    info "服务已在外部运行；保持前台进程存活。Ctrl-C 退出。"
    while :; do sleep 3600; done
  fi
  info "前台运行中，按 Ctrl-C 停止。"
  while :; do
    if [ "$STARTED_CLAIM" = "1" ] && ! is_alive "$CLAIM_PID_FILE"; then
      info "领养服务已退出，停止其余服务。"
      stop_all
      exit 1
    fi
    if [ "$STARTED_SITE" = "1" ] && ! is_alive "$SITE_PID_FILE"; then
      info "静态站点已退出，停止其余服务。"
      stop_all
      exit 1
    fi
    sleep 2
  done
}

# stop 不依赖 Node，先处理
if [ "$ACTION" = "stop" ]; then
  stop_all
  exit 0
fi

require_node "$@"

case "$ACTION" in
  start)
    start_services
    wait_foreground
    ;;
  daemon)
    start_services
    ;;
  restart)
    stop_all
    start_services
    wait_foreground
    ;;
  status)
    show_status
    ;;
  *)
    info "用法：./start.sh [start|daemon|stop|restart|status]"
    exit 2
    ;;
esac
