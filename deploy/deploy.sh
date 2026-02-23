#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Vita bot — deploy latest code + sync data to server
#
# Usage:
#   ./deploy/deploy.sh <server-ip>            # deploy as root
#   ./deploy/deploy.sh <server-ip> <user>     # deploy as user
#
# Or set VITA_SERVER_IP in your shell profile to skip the arg:
#   export VITA_SERVER_IP=123.45.67.89
#   ./deploy/deploy.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SERVER_IP="${1:-${VITA_SERVER_IP:-}}"
SERVER_USER="${2:-root}"
DEPLOY_PATH="/opt/vita"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -z "$SERVER_IP" ]; then
  echo "Error: server IP required."
  echo "Usage: ./deploy/deploy.sh <server-ip>"
  exit 1
fi

echo "→ Syncing data files to $SERVER_USER@$SERVER_IP..."
rsync -az --mkpath \
  "$REPO_ROOT/sms-server/data/" \
  "$SERVER_USER@$SERVER_IP:$DEPLOY_PATH/sms-server/data/"

echo "→ Pulling latest code on server..."
ssh "$SERVER_USER@$SERVER_IP" "
  set -e
  cd $DEPLOY_PATH
  git pull
  cd sms-server
  npm install --omit=dev
  pm2 restart vita-bot || pm2 start $DEPLOY_PATH/sms-server/ecosystem.config.js
  pm2 save
"

echo "✓ Deployed to $SERVER_IP"
echo "  Logs: ssh $SERVER_USER@$SERVER_IP 'pm2 logs vita-bot --lines 50'"
