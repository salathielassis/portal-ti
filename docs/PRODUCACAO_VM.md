# Ambiente de produção — VM self-hosted

Runbook do ambiente que está no ar. Levantado e conferido em **2026-09-10**.
Use junto com o pacote de backup em `ops/vm-snapshot/` e os scripts em `ops/`.

---

## 1. Topologia

| Peça | Onde | Detalhe |
|---|---|---|
| VM | Proxmox, IP interno **10.0.0.8**, hostname `portal-ti` | Linux, systemd |
| DNS | **portalti.doisa.com** → 10.0.0.8 | registro estático na RouterBoard (rb) |
| Usuário do SO que roda a app | **`ti`** | apps em `/home/ti/apps/portal-ti` |
| Frontend | Next.js 14.2.35, `next start` | serviço `portal-frontend.service`, porta **3000** |
| Backend | NestJS, `node dist/main.js` | serviço `portal-backend.service`, porta **3333**, base `/api`, docs em `/api/docs` |
| Banco | PostgreSQL 16-alpine em Docker | container `itam-postgres`, porta **5432**, volume `itam_pgdata` |
| Proxy | nginx 1.26.3 | site `/etc/nginx/sites-enabled/portal-ti`, só HTTP (porta 80) |
| Node/npm | v20.20.2 / 10.8.2 | `/usr/bin/node` |
| Repositório | github.com/salathielassis/portal-ti, branch `main` | clonado em `/home/ti/apps/portal-ti` |

Fluxo de request: navegador → `http://portalti.doisa.com` → nginx (:80)
· `/api/*` → `http://localhost:3333/api/*` (backend)
· resto → `http://localhost:3000` (Next).

---

## 2. Serviços (systemd)

Arquivos: `ops/vm-snapshot/systemd/`. Confirme o conteúdo real com `systemctl cat`.

```
portal-frontend.service   User=ti   WorkingDirectory=/home/ti/apps/portal-ti/frontend   ExecStart=/usr/bin/npm run start
portal-backend.service    User=ti   WorkingDirectory=/home/ti/apps/portal-ti/backend    ExecStart=/usr/bin/node dist/main.js
```

Comandos úteis:

```bash
systemctl status  portal-frontend.service portal-backend.service
systemctl restart portal-backend.service portal-frontend.service   # backend primeiro
journalctl -u portal-frontend.service -n 50 --no-pager
journalctl -u portal-backend.service  -f
```

`next start` **carrega o build `.next` só na inicialização** — toda vez que o
frontend for recompilado é obrigatório `systemctl restart portal-frontend`.

---

## 3. Banco de dados

`docker-compose.yml` (na raiz do repo) sobe só o Postgres:

```
container : itam-postgres          image: postgres:16-alpine     restart: unless-stopped
db        : itam_db                user : itam_user              porta: 5432
volume    : itam_pgdata  ->  /var/lib/postgresql/data  (volume nomeado do Docker)
```

Sobe com `docker compose up -d` a partir de `/home/ti/apps/portal-ti`.
A `DATABASE_URL` do backend aponta para `localhost:5432/itam_db`.

Backup do banco:

```bash
docker exec -t itam-postgres pg_dump -U itam_user -d itam_db | gzip > itam_db_$(date +%F).sql.gz
```

Restore:

```bash
gunzip -c itam_db_AAAA-MM-DD.sql.gz | docker exec -i itam-postgres psql -U itam_user -d itam_db
```

Migrações Prisma (aplicar em produção, nunca `migrate dev`):

```bash
cd /home/ti/apps/portal-ti/backend && npx prisma migrate deploy
```

---

## 4. Variáveis de ambiente

Nunca versionadas (ver `.gitignore`). Templates em `ops/vm-snapshot/env/`.

**`backend/.env`** (chaves confirmadas na sessão; valores de segredo mascarados):

```
DATABASE_URL=***            # postgresql://itam_user:<senha>@localhost:5432/itam_db?schema=public
JWT_SECRET=***
JWT_EXPIRES_IN="8h"
STORAGE_BASE_URL=***
CORS_ORIGIN="http://portalti.doisa.com"
PORT=3333
```

**`frontend/.env.local`**:

```
NEXT_PUBLIC_API_URL=***     # confirmar: deve ser http://portalti.doisa.com/api  (embutido no build)
```

`NEXT_PUBLIC_*` é embutido no bundle **em build time** — se mudar, precisa
`npm run build` + restart do frontend.

---

## 5. nginx

Arquivo: `ops/vm-snapshot/nginx/portal-ti.conf` (cópia fiel do que está em
`/etc/nginx/sites-enabled/portal-ti`). Sem TLS hoje — só porta 80.

```bash
nginx -t && systemctl reload nginx
tail -f /var/log/nginx/error.log
```

Se um dia for colocar HTTPS: `certbot --nginx -d portalti.doisa.com` (precisa a
porta 443 aberta e o DNS resolvendo de fora, ou usar DNS-01).

---

## 6. Deploy de uma atualização

Manual — a VM não tem deploy automático. Use `ops/deploy.sh` (na VM) ou a task
"Deploy → VM" do VS Code. Passos que ele executa:

1. `git pull --ff-only origin main`
2. `frontend`: `rm -rf .next && npm ci && npm run build`
3. `backend`: `npm ci && npm run build && npx prisma migrate deploy`
4. `systemctl restart portal-backend.service portal-frontend.service`

**Erro clássico** (ocorreu em 2026-09-10): recompilar sem reiniciar os
serviços — o `next start` continua servindo o build antigo, e sobrescrever
`.next` com o servidor no ar deixa a sessão nova quebrada (chunks 404).

---

## 7. Backup completo da configuração

`ops/collect-vm-config.sh` — roda **na VM**, junta tudo (units, nginx, `.env`
reais, `docker inspect`, versões, git, opcionalmente dump do banco) em
`~/portalti-vm-config-<data>.tar.gz`.

```bash
# na VM
bash /home/ti/apps/portal-ti/ops/collect-vm-config.sh            # sem banco
bash /home/ti/apps/portal-ti/ops/collect-vm-config.sh --with-db  # com dump do Postgres
```

Baixar para a máquina local (ou usar a task "Backup ← VM" do VS Code):

```powershell
scp adm@10.0.0.8:~/portalti-vm-config-*.tar.gz C:\Salah\portal-ti\backup\
```

O tarball contém **segredos** (JWT_SECRET, senha do banco) e, com `--with-db`,
dados reais — guarde em local seguro. A pasta `backup/` é git-ignored.

---

## 8. Reconstruir a VM do zero

1. VM nova com Docker + Node 20 + nginx.
2. `useradd -m ti`; clonar o repo em `/home/ti/apps/portal-ti`.
3. Restaurar `backend/.env` e `frontend/.env.local` do backup.
4. `docker compose up -d` (Postgres) e restaurar o dump (seção 3).
5. `cd backend && npm ci && npm run build && npx prisma migrate deploy`
6. `cd frontend && npm ci && npm run build`
7. Copiar os `.service` do backup para `/etc/systemd/system/`, `systemctl daemon-reload`,
   `systemctl enable --now portal-backend portal-frontend`.
8. Copiar o nginx conf para `/etc/nginx/sites-available/portal-ti`, `ln -s` em
   `sites-enabled/`, `nginx -t && systemctl reload nginx`.
9. Ajustar o DNS `portalti.doisa.com` para o novo IP.
