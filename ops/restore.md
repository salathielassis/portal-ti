# Restaurar produção a partir de um backup

Pré-requisitos na VM nova: Docker + Docker Compose, Node 20, nginx, git, um
usuário `ti`.

1. **Código**
   ```bash
   sudo -u ti git clone https://github.com/salathielassis/portal-ti.git /home/ti/apps/portal-ti
   cd /home/ti/apps/portal-ti
   ```

2. **Segredos** — do tar.gz gerado por `collect-vm-config.sh`:
   ```bash
   cp backup-extraido/env/backend.env        backend/.env
   cp backup-extraido/env/frontend.env.local frontend/.env.local
   ```

3. **Banco**
   ```bash
   docker compose up -d                 # sobe itam-postgres
   # se houver dump:
   gunzip -c backup-extraido/docker/itam_db.sql.gz | docker exec -i itam-postgres psql -U itam_user -d itam_db
   ```

4. **Build**
   ```bash
   ( cd backend  && npm ci && npm run build && npx prisma migrate deploy )
   ( cd frontend && npm ci && npm run build )
   ```

5. **Serviços**
   ```bash
   sudo cp backup-extraido/systemd/portal-*.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now portal-backend.service portal-frontend.service
   ```

6. **nginx**
   ```bash
   sudo cp backup-extraido/nginx/portal-ti /etc/nginx/sites-available/portal-ti
   sudo ln -sf /etc/nginx/sites-available/portal-ti /etc/nginx/sites-enabled/portal-ti
   sudo nginx -t && sudo systemctl reload nginx
   ```

7. **DNS** — apontar `portalti.doisa.com` para o IP da VM nova na RouterBoard.

8. **Conferir**
   ```bash
   systemctl is-active portal-backend portal-frontend
   curl -I http://localhost/            # via nginx
   ```
