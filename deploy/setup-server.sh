#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Vita bot — one-time server setup (Ubuntu 22.04 / 24.04)
# Run this once on a fresh DigitalOcean droplet as root.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO="https://github.com/calebljohnston/GPTmain.git"
BRANCH="claude/objective-bassi"
DEPLOY_PATH="/opt/vita"

echo "▶ Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "▶ Installing PM2..."
npm install -g pm2

echo "▶ Cloning repo..."
mkdir -p "$DEPLOY_PATH"
git clone --branch "$BRANCH" "$REPO" "$DEPLOY_PATH"

echo "▶ Installing dependencies..."
cd "$DEPLOY_PATH/sms-server"
npm install --omit=dev

echo "▶ Creating data directory..."
mkdir -p "$DEPLOY_PATH/sms-server/data"

echo "▶ Setting up PM2 auto-start on reboot..."
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Setup complete. Two manual steps remain:            ║"
echo "║                                                      ║"
echo "║  1. Create the .env file:                            ║"
echo "║     nano /opt/vita/sms-server/.env                   ║"
echo "║                                                      ║"
echo "║     Add these two lines:                             ║"
echo "║     ANTHROPIC_API_KEY=sk-ant-...                     ║"
echo "║     TELEGRAM_BOT_TOKEN=...                           ║"
echo "║                                                      ║"
echo "║  2. Run the deploy script from your local machine:   ║"
echo "║     ./deploy/deploy.sh <this-server-ip>              ║"
echo "╚══════════════════════════════════════════════════════╝"
