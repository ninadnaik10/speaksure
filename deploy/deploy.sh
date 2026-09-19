#!/usr/bin/env bash
# Server-side deploy. Run as a sudo-capable user on the instance.
# Frontend is built on your laptop and rsynced separately (see DEPLOYMENT.md).
set -euo pipefail

APP_DIR=/opt/speaksure/app
VENV=/opt/speaksure/venv

echo "==> Pulling latest code"
sudo -u speaksure git -C "$APP_DIR" pull --ff-only

echo "==> Syncing Python dependencies"
sudo -u speaksure "$VENV/bin/pip" install --upgrade --requirement "$APP_DIR/server/requirements.txt"

echo "==> Restarting service"
sudo systemctl restart speaksure

echo "==> Waiting for health"
for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
        echo "Healthy:"
        curl -s http://127.0.0.1:5000/api/health
        echo
        exit 0
    fi
    sleep 5
done

echo "Service did not become healthy in 5 minutes. Recent logs:" >&2
sudo journalctl -u speaksure -n 50 --no-pager >&2
exit 1
