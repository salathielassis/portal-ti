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

Acesse `http://localhost:3000` — a rota raiz redireciona para `/dashboard`, que por sua vez pede login (use o usuário do seed: `admin@portalti.com` / `admin123`). Depois de logado, Ativos, Contratos, Fornecedores, Preços de Referência, Clientes e Obras, Financeiro, Importar Extrato e Conciliação PDF já são telas reais, consumindo a API do backend (cadastro, listagem, alocação/transferência/manutenção de ativos com histórico completo, tabela de preços por tipo de equipamento, marcar fatura como paga, relatório mensal de atividade de ativos, upload de extrato bancário, importação de extrato de locação com alerta de preço e comparação com o mês anterior). Só o Dashboard ainda mostra números fixos de exemplo em vez de dados reais, e "Configurações" é um placeholder — ambos descritos na seção 7 do `ARCHITECTURE.md`.

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

Recomendo dois repositórios separados (`portal-ti-frontend` e `portal-ti-backend`) ou um monorepo com esse `frontend/` e `backend/` — ambos funcionam com o que está aqui; monorepo é mais simples de manter sincronizado, repositórios separados facilitam configurar Netlify/cPanel apontando cada um para sua própria raiz de build.

---

## 3. Hospedagem — o que usar para cada parte

Com o que você tem disponível (Firebase, Netlify, GitHub, cPanel), a combinação mais direta é:

| Peça | Onde hospedar | Por quê |
|---|---|---|
| Frontend (Next.js) | **Netlify** | Suporte nativo a Next.js, deploy automático a cada push no GitHub, HTTPS grátis, zero configuração de servidor |
| Backend (NestJS) | **cPanel** (se tiver "Setup Node.js App") | É o único dos quatro que roda um processo Node persistente — Netlify e Firebase Hosting são para conteúdo estático/funções, não para um servidor NestJS + Postgres always-on |
| Banco de dados (PostgreSQL) | **cPanel** se tiver o addon PostgreSQL, senão um Postgres gerenciado gratuito externo (ex. Supabase ou Neon) | Muitos cPanel de hospedagem compartilhada só trazem MySQL por padrão |
| GitHub | fonte da verdade + dispara os deploys | Netlify conecta direto; cPanel normalmente atualiza via `git pull` manual ou Git Deploy do próprio painel |
| Firebase | opcional, como alternativa ao Netlify só para o frontend estático | Não é um bom encaixe para o backend NestJS (Cloud Functions exigiria reescrever o bootstrap do Nest como função serverless, e ainda faltaria um Postgres gerenciado) |

### 3.1 Frontend na Netlify

1. Login na Netlify → **Add new site → Import an existing project** → conecte sua conta do GitHub → escolha o repositório do frontend.
2. Configurações de build:
   - **Base directory**: `frontend` (se for monorepo) ou vazio (se for repositório dedicado)
   - **Build command**: `npm run build`
   - **Publish directory**: deixe a Netlify detectar automaticamente (ela usa o plugin oficial `@netlify/plugin-nextjs` para Next.js com App Router e SSR — não precisa configurar nada manualmente)
3. Em **Environment variables**, adicione `NEXT_PUBLIC_API_URL` apontando para onde o backend vai ficar, por exemplo `https://api.seudominio.com`.
4. Deploy. A cada `git push` na branch principal, a Netlify rebuilda sozinha.
5. Domínio: em **Domain settings**, você pode usar o subdomínio grátis da Netlify (`seu-projeto.netlify.app`) ou apontar um subdomínio seu (ex. `portal.seudominio.com`) criando um registro CNAME no seu DNS apontando para a Netlify — não precisa passar pelo cPanel para isso, a menos que seu DNS também seja gerenciado lá.

### 3.2 Backend no cPanel

Primeiro, confirme que seu plano tem o recurso: entre no cPanel e procure por um ícone chamado **"Setup Node.js App"** (às vezes "Node.js Selector"). Se não existir, seu cPanel é hospedagem compartilhada tradicional sem suporte a processos Node persistentes, e aí o backend precisa de outro host (nesse caso me avise que te indico opções fora da sua lista atual).

Se existir:

1. **Criar o subdomínio primeiro**: cPanel → **Subdomains** → crie, por exemplo, `api` (vira `api.seudominio.com`), apontando para uma pasta nova tipo `api.seudominio.com`.
2. **Setup Node.js App** → **Create Application**:
   - Node.js version: a mais recente disponível (18 ou 20+)
   - Application mode: Production
   - Application root: a mesma pasta do subdomínio criado
   - Application URL: selecione o subdomínio `api.seudominio.com`
   - Application startup file: `dist/main.js`
3. Envie os arquivos do backend para essa pasta — pelo Git (se o cPanel tiver **Git Version Control**, aponte para o seu repositório) ou via upload/FTP do conteúdo da pasta `backend/`.
4. No painel do Node.js App, clique em **"Run NPM Install"** (ele usa o `package.json` para instalar as dependências no ambiente do cPanel).
5. Rode o build: o painel geralmente expõe um terminal ("Enter to the virtual environment" no topo da página do app) — nele:
   ```bash
   npm run build
   npx prisma generate
   npx prisma migrate deploy
   ```
6. Configure as **variáveis de ambiente** direto na tela do Node.js App (mesmo conteúdo do seu `.env`: `DATABASE_URL`, `JWT_SECRET`, `PORT` — o cPanel geralmente define a porta internamente, então confira o valor que ele exige).
7. Clique em **Restart**. A aplicação passa a responder em `https://api.seudominio.com`.

### 3.3 Banco de dados

Verifique em cPanel → **PostgreSQL Databases** se esse addon existe no seu plano:
- **Se existir**: crie o banco e o usuário por lá, pegue host/porta/usuário/senha e monte a `DATABASE_URL` (formato `postgresql://usuario:senha@localhost:5432/nome_do_banco`) — como backend e banco ficam no mesmo servidor, a latência é mínima.
- **Se só existir MySQL**: você tem duas saídas. A mais simples é usar um Postgres gerenciado gratuito fora do cPanel (Supabase ou Neon têm tier free generoso, criam a `DATABASE_URL` pronta em minutos, e o backend se conecta remotamente sem mudar nada no código). A outra é trocar `provider = "postgresql"` por `provider = "mysql"` em `backend/prisma/schema.prisma` e usar o MySQL do próprio cPanel — funciona, mas dois ou três tipos de coluna do schema (principalmente `Json` e alguns `Decimal`) merecem uma conferência depois da troca, então só vale a pena se manter tudo dentro do cPanel for importante para você.

### 3.4 Conectando as pontas

Depois de tudo no ar: o frontend na Netlify lê `NEXT_PUBLIC_API_URL=https://api.seudominio.com`, o backend no cPanel aceita CORS de `https://portal.seudominio.com` (o `main.ts` já habilita `app.enableCors({ origin: true })` de forma permissiva para começar — vale restringir para o domínio exato antes de ir para produção de verdade, trocando `origin: true` por `origin: 'https://portal.seudominio.com'`).

---

## 4. Checklist rápido antes de ir ao ar

Trocar `JWT_SECRET` do `.env.example` por um valor forte e único em produção é o item que mais gente esquece — sem isso, qualquer token JWT antigo ou de exemplo continua "válido" teoricamente. Também vale restringir o CORS ao domínio real do frontend (item 3.4), rodar `prisma migrate deploy` (não `migrate dev`) em produção, e conferir se o upload de PDF da conciliação tem um destino de armazenamento real configurado em `StorageService` — hoje ele só monta uma URL fake, então plugar S3/Blob (ou mesmo salvar em disco no próprio cPanel, para começar) é necessário antes do módulo de conciliação funcionar de ponta a ponta em produção.
