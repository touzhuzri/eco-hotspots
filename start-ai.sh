#!/usr/bin/env bash
# 世界树 · AI 分析代理（前台运行）
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec node ai/server.mjs
