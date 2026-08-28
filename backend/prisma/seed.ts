import { PrismaClient, UserRole, AssetType, AssetOwnership, AssetStatus, InvoiceStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Popula dados mínimos para explorar o sistema localmente:
 * um departamento, um usuário ADMIN (login: admin@portalti.com / admin123),
 * um fornecedor, um contrato de locação, um notebook locado e uma fatura
 * em aberto no mês corrente (útil para testar a conciliação).
 */
async function main() {
  const department = await prisma.department.upsert({
    where: { name: 'Tecnologia da Informação' },
    update: {},
    create: { name: 'Tecnologia da Informação', costCenterCode: 'CC-TI-001' },
  });

  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@portalti.com' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@portalti.com',
      passwordHash,
      role: UserRole.ADMIN,
      departmentId: department.id,
    },
  });

  // Cliente (grupo empresarial) + Site matriz/sede. Sites de obra/filial
  // (ex.: "EQUIP - BARRO ALTO GO") nascem automaticamente ao importar o
  // primeiro extrato de locação daquele CNPJ — aqui só garantimos que a
  // matriz já existe, para o import conseguir resolver `cnpjRoot`.
  const doisaClient = await prisma.client.upsert({
    where: { cnpjRoot: '03092799' },
    update: {},
    create: { name: 'DOISA', cnpjRoot: '03092799' },
  });

  await prisma.site.upsert({
    where: { cnpj: '03092799000181' },
    update: {},
    create: {
      clientId: doisaClient.id,
      name: 'DOISA NATAL - SEDE',
      costCenterLabel: 'DOISA NATAL - SEDE',
      cnpj: '03092799000181',
      isHeadquarters: true,
    },
  });

  // Tabela de preços de referência por tipo de equipamento — usada para
  // classificar automaticamente cada item do extrato (por palavra-chave na
  // descrição) e alertar quando o valor cobrado destoa do de referência.
  // sortOrder crescente = ordem de avaliação: regras mais específicas
  // primeiro (ex.: "Core Ultra 7 Gamer" tem que ser checada antes de
  // "Ultra 7", senão a genérica "casaria" primeiro).
  const priceTiers: {
    label: string;
    keywords: string[];
    referenceValue: number;
    sortOrder: number;
  }[] = [
    { label: 'Notebook Core Ultra 7 Gamer', keywords: ['NOTEBOOK', 'CORE ULTRA 7', 'GAMER'], referenceValue: 540.0, sortOrder: 0 },
    // "I3-"/"I5-"/"I7-" cobre o formato comum em extratos reais, onde o
    // processador aparece como "I5-1035G1" sem a palavra "CORE" na frente.
    { label: 'Notebook Core i3', keywords: ['NOTEBOOK', 'CORE I3|I3-'], referenceValue: 160.0, sortOrder: 10 },
    { label: 'Notebook Core i5', keywords: ['NOTEBOOK', 'CORE I5|I5-'], referenceValue: 220.0, sortOrder: 20 },
    { label: 'Notebook Core i7', keywords: ['NOTEBOOK', 'CORE I7|I7-'], referenceValue: 280.0, sortOrder: 30 },
    { label: 'Notebook Ultra 3', keywords: ['NOTEBOOK', 'ULTRA 3'], referenceValue: 180.0, sortOrder: 40 },
    { label: 'Notebook Ultra 5', keywords: ['NOTEBOOK', 'ULTRA 5'], referenceValue: 220.0, sortOrder: 50 },
    { label: 'Notebook Ultra 7', keywords: ['NOTEBOOK', 'ULTRA 7'], referenceValue: 280.0, sortOrder: 60 },
  ];

  for (const tier of priceTiers) {
    await prisma.equipmentPriceTier.upsert({
      where: { label: tier.label },
      update: { keywords: tier.keywords, referenceValue: tier.referenceValue, sortOrder: tier.sortOrder },
      create: { ...tier, active: true },
    });
  }

  const supplier = await prisma.supplier.upsert({
    where: { cnpj: '12.345.678/0001-90' },
    update: {},
    create: {
      name: 'TechLease Locações Ltda',
      cnpj: '12.345.678/0001-90',
      slaHours: 24,
      contactName: 'Comercial TechLease',
      contactEmail: 'comercial@techlease.com.br',
    },
  });

  const now = new Date();
  const contractEnd = new Date(now);
  contractEnd.setMonth(contractEnd.getMonth() + 6);

  const contract = await prisma.contract.upsert({
    where: { contractNumber: 'CTR-2026-0001' },
    update: {},
    create: {
      contractNumber: 'CTR-2026-0001',
      supplierId: supplier.id,
      startDate: new Date(now.getFullYear(), 0, 1),
      endDate: contractEnd,
      monthlyValuePerAsset: 189.9,
      annualReadjustIndex: 'IPCA',
      annualReadjustPct: 4.5,
    },
  });

  await prisma.asset.upsert({
    where: { assetTag: 'NB-00001' },
    update: {},
    create: {
      assetTag: 'NB-00001',
      serialNumber: 'SN-DEMO-0001',
      type: AssetType.NOTEBOOK,
      ownership: AssetOwnership.LOCADO,
      brand: 'Dell',
      model: 'Latitude 5440',
      specs: { cpu: 'Intel i5-1335U', ram: '16GB', storage: '256GB SSD' },
      status: AssetStatus.EM_USO,
      contractId: contract.id,
      supplierId: supplier.id,
    },
  });

  const referenceMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const dueDate = new Date(now.getFullYear(), now.getMonth(), 10);

  const existingInvoice = await prisma.invoice.findFirst({
    where: { contractId: contract.id, referenceMonth },
  });
  if (!existingInvoice) {
    await prisma.invoice.create({
      data: {
        contractId: contract.id,
        referenceMonth,
        dueDate,
        grossValue: 189.9,
        status: InvoiceStatus.PENDENTE,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    'Seed concluído. Login: admin@portalti.com / senha: admin123 | Cliente "DOISA" (matriz DOISA NATAL - SEDE) pronto para receber extratos de locação importados. | 7 tipos de equipamento cadastrados em Tabela de Preços de Referência.',
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
