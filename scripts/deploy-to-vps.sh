#!/usr/bin/env bash
set -euo pipefail

echo "=== OGBadge デプロイ ==="

VPS="vps-edilab"
REMOTE_DIR="/opt/ogbadge"

# 1. Sync files
echo "[1/3] ファイル同期中..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='build' \
  --exclude='.env*' \
  ~/dev/ogbadge/ "$VPS:$REMOTE_DIR/"

# 2. Build & start
echo "[2/3] Docker ビルド＋起動..."
ssh "$VPS" "cd $REMOTE_DIR && docker compose build && docker compose up -d"

# 3. Health check
echo "[3/3] ヘルスチェック..."
sleep 5
STATUS=$(ssh "$VPS" "curl -s -o /dev/null -w '%{http_code}' http://localhost:3460/api/ping")
if [ "$STATUS" = "200" ]; then
  echo "✅ デプロイ完了！ポート 3460 で稼働中"
else
  echo "❌ ヘルスチェック失敗 (HTTP $STATUS)"
  exit 1
fi
