-- Outras grafias da CLASSIFICAÇÃO que apontam para a mesma obra (evita obra duplicada na importação)
ALTER TABLE "obras" ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
