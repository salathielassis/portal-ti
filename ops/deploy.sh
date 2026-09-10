#!/usr/bin/env bash
# Deploy de uma atualizacao no ambiente self-hosted (VM 10.0.0.8).
# Rode NA VM:  bash /home/ti/apps/portal-ti/ops/deploy.sh
# Precisa de sudo para reiniciar os servicos.
set -euo pipefail

REPO=/home/ti/apps/portal-ti
APP_USER=ti

echo "==> repo: $REPO"
cd "$REPO"

echo "==> git pull"
sudo -u "$APP_USER" git -c safe.directory="$REPO" pull --ff-only origin main

echo "==> frontend: build limpo"
sudo -u "$APP_USER" bash -lc "cd '$REPO/frontend' && rm -rf .next && npm ci && npm run build"

echo "==> backend: build + migracoes"
sudo -u "$APP_USER" bash -lc "cd '$REPO/backend' && npm ci && npm run build && npx prisma migrate deploy"

echo "==> restart servicos (backend primeiro)"
sudo systemctl restart portal-backend.service
sudo systemctl restart portal-frontend.service
sleep 4

echo "==> validacao"
systemctl is-active portal-backend.service portal-frontend.service
curl -s -o /dev/null -w 'backend  /api  -> HTTP %{http_code}\n' http://localhost:3333/api || true
curl -s -o /dev/null -w 'frontend /     -> HTTP %{http_code}\n' http://localhost:3000/ || true
echo "commit no ar: $(git -c safe.directory="$REPO" rev-parse --short HEAD)"
echo "==> OK"
