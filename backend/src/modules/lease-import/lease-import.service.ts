import { BadRequestException, Injectable } from '@nestjs/common';
import { Asset, AssetOwnership, AssetStatus, ContractStatus, InvoiceStatus, Obra, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EquipmentPricingService } from '../equipment-pricing/equipment-pricing.service';
import { classifyEquipmentTier } from '../../common/utils/classify-equipment-tier';
import {
  buildSpecsFromDescription,
  parseEquipmentDescription,
} from '../../common/utils/parse-equipment-description';
import {
  addObraAlias,
  findObraByLabel,
  findObraByLabelInClient,
  normalizeObraLabel,
} from '../../common/utils/obra-matching';
import { assetIdentifierFilter, normalizeAssetTag, normalizeSerial } from '../../common/utils/asset-identifiers';
import {
  LeaseStatementParserService,
  ParsedLeaseItem,
  ParsedLeaseStatement,
} from './parsers/lease-statement-parser.service';
import {
  LeaseImportOptions,
  LeaseImportPreview,
  LeaseImportSummary,
  LeaseReconciliation,
  ObraOption,
  PriceMismatchAlert,
  ReconciliationFlag,
  ReconciliationMissingRow,
  ReconciliationRow,
} from './lease-import.types';

/** Abaixo desta diferença (R$), não vale a pena incomodar o usuário — trata como arredondamento. */
const PRICE_MISMATCH_TOLERANCE = 0.5;

/** Nomes de responsável que são só "marcadores" — podem ser substituídos pelo que vier no extrato. */
const PLACEHOLDER_ASSIGNEES = new Set(['', 'NAO INFORMADO', 'ESTOQUE']);

/** Status em que o ativo NÃO deve voltar para "Em uso" só porque apareceu no extrato. */
const PRESERVED_STATUSES: AssetStatus[] = [
  AssetStatus.ESTOQUE,
  AssetStatus.MANUTENCAO,
  AssetStatus.DEVOLVIDO,
  AssetStatus.DESCARTADO,
];

const ALL_FLAGS: ReconciliationFlag[] = [
  'NOVO',
  'SEM_MUDANCA',
  'VALOR_ALTERADO',
  'VALOR_PREENCHIDO',
  'OUTRA_OBRA',
  'EM_ESTOQUE',
  'EM_MANUTENCAO',
  'DEVOLVIDO_MAS_COBRADO',
  'DESCARTADO_MAS_COBRADO',
  'TOMBO_DIVERGENTE',
  'SERIE_DIVERGENTE',
  'RESPONSAVEL_DIFERENTE',
  'DADOS_A_ORGANIZAR',
];

/** Primeiro dia do mês/ano de uma data (usado como chave de competência da fatura). */
function firstDayOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/** Rótulo/chave natural da Obra dentro do Site — a "CLASSIFICAÇÃO" do extrato. */
function resolveObraLabel(header: ParsedLeaseStatement['header']): string {
  return (header.classification || '').trim() || '(SEM CLASSIFICAÇÃO)';
}

function isPlaceholderAssignee(name: string | null | undefined): boolean {
  return PLACEHOLDER_ASSIGNEES.has(normalizeObraLabel(name));
}

/** Descrição que alimenta marca/modelo/specs — o cabeçalho do grupo "MODELO :" costuma ser o mais completo. */
function itemDescription(item: ParsedLeaseItem): string {
  return item.modelDescription || item.equipmentDescription;
}

/**
 * O cadastro ainda está com a descrição "crua" da locadora no campo modelo
 * (importações antigas gravavam a descrição inteira ali)? Nesse caso é
 * seguro reorganizar em marca/modelo/CPU/RAM/SSD/vídeo; se o usuário já
 * editou o modelo à mão, não mexe.
 */
function hasRawModel(asset: Pick<Asset, 'model' | 'specs'>, item: ParsedLeaseItem): boolean {
  const model = normalizeObraLabel(asset.model);
  const raw = normalizeObraLabel((asset.specs as { raw?: string } | null)?.raw);
  return (
    model === normalizeObraLabel(item.modelDescription) ||
    model === normalizeObraLabel(item.equipmentDescription) ||
    (!!raw && model === raw)
  );
}

type AssetWithActiveAllocation = Prisma.AssetGetPayload<{
  include: { allocations: { include: { obra: true; site: true } } };
}>;

interface ResolvedTargetObra {
  obra: Obra | null;
  matchedBy: 'ESCOLHIDA' | 'CLASSIFICACAO' | 'EQUIPAMENTOS' | 'NOVA';
}

/**
 * Serviço de importação em cascata do "Extrato de Locação": a partir de um
 * PDF, resolve/cria Cliente → Site (estabelecimento/CNPJ) → Obra →
 * Fornecedor → Contrato → Fatura → Ativos → Alocações.
 *
 * Todas as chaves de upsert são pensadas para tornar a reimportação do MESMO
 * extrato (ex.: o financeiro reenviando por engano) idempotente: nada é
 * duplicado, os registros existentes são atualizados com os dados mais
 * recentes do PDF. Essa idempotência é o que permite rodar a cascata como uma
 * sequência de upserts simples em vez de uma `$transaction` interativa (ver
 * comentário no início de `execute()`).
 *
 * Princípio: o extrato é a fonte da verdade do que está sendo COBRADO; o
 * sistema é a fonte da verdade de ONDE o equipamento está e com QUEM. Por
 * isso a importação não move ativos entre obras, não reativa ativos em
 * estoque/devolvidos e não apaga responsáveis já preenchidos — essas
 * diferenças aparecem na conciliação para o usuário decidir.
 */
@Injectable()
export class LeaseImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: LeaseStatementParserService,
    private readonly equipmentPricing: EquipmentPricingService,
  ) {}

  async preview(file: Express.Multer.File, options: LeaseImportOptions = {}): Promise<LeaseImportPreview> {
    const parsed = await this.parseFile(file);
    const { header, items, warnings } = parsed;

    const clientCnpjRoot = header.clientCnpj.slice(0, 8);
    const obraLabel = resolveObraLabel(header);
    const [existingClient, existingSite, existingSupplier, existingContract] = await Promise.all([
      clientCnpjRoot ? this.prisma.client.findUnique({ where: { cnpjRoot: clientCnpjRoot } }) : null,
      header.clientCnpj ? this.prisma.site.findUnique({ where: { cnpj: header.clientCnpj } }) : null,
      header.supplierCnpj ? this.prisma.supplier.findUnique({ where: { cnpj: header.supplierCnpj } }) : null,
      header.contractNumber
        ? this.prisma.contract.findUnique({ where: { contractNumber: header.contractNumber } })
        : null,
    ]);

    const existingAssets = await this.findAssetsForItems(items);
    const target = await this.resolveTargetObra(
      obraLabel,
      existingSite?.id ?? null,
      existingClient?.id ?? null,
      existingAssets,
      options,
    );

    const referenceMonth = firstDayOfMonth(header.periodStart);
    let invoiceAction: 'CRIAR' | 'ATUALIZAR' = 'CRIAR';
    if (existingContract) {
      const existingInvoice = await this.prisma.invoice.findUnique({
        where: { contractId_referenceMonth: { contractId: existingContract.id, referenceMonth } },
      });
      if (existingInvoice) invoiceAction = 'ATUALIZAR';
    }

    const reconciliation = await this.reconcile(items, existingAssets, target.obra, existingContract?.id ?? null);
    const priceAlerts = await this.detectPriceMismatches(items);
    const obraOptions = existingClient ? await this.listObraOptions(existingClient.id, existingAssets) : [];
    const toUpdate = reconciliation.rows.filter((r) => r.system).length;

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
          name: existingSite?.name ?? this.newSiteName(header),
        },
        obra: {
          action: target.obra ? 'JÁ EXISTE' : 'CRIAR',
          costCenterLabel: obraLabel,
          name: target.obra?.name ?? options.newObraName?.trim() ?? obraLabel,
          obraId: target.obra?.id ?? null,
          matchedBy: target.matchedBy,
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
          toCreate: reconciliation.rows.length - toUpdate,
          toUpdate,
          total: reconciliation.rows.length,
        },
      },
      obraOptions,
      reconciliation,
      priceAlerts,
    };
  }

  /** Carrega de uma vez os ativos do extrato (por nº de série OU tombo), com a alocação ativa. */
  private async findAssetsForItems(items: ParsedLeaseItem[]): Promise<AssetWithActiveAllocation[]> {
    const serials = items.map((i) => i.serialNumber).filter(Boolean);
    const tags = items.map((i) => i.pat).filter(Boolean);
    if (!serials.length && !tags.length) return [];
    return this.prisma.asset.findMany({
      where: assetIdentifierFilter(serials, tags),
      include: { allocations: { where: { isActive: true }, take: 1, include: { obra: true, site: true } } },
    });
  }

  private matchAsset(item: ParsedLeaseItem, assets: AssetWithActiveAllocation[]) {
    return (
      assets.find((a) => normalizeSerial(a.serialNumber) === item.serialNumber) ??
      (item.pat ? assets.find((a) => normalizeAssetTag(a.assetTag) === item.pat) : undefined) ??
      null
    );
  }

  /**
   * Decide em qual obra os equipamentos deste extrato vão ficar, nesta
   * ordem: (1) a obra escolhida na tela; (2) a obra do estabelecimento que
   * responde por esta CLASSIFICAÇÃO (comparação sem acento/espaço/caixa,
   * incluindo apelidos); (3) a obra onde a maioria dos equipamentos do
   * extrato já está hoje (caso típico: cadastrados antes pela guia de
   * entrega com outro nome de obra). Só se nada disso achar, cria obra nova.
   */
  private async resolveTargetObra(
    label: string,
    siteId: string | null,
    clientId: string | null,
    existingAssets: AssetWithActiveAllocation[],
    options: LeaseImportOptions,
  ): Promise<ResolvedTargetObra> {
    const requestedObraId = options.obraId;
    if (requestedObraId) {
      const obra = await this.prisma.obra.findUnique({
        where: { id: requestedObraId },
        include: { site: true },
      });
      if (!obra) throw new BadRequestException('A obra escolhida não existe mais — recarregue a tela.');
      if (clientId && obra.site.clientId !== clientId) {
        throw new BadRequestException('A obra escolhida pertence a outro cliente.');
      }
      // A classificação vira apelido da obra escolhida — se ela já pertence a
      // OUTRA obra do cliente, as duas passariam a responder pelo mesmo nome.
      const owner = await findObraByLabelInClient(this.prisma, obra.site.clientId, label);
      if (owner && owner.id !== obra.id) {
        throw new BadRequestException(
          `A classificação "${label}" já pertence à obra "${owner.name}". Se "${obra.name}" e "${owner.name}" são a mesma obra, mescle-as em Clientes e Obras; senão, escolha "${owner.name}".`,
        );
      }
      return { obra, matchedBy: 'ESCOLHIDA' };
    }

    if (siteId) {
      const byLabel = await findObraByLabel(this.prisma, siteId, label);
      if (byLabel) return { obra: byLabel, matchedBy: 'CLASSIFICACAO' };
    }
    // O controle é pelo nome da obra: se outra obra do cliente (em outro
    // CNPJ) já responde por esta classificação, é ela — nunca cria outra
    // com o mesmo nome.
    if (clientId) {
      const inClient = await findObraByLabelInClient(this.prisma, clientId, label);
      if (inClient) return { obra: inClient, matchedBy: 'CLASSIFICACAO' };
    }
    if (options.forceNewObra) return { obra: null, matchedBy: 'NOVA' };

    const counts = new Map<string, { obra: Obra; count: number }>();
    for (const asset of existingAssets) {
      const obra = asset.allocations[0]?.obra;
      if (!obra) continue;
      if (clientId && asset.allocations[0]?.site && asset.allocations[0].site.clientId !== clientId) continue;
      const entry = counts.get(obra.id) ?? { obra, count: 0 };
      entry.count++;
      counts.set(obra.id, entry);
    }
    const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    if (best && best.count * 2 >= existingAssets.length && best.count > 0) {
      return { obra: best.obra, matchedBy: 'EQUIPAMENTOS' };
    }

    return { obra: null, matchedBy: 'NOVA' };
  }

  private async listObraOptions(clientId: string, existingAssets: AssetWithActiveAllocation[]): Promise<ObraOption[]> {
    const obras = await this.prisma.obra.findMany({
      where: { site: { clientId } },
      include: { site: true },
      orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
    });
    const countByObra = new Map<string, number>();
    for (const asset of existingAssets) {
      const obraId = asset.allocations[0]?.obraId;
      if (obraId) countByObra.set(obraId, (countByObra.get(obraId) ?? 0) + 1);
    }
    return obras.map((o) => ({
      id: o.id,
      name: o.name,
      costCenterLabel: o.costCenterLabel,
      aliases: o.aliases,
      siteId: o.siteId,
      siteName: o.site.name,
      siteCnpj: o.site.cnpj,
      active: o.active,
      assetsFromStatement: countByObra.get(o.id) ?? 0,
    }));
  }

  /**
   * Conciliação de inventário: cada equipamento do extrato comparado com o
   * que o sistema tem hoje (existe? está nesta obra? mesmo valor? mesmo
   * tombo? está em estoque/devolvido e ainda é cobrado?), mais a lista do
   * que está no sistema nesta obra/contrato e NÃO veio no extrato.
   */
  private async reconcile(
    items: ParsedLeaseItem[],
    existingAssets: AssetWithActiveAllocation[],
    targetObra: Obra | null,
    contractId: string | null,
  ): Promise<LeaseReconciliation> {
    const rows: ReconciliationRow[] = items.map((item) => {
      const description = itemDescription(item);
      const parsed = parseEquipmentDescription(description);
      const asset = this.matchAsset(item, existingAssets);
      const flags: ReconciliationFlag[] = [];

      if (!asset) {
        flags.push('NOVO');
      } else {
        const alloc = asset.allocations[0] ?? null;
        const previousValue = asset.monthlyValue !== null ? Number(asset.monthlyValue) : null;

        if (previousValue === null || previousValue === 0) {
          if (item.totalValue > 0) flags.push('VALOR_PREENCHIDO');
        } else if (Math.abs(previousValue - item.totalValue) > PRICE_MISMATCH_TOLERANCE) {
          flags.push('VALOR_ALTERADO');
        }

        if (asset.status === AssetStatus.DEVOLVIDO) flags.push('DEVOLVIDO_MAS_COBRADO');
        else if (asset.status === AssetStatus.DESCARTADO) flags.push('DESCARTADO_MAS_COBRADO');
        else if (asset.status === AssetStatus.MANUTENCAO) flags.push('EM_MANUTENCAO');
        else if (asset.status === AssetStatus.ESTOQUE) flags.push('EM_ESTOQUE');
        else if (alloc?.obraId && targetObra && alloc.obraId !== targetObra.id) flags.push('OUTRA_OBRA');
        else if (alloc?.obraId && !targetObra) flags.push('OUTRA_OBRA');

        if (item.pat && normalizeAssetTag(asset.assetTag) !== item.pat && !asset.assetTag.startsWith('IMP-')) {
          flags.push('TOMBO_DIVERGENTE');
        }
        if (normalizeSerial(asset.serialNumber) !== item.serialNumber) flags.push('SERIE_DIVERGENTE');
        if (
          item.allocatedTo &&
          alloc &&
          !isPlaceholderAssignee(alloc.assignedToName) &&
          normalizeObraLabel(alloc.assignedToName) !== normalizeObraLabel(item.allocatedTo)
        ) {
          flags.push('RESPONSAVEL_DIFERENTE');
        }
        if (hasRawModel(asset, item)) flags.push('DADOS_A_ORGANIZAR');
        if (flags.length === 0) flags.push('SEM_MUDANCA');
      }

      return {
        serialNumber: item.serialNumber,
        pat: item.pat,
        description,
        allocatedTo: item.allocatedTo,
        installationDate: item.installationDate,
        extratoValue: item.totalValue,
        parsed: {
          brand: parsed.brand,
          model: parsed.model,
          cpu: parsed.cpu,
          ram: parsed.ram,
          storage: parsed.storage,
          gpu: parsed.gpu,
        },
        system: asset
          ? {
              assetId: asset.id,
              assetTag: asset.assetTag,
              serialNumber: asset.serialNumber,
              brand: asset.brand,
              model: asset.model,
              status: asset.status,
              monthlyValue: asset.monthlyValue !== null ? Number(asset.monthlyValue) : null,
              obraId: asset.allocations[0]?.obraId ?? null,
              obraName: asset.allocations[0]?.obra?.name ?? null,
              siteName: asset.allocations[0]?.site?.name ?? null,
              assignedToName: asset.allocations[0]?.assignedToName ?? null,
            }
          : null,
        flags,
      };
    });

    const inStatement = new Set(rows.filter((r) => r.system).map((r) => r.system!.assetId));
    const missing: ReconciliationMissingRow[] = [];
    const seen = new Set<string>();

    const pushMissing = (asset: AssetWithActiveAllocation, reason: ReconciliationMissingRow['reason']) => {
      if (inStatement.has(asset.id) || seen.has(asset.id)) return;
      seen.add(asset.id);
      missing.push({
        assetId: asset.id,
        assetTag: asset.assetTag,
        serialNumber: asset.serialNumber,
        brand: asset.brand,
        model: asset.model,
        status: asset.status,
        monthlyValue: asset.monthlyValue !== null ? Number(asset.monthlyValue) : null,
        obraName: asset.allocations[0]?.obra?.name ?? null,
        assignedToName: asset.allocations[0]?.assignedToName ?? null,
        reason,
      });
    };

    const include = { allocations: { where: { isActive: true }, take: 1, include: { obra: true, site: true } } };
    if (targetObra) {
      const inObra = await this.prisma.asset.findMany({
        where: {
          ownership: AssetOwnership.LOCADO,
          allocations: { some: { isActive: true, obraId: targetObra.id } },
        },
        include,
      });
      inObra.forEach((a) => pushMissing(a, 'NA_OBRA'));
    }
    if (contractId) {
      const inContract = await this.prisma.asset.findMany({
        where: {
          contractId,
          status: { notIn: [AssetStatus.DEVOLVIDO, AssetStatus.DESCARTADO] },
        },
        include,
      });
      inContract.forEach((a) => pushMissing(a, 'NO_CONTRATO'));
    }

    const summary = Object.fromEntries(ALL_FLAGS.map((f) => [f, 0])) as LeaseReconciliation['summary'];
    for (const row of rows) for (const flag of row.flags) summary[flag]++;
    summary.total = rows.length;
    summary.missing = missing.length;

    return { rows, missing, summary };
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
      const tier = await this.equipmentPricing.classify(itemDescription(item));
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

  async execute(file: Express.Multer.File, options: LeaseImportOptions = {}): Promise<LeaseImportSummary> {
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

    // Busca os tipos de equipamento (para classificação) uma vez só, antes
    // do laço — são poucos registros e mudam raramente.
    const activeTiers = await this.prisma.equipmentPriceTier.findMany({ where: { active: true } });

    // IMPORTANTE: esta cascata NÃO roda dentro de uma `$transaction`
    // interativa do Prisma. Já rodou assim antes, mas contra um banco
    // serverless com pooler (Neon, atrás de um PgBouncer em modo
    // "transaction") isso causava o erro "Transaction API error: Transaction
    // not found". A cascata continua segura sem transação porque cada etapa
    // já é um upsert por chave natural (CNPJ, nº de série, [contrato,
    // competência]) — reimportar o mesmo extrato depois de uma falha no meio
    // do caminho não duplica nada, só completa o que faltou.
    const client = await this.upsertClient(clientCnpjRoot, header.clientName);
    const site = await this.upsertSite(header, client.id);

    const existingAssets = await this.findAssetsForItems(dedupedItems);
    const obraLabel = resolveObraLabel(header);
    const target = await this.resolveTargetObra(obraLabel, site.id, client.id, existingAssets, options);
    let obraCreated = false;
    let obra: Obra;
    if (target.obra) {
      // Obra existente escolhida para uma CLASSIFICAÇÃO com outra grafia:
      // guarda a grafia como apelido para o próximo extrato já cair nela.
      obra = await addObraAlias(this.prisma, target.obra, obraLabel);
    } else {
      const typedName = options.newObraName?.trim();
      const sameName = typedName ? await findObraByLabelInClient(this.prisma, client.id, typedName) : null;
      if (sameName) {
        throw new BadRequestException(
          `Já existe a obra "${sameName.name}" — escolha-a na lista em vez de criar outra com o mesmo nome.`,
        );
      }
      obra = await this.prisma.obra.create({
        data: { siteId: site.id, costCenterLabel: obraLabel, name: options.newObraName?.trim() || obraLabel },
      });
      obraCreated = true;
    }

    const supplier = await this.upsertSupplier(header);
    const contract = await this.upsertContract(header, supplier.id, obra.siteId, obra.id, items.length);
    const invoice = await this.upsertInvoice(contract.id, referenceMonth, header, dedupedItems);

    let assetsCreated = 0;
    let assetsUpdated = 0;
    let assetsReorganized = 0;
    let allocationsCreated = 0;
    let allocationsUpdated = 0;
    let allocationsClosed = 0;
    let keptInOtherObra = 0;
    let statusPreserved = 0;

    const allocationNote = `Importado do extrato de locação ${header.contractNumber} — competência ${referenceMonth.toISOString().slice(0, 7)}.`;

    for (const item of dedupedItems) {
      const assetTag = item.pat || `IMP-${item.serialNumber}`;
      // Procura de novo no banco (e não só na lista carregada antes do laço):
      // um item anterior deste mesmo extrato pode ter acabado de criar o
      // ativo com este tombo — assim nunca nasce um segundo ativo igual.
      const existingAsset =
        existingAssets.find((a) => normalizeSerial(a.serialNumber) === item.serialNumber) ??
        (await this.prisma.asset.findFirst({
          where: assetIdentifierFilter([item.serialNumber], [assetTag]),
          include: { allocations: { where: { isActive: true }, take: 1, include: { obra: true, site: true } } },
        }));

      const description = itemDescription(item);
      const parsed = parseEquipmentDescription(description);
      const tier = classifyEquipmentTier(description, activeTiers);

      let asset: Asset;
      if (!existingAsset) {
        asset = await this.prisma.asset.create({
          data: {
            assetTag,
            serialNumber: item.serialNumber,
            type: parsed.type,
            ownership: AssetOwnership.LOCADO,
            brand: parsed.brand,
            model: parsed.model,
            specs: buildSpecsFromDescription(parsed, description, { modelCode: item.modelCode }) as Prisma.InputJsonValue,
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
        const preserveStatus = PRESERVED_STATUSES.includes(existingAsset.status);
        if (preserveStatus) {
          statusPreserved++;
          if (existingAsset.status === AssetStatus.DEVOLVIDO || existingAsset.status === AssetStatus.DESCARTADO) {
            warnings.push(
              `${existingAsset.assetTag} (série ${existingAsset.serialNumber}) está como ${existingAsset.status === AssetStatus.DEVOLVIDO ? 'DEVOLVIDO à locadora' : 'DESCARTADO'} no sistema, mas ainda aparece cobrado no extrato — confira com a locadora.`,
            );
          }
        }
        const reorganize = hasRawModel(existingAsset, item);
        const currentSpecs = (existingAsset.specs as Record<string, unknown> | null) ?? {};
        asset = await this.prisma.asset.update({
          where: { id: existingAsset.id },
          data: {
            contractId: contract.id,
            supplierId: supplier.id,
            monthlyValue: item.totalValue,
            installationDate: item.installationDate ?? existingAsset.installationDate,
            status: preserveStatus ? existingAsset.status : AssetStatus.EM_USO,
            priceTierId: tier?.id ?? existingAsset.priceTierId,
            ...(reorganize && {
              brand: parsed.brand !== 'NÃO INFORMADA' ? parsed.brand : existingAsset.brand,
              model: parsed.model,
              specs: {
                ...currentSpecs,
                ...buildSpecsFromDescription(parsed, description, { modelCode: item.modelCode }),
              } as Prisma.InputJsonValue,
            }),
          },
        });
        if (reorganize) assetsReorganized++;
        assetsUpdated++;
      }

      // Ativo parado no estoque, em manutenção, devolvido ou descartado: não
      // cria/move alocação — a diferença aparece na conciliação.
      if (asset.status !== AssetStatus.EM_USO) continue;

      const activeAllocation = existingAsset?.allocations[0] ?? null;

      if (!activeAllocation) {
        await this.prisma.assetAllocation.create({
          data: {
            assetId: asset.id,
            siteId: obra.siteId,
            obraId: obra.id,
            assignedToName: item.allocatedTo || 'Não informado',
            deliveryDate: item.installationDate ?? new Date(referenceMonth),
            isActive: true,
            notes: allocationNote,
          },
        });
        allocationsCreated++;
      } else if (activeAllocation.obraId !== obra.id) {
        if (!options.moveFromOtherObras) {
          keptInOtherObra++;
          continue;
        }
        await this.prisma.assetAllocation.update({
          where: { id: activeAllocation.id },
          data: { isActive: false, returnDate: new Date(referenceMonth) },
        });
        await this.prisma.assetAllocation.create({
          data: {
            assetId: asset.id,
            siteId: obra.siteId,
            obraId: obra.id,
            // Mudou de obra: o responsável anterior provavelmente não vai junto.
            assignedToName: item.allocatedTo || 'Não informado',
            deliveryDate: item.installationDate ?? new Date(referenceMonth),
            isActive: true,
            notes: allocationNote,
          },
        });
        allocationsClosed++;
        allocationsCreated++;
      } else if (
        item.allocatedTo &&
        isPlaceholderAssignee(activeAllocation.assignedToName) &&
        normalizeObraLabel(activeAllocation.assignedToName) !== normalizeObraLabel(item.allocatedTo)
      ) {
        // Só preenche quando o cadastro está com um marcador ("Não
        // informado"/"Estoque"). Um nome já preenchido por você nunca é
        // sobrescrito pelo campo LOCAL do extrato — nem apagado quando o
        // extrato vem sem LOCAL.
        await this.prisma.assetAllocation.update({
          where: { id: activeAllocation.id },
          data: { assignedToName: item.allocatedTo },
        });
        allocationsUpdated++;
      }
    }

    if (keptInOtherObra > 0) {
      warnings.push(
        `${keptInOtherObra} equipamento(s) deste extrato estão em outra obra no sistema e foram mantidos onde estão. Se eles de fato mudaram, use "Transferir" na tela de Ativos (ou reimporte marcando "mover para esta obra").`,
      );
    }

    return {
      clientId: client.id,
      clientCreated: client.wasCreated,
      siteId: site.id,
      siteCreated: site.wasCreated,
      obraId: obra.id,
      obraCreated,
      supplierId: supplier.id,
      supplierCreated: supplier.wasCreated,
      contractId: contract.id,
      contractCreated: contract.wasCreated,
      invoiceId: invoice.id,
      invoiceCreated: invoice.wasCreated,
      assetsCreated,
      assetsUpdated,
      assetsReorganized,
      allocationsCreated,
      allocationsUpdated,
      allocationsClosed,
      keptInOtherObra,
      statusPreserved,
      warnings,
    };
  }

  private async upsertClient(cnpjRoot: string, clientName: string) {
    const existing = await this.prisma.client.findUnique({ where: { cnpjRoot } });
    if (existing) return { ...existing, wasCreated: false };
    const created = await this.prisma.client.create({
      data: { cnpjRoot, name: clientName || cnpjRoot },
    });
    return { ...created, wasCreated: true };
  }

  /**
   * Nome de um estabelecimento (CNPJ de faturamento) novo. Antes usava a
   * CLASSIFICAÇÃO — e como a classificação é o nome da OBRA, estabelecimento
   * e obra apareciam com o mesmo nome, parecendo duplicados. O controle é
   * pelo nome da obra, então o estabelecimento leva só o CNPJ formatado.
   */
  private newSiteName(header: ParsedLeaseStatement['header']): string {
    const d = header.clientCnpj.replace(/\D/g, '');
    const formatted =
      d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : header.clientCnpj;
    return `CNPJ ${formatted}`;
  }

  private async upsertSite(header: ParsedLeaseStatement['header'], clientId: string) {
    const existing = await this.prisma.site.findUnique({ where: { cnpj: header.clientCnpj } });
    if (existing) return { ...existing, wasCreated: false };
    const created = await this.prisma.site.create({
      data: {
        clientId,
        cnpj: header.clientCnpj,
        name: this.newSiteName(header),
        costCenterLabel: null,
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
    return { ...created, wasCreated: true };
  }

  private async upsertSupplier(header: ParsedLeaseStatement['header']) {
    const existing = await this.prisma.supplier.findUnique({ where: { cnpj: header.supplierCnpj } });
    if (existing) return { ...existing, wasCreated: false };
    const created = await this.prisma.supplier.create({
      data: { cnpj: header.supplierCnpj, name: header.supplierName || header.supplierCnpj },
    });
    return { ...created, wasCreated: true };
  }

  private async upsertContract(
    header: ParsedLeaseStatement['header'],
    supplierId: string,
    siteId: string,
    obraId: string,
    itemCount: number,
  ) {
    const existing = await this.prisma.contract.findUnique({ where: { contractNumber: header.contractNumber } });
    if (existing) {
      const patch: { siteId?: string; obraId?: string } = {};
      if (!existing.siteId) patch.siteId = siteId;
      if (!existing.obraId) patch.obraId = obraId;
      if (Object.keys(patch).length === 0) return { ...existing, wasCreated: false };
      const updated = await this.prisma.contract.update({ where: { id: existing.id }, data: patch });
      return { ...updated, wasCreated: false };
    }
    const referenceMonthlyValue = header.totalValue !== null && itemCount > 0 ? header.totalValue / itemCount : 0;
    const created = await this.prisma.contract.create({
      data: {
        contractNumber: header.contractNumber,
        supplierId,
        siteId,
        obraId,
        status: ContractStatus.ATIVO,
        // O extrato não informa a vigência real do contrato — usamos o
        // período de apuração como início e +1 ano como referência,
        // ajustável manualmente na tela de Contratos depois.
        startDate: header.periodStart,
        endDate: addYears(header.periodStart, 1),
        monthlyValuePerAsset: referenceMonthlyValue,
      },
    });
    return { ...created, wasCreated: true };
  }

  private async upsertInvoice(
    contractId: string,
    referenceMonth: Date,
    header: ParsedLeaseStatement['header'],
    dedupedItems: ParsedLeaseItem[],
  ) {
    const grossValue = header.totalValue ?? dedupedItems.reduce((acc, i) => acc + i.totalValue, 0);
    const existing = await this.prisma.invoice.findUnique({
      where: { contractId_referenceMonth: { contractId, referenceMonth } },
    });
    if (existing) {
      const updated = await this.prisma.invoice.update({ where: { id: existing.id }, data: { grossValue } });
      return { ...updated, wasCreated: false };
    }
    const created = await this.prisma.invoice.create({
      data: {
        contractId,
        referenceMonth,
        dueDate: header.periodEnd,
        grossValue,
        status: InvoiceStatus.PENDENTE,
      },
    });
    return { ...created, wasCreated: true };
  }

  private async parseFile(file: Express.Multer.File): Promise<ParsedLeaseStatement> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    if (file.mimetype !== 'application/pdf' && !file.originalname?.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Envie um arquivo PDF.');
    }
    const parsed = await this.parser.parse(file.buffer);
    return {
      ...parsed,
      items: parsed.items.map((item) => ({
        ...item,
        serialNumber: normalizeSerial(item.serialNumber),
        pat: normalizeAssetTag(item.pat),
      })),
    };
  }
}

// Reexportado para o controller anotar o tipo do array de itens sem precisar
// importar diretamente do parser em dois lugares.
export type { ParsedLeaseItem };
