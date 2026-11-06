#!/bin/sh
# 世界树 · 部署前环境体检（只读，不安装、不改配置）
#
# 用法：
#   sh deploy/preflight.sh
#   sh deploy/preflight.sh > /tmp/eco-preflight.txt 2>&1
#
# 把输出发给技术支持即可。不要在这里粘贴密码、私钥或 claims.jsonl 内容。

set +e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT" || exit 1

echo "===== 世界树部署前体检 ====="
echo "time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "project: $ROOT"
echo

echo "===== 1. 系统 ====="
uname -a
[ -r /etc/os-release ] && cat /etc/os-release
echo "arch: $(uname -m)"
echo "bits: $(getconf LONG_BIT 2>/dev/null)"
echo "user: $(id 2>/dev/null)"
echo "alpine: $([ -r /etc/alpine-release ] && cat /etc/alpine-release || echo no)"
ldd --version 2>&1 | head -n 1
echo

echo "===== 2. 运行时 ====="
for c in sh bash node npm npx python3 python unzip tar gzip curl wget ss netstat systemctl nginx caddy docker podman; do
  p=$(command -v "$c" 2>/dev/null)
  if [ -n "$p" ]; then
    echo "$c: $p"
  else
    echo "$c: MISSING"
  fi
done
echo
echo "node: $(node -v 2>/dev/null || echo MISSING)"
echo "npm: $(npm -v 2>/dev/null || echo MISSING)"
echo "python3: $(python3 --version 2>&1 || echo MISSING)"
echo "bash: $(bash --version 2>/dev/null | head -n 1 || echo MISSING)"
echo

echo "===== 3. 资源 ====="
echo '--- disk ---'
df -h . /tmp 2>/dev/null
echo '--- memory ---'
free -h 2>/dev/null || free -m 2>/dev/null || echo 'free MISSING'
echo '--- cpu ---'
nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null
echo '--- ulimit ---'
ulimit -n 2>/dev/null
echo

echo "===== 4. 端口占用 ====="
for p in 80 443 5173 8788 41018; do
  echo "--- port $p ---"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -E "[:.]$p[[:space:]]" || echo free
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -E "[:.]$p[[:space:]]" || echo free
  else
    echo 'ss/netstat MISSING'
  fi
done
echo
echo '--- firewall ---'
if command -v ufw >/dev/null 2>&1; then
  ufw status 2>&1 | head -n 20
fi
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --state 2>&1
  firewall-cmd --list-ports 2>&1
fi
echo

echo "===== 5. 项目文件 ====="
for f in \
  index.html start.sh \
  deploy/site-server.mjs deploy/claim-server.mjs \
  vendor/three/three.module.js \
  vendor/three/addons/controls/OrbitControls.js \
  vendor/rdkit/RDKit_minimal.js vendor/rdkit/RDKit_minimal.wasm \
  data/curated/lotus-eco.json data/curated/lotus-structures.json \
  data/molecules/facets.json.gz
do
  if [ -e "$f" ]; then echo "OK   $f"; else echo "MISS $f"; fi
done
echo "3d shards: $(find data/molecules3d -maxdepth 1 -name '*.json.gz' 2>/dev/null | wc -l)"
echo "3d size: $(du -sh data/molecules3d 2>/dev/null | awk '{print $1}')"
echo "data size: $(du -sh data 2>/dev/null | awk '{print $1}')"
echo "vendor size: $(du -sh vendor 2>/dev/null | awk '{print $1}')"
echo "project size (no .git/logs/release): $(du -sh --exclude=.git --exclude=logs --exclude=release . 2>/dev/null | awk '{print $1}')"
echo

echo "===== 6. 权限 / 状态 ====="
[ -e claims.jsonl ] && ls -l claims.jsonl || echo 'claims.jsonl: not present (fresh install)'
[ -d logs ] && ls -ld logs || echo 'logs/: not present'
[ -d .run ] && ls -ld .run || echo '.run/: not present'
echo "root writable: $([ -w . ] && echo yes || echo no)"
echo "logs writable: $([ -d logs ] && [ -w logs ] && echo yes || echo no/absent)"
echo "  PORT=${PORT:-<unset>}"
echo "  SITE_PORT=${SITE_PORT:-<unset>}"
echo "  CLAIM_PORT=${CLAIM_PORT:-<unset>}"
echo "  CLAIM_FILE=${CLAIM_FILE:-<unset>}"
echo

echo "===== 7. start.sh 行尾 ====="
if [ -r start.sh ]; then
  if grep -q "$(printf '\r')" start.sh 2>/dev/null; then
    echo 'CRLF detected (需转换)'
  else
    echo 'LF (ok)'
  fi
  ls -l start.sh
fi
echo

echo "===== 体检结束 ====="
echo "请把以上输出发给技术支持；不要发送密码、私钥或 claims.jsonl。"
