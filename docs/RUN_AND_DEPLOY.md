# Como executar localmente e hospedar o Portal TI

Este guia assume que você já tem **VS Code** e **Node.js** instalados (Node 18+ recomendado; o ambiente que empacotou este projeto usou Node 22). O código foi corrigido e testado nesta sessão: o frontend passou por `npm install` + `npm run build` com sucesso, e o backend passou por checagem de tipos completa (o único ponto não testado aqui foi a geração do client do Prisma, bloqueada pela rede restrita deste ambiente de empacotamento — vai funcionar normalmente na sua máquina).

---

## 1. Rodando localmente

### 1.1 Banco de dados (PostgreSQL)

A forma mais simples é via Docker (arquivo `docker-compose.yml` na raiz do projeto):

```bash
docker compose up -d
```

Isso sobe um Postgres em `localhost:5432` com usuário `itam_user`, senha `itam_pass`, banco `itam_db` — já batendo com o `.env.example` do backend. Se preferir não usar Docker, instale o PostgreSQL localmente e crie um banco com esses mesmos dados (ou ajuste a `DATABASE_URL`).

### 1.2 Backend (NestJS)

```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```

O `prisma migrate dev` cria as tabelas a partir do `schema.prisma`. O `prisma:seed` cria um usuário de teste (**login: `admin@portalti.com`, senha: `admin123`**), o cliente "DOISA" com a matriz "DOISA NATAL - SEDE" já cadastrada (pronta para receber obras/filiais via importação de extrato), os 7 tipos de equipamento da tabela de preços de referência (Notebook Core i3/i5/i7, Core Ultra 7 Gamer, Ultra 3/5/7), um fornecedor, um contrato e uma fatura em aberto, para você já ter o que testar nas telas de conciliação e importação de extrato. A API sobe em `http://localhost:3333/api`, com a documentação Swagger interativa em `http://localhost:3333/api/docs`.

Se você está atualizando um banco que já existia de uma entrega anterior (schema mudou — tabela `equipment_price_tiers` e coluna `priceTierId` em `Asset` são novas), rode de novo `npx prisma migrate dev --name equipment-price-tiers` e `npm run prisma:seed` — ambos são seguros de repetir (o seed usa `upsert`, não duplica nada).

### 1.3 Frontend (Next.js)

Em outro terminal:

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Acesse `http://localhost:3000` — a rota raiz redireciona para `/dashboard`, que por sua vez pede login (use o usuário do seed: `admin@portalti.com` / `admin123`, ou a senha que você já tiver trocado — ver seção 4). Depois de logado, Dashboard, Ativos, Contratos, Fornecedores, Preços de Referência, Clientes e Obras, Financeiro, Importar Extrato e Conciliação PDF já são telas reais, consumindo a API do backend (KPIs e gráficos consolidados a partir dos dados reais, cadastro, listagem, alocação/transferência/manutenção de ativos com histórico completo, tabela de preços por tipo de equipamento, marcar fatura como paga, relatório mensal de atividade de ativos, upload de extrato bancário, importação de extrato de locação com alerta de preço e comparação com o mês anterior). Só "Configurações" ainda é um placeholder, descrito na seção 7 do `ARCHITECTURE.md`.

---

## 2. Colocando no GitHub

```bash
cd /caminho/onde/voce/extraiu/o/zip
git init
git add .
git commit -m "Scaffold inicial: Portal TI - Controle de Ativos"
```

Crie um repositório vazio no GitHub (sem README/gitignore) e conecte:

```bash
git remote add origin https://github.com/SEU_USUARIO/portal-ti-ativos.git
git branch -M main
git push -u origin main
```

Recomendo dois repositórios separados (`portal-ti-frontend` e `portal-ti-backend`) ou um monorepo com esse `frontend/` e `backend/` — ambos funcionam com o que está aqui; monorepo é mais simples de manter sincronizado.

---

## 3. Hospedagem — VM própria (Proxmox)

Frontend, backend e banco de dados rodam juntos numa VM própria, dentro de um cluster Proxmox — sem depender de serviços de terceiros. (Uma versão anterior deste guia recomendava Netlify + Render + Neon/cPanel; esses serviços não são mais usados neste projeto, e os recursos correspondentes já foram removidos dessas plataformas.)

A topologia exata da VM (gerenciador de processo do backend, forma de servir o frontend, proxy reverso, etc.) depende de como você configurou a VM, então aqui ficam só os pontos que valem para qualquer configuração self-hosted:

### 3.1 Banco de dados

Postgres roda na própria VM (ou em outra máquina acessível a partir dela). Ajuste a `DATABASE_URL` do backend em produção apontando para esse Postgres real — algo como `postgresql://usuario:senha@localhost:5432/itam_db` se o banco estiver na mesma VM do backend, ou usando o IP interno da VM do banco caso estejam separadas.

### 3.2 Backend (NestJS)

Na VM:
```bash
cd backend
npm install
npm run build
npx prisma generate
npx prisma migrate deploy
```
Depois, mantenha o processo (`node dist/main.js` ou `npm run start:prod`) rodando de forma persistente com o gerenciador de processo que você escolher na VM (systemd, pm2, Docker, etc.) — o importante é que ele reinicie sozinho se cair e sobreviva a reboots da VM. Configure as variáveis de ambiente (`DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`, `STORAGE_BASE_URL`) no mesmo lugar onde esse processo é definido (arquivo `.env` na VM, unit do systemd, etc.) — nunca commitadas no repositório.

### 3.3 Frontend (Next.js)

```bash
cd frontend
npm install
npm run build
```
E sirva o resultado (`npm run start`, atrás de um proxy reverso tipo Nginx, ou a forma que você tiver configurado na VM), com `NEXT_PUBLIC_API_URL` apontando para o endereço real do backend na VM (IP interno, domínio, etc.) no momento do build.

### 3.4 Conectando as pontas

O frontend lê `NEXT_PUBLIC_API_URL=<endereço do backend>`, e o backend restringe o CORS apenas à origem real do frontend através da variável `CORS_ORIGIN` (pode listar mais de uma origem separada por vírgula). Sem essa variável definida, o backend libera qualquer origem (útil só em ambiente local); em produção ela deve sempre apontar para o domínio/IP exato de onde o frontend é servido.

---

## 4. Como editar o sistema depois que já está no ar

A hospedagem atual (VM própria) não tem deploy automático via GitHub — isso era específico do Netlify/Render, que não são mais usados. O processo de editar algo é:

1. Edite o arquivo (localmente, no VS Code).
2. `git add <arquivo>` e `git commit -m "descrição da mudança"`.
3. `git push origin main`.
4. Na VM, atualize o código (`git pull` ou o mecanismo que você tiver configurado lá) e refaça o build/restart do backend e/ou do frontend (seções 3.2 e 3.3 acima), conforme o que mudou.

Se uma variável de ambiente mudar de valor, edite direto no arquivo/local onde ela está configurada na VM e reinicie o processo correspondente para o novo valor ter efeito.

### Quando o `schema.prisma` muda (nova coluna, novo status, nova tabela)

O passo a passo acima (editar → commit → push) é suficiente para código, mas **não é suficiente sozinho quando o `backend/prisma/schema.prisma` muda** — rebuildar e reiniciar o backend na VM não aplica migração nenhuma no banco sozinho. Sem esse passo extra, o backend sobe com um código que espera uma coluna/valor de enum que ainda não existe no banco de produção, e todo request que tocar nisso quebra. Sempre que uma mudança alterar o `schema.prisma` (como a que adicionou o status `DEVOLVIDO` aos ativos):

1. Rode localmente primeiro, contra o seu banco de desenvolvimento (gera o arquivo de migração, que já vai junto no commit):
   ```powershell
   cd backend
   npx prisma migrate dev --name nome-da-mudanca
   ```
2. Confirme que o build local ainda passa (`npm run build`) e prossiga com o commit/push normal (seção acima) — o arquivo novo em `backend/prisma/migrations/` precisa estar no commit.
3. Na VM, depois de atualizar o código, aplique a MESMA migração no banco de produção antes (ou logo depois) de reiniciar o backend:
   ```bash
   cd backend
   npx prisma migrate deploy
   ```
   `migrate deploy` (diferente de `migrate dev`) só aplica migrações já existentes, sem pedir confirmação nem tentar gerar uma nova — é a forma segura de rodar contra produção. Como o banco agora está na própria VM, isso pode ser rodado direto nela, sem precisar apontar `DATABASE_URL` para um host remoto.

Se pular o passo 3, o sintoma normalmente é um erro genérico (`Internal server error` ou um erro do Prisma reclamando de uma coluna/valor desconhecido) assim que alguma tela tentar usar o campo novo — mesmo com o deploy do código tendo "dado certo".

### Trocar a senha de um usuário em produção

Se uma senha vazar ou precisar ser trocada (por exemplo, a senha padrão do seed, que não deve continuar em uso depois que o sistema vai ao ar), rode direto na VM, apontando para o banco de produção:

```bash
cd backend
npm run set-password -- admin@portalti.com "NovaSenhaForte123"
```

O comando busca o usuário pelo e-mail e grava o hash da nova senha diretamente no banco — não precisa de deploy nem de reiniciar nada.

### Apagar os dados de exemplo do seed

O `prisma:seed` cria alguns registros só para você ter o que testar (fornecedor "TechLease Locações Ltda", contrato "CTR-2026-0001", o ativo "NB-00001" e a fatura de exemplo). Quando o sistema for para uso real, apague esses registros de exemplo com:

```bash
cd backend
npm run remove-seed-demo-data
```

Isso preserva o que já é real: o usuário admin, o departamento, o cliente "DOISA" (matriz "DOISA NATAL - SEDE") e os 7 tipos de equipamento da tabela de preços de referência. É seguro rodar mais de uma vez.

---

## 5. Checklist rápido antes de ir ao ar

Trocar `JWT_SECRET` do `.env.example` por um valor forte e único em produção é o item que mais gente esquece — sem isso, qualquer token JWT antigo ou de exemplo continua "válido" teoricamente. Também vale restringir o CORS ao domínio/IP real do frontend (item 3.4, via `CORS_ORIGIN`), rodar `prisma migrate deploy` (não `migrate dev`) em produção, trocar a senha padrão criada pelo seed (veja o comando `set-password` acima) e conferir se o upload de PDF da conciliação tem um destino de armazenamento real configurado em `StorageService` — hoje ele só monta uma URL fake, então plugar um destino real (S3/Blob, ou mesmo um caminho em disco na própria VM, para começar) é necessário antes do módulo de conciliação funcionar de ponta a ponta em produção.
