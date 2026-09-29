#!/bin/sh
# 本地开发：同时启动 Go 后端（:8787）和 Vite（:5173），Ctrl-C 一起退出
# 站长账号与 Docker 相同，读取 .env 里的 ADMIN_USER / ADMIN_PASSWORD；没有 .env 时用 admin / dev-admin-password
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
ADMIN_USER="${ADMIN_USER:-admin}"
if [ -n "$ADMIN_PASSWORD" ]; then
  PW_HINT="见 .env 的 ADMIN_PASSWORD"
else
  ADMIN_PASSWORD=dev-admin-password
  PW_HINT="$ADMIN_PASSWORD"
fi
mkdir -p .dev
(cd server && go build -o ../.dev/s11-server .)
ADMIN_USER="$ADMIN_USER" ADMIN_PASSWORD="$ADMIN_PASSWORD" DATA_DIR=server/data ADDR=:8787 .dev/s11-server &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
echo "后端 http://localhost:8787  站长 $ADMIN_USER / 口令 $PW_HINT"
pnpm exec vite
