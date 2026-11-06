#!/usr/bin/env bash
# 世界树 · 一键运行（本地）
#
#   ./run.sh                 启动站点 + 领养服务，并自动打开浏览器
#   ./run.sh --no-open       只启动，不打开浏览器
#   ./run.sh --port 8080     指定端口（等价于 SITE_PORT=8080）
#   ./run.sh stop|status|restart|daemon
#                            透传给 start.sh
#
# 前台运行：按 Ctrl-C 停止服务（复用已有实例时也会一并停止）。
# 完整的环境变量见 start.sh 顶部注释。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

NO_OPEN=0
SITE_PORT="${SITE_PORT:-${PORT:-${SERVER_PORT:-5173}}}"

usage() {
  sed -n '2,12p' "$ROOT/run.sh" | sed 's/^# \{0,1\}//'
}

die() { printf '错误：%s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-open)
      NO_OPEN=1
      shift
      ;;
    --port)
      [ "$#" -ge 2 ] || die "--port 需要一个端口号"
      SITE_PORT="$2"
      shift 2
      ;;
    --port=*)
      SITE_PORT="${1#*=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    stop | status | restart | daemon)
      # 这些动作不需要打开浏览器，直接交给 start.sh
      [ -f "$ROOT/start.sh" ] || die "缺少 start.sh"
      exec "$ROOT/start.sh" "$@"
      ;;
    *)
      die "未知参数：$1（用 --help 查看用法）"
      ;;
  esac
done

[ -f "$ROOT/start.sh" ] || die "缺少 start.sh"
[ -f "$ROOT/deploy/site-server.mjs" ] || die "缺少 deploy/site-server.mjs"

# 从 Windows 拷贝或 git 配置不当会引入 CRLF，导致 shebang 变成 "bash\r"。
# 这里自动修一次，保证脚本可执行。
if grep -q $'\r' "$ROOT/start.sh"; then
  printf '检测到 start.sh 为 CRLF 换行，正在转换为 LF……\n'
  tmp="$(mktemp "$ROOT/.start.XXXXXX")"
  tr -d '\r' <"$ROOT/start.sh" >"$tmp"
  chmod +x "$tmp"
  mv "$tmp" "$ROOT/start.sh"
fi
[ -x "$ROOT/start.sh" ] || chmod +x "$ROOT/start.sh"

export SITE_PORT
URL="http://127.0.0.1:$SITE_PORT/"

http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null --max-time 1 "$1" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --timeout=1 "$1" 2>/dev/null
  else
    node -e '
      fetch(process.argv[1], { signal: AbortSignal.timeout(1000) })
        .then((r) => process.exit(r.ok ? 0 : 1))
        .catch(() => process.exit(1));
    ' "$1" 2>/dev/null
  fi
}

open_url() {
  local url="$1" cmd
  if [ -n "${BROWSER:-}" ]; then
    $BROWSER "$url" >/dev/null 2>&1 &
    return 0
  fi
  for cmd in xdg-open open wslview; do
    if command -v "$cmd" >/dev/null 2>&1; then
      "$cmd" "$url" >/dev/null 2>&1 &
      return 0
    fi
  done
  return 1
}

# start.sh 自己负责处理 INT/TERM 并清理服务；这里只把信号转发给它。
START_PID=""
cleanup() {
  trap - INT TERM EXIT
  if [ -n "$START_PID" ] && kill -0 "$START_PID" 2>/dev/null; then
    kill -TERM "$START_PID" 2>/dev/null || true
  fi
  [ -n "$START_PID" ] && wait "$START_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

"$ROOT/start.sh" &
START_PID=$!

# 等站点真正可访问再打开浏览器，避免打开一个连接失败的白页。
ready=0
for _ in $(seq 1 120); do
  if ! kill -0 "$START_PID" 2>/dev/null; then
    wait "$START_PID" || true
    printf '服务启动失败，请检查上面的日志或 %s/logs/。\n' "$ROOT" >&2
    exit 1
  fi
  if http_ok "$URL"; then
    ready=1
    break
  fi
  sleep 0.25
done

if [ "$ready" -ne 1 ]; then
  die "等待站点超时：$URL（日志见 $ROOT/logs/site.log）"
fi

if [ "$NO_OPEN" -eq 0 ]; then
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    open_url "$URL" || printf '\n未能自动打开浏览器，请手动访问：%s\n' "$URL"
  else
    printf '\n未检测到图形界面，跳过自动打开浏览器。\n'
  fi
fi

printf '\n世界树已就绪： %s\n按 Ctrl-C 停止服务。\n\n' "$URL"

wait "$START_PID" || true
