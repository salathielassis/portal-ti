/**
 * Remove os registros de EXEMPLO criados pelo seed (prisma/seed.ts), sem
 * mexer no que já é real (usuário admin, departamento, cliente DOISA,
 * tabela de preços de referência).
 *
 * O que este script apaga:
 *   - Fornecedor "TechLease Locações Ltda" (CNPJ de exemplo 12.345.678/0001-90)
 *   - Contrato "CTR-2026-0001" (e seus alertas)
 *   - Ativo "NB-00001" / Dell Latitude 5440 (e seu histórico de alocação/movimentação)
 *   - A fatura de exemplo gerada para esse contrato
 *
 * Uso (contra o banco de produção, sem mexer no seu .env local):
 *   cd backend
 *   $env:DATABASE_URL="postgresql://...string-de-conexao-do-neon...";  npm run remove-seed-demo-data
 *
 * É seguro rodar mais de uma vez — se os registros já não existirem, o
 * script só avisa e segue em frente.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_ASSET_TAG = 'NB-00001';
const DEMO_CONTRACT_NUMBER = 'CTR-2026-0001';
const DEMO_SUPPLIER_CNPJ = '12.345.678/0001-90';

async function main() {
  const asset = await prisma.asset.findUnique({ where: { assetTag: DEMO_ASSET_TAG } });
  if (asset) {
    await prisma.assetMovement.deleteMany({ where: { assetId: asset.id } });
    await prisma.assetAllocation.deleteMany({ where: { assetId: asset.id } });
    await prisma.asset.delete({ where: { id: asset.id } });
    console.log(`Ativo de exemplo ${DEMO_ASSET_TAG} removido.`);
  } else {
    console.log(`Ativo de exemplo ${DEMO_ASSET_TAG} não encontrado (já removido?).`);
  }

  const contract = await prisma.contract.findUnique({ where: { contractNumber: DEMO_CONTRACT_NUMBER } });
  if (contract) {
    const invoices = await prisma.invoice.findMany({ where: { contractId: contract.id } });
    for (const invoice of invoices) {
      await prisma.invoiceCostAllocation.deleteMany({ where: { invoiceId: invoice.id } });
    }
    await prisma.invoice.deleteMany({ where: { contractId: contract.id } });
    await prisma.contractAlert.deleteMany({ where: { contractId: contract.id } });
    await prisma.contract.delete({ where: { id: contract.id } });
    console.log(`Contrato de exemplo ${DEMO_CONTRACT_NUMBER} e suas faturas removidos.`);
  } else {
    console.log(`Contrato de exemplo ${DEMO_CONTRACT_NUMBER} não encontrado (já removido?).`);
  }

  const supplier = await prisma.supplier.findUnique({ where: { cnpj: DEMO_SUPPLIER_CNPJ } });
  if (supplier) {
    await prisma.supplier.delete({ where: { id: supplier.id } });
    console.log(`Fornecedor de exemplo "${supplier.name}" removido.`);
  } else {
    console.log(`Fornecedor de exemplo (CNPJ ${DEMO_SUPPLIER_CNPJ}) não encontrado (já removido?).`);
  }

  console.log('Limpeza concluída. Cliente "DOISA", usuário admin e tabela de preços de referência foram preservados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
