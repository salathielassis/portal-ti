# vm-snapshot — configuração de produção (último estado conhecido)

Cópia versionada da configuração da VM **10.0.0.8** (`portalti.doisa.com`).
Serve de referência rápida e de base para reconstrução. O runbook completo está
em `../../docs/PRODUCACAO_VM.md`.

| Arquivo | O que é | Confiança |
|---|---|---|
| `nginx/portal-ti.conf` | cópia fiel de `/etc/nginx/sites-enabled/portal-ti` | alta (copiado 1:1) |
| `systemd/portal-frontend.service` | unit do frontend | **parcial** — só `User`/`WorkingDirectory`/`ExecStart` confirmados |
| `systemd/portal-backend.service` | unit do backend | **parcial** — idem |
| `env/backend.env.template` | chaves do `backend/.env` de produção | chaves ok, **valores de segredo não** |
| `env/frontend.env.local.template` | `frontend/.env.local` | valor real estava mascarado |
| `VERSIONS.txt` | versões, portas, caminhos, commit no ar | alta |

Para o snapshot **autoritativo** (unit files inteiros, `.env` reais, `docker
inspect`, dump do banco), rode na VM:

```bash
bash ../collect-vm-config.sh --with-db
```

e baixe o `.tar.gz` gerado para `backup/`.
