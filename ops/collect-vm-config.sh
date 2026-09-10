#!/usr/bin/env bash
# Junta TODA a configuracao de producao da VM em um unico tar.gz.
# Rode NA VM (10.0.0.8), com um usuario que tenha sudo:
#     bash /home/ti/apps/portal-ti/ops/collect-vm-config.sh            # sem banco
#     bash /home/ti/apps/portal-ti/ops/collect-vm-config.sh --with-db  # + dump do Postgres
#
# ATENCAO: o pacote gerado contem SEGREDOS (JWT_SECRET, senha do banco) e, com
# --with-db, dados reais. Guarde em local seguro. Nao versione.
set -euo pipefail

REPO=/home/ti/apps/portal-ti
WITH_DB=0
[ "${1:-}" = "--with-db" ] && WITH_DB=1

STAMP=$(date +%Y-%m-%d_%H%M)
OUT="$HOME/portalti-vm-config-$STAMP"
mkdir -p "$OUT"/{systemd,nginx,env,docker,git,system}

echo "==> systemd"
sudo systemctl cat portal-frontend.service > "$OUT/systemd/portal-frontend.service" 2>/dev/null || true
sudo systemctl cat portal-backend.service  > "$OUT/systemd/portal-backend.service"  2>/dev/null || true
systemctl show portal-frontend.service portal-backend.service \
  -p ActiveState -p SubState -p ExecMainStartTimestamp -p FragmentPath > "$OUT/systemd/state.txt" 2>/dev/null || true

echo "==> nginx"
sudo cp -a /etc/nginx/sites-available/portal-ti "$OUT/nginx/" 2>/dev/null || \
  sudo cp -aL /etc/nginx/sites-enabled/portal-ti "$OUT/nginx/portal-ti" 2>/dev/null || true
sudo nginx -T > "$OUT/nginx/nginx-T-full.txt" 2>&1 || true

echo "==> env (com segredos)"
sudo cp -a "$REPO/backend/.env"          "$OUT/env/backend.env"          2>/dev/null || echo "sem backend/.env"
sudo cp -a "$REPO/frontend/.env.local"   "$OUT/env/frontend.env.local"   2>/dev/null || echo "sem frontend/.env.local"

echo "==> docker / postgres"
cp -a "$REPO/docker-compose.yml" "$OUT/docker/" 2>/dev/null || true
docker inspect itam-postgres > "$OUT/docker/itam-postgres.inspect.json" 2>/dev/null || true
docker ps -a  > "$OUT/docker/docker-ps.txt" 2>/dev/null || true
docker volume inspect itam_pgdata > "$OUT/docker/itam_pgdata.volume.json" 2>/dev/null || \
  docker volume inspect portal-ti_itam_pgdata > "$OUT/docker/itam_pgdata.volume.json" 2>/dev/null || true

echo "==> git"
git -C "$REPO" -c safe.directory="$REPO" rev-parse HEAD          > "$OUT/git/HEAD.txt" 2>/dev/null || true
git -C "$REPO" -c safe.directory="$REPO" log --oneline -20       > "$OUT/git/log.txt"  2>/dev/null || true
git -C "$REPO" -c safe.directory="$REPO" status -sb              > "$OUT/git/status.txt" 2>/dev/null || true
git -C "$REPO" -c safe.directory="$REPO" remote -v               > "$OUT/git/remote.txt" 2>/dev/null || true
git -C "$REPO" -c safe.directory="$REPO" diff                    > "$OUT/git/uncommitted.patch" 2>/dev/null || true
ls "$REPO/backend/prisma/migrations"                             > "$OUT/git/prisma-migrations.txt" 2>/dev/null || true

echo "==> sistema"
{ uname -a; echo; cat /etc/os-release; echo; node -v; npm -v; echo; ss -tlnp; echo; \
  crontab -l 2>/dev/null; echo "--- root crontab ---"; sudo crontab -l 2>/dev/null; } \
  > "$OUT/system/info.txt" 2>&1 || true

if [ "$WITH_DB" = "1" ]; then
  echo "==> dump do banco (pode demorar)"
  docker exec -t itam-postgres pg_dump -U itam_user -d itam_db | gzip > "$OUT/docker/itam_db.sql.gz" || \
    echo "FALHA no pg_dump — confira usuario/db"
fi

cat > "$OUT/LEIA-ME.txt" <<TXT
Backup de configuracao da VM portalti.doisa.com (10.0.0.8)
Gerado em: $STAMP
Inclui dump do banco: $([ "$WITH_DB" = 1 ] && echo SIM || echo nao)

CONTEM SEGREDOS (env/*.env). Guarde com cuidado.

Restore: ver docs/PRODUCACAO_VM.md secao 8 no repositorio.
TXT

TAR="$OUT.tar.gz"
tar -czf "$TAR" -C "$(dirname "$OUT")" "$(basename "$OUT")"
rm -rf "$OUT"
echo
echo "==> pronto: $TAR"
echo "    baixe com:  scp $USER@10.0.0.8:$TAR ./backup/"
