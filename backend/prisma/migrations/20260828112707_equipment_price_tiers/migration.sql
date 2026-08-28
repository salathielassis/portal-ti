-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "priceTierId" TEXT;

-- CreateTable
CREATE TABLE "equipment_price_tiers" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keywords" TEXT[],
    "referenceValue" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_price_tiers_label_key" ON "equipment_price_tiers"("label");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_priceTierId_fkey" FOREIGN KEY ("priceTierId") REFERENCES "equipment_price_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
