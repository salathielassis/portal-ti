import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetOwnership, AssetStatus, AssetType, ContractStatus, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EquipmentPricingService } from '../equipment-pricing/equipment-pricing.service';
import { classifyEquipmentTier } from '../../common/utils/classify-equipment-tier';
import {
  LeaseStatementParserService,
  ParsedLeaseItem,
  ParsedLeaseStatement,
} from './parsers/lease-statement-parser.service';
import { LeaseImportPreview, LeaseImportSummary, PriceMismatchAlert } from './lease-import.types';

/** Abaixo desta diferença (R$), não vale a pena incomodar o usuário — trata como arredondamento. */
const PRICE_MISMATCH_TOLERANCE = 0.5;

const KNOWN_BRANDS = ['DELL', 'HP', 'LENOVO', 'SAMSUNG', 'POSITIVO', 'ACER', 'ASUS', 'APPLE', 'VAIO'];

function detectBrand(description: string): string {
  const upper = description.toUpperCase();
  const found = KNOWN_BRANDS.find((brand) => upper.includes(brand));
  return found ?? 'NÃO INFORMADA';
}

function detectAssetType(description: string): AssetType {
  const upper = description.toUpperCase();
  if (upper.includes('IMPRESSORA')) return AssetType.IMPRESSORA;
  if (upper.includes('MONITOR')) return AssetType.MONITOR;
  if (upper.includes('NOTEBOOK') || upper.includes('NOTBOOK')) return AssetType.NOTEBOOK;
  return AssetType.OUTRO;
}

/** Primeiro dia do mês/ano de uma data (usado como chave de competência da fatura). */
function firstDayOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * Serviço de importação em cascata do "Extrato de Locação": a partir de um
 * PDF, resolve/cria Cliente → Site (obra/filial) → Fornecedor → Contrato →
 * Fatura → Ativos → Alocações, tudo em uma única transação.
 *
 * Todas as chaves de upsert são pensadas para tornar a reimportação do MESMO
 * extrato (ex.: o financeiro reenviando por engano) idempotente: nada é
 * duplicado, os registros existentes são atualizados com os dados mais
 * recentes do PDF.
 */
@Injectable()
export class LeaseImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: LeaseStatementParserService,
    private readonly equipmentPricing: EquipmentPricingService,
  ) {}

  async preview(file: Express.Multer.File): Promise<LeaseImportPreview> {
    const parsed = await this.parseFile(file);
    const { header, items, warnings } = parsed;

    const clientCnpjRoot = header.clientCnpj.slice(0, 8);
    const [existingClient, existingSite, existingSupplier, existingContract] = await Promise.all([
      clientCnpjRoot ? this.prisma.client.findUnique({ where: { cnpjRoot: clientCnpjRoot } }) : null,
      header.clientCnpj ? this.prisma.site.findUnique({ where: { cnpj: header.clientCnpj } }) : null,
      header.supplierCnpj ? this.prisma.supplier.findUnique({ where: { cnpj: header.supplierCnpj } }) : null,
      header.contractNumber
        ? this.prisma.contract.findUnique({ where: { contractNumber: header.contractNumber } })
        : null,
    ]);

    const serials = items.map((i) => i.serialNumber);
    const existingAssets = serials.length
      ? await this.prisma.asset.findMany({ where: { serialNumber: { in: serials } }, select: { serialNumber: true } })
      : [];
    const existingSerialSet = new Set(existingAssets.map((a) => a.serialNumber));

    const referenceMonth = firstDayOfMonth(header.periodStart);
    let invoiceAction: 'CRIAR' | 'ATUALIZAR' = 'CRIAR';
    if (existingContract) {
      const existingInvoice = await this.prisma.invoice.findUnique({
        where: { contractId_referenceMonth: { contractId: existingContract.id, referenceMonth } },
      });
      if (existingInvoice) invoiceAction = 'ATUALIZAR';
    }

    const comparison = existingSite ? await this.compareWithPreviousImport(existingSite.id, items) : null;
    const priceAlerts = await this.detectPriceMismatches(items);

    return {
      header,
      items,
      warnings,
      diff: {
        client: {
          action: existingClient ? 'JÁ EXISTE' : 'CRIAR',
          cnpjRoot: clientCnpjRoot,
          name: existingClient?.name ?? header.clientName,
        },
        site: {
          action: existingSite ? 'JÁ EXISTE' : 'CRIAR',
          cnpj: header.clientCnpj,
          name: existingSite?.name ?? header.classification,
        },
        supplier: {
          action: existingSupplier ? 'JÁ EXISTE' : 'CRIAR',
          cnpj: header.supplierCnpj,
          name: existingSupplier?.name ?? header.supplierName,
        },
        contract: {
          action: existingContract ? 'JÁ EXISTE' : 'CRIAR',
          contractNumber: header.contractNumber,
        },
        invoice: {
          action: invoiceAction,
          referenceMonth: referenceMonth.toISOString().slice(0, 10),
          grossValue: header.totalValue,
        },
        assets: {
          toCreate: items.filter((i) => !existingSerialSet.has(i.serialNumber)).length,
          toUpdate: items.filter((i) => existingSerialSet.has(i.serialNumber)).length,
          total: items.length,
        },
      },
      comparison,
      priceAlerts,
    };
  }

  /**
   * Compara os itens deste extrato contra o que estava ativo no Site na
   * última importação — pensado para o financeiro pegar, mês a mês, o que
   * mudou sem precisar ler o PDF inteiro de novo: equipamento que sumiu
   * (devolvido/trocado sem aviso?), valor que mudou, equipamento novo.
   */
  private async compareWithPreviousImport(
    siteId: string,
    items: ParsedLeaseItem[],
  ): Promise<import('./lease-import.types').LeaseImportComparison> {
    const activeAtSite = await this.prisma.assetAllocation.findMany({
      where: { siteId, isActive: true },
      include: { asset: true },
    });

    const itemBySerial = new Map(items.map((i) => [i.serialNumber, i]));
    const activeBySerial = new Map(activeAtSite.map((a) => [a.asset.serialNumber, a]));

    const removed = activeAtSite
      .filter((a) => !itemBySerial.has(a.asset.serialNumber))
      .map((a) => ({
        serialNumber: a.asset.serialNumber,
        description: a.asset.model,
        assignedToName: a.assignedToName,
      }));

    const valueChanged: { serialNumber: string; description: string; previousValue: number; newValue: number }[] = [];
    const newAtSite: { serialNumber: string; description: string; totalValue: number }[] = [];

    for (const item of items) {
      const existing = activeBySerial.get(item.serialNumber);
      if (!existing) {
        newAtSite.push({
          serialNumber: item.serialNumber,
          description: item.equipmentDescription,
          totalValue: item.totalValue,
        });
        continue;
      }
      const previousValue = existing.asset.monthlyValue ? Number(existing.asset.monthlyValue) : 0;
      if (Math.abs(previousValue - item.totalValue) > PRICE_MISMATCH_TOLERANCE) {
        valueChanged.push({
          serialNumber: item.serialNumber,
          description: item.equipmentDescription,
          previousValue,
          newValue: item.totalValue,
        });
      }
    }

    return { removed, valueChanged, newAtSite };
  }

  /**
   * Classifica cada item pelo tipo (EquipmentPriceTier) e aponta quando o
   * valor cobrado no extrato destoa do valor de referência cadastrado —
   * ignora itens com valor zerado (comum em proporcionalidade de
   * instalação/devolução no meio do mês, não é uma cobrança "errada").
   */
  private async detectPriceMismatches(items: ParsedLeaseItem[]): Promise<PriceMismatchAlert[]> {
    const alerts: PriceMismatchAlert[] = [];
    for (const item of items) {
      if (item.totalValue <= 0) continue;
      const description = item.modelDescription || item.equipmentDescription;
      const tier = await this.equipmentPricing.classify(description);
      if (!tier) continue;
      const referenceValue = Number(tier.referenceValue);
      if (Math.abs(referenceValue - item.totalValue) > PRICE_MISMATCH_TOLERANCE) {
        alerts.push({
          serialNumber: item.serialNumber,
          description: item.equipmentDescription,
          tierLabel: tier.label,
          referenceValue,
          chargedValue: item.totalValue,
        });
      }
    }
    return alerts;
  }

  async execute(file: Express.Multer.File): Promise<LeaseImportSummary> {
    const { header, items, warnings } = await this.parseFile(file);

    if (!header.clientCnpj || !header.supplierCnpj || !header.contractNumber) {
      throw new BadRequestException(
        'Dados essenciais do cabeçalho (CNPJ do cliente, CNPJ do fornecedor ou número do contrato) não puderam ser lidos — importação cancelada. Confira o PDF.',
      );
    }

    // Resolve colisões de nº de série DENTRO do próprio extrato (observado em
    // extratos reais: dois itens distintos, com P.A.T. diferentes, podem
    // compartilhar o mesmo nº de série exibido — provavelmente truncamento no
    // sistema da locadora). Como `Asset.serialNumber` é único no banco, o
    // segundo item em diante é desambiguado anexando o P.A.T.
    const seenSerials = new Map<string, number>();
    const dedupedItems = items.map((item) => {
      const count = seenSerials.get(item.serialNumber) ?? 0;
      seenSerials.set(item.serialNumber, count + 1);
      if (count === 0) return item;
      warnings.push(
        `Nº de série "${item.serialNumber}" repetido no extrato (P.A.T. ${item.pat}) — armazenado como "${item.serialNumber}-${item.pat}" para não colidir com o primeiro item.`,
      );
      return { ...item, serialNumber: `${item.serialNumber}-${item.pat}` };
    });

    const referenceMonth = firstDayOfMonth(header.periodStart);
    const clientCnpjRoot = header.clientCnpj.slice(0, 8);

    // Busca os tipos de equipamento (para classificação) FORA da transação e
    // ANTES de abri-la: são poucos registros e mudam raramente, então não faz
    // sentido pagar uma consulta ao banco por item dentro do laço. Isso evita
    // também misturar duas conexões diferentes (a de `tx` e a do client
    // "solto" usado por EquipmentPricingService) dentro da mesma transação —
    // em bancos serverless com pooler (ex.: Neon/PgBouncer em modo
    // transaction), isso podia derrubar a conexão da transação e gerar o erro
    // "Transaction API error: Transaction not found" ao confirmar a
    // importação de um extrato com vários equipamentos.
    const activeTiers = await this.prisma.equipmentPriceTier.findMany({ where: { active: true } });

    const result = await this.prisma.$transaction(
      async (tx) => {
      // 1. Cliente (grupo empresarial, pela raiz do CNPJ)
      let client = await tx.client.findUnique({ where: { cnpjRoot: clientCnpjRoot } });
      let clientCreated = false;
      if (!client) {
        client = await tx.client.create({
          data: { cnpjRoot: clientCnpjRoot, name: header.clientName || clientCnpjRoot },
        });
        clientCreated = true;
      }

      // 2. Site (obra/filial — onde os ativos são fisicamente alocados)
      let site = await tx.site.findUnique({ where: { cnpj: header.clientCnpj } });
      let siteCreated = false;
      if (!site) {
        site = await tx.site.create({
          data: {
            clientId: client.id,
            cnpj: header.clientCnpj,
            name: header.classification || header.clientName,
            costCenterLabel: header.classification || null,
            isHeadquarters: false,
            addressStreet: header.address.street,
            addressNumber: header.address.number,
            addressComplement: header.address.complement,
            addressDistrict: header.address.district,
            addressCity: header.address.city,
            addressState: header.address.state,
            addressZip: header.address.zip,
            contactName: header.contact.name,
            contactPhone: header.contact.phone,
            contactEmail: header.contact.email,
          },
        });
        siteCreated = true;
      }

      // 3. Fornecedor (locadora)
      let supplier = await tx.supplier.findUnique({ where: { cnpj: header.supplierCnpj } });
      let supplierCreated = false;
      if (!supplier) {
        supplier = await tx.supplier.create({
          data: { cnpj: header.supplierCnpj, name: header.supplierName || header.supplierCnpj },
        });
        supplierCreated = true;
      }

      // 4. Contrato
      let contract = await tx.contract.findUnique({ where: { contractNumber: header.contractNumber } });
      let contractCreated = false;
      if (!contract) {
        const referenceMonthlyValue =
          header.totalValue !== null && items.length > 0 ? header.totalValue / items.length : 0;
        contract = await tx.contract.create({
          data: {
            contractNumber: header.contractNumber,
            supplierId: supplier.id,
            siteId: site.id,
            status: ContractStatus.ATIVO,
            // O extrato não informa a vigência real do contrato — usamos o
            // período de apuração como início e +1 ano como referência,
            // ajustável manualmente na tela de Contratos depois.
            startDate: header.periodStart,
            endDate: addYears(header.periodStart, 1),
            monthlyValuePerAsset: referenceMonthlyValue,
          },
        });
        contractCreated = true;
      } else if (!contract.siteId) {
        contract = await tx.contract.update({ where: { id: contract.id }, data: { siteId: site.id } });
      }

      // 5. Fatura (competência = mês do período de apuração)
      const grossValue = header.totalValue ?? dedupedItems.reduce((acc, i) => acc + i.totalValue, 0);
      let invoice = await tx.invoice.findUnique({
        where: { contractId_referenceMonth: { contractId: contract.id, referenceMonth } },
      });
      let invoiceCreated = false;
      if (!invoice) {
        invoice = await tx.invoice.create({
          data: {
            contractId: contract.id,
            referenceMonth,
            dueDate: header.periodEnd,
            grossValue,
            status: InvoiceStatus.PENDENTE,
          },
        });
        invoiceCreated = true;
      } else {
        invoice = await tx.invoice.update({ where: { id: invoice.id }, data: { grossValue } });
      }

      // 6. Ativos + alocações
      let assetsCreated = 0;
      let assetsUpdated = 0;
      let allocationsCreated = 0;
      let allocationsUpdated = 0;
      let allocationsClosed = 0;

      for (const item of dedupedItems) {
        const assetTag = item.pat || `IMP-${item.serialNumber}`;
        const existingAsset = await tx.asset.findFirst({
          where: { OR: [{ serialNumber: item.serialNumber }, { assetTag }] },
        });

        const description = item.equipmentDescription || item.modelDescription;
        // Classifica o tipo de equipamento (tabela de preços de referência)
        // com a lista já carregada em memória (`activeTiers`, buscada antes
        // de abrir a transação) — sem round-trip ao banco por item — para que
        // o Asset já nasça/atualize com o priceTierId correto, e não só
        // durante a prévia (onde serve apenas para alertar, sem persistir).
        const tier = classifyEquipmentTier(item.modelDescription || description, activeTiers);
        let asset;
        if (!existingAsset) {
          asset = await tx.asset.create({
            data: {
              assetTag,
              serialNumber: item.serialNumber,
              type: detectAssetType(description),
              ownership: AssetOwnership.LOCADO,
              brand: detectBrand(item.modelDescription || description),
              model: item.modelDescription || description,
              specs: { raw: description, modelCode: item.modelCode },
              status: AssetStatus.EM_USO,
              contractId: contract.id,
              supplierId: supplier.id,
              monthlyValue: item.totalValue,
              installationDate: item.installationDate,
              priceTierId: tier?.id ?? null,
            },
          });
          assetsCreated++;
        } else {
          const preserveStatus =
            existingAsset.status === AssetStatus.MANUTENCAO || existingAsset.status === AssetStatus.DESCARTADO;
          asset = await tx.asset.update({
            where: { id: existingAsset.id },
            data: {
              contractId: contract.id,
              supplierId: supplier.id,
              monthlyValue: item.totalValue,
              installationDate: item.installationDate ?? existingAsset.installationDate,
              status: preserveStatus ? existingAsset.status : AssetStatus.EM_USO,
              priceTierId: tier?.id ?? existingAsset.priceTierId,
            },
          });
          assetsUpdated++;
        }

        // Alocação ativa neste Site
        const activeAllocation = await tx.assetAllocation.findFirst({
          where: { assetId: asset.id, isActive: true },
        });
        const allocationNote = `Importado do extrato de locação ${header.contractNumber} — competência ${referenceMonth.toISOString().slice(0, 7)}.`;
        const assignedToName = item.allocatedTo || 'Não informado';

        if (!activeAllocation) {
          await tx.assetAllocation.create({
            data: {
              assetId: asset.id,
              siteId: site.id,
              assignedToName,
              deliveryDate: item.installationDate ?? new Date(referenceMonth),
              isActive: true,
              notes: allocationNote,
            },
          });
          allocationsCreated++;
        } else if (activeAllocation.siteId !== site.id) {
          // Ativo mudou de obra/filial desde a última importação: encerra a
          // alocação anterior e abre uma nova no site atual.
          await tx.assetAllocation.update({
            where: { id: activeAllocation.id },
            data: { isActive: false, returnDate: new Date(referenceMonth) },
          });
          await tx.assetAllocation.create({
            data: {
              assetId: asset.id,
              siteId: site.id,
              assignedToName,
              deliveryDate: item.installationDate ?? new Date(referenceMonth),
              isActive: true,
              notes: allocationNote,
            },
          });
          allocationsClosed++;
          allocationsCreated++;
        } else if (activeAllocation.assignedToName !== assignedToName) {
          await tx.assetAllocation.update({
            where: { id: activeAllocation.id },
            data: { assignedToName, notes: allocationNote },
          });
          allocationsUpdated++;
        }
      }

      return {
        clientId: client.id,
        clientCreated,
        siteId: site.id,
        siteCreated,
        supplierId: supplier.id,
        supplierCreated,
        contractId: contract.id,
        contractCreated,
        invoiceId: invoice.id,
        invoiceCreated,
        assetsCreated,
        assetsUpdated,
        allocationsCreated,
        allocationsUpdated,
        allocationsClosed,
      };
      },
      // Timeout/maxWait generosos: extratos com dezenas de equipamentos fazem
      // vários round-trips ao banco dentro da mesma transação, e um banco
      // serverless (ex.: Neon) pode levar alguns segundos para "acordar" o
      // compute se estiver ocioso — o padrão do Prisma (5s) já se mostrou
      // curto demais em produção.
      { timeout: 30000, maxWait: 15000 },
    );

    return { ...result, warnings };
  }

  private async parseFile(file: Express.Multer.File): Promise<ParsedLeaseStatement> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    if (file.mimetype !== 'application/pdf' && !file.originalname?.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Envie um arquivo PDF.');
    }
    return this.parser.parse(file.buffer);
  }
}

// Reexportado para o controller anotar o tipo do array de itens sem precisar
// importar diretamente do parser em dois lugares.
export type { ParsedLeaseItem };
