# Portal TI — Controle de Ativos (ITAM)
### Documento de Arquitetura e Ponto de Partida do Desenvolvimento

Este documento acompanha o scaffold de código entregue junto a ele. Ele registra as decisões de modelagem, a estrutura de pastas escolhida e como o design system (incluindo a paleta de marca e o modo claro/escuro) foi implementado, para que qualquer pessoa da equipe possa continuar o desenvolvimento a partir daqui.

---

## 1. Modelagem do Banco de Dados

O modelo é relacional (PostgreSQL) e foi desenhado em torno de seis domínios: identidade/RBAC, clientes/obras, ativos, contratos/fornecedores, financeiro, e conciliação bancária. O schema completo, pronto para uso com Prisma ORM, está em `backend/prisma/schema.prisma`.

### 1.1 Diagrama Entidade-Relacionamento

```mermaid
erDiagram
    USER ||--o{ ASSET_ALLOCATION : aloca
    USER }o--|| DEPARTMENT : pertence

    DEPARTMENT ||--o{ ASSET_ALLOCATION : recebe
    DEPARTMENT ||--o{ INVOICE_COST_ALLOCATION : rateia

    CLIENT ||--o{ SITE : possui

    SITE ||--o{ ASSET_ALLOCATION : recebe
    SITE ||--o{ CONTRACT : coberto_por

    ASSET }o--|| SUPPLIER : fornecido_por
    ASSET }o--|| CONTRACT : vinculado_a
    ASSET }o--|| EQUIPMENT_PRICE_TIER : classificado_como
    ASSET ||--o{ ASSET_ALLOCATION : historico
    ASSET ||--o{ ASSET_MOVEMENT : movimentacoes

    SUPPLIER ||--o{ CONTRACT : possui

    CONTRACT ||--o{ ASSET : cobre
    CONTRACT ||--o{ INVOICE : gera
    CONTRACT ||--o{ CONTRACT_ALERT : dispara

    INVOICE ||--o{ INVOICE_COST_ALLOCATION : rateada_em
    INVOICE ||--o{ RECONCILIATION_MATCH : conciliada_por

    RECONCILIATION ||--o{ BANK_TRANSACTION : contem
    RECONCILIATION ||--o{ RECONCILIATION_MATCH : produz
    BANK_TRANSACTION ||--o| RECONCILIATION_MATCH : casada_com

    CLIENT {
        uuid id PK
        string name "ex.: DOISA"
        string cnpjRoot UK "8 primeiros dígitos do CNPJ"
    }
    SITE {
        uuid id PK
        uuid clientId FK
        string name "ex.: EQUIP - BARRO ALTO GO"
        string costCenterLabel "campo CLASSIFICAÇÃO do extrato"
        string cnpj UK "CNPJ completo da filial/obra (ou da matriz)"
        bool isHeadquarters
    }
    USER {
        uuid id PK
        string name
        string email UK
        enum role "ADMIN | FINANCEIRO | SUPORTE"
        uuid departmentId FK
    }
    DEPARTMENT {
        uuid id PK
        string name UK
        string costCenterCode
    }
    ASSET {
        uuid id PK
        string assetTag UK
        string serialNumber UK
        enum type "NOTEBOOK | IMPRESSORA | ..."
        enum ownership "PROPRIO | LOCADO"
        enum status "EM_USO | ESTOQUE | MANUTENCAO | DESCARTADO"
        json specs
        uuid contractId FK
        uuid supplierId FK
        uuid priceTierId FK "tipo classificado automaticamente — null se não reconhecido"
        decimal monthlyValue "valor de locação deste equipamento no extrato"
        datetime installationDate "data de instalação lida do extrato"
    }
    EQUIPMENT_PRICE_TIER {
        uuid id PK
        string label UK "ex.: Notebook Core i5"
        string_array keywords "casam por AND; use A|B dentro de um item para OR"
        decimal referenceValue "valor mensal esperado para o tipo"
        int sortOrder "menor = avaliado primeiro (regras específicas antes das genéricas)"
        bool active
    }
    ASSET_ALLOCATION {
        uuid id PK
        uuid assetId FK
        string assignedToName
        uuid departmentId FK "centro de custo interno (equipe de TI)"
        uuid siteId FK "obra/filial do CLIENTE onde o ativo está instalado"
        datetime deliveryDate
        datetime returnDate
        bool isActive
    }
    ASSET_MOVEMENT {
        uuid id PK
        uuid assetId FK
        enum type "ENTREGA | DEVOLUCAO | TRANSFERENCIA | MANUTENCAO_ENTRADA | MANUTENCAO_SAIDA | DESCARTE"
        datetime occurredAt
    }
    SUPPLIER {
        uuid id PK
        string name
        string cnpj UK
        int slaHours
    }
    CONTRACT {
        uuid id PK
        string contractNumber UK
        uuid supplierId FK
        uuid siteId FK "obra/filial coberta por este contrato"
        enum status
        datetime startDate
        datetime endDate
        decimal monthlyValuePerAsset
        decimal earlyTerminationFee
        decimal annualReadjustPct
    }
    CONTRACT_ALERT {
        uuid id PK
        uuid contractId FK
        enum threshold "D30 | D15 | D07"
        bool acknowledged
    }
    INVOICE {
        uuid id PK
        uuid contractId FK
        datetime referenceMonth
        datetime dueDate
        decimal grossValue
        enum status "PENDENTE | CONCILIADA | PAGA | VENCIDA"
    }
    INVOICE_COST_ALLOCATION {
        uuid id PK
        uuid invoiceId FK
        uuid departmentId FK
        decimal percentage
        decimal value
    }
    RECONCILIATION {
        uuid id PK
        datetime referenceMonth
        string fileName
        enum status "PROCESSANDO | CONCLUIDA | ERRO"
        int totalTransactions
        int matchedCount
    }
    BANK_TRANSACTION {
        uuid id PK
        uuid reconciliationId FK
        datetime transactionDate
        string description
        decimal amount
        bool matched
    }
    RECONCILIATION_MATCH {
        uuid id PK
        uuid bankTransactionId FK UK
        uuid invoiceId FK
        enum matchType "AUTOMATICO | SUGERIDO | MANUAL"
        enum matchStatus "PENDENTE_REVISAO | CONFIRMADO | REJEITADO"
        decimal confidenceScore
        decimal valueDelta
    }
```

### 1.2 Decisões de modelagem

**Rastreabilidade separada em duas tabelas.** `AssetAllocation` guarda o "quem está com o ativo agora e desde quando" (consultada o tempo todo, com índice em `isActive`); `AssetMovement` é um log de auditoria imutável (toda mudança de status/posse gera uma linha). Misturar as duas em uma tabela só forçaria queries de "estado atual" a varrer histórico completo.

**`specs` como `Json`.** Configuração de hardware varia demais entre notebook e impressora (CPU/RAM/SSD vs. resolução/toner) para justificar colunas fixas ou uma tabela EAV. Um campo JSONB com índice GIN opcional resolve os dois casos sem migração a cada novo atributo.

**Conciliação em três tabelas encadeadas.** `Reconciliation` (a sessão de upload) → `BankTransaction` (cada linha extraída do PDF, inclusive as sem match, para auditoria total) → `ReconciliationMatch` (o vínculo, com `matchType` e `confidenceScore` explícitos). Isso permite reprocessar ou reverter uma sessão inteira sem perder o que foi extraído do PDF original.

**Cliente vs. Site (obra/filial) como entidades separadas.** `Client` é o grupo empresarial, identificado pela raiz do CNPJ (8 primeiros dígitos, compartilhados entre matriz e todas as filiais). `Site` é cada local físico — a própria matriz/sede inclusive — com CNPJ completo próprio; é em `Site` que o ativo é fisicamente alocado (`AssetAllocation.siteId`) e é o `Site` que um `Contract` cobre. Essa separação existe porque o campo "CLASSIFICAÇÃO" do extrato da locadora (ex.: "EQUIP - BARRO ALTO GO") identifica uma obra específica, não a empresa como um todo — e uma mesma empresa (mesma raiz de CNPJ) pode ter dezenas de obras, cada uma com seu próprio CNPJ e seus próprios ativos locados, mas devendo aparecer agrupada sob o mesmo `Client` nos relatórios executivos.

**Alertas de contrato como registros, não como cron efêmero.** `ContractAlert` com `@@unique([contractId, threshold])` garante que o job agendado (30/15/7 dias) não duplique notificações e permite consultar "quais alertas já foram reconhecidos" na UI.

**`EquipmentPriceTier` como tabela, não como enum ou constante no código.** O financeiro pediu uma tabela de preços por tipo de equipamento (ex.: "Notebook Core i5 — R$ 220,00") que precisa ser editável sem deploy — inclusive as palavras-chave que reconhecem cada tipo na descrição livre do extrato. Um enum fixo exigiria alterar código toda vez que a locadora trocasse a nomenclatura de um modelo; uma tabela com `keywords: String[]` e `sortOrder` resolve isso pela UI (`/precos-referencia`). `Asset.priceTierId` é opcional (`String?`) de propósito: um equipamento cuja descrição não bate com nenhuma regra fica "não classificado" em vez de travar a importação — informação insuficiente não é o mesmo que erro.

---

## 2. Estrutura de Pastas

O scaffold entregue já contém os arquivos marcados com `●` — isso inclui, desde a segunda rodada de desenvolvimento, os módulos de Ativos, Contratos, Fornecedores e Financeiro completos (backend com CRUD real + telas no frontend consumindo a API), e, desde a rodada de deploy em produção, o Dashboard (Módulo D) já consumindo dados reais via `GET /dashboard/summary`. Os demais itens (sem `●`) são a estrutura-alvo recomendada para o que ainda falta: cadastro de usuários e o job automático de alertas de contrato.

### 2.1 Backend (NestJS + TypeScript + Prisma)

```
backend/
├── prisma/
│   └── schema.prisma                      ●  modelo completo (seção 1)
├── src/
│   ├── main.ts                              ●  bootstrap Nest + Swagger + ValidationPipe global
│   ├── app.module.ts                        ●  agrega todos os módulos de domínio
│   │
│   ├── common/                                código transversal, sem regra de negócio
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts          ●  @Roles(...)
│   │   │   └── current-user.decorator.ts   ●  @CurrentUser()
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts           ●  valida Bearer token
│   │   │   └── roles.guard.ts              ●  RBAC (Admin/Financeiro/Suporte)
│   │   ├── filters/                            HttpExceptionFilter global
│   │   ├── interceptors/                       logging / transform de resposta
│   │   └── storage/
│   │       ├── storage.service.ts          ●  abstração de storage (S3/Blob)
│   │       └── storage.module.ts           ●
│   │
│   ├── prisma/
│   │   ├── prisma.service.ts               ●  client Prisma como provider Nest
│   │   └── prisma.module.ts                ●  @Global(), exporta o client
│   │
│   └── modules/
│       ├── auth/                            ●  login (JWT), estratégia Passport — falta refresh token
│       ├── departments/                     ●  listagem simples (dropdowns de alocação/rateio)
│       ├── clients/                         ●  Cliente + Site (obra/filial) — CRUD leve + listagem
│       │   └── dto/
│       │       ├── create-client.dto.ts    ●
│       │       └── create-site.dto.ts      ●
│       ├── users/                              próxima etapa — CRUD de usuários + RBAC pela UI
│       ├── suppliers/                       ●  Módulo B — CRUD de fornecedores
│       ├── contracts/                       ●  Módulo B — CRUD de contratos + `/contracts/expiring`
│       ├── equipment-pricing/               ●  tabela de preços de referência por tipo + classificador
│       │   │                                    compartilhado (usado por assets/ e lease-import/)
│       │   ├── dto/
│       │   │   ├── create-price-tier.dto.ts ●
│       │   │   └── update-price-tier.dto.ts ●
│       │   ├── equipment-pricing.controller.ts ●  CRUD em /equipment-price-tiers
│       │   ├── equipment-pricing.service.ts ●  CRUD + `classify(description)`
│       │   └── equipment-pricing.module.ts  ●
│       ├── assets/                          ●  Módulo A — CRUD de ativos + alocar/devolver/transferir/
│       │   │                                    manutenção + histórico + `/assets/idle`
│       │   └── dto/
│       │       └── allocate-asset.dto.ts    ●  AllocateAssetDto/ReturnAssetDto/TransferAssetDto/
│       │                                        SendToMaintenanceDto/ReturnFromMaintenanceDto
│       ├── finance/                         ●  Módulo C (parte 1) — invoices, rateio, resumo mensal,
│       │   │                                    relatório de atividade mensal de ativos
│       ├── reconciliation/                  ●  Módulo C (parte 2) — conciliação de extrato bancário
│       │   ├── dto/
│       │   │   ├── upload-statement.dto.ts ●
│       │   │   └── confirm-match.dto.ts    ●
│       │   ├── parsers/
│       │   │   └── bank-statement-parser.service.ts     ●  extração do PDF (+fallback OCR)
│       │   ├── matching/
│       │   │   └── reconciliation-matching.service.ts   ●  motor de score/match
│       │   ├── reconciliation.controller.ts ●
│       │   ├── reconciliation.service.ts    ●  orquestra upload → parse → match → persistência
│       │   └── reconciliation.module.ts     ●
│       ├── lease-import/                    ●  Módulo C (parte 3) — o diferencial do sistema: importação
│       │   │                                    automática de extrato de locação (ver seção 3.1)
│       │   ├── parsers/
│       │   │   └── lease-statement-parser.service.ts    ●  extração posicional do PDF (pdf2json)
│       │   ├── lease-import.types.ts        ●  tipos de preview/summary + comparação/alerta de preço
│       │   ├── lease-import.controller.ts   ●  POST /lease-import/preview e /execute
│       │   ├── lease-import.service.ts      ●  cascata de upserts (Cliente→Site→Fornecedor→Contrato→...)
│       │   │                                    + comparação com importação anterior + alerta de preço
│       │   └── lease-import.module.ts       ●
│       └── dashboard/                       ●  Módulo D — agrega números reais (contagens de Asset,
│                                                custo mensal via FinanceService, taxa de conciliação,
│                                                distribuição por status, ativos ociosos via
│                                                AssetsService.findIdle) em `GET /dashboard/summary`
├── prisma/seed.ts                           ●  usuário de teste + fornecedor/contrato/ativo de exemplo
├── package.json                            ●
└── .env.example                            ●
```

### 2.2 Frontend (Next.js App Router + Tailwind + shadcn/ui)

```
frontend/
├── app/
│   ├── layout.tsx                          ●  root layout: ThemeProvider + AuthProvider
│   ├── page.tsx                            ●  redireciona "/" para "/dashboard"
│   ├── globals.css                         ●  design tokens (paleta + claro/escuro)
│   ├── (auth)/
│   │   └── login/page.tsx                  ●  tela de login (JWT), consome useAuth()
│   └── (dashboard)/                            grupo de rotas protegidas por <RequireAuth>
│       ├── layout.tsx                      ●  <RequireAuth><Sidebar />+conteúdo</RequireAuth>
│       ├── dashboard/page.tsx              ●  Módulo D — client component, busca `/dashboard/summary`
│       ├── ativos/page.tsx                 ●  Módulo A — lista+filtros, cadastro, alocar/transferir/
│       │                                        devolver/manutenção + drawer de histórico completo
│       ├── contratos/page.tsx              ●  Módulo B — lista com badge de vencimento, cadastro
│       ├── fornecedores/page.tsx           ●  Módulo B — lista, cadastro
│       ├── precos-referencia/page.tsx      ●  CRUD da tabela de preços de referência por tipo
│       ├── financeiro/page.tsx             ●  Módulo C — faturas, marcar como paga, relatório de
│       │                                        atividade mensal de ativos (por mês/obra)
│       ├── clientes/page.tsx               ●  lista Clientes + Sites (obras/filiais) e seus CNPJs
│       ├── importar-extrato/page.tsx       ●  upload do extrato → prévia (com alerta de preço e
│       │                                        comparação com o mês anterior) → confirmar
│       ├── conciliacao/page.tsx            ●  Módulo C — upload de extrato bancário + revisão de matches
│       └── configuracoes/page.tsx          ●  placeholder ("em construção")
│
├── contexts/
│   └── auth-context.tsx                    ●  AuthProvider/useAuth() — JWT em localStorage
├── components/
│   ├── auth/
│   │   └── require-auth.tsx                ●  guarda de rota client-side (redireciona a /login)
│   ├── layout/
│   │   ├── sidebar.tsx                     ●  navegação lateral retrátil
│   │   └── header.tsx                      ●  breadcrumbs + notificações + avatar (com logout) + tema
│   ├── theme/
│   │   ├── theme-provider.tsx              ●  wrapper de next-themes
│   │   └── theme-toggle.tsx                ●  dropdown claro/escuro/sistema
│   ├── dashboard/
│   │   ├── kpi-card.tsx                    ●
│   │   ├── cost-evolution-chart.tsx        ●  Recharts — AreaChart, recebe `costEvolution` real via prop
│   │   ├── status-distribution-chart.tsx   ●  Recharts — PieChart (donut), recebe `statusDistribution` real
│   │   └── idle-assets-table.tsx           ●  recebe `idleAssets`/`idleMonthlyCost` reais via prop
│   └── ui/                                 ●  primitivos ao estilo shadcn/ui escritos à mão neste
│                                                scaffold (button, card, table, badge, input, label,
│                                                select, textarea, dialog, alert, dropdown-menu,
│                                                avatar, tooltip) — `components.json` já configurado
│                                                caso prefira gerar os próximos via CLI
│
├── lib/
│   ├── utils.ts                            ●  helper `cn()` (clsx + tailwind-merge)
│   └── api-client.ts                       ●  fetch com Bearer token + tratamento de erro (ApiError)
├── hooks/                                      próxima etapa — extrair a lógica de fetch das páginas
│                                                para hooks reutilizáveis (useAssets, useContracts...)
├── tailwind.config.ts                      ●  mapeia as classes Tailwind para os tokens CSS
└── package.json                            ●
```

---

## 3. Módulo C — Financeiro: Conciliação Bancária e Importação de Extratos de Locação

### 3.1 Conciliação de extrato bancário

Arquivos: `backend/src/modules/reconciliation/*`.

O fluxo é: **upload → parsing → matching → revisão humana**.

1. `ReconciliationController.uploadStatement` recebe o PDF via `multipart/form-data`, protegido por `JwtAuthGuard` + `RolesGuard` (só Financeiro/Admin podem conciliar).
2. `ReconciliationService.processStatementUpload` salva o arquivo original (auditoria), cria a sessão `Reconciliation` e delega a extração ao `BankStatementParserService`.
3. `BankStatementParserService` usa `pdf-parse` para pegar o texto do PDF e uma expressão regular para reconhecer linhas `DATA | DESCRIÇÃO | VALOR`. Se o PDF for escaneado (sem camada de texto), há um ponto de extensão para OCR via `tesseract.js` (`extractWithOcrFallback`) — deixado como stub comentado porque rasterização de página é custosa e deve rodar em um worker dedicado, não no processo da API.
4. Cada linha extraída vira um `BankTransaction`, persistido **mesmo quando não há match** — isso é proposital: o Financeiro precisa ver 100% do extrato, não só o que o sistema conseguiu casar.
5. `ReconciliationMatchingService` roda um algoritmo de pontuação (0–100) contra as faturas `PENDENTE`/`VENCIDA` do período: peso maior para valor batendo exatamente, peso médio para a data cair na janela de vencimento, peso menor para o nome/CNPJ do fornecedor aparecer na descrição do lançamento. Acima de 85 pontos o match é aplicado automaticamente; entre 50 e 84 fica como sugestão pendente de revisão; abaixo de 50 a transação fica sem sugestão.
6. A tela de conciliação (rota `/conciliacao` no frontend) consome `GET /reconciliation/:id`, mostra as sugestões lado a lado com as faturas, e chama `POST /reconciliation/matches/confirm` ou `.../matches/manual` conforme o usuário aprova, rejeita ou casa manualmente.

Esse desenho mantém a automação sem tirar o controle humano final — decisão importante em um fluxo financeiro, onde um falso positivo automático é pior do que uma sugestão que exige um clique de confirmação.

### 3.2 Importação automática de extrato de locação (o diferencial mais recente)

Arquivos: `backend/src/modules/lease-import/*`. Tela: `frontend/app/(dashboard)/importar-extrato/page.tsx`.

Este é um fluxo **diferente** da conciliação bancária acima: em vez de casar pagamentos já lançados contra faturas já cadastradas, aqui o PDF de origem é o "Extrato de Locação" que a própria locadora envia todo mês (formato observado: LOCAinfo/AM Serviços), e o objetivo é **popular o cadastro** — Cliente, Obra/Site, Fornecedor, Contrato, Fatura e cada Ativo individual — a partir dele, sem digitação manual.

**Por que `pdf2json` e não `pdf-parse` aqui.** O `pdf-parse` (usado na conciliação bancária acima) extrai texto na ordem do content stream interno do PDF, não na ordem visual. Isso funciona bem para um extrato bancário simples (uma linha por transação), mas quebra a tabela de equipamentos deste extrato: colunas inteiras (nº de série + P.A.T./tombo + descrição) chegam concatenadas sem espaço, tornando ambíguo onde termina um campo e começa o outro sempre que o nº de série termina em dígito. O `pdf2json` preserva a posição X/Y de cada fragmento de texto, permitindo reconstruir a tabela por faixas de coluna — a mesma técnica que o `pdfplumber` (Python) usa com `layout=True`, só que em Node.js puro, sem precisar embarcar um interpretador Python no deploy.

**Fluxo em duas etapas (preview → confirmar), pensado para dados financeiros:**

1. `POST /lease-import/preview` — `LeaseStatementParserService` lê o PDF e devolve cabeçalho + itens + um resumo do que **seria** criado/atualizado, sem gravar nada. A tela de importação mostra essa prévia (inclusive a tabela completa de equipamentos lidos) para o usuário conferir.
2. `POST /lease-import/execute` — reprocessa o mesmo arquivo e roda `LeaseImportService.execute` numa única transação Prisma: resolve/cria, nesta ordem, `Client` (pela raiz do CNPJ) → `Site` (pelo CNPJ completo, usando o campo "CLASSIFICAÇÃO" do extrato como nome/centro de custo) → `Supplier` → `Contract` → `Invoice` (chave única `[contractId, referenceMonth]`) → um `Asset` por linha de equipamento → a `AssetAllocation` ativa daquele ativo naquele Site.

**Idempotência é o requisito não-negociável de um importador financeiro.** Reenviar o mesmo extrato (o Financeiro reenviando por engano, ou reprocessando após corrigir algo) não deve duplicar nada — por isso toda etapa da cascata é um upsert por uma chave natural (raiz de CNPJ, CNPJ completo, nº de série do ativo, `[contrato, competência]` da fatura), nunca um `create` incondicional. Isso foi validado com um teste de integração (mock do Prisma em memória, sem depender de Postgres) que roda a importação duas vezes seguidas com o mesmo PDF real e confirma zero registros duplicados na segunda rodada.

**Validações cruzadas em vez de confiar cegamente na extração.** O parser soma o valor mensal de cada equipamento lido e compara com o "VALOR TOTAL" declarado no cabeçalho do extrato — se não bater, um aviso é devolvido no preview antes de qualquer gravação. Da mesma forma, cada grupo "MODELO :" tem sua contagem de equipamentos declarada pelo próprio extrato conferida contra o que foi de fato lido. Isso pega erros de leitura sem depender de um humano contar itens manualmente.

**Nota sobre o extrato real usado como referência:** o cabeçalho traz um campo "TOT. EQUIP" que, no PDF de exemplo (Barro Alto/GO, agosto/2026), diz "23" — mas o extrato lista de fato 45 linhas de equipamento, número que bate exatamente com a soma dos subtotais por modelo *e* com o "VALOR TOTAL" do rodapé. Ou seja, o "TOT. EQUIP" do cabeçalho não corresponde ao número de linhas nesse layout (motivo não documentado pela locadora — possivelmente conta algo diferente, como um total de contrato histórico). Por isso o importador **não** usa esse campo como critério de erro isolado; ele aparece apenas como nota informativa no preview, junto com as validações cruzadas que de fato importam (soma financeira e contagem por grupo).

**Colisão de nº de série dentro do mesmo extrato.** No PDF de referência, dois equipamentos distintos (P.A.T. `036359` e `036358`, ambos "NOTEBOOK CORE ULTRA 7-155H") aparecem com o mesmo nº de série impresso — provavelmente truncamento no sistema da própria locadora ao gerar o relatório, não um erro de leitura (nº de série completo provavelmente é mais longo). Como `Asset.serialNumber` é único no banco, o serviço desambigua automaticamente o segundo item em diante anexando o P.A.T. (`<serial>-<pat>`) e registra um aviso, em vez de sobrescrever um ativo com o outro.

---

## 4. Tipos de Equipamento, Transferência/Manutenção de Ativos e Comparação de Extratos

Este bloco de funcionalidades nasceu de um pedido direto do Financeiro: uma vez que o extrato de locação (seção 3.2) já popula o cadastro de ativos automaticamente, faltava (1) saber quanto cada *tipo* de equipamento deveria custar e ser avisado quando o extrato cobrasse diferente, (2) uma tela única para consultar, transferir entre obras, devolver e mandar para manutenção qualquer ativo (próprio ou locado) com histórico completo, e (3) uma contagem mensal fechada de quantos ativos estavam ativos, devolvidos ou novos — com a data exata de entrada/saída, já que a locadora cobra proporcional ao dia da instalação/devolução no meio do mês.

### 4.1 Classificação automática por tipo (`EquipmentPriceTier`)

Arquivos: `backend/src/modules/equipment-pricing/*`, `backend/src/common/utils/classify-equipment-tier.ts`. Tela: `frontend/app/(dashboard)/precos-referencia/page.tsx`.

Cada linha da tabela de preços é uma regra: um `label` (ex.: "Notebook Core i5"), uma lista de `keywords` e um `referenceValue`. A função pura `classifyEquipmentTier(description, tiers)` ordena as regras por `sortOrder` crescente e retorna a primeira cujas palavras-chave **todas** aparecem na descrição (comparação maiúscula, sem acento a mais). Duas decisões de design valem registro:

- **`sortOrder` existe porque regras específicas colidem com regras genéricas.** "Notebook Core Ultra 7 Gamer" precisa ser avaliada *antes* de "Notebook Ultra 7", senão a genérica casaria primeiro (a descrição de um Core Ultra 7 Gamer também contém a substring "ULTRA 7"). `sortOrder` menor = avaliado primeiro.
- **Sintaxe `A|B` dentro de uma palavra-chave = "A ou B".** Extratos reais descrevem o processador tanto como `"CORE I5-1035G1"` quanto, às vezes, direto `"I5-11300H"` (sem a palavra "CORE" na frente). A seed (`prisma/seed.ts`) já cadastra os 7 tipos informados usando esse recurso — `'CORE I5|I5-'` — para cobrir os dois formatos. Isso foi validado reprocessando o extrato real de referência (Barro Alto/GO, agosto/2026): das 45 linhas de equipamento, 100% foram classificadas corretamente com essa regra (sem o fallback `|I5-`, 3 notebooks HP/Lenovo com processador descrito sem "CORE" ficavam não classificados).
- Um equipamento sem nenhuma regra compatível fica com `priceTierId = null` — "não classificado" é tratado como informação insuficiente, não como erro, e não bloqueia a importação nem o cadastro.

`EquipmentPricingService.classify(description)` é consumido por dois outros módulos: `AssetsService` (ao criar/editar um ativo manualmente, reclassifica se marca/modelo mudou) e `LeaseImportService` (ao importar um extrato, ver 4.3). A tela `/precos-referencia` é um CRUD completo (criar/editar/excluir, com contagem de quantos ativos estão classificados em cada tipo) — pensada para o Financeiro manter a tabela atualizada sem depender de deploy.

### 4.2 Transferência e manutenção de ativos

Arquivos: `backend/src/modules/assets/*`. Tela: `frontend/app/(dashboard)/ativos/page.tsx`.

O CRUD de ativos já tinha alocar/devolver; esta rodada adicionou as ações que faltavam para o ciclo de vida completo pedido ("consulta, transferir entre centros de custos em caso de transferência entre filiais, consiga fazer devolução, manutenção, um controle completo"):

- **`POST /assets/:id/transfer`** — transferência é "devolução + nova alocação" num único passo: encerra a alocação ativa atual (se houver) com `returnDate = transferDate` e abre uma nova no destino informado (`assignedToName`, `siteId`, `departmentId`), tudo numa transação Prisma. Evita ter que devolver e alocar de novo manualmente quando um ativo muda de obra/filial, e registra o movimento como `TRANSFERENCIA` (não como `DEVOLUCAO` + `ENTREGA` separados) para o histórico não sugerir que o equipamento passou por estoque.
- **`POST /assets/:id/maintenance/start` e `/maintenance/end`** — enviar para manutenção encerra a alocação ativa (o equipamento sai fisicamente de quem estava com ele) e muda o status para `MANUTENCAO`; ao voltar, o ativo fica em `ESTOQUE` e precisa ser alocado de novo. Essa foi uma decisão confirmada explicitamente com o usuário (em vez de manter um "responsável fantasma" vinculado a um equipamento que está na assistência técnica).
- Ambas as ações usam os valores de `MovementType` que já existiam no schema (`TRANSFERENCIA`, `MANUTENCAO_ENTRADA`, `MANUTENCAO_SAIDA`) mas que nenhum código gravava até agora — o histórico de um ativo (`GET /assets/:id`) mostra `allocations` (com `site`/`department` populados) e `movements` em ordem cronológica reversa, e é isso que a tela de Ativos abre como diálogo de "Histórico" por ativo.

### 4.3 Comparação com a importação anterior e alerta de preço

Arquivos: `backend/src/modules/lease-import/lease-import.service.ts` (métodos privados `compareWithPreviousImport` e `detectPriceMismatches`), `lease-import.types.ts`. Tela: seção adicional em `frontend/app/(dashboard)/importar-extrato/page.tsx`.

O usuário descreveu o fluxo que queria: importar todas as máquinas atuais dos extratos uma vez, e dali em diante usar a importação de todo mês para ver o que mudou. Isso é diferente da Conciliação PDF (seção 3.1, que casa *pagamentos* contra faturas) — aqui o que se compara é o **conjunto de equipamentos ativos num Site** contra o extrato recém-lido, e isso só faz sentido dentro do próprio `POST /lease-import/preview` (decisão confirmada com o usuário: mostrar na própria tela de importação, não em uma tela separada), porque é ali que já se tem tanto o Site resolvido quanto os itens parseados, sem gravar nada ainda.

`preview()` agora devolve dois campos novos, calculados sempre que possível (nenhum dos dois grava no banco):

- **`comparison`** (`null` quando o Site é novo — não há o que comparar): busca as `AssetAllocation` ativas daquele Site e compara contra os itens do extrato por número de série. Três listas resultam: `removed` (estava ativo no Site e sumiu do extrato deste mês — devolvido ou trocado sem aviso), `valueChanged` (mesmo equipamento, valor mensal mudou mais que R$0,50) e `newAtSite` (aparece no extrato mas não estava alocado ali antes — novo ou transferido de outro lugar).
- **`priceAlerts`**: independente de haver importação anterior, cada item é classificado pela tabela de preços de referência (seção 4.1) e comparado contra o `referenceValue` do tipo — itens com valor zerado (proporcionalidade de instalação/devolução no meio do mês) são ignorados para não gerar alerta falso.

Quando a importação é de fato confirmada (`POST /lease-import/execute`), cada `Asset` criado ou atualizado grava o `priceTierId` classificado — antes desta rodada, a classificação só existia durante a prévia (para alertar) e não persistia no ativo; agora o ativo nasce/atualiza já com seu tipo de referência, o que é o que alimenta a coluna "Tipo (ref.)" na tela de Ativos e o relatório financeiro (4.4).

### 4.4 Relatório financeiro de atividade mensal de ativos

Arquivos: `backend/src/modules/finance/finance.service.ts` (`assetActivityReport`), endpoint `GET /finance/invoices/reports/asset-activity?month=AAAA-MM&siteId=...`. Tela: seção adicional em `frontend/app/(dashboard)/financeiro/page.tsx`.

Pedido literal do usuário: "preciso que o financeiro tenha contagem completa se ativo, se devolvido, se o equipamento é novo, se iniciou/saiu da fatura em qualquer dia do mês." O relatório recebe um mês (`AAAA-MM`) e, opcionalmente, um Site, e calcula tudo a partir das datas reais de `AssetAllocation` (não de um contador incremental, para funcionar corretamente mesmo consultando meses passados):

- **`activeAtEnd`** — alocações com `deliveryDate <= fim do mês` e (`returnDate` nulo ou depois do fim do mês).
- **`activatedDuringMonth`** / **`returnedDuringMonth`** — `deliveryDate`/`returnDate` caindo dentro do mês, motivo de existir a lista `movements` com a **data exata** de cada entrada/saída (a fatura da locadora cobra proporcional ao dia).
- **`newEquipment`** — dentre os que entraram no mês, quantos têm `Asset.createdAt` também dentro do mês (equipamento visto pela primeira vez no sistema, e não apenas transferido de outra obra).

A tela mostra os quatro totais como cards, a lista de entradas/saídas com badge "Novo" para equipamento recém-cadastrado, e a listagem completa dos ativos em uso no fim do mês (com responsável, obra e valor mensal) — o "controle completo" que o financeiro pediu para conferir a fatura sem precisar reabrir o PDF.

---

## 5. Design System — Paleta, Modo Claro/Escuro e Componentes

### 4.1 Paleta de marca aplicada como tokens

As três cores fornecidas foram convertidas para HSL e viram variáveis CSS em `frontend/app/globals.css`, nunca valores fixos espalhados pelos componentes:

| Cor | Hex | Pantone | Papel no sistema |
|---|---|---|---|
| Azul Metálico | `#2D4F9E` | 7687 C | `--primary` — botões de ação, links ativos na sidebar, foco de inputs |
| Laranja | `#DB812E` | 716 C | `--secondary` — badges de "Locado", alertas de vencimento de contrato, destaque em gráficos |
| Preto | `#000000` | Process Black | base do `--foreground` (levemente suavizado para conforto de leitura) |

Fundo em `#F9FAFB` e cards em `#FFFFFF` com bordas sutis (`#E5E7EB`-ish, token `--border`) conforme pedido, no tema claro. No tema escuro, cada token é redefinido dentro do seletor `.dark` — os componentes (`bg-background`, `text-foreground`, `bg-primary`, etc.) não sabem em qual tema estão, apenas leem a variável, então **tudo se adapta automaticamente**: cards, gráficos (Recharts lê `hsl(var(--chart-1))` diretamente), badges, bordas e até o gradiente de preenchimento da área do gráfico de custos.

### 4.2 Alternância de tema

`components/theme/theme-provider.tsx` usa `next-themes` com `attribute="class"`, então trocar de tema é só adicionar/remover `.dark` na tag `<html>` — sem re-render de árvore, sem flash de conteúdo errado no primeiro paint (`suppressHydrationWarning` no `layout.tsx` cobre esse caso). `components/theme/theme-toggle.tsx` expõe três opções (Claro / Escuro / Sistema) num dropdown no header, com os ícones de sol/lua animando via classes Tailwind condicionais a `.dark`.

### 4.3 Navegação

`Sidebar` (retrátil, estado persistido em `localStorage`) usa ícones Lucide e destaca o item ativo com `bg-primary/10 text-primary` — ou seja, a cor de destaque vem do token, então num tema com marca diferente bastaria trocar os tokens em `globals.css` e a sidebar inteira reflete a nova cor sem tocar em `sidebar.tsx`. `Header` traz breadcrumbs, notificações e avatar, conforme pedido.

---

## 6. Autenticação — como o login funciona hoje

Não há sessão de servidor nem cookie: o `AuthContext` (`frontend/contexts/auth-context.tsx`) guarda o JWT retornado por `POST /auth/login` no `localStorage` do navegador, e `lib/api-client.ts` anexa esse token em toda chamada (`Authorization: Bearer ...`). Como a checagem só existe no cliente, `<RequireAuth>` protege o grupo de rotas `(dashboard)` redirecionando para `/login` via `useEffect` em vez de um middleware do Next (que roda no edge, sem acesso a `localStorage`). Isso é suficiente para uso interno da equipe; antes de expor a internet aberta, vale endurecer trocando o token de `localStorage` por um cookie `httpOnly` (exige um pequeno endpoint de proxy no Next, já que cookies `httpOnly` não são legíveis por `fetch` do cliente).

## 7. Próximos passos sugeridos

Com os módulos A, B, C (partes 1, 2 e 3 — invoices/rateio, conciliação bancária e importação automática de extrato de locação, incluindo tipos de equipamento, transferência/manutenção e relatório mensal — seção 4) e D (Dashboard, ligado a `GET /dashboard/summary`) implementados de ponta a ponta — backend com CRUD/agregação real e frontend consumindo a API —, o que resta é: (1) um `UsersModule` com CRUD de usuários pela UI (hoje só existem via `prisma/seed.ts` ou inserindo direto no banco); (2) o job de alertas de vencimento de contrato (30/15/7 dias) com `@nestjs/schedule` e um `@Cron('0 8 * * *')` diário que varre `Contract.endDate` e faz `upsert` em `ContractAlert`, respeitando a constraint `@@unique([contractId, threshold])` do schema — hoje o endpoint `GET /contracts/expiring` já existe, só falta o disparo automático (e-mail/notificação) em cima dele; (3) o importador de extrato de locação (seção 3.2) hoje suporta o layout LOCAinfo/AM Serviços — se a empresa tiver outras locadoras com layouts diferentes, cada uma precisará de seu próprio `*-statement-parser.service.ts` (a lógica de cascata de upserts em `LeaseImportService` já é reaproveitável, só o parser muda); (4) não existe ainda um endpoint para **editar** um Site (obra/filial) já criado — hoje ele só é criado automaticamente pela importação (`clientId`, `name`, `costCenterLabel`, endereço/contato) ou manualmente via `POST /clients/:id/sites`, mas corrigir um nome ou completar um endereço depois exige alterar direto no banco; um `PATCH /clients/sites/:id` simples resolveria.
