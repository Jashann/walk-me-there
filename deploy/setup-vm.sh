#!/usr/bin/env bash
# One-time setup on a fresh Debian 12 VM: Node, ffmpeg, Chrome, Caddy (automatic HTTPS), the app and a systemd service.
# Usage from a clone on the VM: DOMAIN=<ip-with-dashes>.sslip.io MODEL_API_KEY=<key> bash deploy/setup-vm.sh
set -euo pipefail
: "${DOMAIN:?set DOMAIN, for example 34-1-2-3.sslip.io}"
: "${MODEL_API_KEY:?set MODEL_API_KEY}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
sudo apt-get update -y
sudo apt-get install -y ffmpeg curl debian-keyring debian-archive-keyring apt-transport-https git rsync
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt-get install -y nodejs
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --yes --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update -y && sudo apt-get install -y caddy google-chrome-stable
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
${DOMAIN} {
  encode gzip
  reverse_proxy localhost:8787
}
CADDY
sudo systemctl restart caddy
id wmt >/dev/null 2>&1 || sudo useradd -r -m -s /usr/sbin/nologin wmt
sudo mkdir -p /opt/walk-me-there
sudo rsync -a --exclude node_modules --exclude data --exclude .git "$HERE/" /opt/walk-me-there/
sudo mkdir -p /opt/walk-me-there/data
sudo tee /opt/walk-me-there/.env >/dev/null <<ENV
PORT=8787
HOME=/opt/walk-me-there
MODEL_API_KEY=${MODEL_API_KEY}
ADMIN_TOKEN=$(openssl rand -hex 24)
CHROME_PATH=/usr/bin/google-chrome
ENV
sudo chmod 600 /opt/walk-me-there/.env
cd /opt/walk-me-there && sudo npm ci && sudo npm run build
sudo chown -R wmt:wmt /opt/walk-me-there
sudo cp /opt/walk-me-there/deploy/walk-me-there.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now walk-me-there
