import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetAttachmentType, AssetOwnership, AssetStatus, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  buildSpecsFromDescription,
  parseEquipmentDescription,
} from '../../common/utils/parse-equipment-description';
import { findObraByLabel, findObraByLabelInClient } from '../../common/utils/obra-matching';
import { assetIdentifierFilter, normalizeAssetTag, normalizeSerial } from '../../common/utils/asset-identifiers';
import { DeliveryNoteOcrService } from './ocr/delivery-note-ocr.service';
import { DeliveryNoteParserService, LOCAINFO_CNPJ, LOCAINFO_NAME } from './parsers/delivery-note-parser.service';
import { ConfirmDeliveryImportDto } from './dto/confirm-delivery-import.dto';
import { DeliveryImportPreview, DeliveryImportSummary } from './delivery-import.types';

/**
 * Cadastra os ativos físicos assim que chegam (guia de entrega da LOCAiNFO),
 * SEM vínculo de contrato/valor — de propósito. A guia não traz nº de
 * contrato nem valor mensal; quem completa isso é o `lease-import` (extrato
 * de locação mensal), que já faz upsert por `serialNumber` e preenche
 * `contractId`/`monthlyValue` automaticamente no ciclo seguinte. Os dois
 * módulos são complementares: este registra a chegada física, rápido, no dia
 * da entrega; o extrato mensal seguinte reconcilia o lado financeiro.
 */
@Injectable()
export class DeliveryImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: DeliveryNoteOcrService,
    private readonly parser: DeliveryNoteParserService,
  ) {}

  async preview(file: Express.Multer.File): Promise<DeliveryImportPreview> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    if (file.mimetype !== 'application/pdf' && !file.originalname?.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Envie um arquivo PDF.');
    }

    const fileKey = await this.storage.save(file, 'delivery-notes');
    const pages = await this.ocr.ocrPdf(file.buffer);
    const { header, items, warnings } = this.parser.parse(pages);

    const clientCnpjRoot = header.clientCnpj?.slice(0, 8) ?? '';
    const [existingClient, existingSite] = await Promise.all([
      clientCnpjRoot ? this.prisma.client.findUnique({ where: { cnpjRoot: clientCnpjRoot } }) : null,
      header.clientCnpj ? this.prisma.site.findUnique({ where: { cnpj: header.clientCnpj } }) : null,
    ]);

    const costCenterLabel = header.siteName ?? '';
    const [existingObra, existingObras] = existingSite
      ? await Promise.all([
          costCenterLabel ? findObraByLabel(this.prisma, existingSite.id, costCenterLabel) : null,
          // Obras já cadastradas neste Site — a tela mostra como opções pra
          // escolher, em vez de deixar o usuário digitar um nome levemente
          // diferente do já usado (ex.: OCR lê "DOIS A - SEDE" mas a obra que
          // já recebe locados na matriz se chama "EQUIP - DOIS A NATAL -
          // SEDE") e acabar criando uma obra duplicada por engano.
          this.prisma.obra.findMany({ where: { siteId: existingSite.id, active: true }, orderBy: { name: 'asc' } }),
        ])
      : [null, []];

    const serviceTags = items.flatMap((i) => i.serials.map((s) => normalizeSerial(s.serviceTag))).filter(Boolean);
    const existingAssets = serviceTags.length
      ? await this.prisma.asset.findMany({
          where: assetIdentifierFilter(serviceTags, []),
          select: { serialNumber: true },
        })
      : [];
    const existingSerialSet = new Set(existingAssets.map((a) => normalizeSerial(a.serialNumber)));
    const totalSerials = serviceTags.length;
    const toUpdate = serviceTags.filter((s) => existingSerialSet.has(s)).length;

    return {
      fileKey,
      header,
      items,
      warnings,
      diff: {
        client: {
          action: existingClient ? 'JÁ EXISTE' : 'CRIAR',
          cnpjRoot: clientCnpjRoot,
          name: existingClient?.name ?? header.clientName ?? '',
        },
        site: {
          action: existingSite ? 'JÁ EXISTE' : 'CRIAR',
          cnpj: header.clientCnpj ?? '',
          name: existingSite?.name ?? header.siteName ?? '',
        },
        obra: {
          action: existingObra ? 'JÁ EXISTE' : 'CRIAR',
          costCenterLabel,
          name: existingObra?.name ?? costCenterLabel,
        },
        assets: { toCreate: totalSerials - toUpdate, toUpdate, total: totalSerials },
      },
      existingObras: existingObras.map((o) => ({ id: o.id, name: o.name, costCenterLabel: o.costCenterLabel })),
    };
  }

  async execute(dto: ConfirmDeliveryImportDto): Promise<DeliveryImportSummary> {
    const warnings: string[] = [];
    const clientCnpjRoot = dto.header.clientCnpj.slice(0, 8);

    // Lido uma vez só (não por asset) — usado apenas para preencher o
    // `fileSize` de cada AssetAttachment; todos compartilham o mesmo `fileKey`.
    const fileSize = await this.storage.readFile(dto.fileKey).then((buf) => buf.length).catch(() => 0);

    // Cascata de upserts sequenciais, SEM `$transaction` interativa — mesma
    // decisão (e mesmo motivo: pooler serverless tipo Neon/PgBouncer pode
    // derrubar transações interativas longas) já documentada em
    // `lease-import.service.ts` e `assets.service.ts allocate()`. Cada etapa
    // é upsert por chave natural, então reenviar a mesma confirmação depois
    // de uma falha parcial não duplica nada.
    const client = await this.upsertClient(clientCnpjRoot, dto.header.clientName);
    const site = await this.upsertSite(dto.header, client.id);
    const obra = await this.upsertObra(site.id, client.id, dto.header.siteName);
    const supplier = await this.upsertSupplier();

    let assetsCreated = 0;
    let assetsUpdated = 0;
    let allocationsCreated = 0;
    let allocationsClosed = 0;

    const allocationNote = `Importado da guia de entrega LOCAiNFO — requisição ${dto.header.requisitionNumber ?? 'não informada'}.`;
    const movementDescription = `Entrega via guia LOCAiNFO — requisição ${dto.header.requisitionNumber ?? 'não informada'}.`;
    const defaultAssignedToName = site.isHeadquarters ? 'Estoque' : 'Não informado';

    for (const item of dto.items) {
      for (const serial of item.serials) {
        const serviceTag = normalizeSerial(serial.serviceTag);
        const assetTag = normalizeAssetTag(serial.assetTag);
        if (!serviceTag || !assetTag) {
          warnings.push(`Item "${item.description}" tem um número de série ou tombo vazio — ignorado.`);
          continue;
        }

        const existingAsset = await this.prisma.asset.findFirst({
          where: assetIdentifierFilter([serviceTag], [assetTag]),
        });

        let asset;
        if (!existingAsset) {
          const parsed = parseEquipmentDescription(item.description);
          asset = await this.prisma.asset.create({
            data: {
              assetTag,
              serialNumber: serviceTag,
              type: parsed.type,
              ownership: AssetOwnership.LOCADO,
              brand: parsed.brand,
              model: parsed.model,
              specs: buildSpecsFromDescription(parsed, item.description, {
                codigo: item.codigo ?? null,
                referencia: item.referencia ?? null,
              }) as Prisma.InputJsonValue,
              status: AssetStatus.EM_USO,
              contractId: null,
              supplierId: supplier.id,
            },
          });
          assetsCreated++;
        } else {
          const preserveStatus =
            existingAsset.status === AssetStatus.MANUTENCAO || existingAsset.status === AssetStatus.DESCARTADO;
          asset = await this.prisma.asset.update({
            where: { id: existingAsset.id },
            data: {
              supplierId: existingAsset.supplierId ?? supplier.id,
              status: preserveStatus ? existingAsset.status : AssetStatus.EM_USO,
            },
          });
          assetsUpdated++;
        }

        const activeAllocation = await this.prisma.assetAllocation.findFirst({
          where: { assetId: asset.id, isActive: true },
        });

        if (!activeAllocation) {
          await this.prisma.assetAllocation.create({
            data: {
              assetId: asset.id,
              siteId: site.id,
              obraId: obra.id,
              assignedToName: defaultAssignedToName,
              deliveryDate: new Date(),
              isActive: true,
              notes: allocationNote,
            },
          });
          allocationsCreated++;
        } else if (activeAllocation.obraId !== obra.id) {
          await this.prisma.assetAllocation.update({
            where: { id: activeAllocation.id },
            data: { isActive: false, returnDate: new Date() },
          });
          await this.prisma.assetAllocation.create({
            data: {
              assetId: asset.id,
              siteId: site.id,
              obraId: obra.id,
              assignedToName: defaultAssignedToName,
              deliveryDate: new Date(),
              isActive: true,
              notes: allocationNote,
            },
          });
          allocationsClosed++;
          allocationsCreated++;
        }
        // Já alocado na mesma obra: não mexe — pode já ter sido corrigido
        // manualmente (nome do colaborador) e essa importação não deve
        // sobrescrever isso.

        await this.prisma.assetMovement.create({
          data: {
            assetId: asset.id,
            type: MovementType.ENTREGA,
            fromStatus: existingAsset?.status ?? null,
            toStatus: AssetStatus.EM_USO,
            description: movementDescription,
          },
        });

        const existingAttachment = await this.prisma.assetAttachment.findFirst({
          where: { assetId: asset.id, fileKey: dto.fileKey },
        });
        if (!existingAttachment) {
          await this.prisma.assetAttachment.create({
            data: {
              assetId: asset.id,
              type: AssetAttachmentType.GUIA_ENTREGA,
              fileName: `guia-entrega-${dto.header.requisitionNumber ?? asset.assetTag}.pdf`,
              fileKey: dto.fileKey,
              mimeType: 'application/pdf',
              fileSize,
            },
          });
        }
      }
    }

    return {
      clientId: client.id,
      clientCreated: client.wasCreated,
      siteId: site.id,
      siteCreated: site.wasCreated,
      obraId: obra.id,
      obraCreated: obra.wasCreated,
      supplierId: supplier.id,
      assetsCreated,
      assetsUpdated,
      allocationsCreated,
      allocationsClosed,
      warnings,
    };
  }

  private async upsertClient(cnpjRoot: string, name: string) {
    const existing = await this.prisma.client.findUnique({ where: { cnpjRoot } });
    if (existing) return { ...existing, wasCreated: false };
    const created = await this.prisma.client.create({ data: { cnpjRoot, name: name || cnpjRoot } });
    return { ...created, wasCreated: true };
  }

  private async upsertSite(header: ConfirmDeliveryImportDto['header'], clientId: string) {
    const existing = await this.prisma.site.findUnique({ where: { cnpj: header.clientCnpj } });
    if (existing) return { ...existing, wasCreated: false };
    // A guia não traz endereço estruturado, só o "Local de Entrega" em texto
    // livre — guardado bruto em addressStreet; o usuário completa os demais
    // campos manualmente em Clientes/Obras se precisar.
    const created = await this.prisma.site.create({
      data: {
        clientId,
        cnpj: header.clientCnpj,
        name: header.siteName || header.clientName,
        costCenterLabel: header.siteName || null,
        isHeadquarters: false,
      },
    });
    return { ...created, wasCreated: true };
  }

  private async upsertObra(siteId: string, clientId: string, siteName: string) {
    const costCenterLabel = siteName || '(SEM NOME DE SITE)';
    // Mesmo casamento tolerante da importação de extrato (sem acento/espaço/
    // caixa, incluindo apelidos): primeiro no próprio CNPJ, depois em
    // qualquer obra do cliente — nunca cria obra com nome já existente.
    const existing =
      (await findObraByLabel(this.prisma, siteId, costCenterLabel)) ??
      (await findObraByLabelInClient(this.prisma, clientId, costCenterLabel));
    if (existing) return { ...existing, wasCreated: false };
    const created = await this.prisma.obra.create({ data: { siteId, costCenterLabel, name: costCenterLabel } });
    return { ...created, wasCreated: true };
  }

  private async upsertSupplier() {
    const existing = await this.prisma.supplier.findUnique({ where: { cnpj: LOCAINFO_CNPJ } });
    if (existing) return existing;
    return this.prisma.supplier.create({ data: { cnpj: LOCAINFO_CNPJ, name: LOCAINFO_NAME } });
  }
}
