-- Backfill de dados: cria uma Obra por Contrato existente e repovoa os
-- vínculos obraId em contracts e asset_allocations.
--
-- Regra do rótulo da obra (costCenterLabel = chave natural dentro do Site):
--   - Site com 1 único contrato  -> usa o rótulo/nome do próprio Site
--     (o Site "puro" já É a obra; a CLASSIFICAÇÃO ficou nele na importação).
--   - Site com vários contratos (ex.: a matriz "DOISA NATAL - SEDE", que
--     recebeu 8 obras faturadas no mesmo CNPJ) -> usa o número do contrato
--     como rótulo, já que a CLASSIFICAÇÃO original de cada obra não foi
--     preservada por contrato. O usuário renomeia depois na tela de Obras.

-- 1. Uma Obra por contrato vinculado a um site.
INSERT INTO "obras" ("id", "siteId", "name", "costCenterLabel", "active", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."siteId",
  CASE WHEN sc.cnt = 1 THEN s."name" ELSE c."contractNumber" END,
  CASE WHEN sc.cnt = 1 THEN COALESCE(NULLIF(s."costCenterLabel", ''), s."name") ELSE c."contractNumber" END,
  true,
  now(),
  now()
FROM "contracts" c
JOIN "sites" s ON s."id" = c."siteId"
JOIN (
  SELECT "siteId", count(*) AS cnt
  FROM "contracts"
  WHERE "siteId" IS NOT NULL
  GROUP BY "siteId"
) sc ON sc."siteId" = c."siteId"
WHERE c."siteId" IS NOT NULL;

-- 2. Liga cada contrato à obra recém-criada (match por site + rótulo derivado).
UPDATE "contracts" c
SET "obraId" = o."id"
FROM "obras" o
JOIN "sites" s ON s."id" = o."siteId"
JOIN (
  SELECT "siteId", count(*) AS cnt
  FROM "contracts"
  WHERE "siteId" IS NOT NULL
  GROUP BY "siteId"
) sc ON sc."siteId" = o."siteId"
WHERE o."siteId" = c."siteId"
  AND o."costCenterLabel" = CASE
    WHEN sc.cnt = 1 THEN COALESCE(NULLIF(s."costCenterLabel", ''), s."name")
    ELSE c."contractNumber"
  END;

-- 3. Alocações: herdam a obra do contrato do próprio ativo.
UPDATE "asset_allocations" a
SET "obraId" = c."obraId"
FROM "assets" ast
JOIN "contracts" c ON c."id" = ast."contractId"
WHERE ast."id" = a."assetId"
  AND c."obraId" IS NOT NULL;

-- 4. Alocações cujo ativo não tem contrato: obra "(SEM CONTRATO)" no site atual.
INSERT INTO "obras" ("id", "siteId", "name", "costCenterLabel", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, a."siteId", 'Sem contrato', '(SEM CONTRATO)', true, now(), now()
FROM "asset_allocations" a
WHERE a."obraId" IS NULL AND a."siteId" IS NOT NULL
GROUP BY a."siteId"
ON CONFLICT ("siteId", "costCenterLabel") DO NOTHING;

UPDATE "asset_allocations" a
SET "obraId" = o."id"
FROM "obras" o
WHERE a."obraId" IS NULL
  AND a."siteId" IS NOT NULL
  AND o."siteId" = a."siteId"
  AND o."costCenterLabel" = '(SEM CONTRATO)';
