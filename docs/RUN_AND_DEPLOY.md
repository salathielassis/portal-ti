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

> **Nota:** no deploy real deste projeto, o backend acabou hospedado no **Render** (não no cPanel) e o banco no **Neon** — ambos free tier — porque o cPanel disponível não tinha "Setup Node.js App". As instruções de cPanel abaixo continuam válidas como alternativa caso você troque de hospedagem futuramente.

### 3.1 Frontend na Netlify

1. Login na Netlify → **Add new site → Import an existing project** → conecte sua conta do GitHub → escolha o repositório do frontend.
2. Configurações de build:
   - **Base directory**: `frontend` (se for monorepo) ou vazio (se for repositório dedicado)
   - **Build command**: `npm run build`
   - **Publish directory**: em monorepo, defina explicitamente como `frontend/.next` (deixar em branco causa erro quando "Base directory" já está definido) — e confira em **Project configuration → Build & deploy** se o **Runtime** está marcado como **Next.js**; se estiver "Not set", selecione manualmente, senão o site fica com 404 em todas as rotas.
3. Em **Environment variables**, adicione `NEXT_PUBLIC_API_URL` apontando para onde o backend vai ficar, por exemplo `https://api.seudominio.com` (ou a URL do Render, se for esse o caso).
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

Depois de tudo no ar: o frontend lê `NEXT_PUBLIC_API_URL=https://<sua-api>`, e o backend restringe o CORS apenas ao domínio real do frontend através da variável de ambiente `CORS_ORIGIN` (ex.: `CORS_ORIGIN=https://portal-ti.netlify.app`, podendo listar mais de uma origem separada por vírgula) — configurada direto no painel do Render (ou do cPanel, se for o caso). Sem essa variável definida, o backend libera qualquer origem (útil só em ambiente local); em produção ela deve sempre apontar para o domínio exato do frontend.

---

## 4. Como editar o sistema depois que já está no ar

A hospedagem atual (Netlify para o frontend, Render para o backend) está configurada com **deploy contínuo via GitHub**: os dois serviços ficam "escutando" a branch `main` do repositório. Isso significa que o processo de editar algo é sempre o mesmo, sem precisar mexer manualmente no painel do Netlify ou do Render de novo:

1. Edite o arquivo (localmente, no VS Code).
2. `git add <arquivo>` e `git commit -m "descrição da mudança"`.
3. `git push origin main`.
4. Pronto — o Render detecta o push e refaz o build do backend automaticamente (acompanhe em **Render → seu serviço → Events/Logs**), e a Netlify faz o mesmo para o frontend (acompanhe em **Netlify → seu site → Deploys**). Cada deploy leva de 1 a 3 minutos.

Não é preciso recriar o serviço nem reconfigurar variáveis de ambiente a cada mudança — isso só é necessário se a própria variável mudar de valor (nesse caso, edite direto em **Render → Environment** ou **Netlify → Project configuration → Environment variables**, o que dispara um novo deploy sozinho).

### Quando o `schema.prisma` muda (nova coluna, novo status, nova tabela)

O passo a passo acima (editar → commit → push) é suficiente para código, mas **não é suficiente sozinho quando o `backend/prisma/schema.prisma` muda** — o Render só builda e roda o servidor (`npm run build` + `node dist/main`), ele não aplica migração nenhuma no banco de produção sozinho. Sem esse passo extra, o backend sobe com um código que espera uma coluna/valor de enum que ainda não existe no Neon, e todo request que tocar nisso quebra. Sempre que uma mudança alterar o `schema.prisma` (como a que adicionou o status `DEVOLVIDO` aos ativos):

1. Rode localmente primeiro, contra o seu banco de desenvolvimento (gera o arquivo de migração, que já vai junto no commit):
   ```powershell
   cd backend
   npx prisma migrate dev --name nome-da-mudanca
   ```
2. Confirme que o build local ainda passa (`npm run build`) e prossiga com o commit/push normal (seção acima) — o arquivo novo em `backend/prisma/migrations/` precisa estar no commit.
3. Depois que o Render terminar de subir a nova versão do backend, aplique a MESMA migração no banco de produção (Neon), rodando localmente com a `DATABASE_URL` de produção (mesmo truque do `set-password`):
   ```powershell
   cd backend
   $env:DATABASE_URL="postgresql://...string-de-conexao-do-neon...";  npx prisma migrate deploy
   ```
   `migrate deploy` (diferente de `migrate dev`) só aplica migrações já existentes, sem pedir confirmação nem tentar gerar uma nova — é a forma seguro de rodar contra produção.

Se pular o passo 3, o sintoma normalmente é um erro genérico (`Internal server error` ou um erro do Prisma reclamando de uma coluna/valor desconhecido) assim que alguma tela tentar usar o campo novo — mesmo com o deploy do código tendo "dado certo".

### Trocar a senha de um usuário em produção

Se uma senha vazar ou precisar ser trocada (por exemplo, a senha padrão do seed, que não deve continuar em uso depois que o sistema vai ao ar), rode localmente, apontando para o banco de produção (Neon), sem alterar seu `.env` local:

```powershell
cd backend
$env:DATABASE_URL="postgresql://...string-de-conexao-do-neon...";  npm run set-password -- admin@portalti.com "NovaSenhaForte123"
```

O comando busca o usuário pelo e-mail e grava o hash da nova senha diretamente no banco — não precisa de deploy nem de reiniciar nada.

### Apagar os dados de exemplo do seed

O `prisma:seed` cria alguns registros só para você ter o que testar (fornecedor "TechLease Locações Ltda", contrato "CTR-2026-0001", o ativo "NB-00001" e a fatura de exemplo). Quando o sistema for para uso real, apague esses registros de exemplo com:

```powershell
cd backend
$env:DATABASE_URL="postgresql://...string-de-conexao-do-neon...";  npm run remove-seed-demo-data
```

Isso preserva o que já é real: o usuário admin, o departamento, o cliente "DOISA" (matriz "DOISA NATAL - SEDE") e os 7 tipos de equipamento da tabela de preços de referência. É seguro rodar mais de uma vez.

---

## 5. Checklist rápido antes de ir ao ar

Trocar `JWT_SECRET` do `.env.example` por um valor forte e único em produção é o item que mais gente esquece — sem isso, qualquer token JWT antigo ou de exemplo continua "válido" teoricamente. Também vale restringir o CORS ao domínio real do frontend (item 3.4, já feito neste deploy via `CORS_ORIGIN`), rodar `prisma migrate deploy` (não `migrate dev`) em produção, trocar a senha padrão criada pelo seed (veja o comando `set-password` acima) e conferir se o upload de PDF da conciliação tem um destino de armazenamento real configurado em `StorageService` — hoje ele só monta uma URL fake, então plugar S3/Blob (ou mesmo salvar em disco no próprio cPanel, para começar) é necessário antes do módulo de conciliação funcionar de ponta a ponta em produção.
