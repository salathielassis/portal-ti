# Como executar o Portal TI no seu computador — guia para quem não é programador

Você está certo: tudo isso roda dentro do VS Code, no terminal dele. Este guia parte do zero — desde extrair o arquivo até ver o sistema aberto no navegador — explicando cada termo técnico na hora em que ele aparece.

Ideia geral antes de começar: este sistema tem duas partes que rodam **ao mesmo tempo, em dois terminais separados**: o **backend** (o "motor", que fala com o banco de dados e responde perguntas como "quais ativos existem") e o **frontend** (a tela bonita que você vê no navegador). Eles são dois programas independentes, então cada um precisa do seu próprio terminal aberto e rodando. Se você fechar o terminal, aquela parte para de funcionar.

---

## Parte 0 — Conferir se as ferramentas estão instaladas

Antes de tudo, abra o terminal do seu sistema operacional (não precisa ser no VS Code ainda — pode ser o Prompt de Comando/PowerShell no Windows, ou o Terminal no Mac) e digite, um de cada vez, apertando Enter depois de cada linha:

```bash
node -v
npm -v
git --version
```

Cada comando desses deve responder com um número de versão (tipo `v20.11.0`). Se algum der erro tipo "comando não encontrado", é porque falta instalar aquela ferramenta — mas você mencionou que já tem Node.js, então provavelmente as duas primeiras já vão funcionar. O `npm` (Node Package Manager, "gerenciador de pacotes do Node") vem junto quando você instala o Node.js, não é uma instalação separada.

Você também vai precisar do **Docker Desktop** para rodar o banco de dados PostgreSQL localmente sem complicação. Se ainda não tem, baixe em [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/), instale como qualquer programa normal, e abra-o uma vez para garantir que ele iniciou (ele fica com um ícone na bandeja do sistema). Depois, no terminal:

```bash
docker --version
```

Se aparecer um número de versão, está pronto.

---

## Parte 1 — Extrair o arquivo e organizá-lo numa pasta permanente

O arquivo que te mandei (`itam-project-scaffold.zip`) provavelmente está na sua pasta de Downloads agora. Antes de abrir no VS Code, mova-o para um lugar definitivo — Downloads não é lugar para projetos que você vai continuar desenvolvendo.

Sugestão: crie uma pasta chamada `Projetos` dentro de Documentos (ou onde preferir), e dentro dela extraia o zip. No Windows, clique com o botão direito no arquivo `.zip` → **"Extrair tudo..."** → escolha esse destino. No Mac, dois cliques no `.zip` já extrai ao lado dele, e depois você arrasta a pasta resultante para onde quiser.

Ao final, você deve ter uma pasta chamada `itam-project` (ou o nome que você deu) contendo duas pastas dentro: `backend` e `frontend`, mais um arquivo `docker-compose.yml` e uma pasta `docs`.

---

## Parte 2 — Abrir a pasta no VS Code

1. Abra o VS Code.
2. Menu **File → Open Folder...** (no Mac: **File → Open...**).
3. Selecione a pasta `itam-project` inteira (a pasta-mãe, não `backend` nem `frontend` individualmente) e clique em Abrir/Select Folder.
4. O VS Code vai recarregar mostrando, na barra lateral esquerda (o "Explorer"), a árvore de arquivos: `backend/`, `frontend/`, `docs/`, `docker-compose.yml`.

Isso é tudo que "adicionar ao VS Code" significa — você não precisa criar nada do zero, só abrir a pasta que já veio pronta.

---

## Parte 3 — Abrir o terminal integrado do VS Code

O terminal integrado é uma janela de linha de comando que já abre exatamente dentro da pasta do seu projeto — é por isso que usamos ele em vez do terminal comum do sistema.

Para abrir: menu **Terminal → New Terminal** (ou o atalho **Ctrl+`** — a tecla de crase, geralmente acima do Tab, à esquerda do "1" no teclado). Vai abrir um painel na parte de baixo do VS Code com um cursor piscando, já dentro da pasta `itam-project`.

Cada linha de comando que eu te passar a seguir, você digita ali (ou copia e cola) e aperta Enter. O terminal mostra o que está acontecendo em tempo real; espere cada comando terminar (o cursor volta a ficar disponível) antes de digitar o próximo.

---

## Parte 4 — Subir o banco de dados (PostgreSQL)

Com o Docker Desktop aberto e rodando, no terminal do VS Code digite:

```bash
docker compose up -d
```

Isso lê o arquivo `docker-compose.yml` que já está na pasta e cria (na primeira vez) um "container" — pense nele como uma caixinha isolada rodando um PostgreSQL configurado exatamente do jeito que o sistema espera, sem você precisar instalar banco de dados nenhum na sua máquina. O `-d` significa "rode em segundo plano" (você não precisa deixar um terminal preso nisso). Para confirmar que subiu:

```bash
docker ps
```

Deve aparecer uma linha com o nome `itam-postgres`.

---

## Parte 5 — Rodar o backend (o motor do sistema)

Ainda no mesmo terminal (ou abra um novo — não faz diferença nesta etapa), "entre" na pasta do backend:

```bash
cd backend
```

`cd` significa "change directory" (mudar de pasta) — a partir de agora, os comandos rodam dentro de `backend/`.

Agora, uma cópia do arquivo de configuração de ambiente:

```bash
cp .env.example .env
```

Isso duplica o arquivo `.env.example` (que já vem com os valores certos para o Docker que você acabou de subir) criando um `.env` — é esse `.env` que o sistema realmente lê. Separar os dois é uma prática padrão: o `.env.example` fica público/versionado como modelo, o `.env` fica só na sua máquina (nunca é enviado ao GitHub) porque é onde ficariam senhas reais em produção.

Instalar as dependências do projeto (bibliotecas de código que o backend usa por baixo dos panos):

```bash
npm install
```

Isso demora um pouco na primeira vez (baixa tudo da internet) e cria uma pasta `node_modules` — pode ignorá-la, é só material de apoio, nunca precisa abrir.

Gerar o "client" do Prisma (Prisma é a ferramenta que traduz o desenho das tabelas em código que o backend entende):

```bash
npx prisma generate
```

Criar de fato as tabelas dentro do banco de dados que subiu no Docker:

```bash
npx prisma migrate dev --name init
```

Aqui pode aparecer uma pergunta no terminal — só confirme (Enter ou "y") se ele perguntar algo como o nome da migração; o `--name init` já responde a maior parte.

Popular o banco com alguns dados de teste (um usuário para você logar, um fornecedor, um contrato de exemplo):

```bash
npm run prisma:seed
```

No final desse comando, o terminal mostra a mensagem com o login de teste: `admin@portalti.com` / senha `admin123`.

E finalmente, ligar o backend:

```bash
npm run start:dev
```

O terminal vai ficar "preso" mostrando logs — isso é esperado, significa que o servidor está rodando e escutando. **Não feche esse terminal.** Você deve ver uma mensagem parecida com `Portal TI backend rodando em http://localhost:3333/api`.

---

## Parte 6 — Rodar o frontend (a tela), em um SEGUNDO terminal

Como o backend do passo anterior ficou ocupado rodando, você precisa de **outro terminal** para o frontend. No VS Code, clique no ícone de "+" no canto do painel de terminal (ou **Terminal → New Terminal** de novo) — isso abre uma segunda aba de terminal, mantendo a primeira (do backend) rodando por trás.

No terminal novo, volte para a pasta principal e entre no frontend:

```bash
cd frontend
```

(Se o terminal novo já abrir dentro de `itam-project` e não dentro de `backend`, ótimo, só rode `cd frontend`. Se ele abrir "dentro" do backend por engano, rode `cd ../frontend`.)

Copiar o arquivo de ambiente, igual fizemos no backend:

```bash
cp .env.local.example .env.local
```

Instalar as dependências:

```bash
npm install
```

E ligar o frontend:

```bash
npm run dev
```

Esse terminal também vai ficar "preso" mostrando logs — normal, é o servidor de desenvolvimento do frontend rodando. Ele deve mostrar algo como `Local: http://localhost:3000`.

---

## Parte 7 — Ver funcionando

Com os dois terminais rodando (backend na porta 3333, frontend na porta 3000), abra o navegador e acesse:

```
http://localhost:3000
```

Você vai cair primeiro numa tela de login — use o usuário criado pelo seed (`admin@portalti.com` / senha `admin123`). Depois de entrar, você já vê o Dashboard com sidebar, cards e gráficos, e os menus Ativos, Contratos, Fornecedores, Preços de Referência, Clientes e Obras, Financeiro, Importar Extrato, Conciliação PDF e Relatórios já são telas reais: dá para cadastrar um fornecedor, criar um contrato, cadastrar um ativo e alocá-lo, transferi-lo entre obras/filiais, mandar para manutenção e ver o histórico completo, lançar uma fatura e marcá-la como paga, ver o relatório mensal de ativos (quantos ativos, devolvidos e novos, com a data exata de entrada/saída) em **Financeiro**, cadastrar o valor esperado de cada tipo de notebook em **Preços de Referência**, enviar um PDF de extrato bancário para testar a conciliação automática, e enviar o PDF do "Extrato de Locação" que a locadora manda todo mês em **Importar Extrato**: o sistema lê o CNPJ da obra, o contrato e cada equipamento (nº de série, tombo, modelo, valor e data de instalação) direto do PDF, classifica automaticamente o tipo de cada equipamento, avisa quando o valor cobrado destoa da tabela de referência e mostra o que mudou desde o mês anterior naquela obra, tudo antes de gravar qualquer coisa — só grava no banco quando você confirma. Em **Relatórios**, dá para filtrar os equipamentos por centro de custo (obra/filial), contrato, tipo ou status — ou marcar linhas específicas com o checkbox — e exportar em **XLS** (com todas as colunas: série, fornecedor, valores, datas) ou **PDF** (resumo em paisagem, com totais por centro de custo e por status) para levar à gestão. O botão de sol/lua no canto superior direito alterna entre tema claro e escuro em qualquer uma dessas telas.

Para conferir o backend diretamente (fora do que o frontend já usa), acesse:

```
http://localhost:3333/api/docs
```

Essa é a documentação interativa (Swagger) de todos os endpoints da API — dá para testar o login e os endpoints de conciliação diretamente por ali, sem precisar programar nada, só preenchendo formulários na tela.

---

## Se você já tinha o projeto rodando de uma versão anterior

Esta entrega trouxe campos e uma tabela novos no banco (tipos de equipamento, `priceTierId` no ativo). Se você já tinha rodado `npx prisma migrate dev` e `npm run prisma:seed` antes, precisa repetir os dois no terminal do **backend** para pegar essas novidades (isso não apaga os dados que você já tinha, como os ativos importados de extratos anteriores):

```bash
cd backend
npx prisma migrate dev --name equipment-price-tiers
npm run prisma:seed
```

O `migrate dev` cria a tabela nova e a coluna nova sem mexer no que já existe; o `prisma:seed` é seguro rodar de novo — ele usa `upsert`, então não duplica o usuário admin nem os 7 tipos de equipamento se você já os tiver.

---

## Para rodar de novo depois (nos próximos dias)

Você só faz o Parte 0–1–2 uma vez. Nas próximas vezes que for abrir o projeto:

1. Abra o Docker Desktop (se não abrir sozinho).
2. Abra o VS Code na pasta do projeto.
3. Terminal 1: `docker compose up -d`, depois `cd backend` e `npm run start:dev`.
4. Terminal 2: `cd frontend` e `npm run dev`.

Não precisa repetir `npm install`, `prisma generate`, `migrate` nem `seed` — isso já ficou salvo. Só repete se você apagar a pasta `node_modules` ou resetar o banco.

---

## Se algo der errado

**"porta 3000 (ou 3333) já está em uso"** — algum terminal anterior ainda está rodando por trás. Feche todos os terminais do VS Code (ícone de lixeira em cada aba) e abra de novo.

**"comando não encontrado" ao rodar `npm` ou `npx`** — o terminal do VS Code às vezes abre antes do Node.js estar disponível no PATH do sistema; feche o VS Code inteiro e abra de novo.

**Docker não sobe / `docker compose up -d` dá erro** — confirme que o ícone do Docker Desktop na bandeja do sistema mostra "Running" (às vezes ele demora ~30 segundos para ligar depois de aberto).

**Qualquer outro erro** — copie a mensagem completa que apareceu no terminal (o texto em vermelho, geralmente) e me manda; com o texto exato eu identifico o problema bem mais rápido do que com uma descrição geral tipo "deu erro".

---

Quando isso tudo estiver rodando local e você já tiver visto o dashboard no navegador, me avisa que a gente parte para o próximo passo: publicar de verdade (GitHub → Netlify → cPanel), que já expliquei no `RUN_AND_DEPLOY.md` — mas vamos fazer aquilo com calma também, um passo de cada vez, do mesmo jeito que este aqui.
