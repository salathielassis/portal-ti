-- CreateTable
CREATE TABLE "obras" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costCenterLabel" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "obras_siteId_costCenterLabel_key" ON "obras"("siteId", "costCenterLabel");

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "obraId" TEXT;

-- AlterTable
ALTER TABLE "asset_allocations" ADD COLUMN "obraId" TEXT;

-- AddForeignKey
ALTER TABLE "obras" ADD CONSTRAINT "obras_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_obraId_fkey" FOREIGN KEY ("obraId") REFERENCES "obras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_obraId_fkey" FOREIGN KEY ("obraId") REFERENCES "obras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
