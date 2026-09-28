import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetAttachmentType, AssetOwnership, AssetStatus, AssetType, MovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EquipmentPricingService } from '../equipment-pricing/equipment-pricing.service';
import { StorageService } from '../../common/storage/storage.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { normalizeAssetTag, normalizeSerial } from '../../common/utils/asset-identifiers';
import { UpdateAssetDto } from './dto/update-asset.dto';
import {
  AllocateAssetDto,
  ReturnAssetDto,
  ReturnToSupplierDto,
  TransferAssetDto,
  UpdateAssignedToDto,
  SendToMaintenanceDto,
  ReturnFromMaintenanceDto,
  DiscardAssetDto,
} from './dto/allocate-asset.dto';

interface FindAllFilters {
  status?: AssetStatus;
  ownership?: AssetOwnership;
  type?: AssetType;
  contractId?: string;
  /** Estabelecimento (CNPJ) — só é alcançável via a alocação ATIVA do ativo. */
  siteId?: string;
  /** Obra / centro de custo — via a alocação ATIVA do ativo. Tem prioridade sobre siteId. */
  obraId?: string;
  /** Busca livre por tag, número de série, marca ou modelo. */
  search?: string;
}

/** Responsável é opcional em toda a tela de ativos — em branco é gravado como "Não informado". */
function normalizeAssignee(name: string | null | undefined): string {
  return name?.trim() || 'Não informado';
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly equipmentPricing: EquipmentPricingService,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateAssetDto, userId?: string) {
    if (dto.ownership === AssetOwnership.LOCADO && !dto.contractId) {
      throw new BadRequestException('Ativos locados precisam informar o contrato de origem');
    }

    dto.assetTag = normalizeAssetTag(dto.assetTag);
    dto.serialNumber = normalizeSerial(dto.serialNumber);
    if (!dto.assetTag || !dto.serialNumber) {
      throw new BadRequestException('Informe o patrimônio (tombo) e o número de série.');
    }
    await this.assertUniqueIdentifiers(dto.assetTag, dto.serialNumber);

    const { obraId, assignedToName, ...assetData } = dto;
    const siteId = await this.resolveSiteFromObra(obraId);
    const tier = await this.equipmentPricing.classify(`${dto.brand} ${dto.model}`);

    const asset = await this.prisma.asset.create({
      data: {
        ...(assetData as any),
        priceTierId: tier?.id ?? null,
        ...(obraId && { status: AssetStatus.EM_USO }),
      },
    });

    // Cadastro já com o local onde o equipamento está: nasce alocado na
    // obra/filial, com responsável opcional — nem sempre se sabe quem ficou
    // com ele, e isso não pode travar o cadastro.
    if (obraId) {
      const name = normalizeAssignee(assignedToName);
      await this.prisma.assetAllocation.create({
        data: { assetId: asset.id, assignedToName: name, siteId, obraId, deliveryDate: new Date(), allocatedById: userId },
      });
      await this.prisma.assetMovement.create({
        data: {
          assetId: asset.id,
          type: MovementType.ENTREGA,
          fromStatus: null,
          toStatus: AssetStatus.EM_USO,
          loggedById: userId,
          description: `Cadastrado já alocado — responsável: ${name}`,
        },
      });
    }

    return asset;
  }

  async findAll(filters: FindAllFilters) {
    return this.prisma.asset.findMany({
      where: {
        ...(filters.status && { status: filters.status }),
        ...(filters.ownership && { ownership: filters.ownership }),
        ...(filters.type && { type: filters.type }),
        ...(filters.contractId && { contractId: filters.contractId }),
        ...(filters.siteId && {
          allocations: { some: { isActive: true, siteId: filters.siteId } },
        }),
        ...(filters.obraId && {
          allocations: { some: { isActive: true, obraId: filters.obraId } },
        }),
        ...(filters.search && {
          OR: [
            { assetTag: { contains: filters.search, mode: 'insensitive' } },
            { serialNumber: { contains: filters.search, mode: 'insensitive' } },
            { brand: { contains: filters.search, mode: 'insensitive' } },
            { model: { contains: filters.search, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        supplier: true,
        contract: true,
        priceTier: true,
        allocations: {
          where: { isActive: true },
          take: 1,
          include: { site: true, obra: true, department: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Busca exata por nº de série — usado pela leitura de código de barras (bipador), que lê o mesmo nº de série já impresso pelo fabricante embaixo do equipamento. */
  async findBySerial(serialNumber: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { serialNumber: { equals: normalizeSerial(serialNumber), mode: 'insensitive' } },
      include: {
        supplier: true,
        contract: true,
        priceTier: true,
        allocations: {
          where: { isActive: true },
          take: 1,
          include: { site: true, obra: true, department: true },
        },
      },
    });
    if (!asset) throw new NotFoundException('Nenhum ativo encontrado com esse número de série');
    return asset;
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        supplier: true,
        contract: true,
        priceTier: true,
        allocations: {
          orderBy: { deliveryDate: 'desc' },
          include: { site: true, obra: true, department: true },
        },
        movements: { orderBy: { occurredAt: 'desc' } },
        attachments: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!asset) throw new NotFoundException('Ativo não encontrado');
    return asset;
  }

  async update(id: string, dto: UpdateAssetDto) {
    const current = await this.findOne(id);

    if (dto.assetTag !== undefined) dto.assetTag = normalizeAssetTag(dto.assetTag);
    if (dto.serialNumber !== undefined) dto.serialNumber = normalizeSerial(dto.serialNumber);
    if (dto.assetTag === '' || dto.serialNumber === '') {
      throw new BadRequestException('Patrimônio (tombo) e número de série não podem ficar vazios.');
    }
    await this.assertUniqueIdentifiers(dto.assetTag, dto.serialNumber, id);

    const ownership = dto.ownership ?? current.ownership;
    const contractId = dto.contractId !== undefined ? dto.contractId : current.contractId;
    if (ownership === AssetOwnership.LOCADO && !contractId) {
      throw new BadRequestException('Ativos locados precisam informar o contrato de origem');
    }

    // Reclassifica o tipo se marca/modelo mudou — mantém a tabela de preços
    // de referência útil mesmo para ativos cadastrados/corrigidos manualmente.
    let priceTierId = current.priceTierId;
    if (dto.brand || dto.model) {
      const tier = await this.equipmentPricing.classify(`${dto.brand ?? current.brand} ${dto.model ?? current.model}`);
      priceTierId = tier?.id ?? null;
    }
    return this.prisma.asset.update({ where: { id }, data: { ...(dto as any), priceTierId } });
  }

  /**
   * Tombo e nº de série são únicos ignorando maiúsculas/espaços — o índice
   * único do banco só pega repetição exata, e cadastros antigos podem não
   * estar normalizados.
   */
  private async assertUniqueIdentifiers(assetTag?: string, serialNumber?: string, excludeId?: string) {
    const notSelf = excludeId ? { id: { not: excludeId } } : {};
    if (assetTag) {
      const dup = await this.prisma.asset.findFirst({
        where: { ...notSelf, assetTag: { equals: assetTag, mode: 'insensitive' } },
      });
      if (dup) throw new ConflictException(`Já existe um ativo com o patrimônio ${dup.assetTag}`);
    }
    if (serialNumber) {
      const dup = await this.prisma.asset.findFirst({
        where: { ...notSelf, serialNumber: { equals: serialNumber, mode: 'insensitive' } },
      });
      if (dup) {
        throw new ConflictException(`Já existe um ativo com o número de série ${dup.serialNumber} (patrimônio ${dup.assetTag})`);
      }
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.asset.delete({ where: { id } });
    } catch {
      throw new ConflictException(
        'Não é possível excluir: este ativo tem histórico de alocação vinculado.',
      );
    }
  }

  /**
   * A alocação guarda `obraId` (unidade real) e `siteId` (o CNPJ) em
   * sincronia. Quando a chamada informa a obra, o site é derivado dela;
   * quando informa só o site (uso legado / cliente externo), mantém o site.
   */
  private async resolveSiteFromObra(obraId?: string, fallbackSiteId?: string): Promise<string | undefined> {
    if (!obraId) return fallbackSiteId;
    const obra = await this.prisma.obra.findUnique({ where: { id: obraId } });
    if (!obra) throw new BadRequestException('Obra informada não existe.');
    return obra.siteId;
  }

  /** Entrega o ativo para um colaborador/cliente/departamento/obra */
  async allocate(assetId: string, dto: AllocateAssetDto, userId: string) {
    const asset = await this.findOne(assetId);

    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });
    if (activeAllocation) {
      throw new ConflictException(
        'Este ativo já está alocado — use "Transferir" para mover diretamente, ou devolva antes de alocar novamente',
      );
    }

    const siteId = await this.resolveSiteFromObra(dto.obraId, dto.siteId);
    const assignedToName = normalizeAssignee(dto.assignedToName);

    // Sequência simples (sem `$transaction` interativa): contra um banco
    // serverless com pooler (ex.: Neon), uma transação interativa pode
    // manter uma conexão presa e ser derrubada no meio do caminho — o mesmo
    // problema já visto e corrigido na importação de extrato. Como aqui são
    // só 3 escritas dependentes (nunca reexecutadas em lote), rodar em
    // sequência é seguro e evita o risco.
    const allocation = await this.prisma.assetAllocation.create({
      data: {
        assetId,
        assignedToName,
        cpf: dto.cpf,
        siteId,
        obraId: dto.obraId,
        departmentId: dto.departmentId,
        clientName: dto.clientName,
        deliveryDate: new Date(dto.deliveryDate),
        notes: dto.notes,
        allocatedById: userId,
      },
    });

    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.ENTREGA,
        fromStatus: asset.status,
        toStatus: AssetStatus.EM_USO,
        loggedById: userId,
        description: `Entregue para ${assignedToName}`,
      },
    });

    await this.prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.EM_USO } });

    return allocation;
  }

  /**
   * Corrige/preenche só o nome do responsável na alocação ATIVA atual — sem
   * fechar/reabrir alocação, sem mudar site/departamento e sem gerar
   * movimentação nova, porque fisicamente nada mudou de lugar. Pensado para
   * o caso comum de uma importação de extrato de locação ter deixado o ativo
   * com "Não informado" (o PDF da locadora normalmente não traz o nome do
   * colaborador, só a obra/local) e o usuário precisar corrigir depois — ou
   * para o caso de troca de equipamento entre colaboradores, quando ainda
   * não se sabe quem ficou com ele (campo enviado em branco vira
   * "Não informado" novamente, em vez de salvar uma string vazia).
   */
  async updateAssignedTo(assetId: string, dto: UpdateAssignedToDto) {
    await this.findOne(assetId);
    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });
    if (!activeAllocation) {
      throw new BadRequestException(
        'Este ativo não possui uma alocação ativa — use "Alocar" para atribuir um responsável.',
      );
    }
    const assignedToName = normalizeAssignee(dto.assignedToName);
    return this.prisma.assetAllocation.update({
      where: { id: activeAllocation.id },
      data: { assignedToName },
    });
  }

  /**
   * Registra a devolução do ativo PARA O ESTOQUE — sempre, independente de
   * propriedade. Um ativo LOCADO devolvido continua com o contrato de
   * locação ativo (a locadora só para de cobrar quando avisada — ver
   * `returnToSupplier()`), então ele fica ocioso em ESTOQUE gerando custo
   * até ser realocado ou formalmente devolvido à locadora. Isso é
   * exatamente o que `findIdle()` reporta no card "Equipamentos Ociosos" do
   * dashboard. Um ativo PRÓPRIO simplesmente volta para o estoque, sem
   * nenhum contrato envolvido.
   */
  async returnAsset(assetId: string, dto: ReturnAssetDto, userId: string) {
    const asset = await this.findOne(assetId);
    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });
    if (!activeAllocation) {
      throw new BadRequestException('Este ativo não possui uma alocação ativa para devolver');
    }

    // Anexa a observação da devolução à nota existente da alocação (ex.: a
    // nota deixada pela importação de extrato) em vez de sobrescrevê-la.
    const returnNote = dto.notes?.trim();
    const notes = returnNote
      ? [activeAllocation.notes, `Devolução: ${returnNote}`].filter(Boolean).join('\n')
      : activeAllocation.notes;

    // Sequência simples (sem `$transaction` interativa) — ver nota em `allocate()`.
    const updated = await this.prisma.assetAllocation.update({
      where: { id: activeAllocation.id },
      data: {
        returnDate: new Date(dto.returnDate),
        isActive: false,
        notes,
        // Preenche/confirma CPF e RG na devolução — útil quando não foram
        // capturados na entrega mas o termo de devolução em PDF pede os dois.
        ...(dto.cpf !== undefined && { cpf: dto.cpf }),
        ...(dto.rg !== undefined && { rg: dto.rg }),
      },
    });

    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.DEVOLUCAO,
        fromStatus: asset.status,
        toStatus: AssetStatus.ESTOQUE,
        loggedById: userId,
        description: 'Devolução registrada',
      },
    });

    await this.prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.ESTOQUE } });

    return updated;
  }

  /**
   * Devolução do ativo LOCADO à locadora — formaliza o fim do uso desse
   * item no contrato (na prática, o e-mail avisando a locadora para parar
   * de cobrar). Diferente de `returnAsset()`: pode ser chamada tanto de
   * EM_USO (fecha a alocação ativa, se houver) quanto de ESTOQUE (ativo já
   * ocioso, sem alocação para fechar) — o destino é sempre DEVOLVIDO, que
   * `findIdle()` não considera mais ocioso/gerando custo.
   */
  async returnToSupplier(assetId: string, dto: ReturnToSupplierDto, userId: string) {
    const asset = await this.findOne(assetId);
    if (asset.ownership !== AssetOwnership.LOCADO) {
      throw new BadRequestException('Só é possível devolver à locadora ativos locados');
    }
    if (asset.status === AssetStatus.DEVOLVIDO) {
      throw new BadRequestException('Este ativo já foi devolvido à locadora');
    }
    if (asset.status === AssetStatus.DESCARTADO) {
      throw new BadRequestException('Este ativo foi descartado — não é possível devolvê-lo à locadora');
    }

    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });

    // Sequência simples (sem `$transaction` interativa) — ver nota em `allocate()`.
    if (activeAllocation) {
      await this.prisma.assetAllocation.update({
        where: { id: activeAllocation.id },
        data: { isActive: false, returnDate: new Date(dto.returnDate) },
      });
    }

    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.DEVOLUCAO,
        fromStatus: asset.status,
        toStatus: AssetStatus.DEVOLVIDO,
        loggedById: userId,
        description: dto.notes
          ? `Devolvido à locadora — ${dto.notes}`
          : 'Devolvido à locadora — fim de uso deste equipamento no contrato',
      },
    });

    return this.prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.DEVOLVIDO } });
  }

  /**
   * Transfere o ativo diretamente para um novo destino (pessoa/obra/
   * departamento), num único passo: encerra a alocação ativa atual (se
   * houver) e abre uma nova. Pensado para o caso de uso "mudou de obra" —
   * evita ter que devolver e alocar de novo manualmente, e registra os dois
   * lados da movimentação no histórico.
   */
  async transfer(assetId: string, dto: TransferAssetDto, userId: string) {
    const asset = await this.findOne(assetId);
    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
      include: { site: true, obra: true },
    });

    const siteId = await this.resolveSiteFromObra(dto.obraId, dto.siteId);
    const assignedToName = normalizeAssignee(dto.assignedToName);

    // Sequência simples (sem `$transaction` interativa) — ver nota em `allocate()`.
    if (activeAllocation) {
      await this.prisma.assetAllocation.update({
        where: { id: activeAllocation.id },
        data: { isActive: false, returnDate: new Date(dto.transferDate) },
      });
    }

    const newAllocation = await this.prisma.assetAllocation.create({
      data: {
        assetId,
        assignedToName,
        cpf: dto.cpf,
        siteId,
        obraId: dto.obraId,
        departmentId: dto.departmentId,
        clientName: dto.clientName,
        deliveryDate: new Date(dto.transferDate),
        notes: dto.notes,
        allocatedById: userId,
      },
    });

    const fromLabel = activeAllocation
      ? activeAllocation.obra?.name ?? activeAllocation.site?.name ?? activeAllocation.assignedToName
      : 'estoque';
    const newObra = dto.obraId ? await this.prisma.obra.findUnique({ where: { id: dto.obraId } }) : null;
    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.TRANSFERENCIA,
        fromStatus: asset.status,
        toStatus: AssetStatus.EM_USO,
        loggedById: userId,
        description: `Transferido de ${fromLabel} para ${newObra?.name ? `${newObra.name} (${assignedToName})` : assignedToName}`,
      },
    });

    await this.prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.EM_USO } });

    return newAllocation;
  }

  /**
   * Envia o ativo para manutenção: encerra a alocação ativa (o equipamento
   * sai fisicamente de quem estava com ele) e marca o status como
   * MANUTENCAO. Quando voltar, precisa ser alocado de novo — decisão
   * deliberada para não deixar um responsável "fantasma" vinculado a um
   * equipamento que está fisicamente na assistência técnica.
   */
  async sendToMaintenance(assetId: string, dto: SendToMaintenanceDto, userId: string) {
    const asset = await this.findOne(assetId);
    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });

    // Sequência simples (sem `$transaction` interativa) — ver nota em `allocate()`.
    if (activeAllocation) {
      await this.prisma.assetAllocation.update({
        where: { id: activeAllocation.id },
        data: { isActive: false, returnDate: new Date(dto.date) },
      });
    }

    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.MANUTENCAO_ENTRADA,
        fromStatus: asset.status,
        toStatus: AssetStatus.MANUTENCAO,
        loggedById: userId,
        description: dto.notes ?? 'Enviado para manutenção',
      },
    });

    return this.prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.MANUTENCAO } });
  }

  /** Retorna o ativo da manutenção para o estoque, pronto para nova alocação. */
  async returnFromMaintenance(assetId: string, dto: ReturnFromMaintenanceDto, userId: string) {
    const asset = await this.findOne(assetId);
    if (asset.status !== AssetStatus.MANUTENCAO) {
      throw new BadRequestException('Este ativo não está em manutenção');
    }

    // Sequência simples (sem `$transaction` interativa) — ver nota em `allocate()`.
    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.MANUTENCAO_SAIDA,
        fromStatus: asset.status,
        toStatus: AssetStatus.ESTOQUE,
        loggedById: userId,
        description: dto.notes ?? 'Retornou da manutenção',
      },
    });

    return this.prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.ESTOQUE } });
  }

  /**
   * Baixa definitiva do ativo — defeito sem conserto viável pelo valor,
   * perda, etc. Encerra a alocação ativa (se houver), igual às outras
   * saídas, mas o destino é DESCARTADO: diferente de manutenção, não volta
   * pro estoque depois. O cadastro e o histórico continuam consultáveis
   * (mesmo raciocínio de DEVOLVIDO), só não conta mais como disponível.
   */
  async discard(assetId: string, dto: DiscardAssetDto, userId: string) {
    const asset = await this.findOne(assetId);
    if (asset.status === AssetStatus.DESCARTADO) {
      throw new BadRequestException('Este ativo já está descartado');
    }

    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });

    // Sequência simples (sem `$transaction` interativa) — ver nota em `allocate()`.
    if (activeAllocation) {
      await this.prisma.assetAllocation.update({
        where: { id: activeAllocation.id },
        data: { isActive: false, returnDate: new Date(dto.date) },
      });
    }

    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.DESCARTE,
        fromStatus: asset.status,
        toStatus: AssetStatus.DESCARTADO,
        loggedById: userId,
        description: dto.reason,
        occurredAt: new Date(dto.date),
      },
    });

    return this.prisma.asset.update({ where: { id: assetId }, data: { status: AssetStatus.DESCARTADO } });
  }

  /**
   * Ativos LOCADOS parados em estoque há mais de `minDays` — usados no card
   * "Equipamentos Ociosos" do Dashboard (Módulo D), pois representam custo
   * de locação sem uso.
   */
  async findIdle(minDays = 15) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - minDays);

    const idle = await this.prisma.asset.findMany({
      where: {
        status: AssetStatus.ESTOQUE,
        ownership: AssetOwnership.LOCADO,
        updatedAt: { lte: threshold },
      },
      include: { contract: true },
      orderBy: { updatedAt: 'asc' },
    });

    return idle.map((asset) => ({
      ...asset,
      idleDays: Math.floor((Date.now() - asset.updatedAt.getTime()) / (1000 * 60 * 60 * 24)),
      monthlyCost: asset.contract ? Number(asset.contract.monthlyValuePerAsset) : 0,
    }));
  }

  /** Ativo + alocação ativa, para montar o termo de responsabilidade (400 se não houver alocação ativa). */
  async findActiveAllocationForTermo(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        priceTier: true,
        allocations: {
          where: { isActive: true },
          take: 1,
          include: { site: true, obra: true, department: true },
        },
      },
    });
    if (!asset) throw new NotFoundException('Ativo não encontrado');

    const allocation = asset.allocations[0];
    if (!allocation) {
      throw new BadRequestException('Este ativo não possui uma alocação ativa — não há termo a gerar.');
    }

    return { asset, allocation };
  }

  /** Anexa um arquivo (foto, nota fiscal, termo assinado, etc.) ao cadastro do ativo. */
  async addAttachment(assetId: string, file: Express.Multer.File, type: AssetAttachmentType, userId: string) {
    await this.findOne(assetId);
    const fileKey = await this.storage.save(file, 'attachments');
    return this.prisma.assetAttachment.create({
      data: {
        assetId,
        type,
        fileName: file.originalname,
        fileKey,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedById: userId,
      },
    });
  }

  private async findAttachmentOrThrow(assetId: string, attachmentId: string) {
    const attachment = await this.prisma.assetAttachment.findFirst({ where: { id: attachmentId, assetId } });
    if (!attachment) throw new NotFoundException('Anexo não encontrado');
    return attachment;
  }

  /** Devolve os bytes de um anexo para download (o controller monta o Content-Type/Content-Disposition). */
  async getAttachmentFile(assetId: string, attachmentId: string) {
    const attachment = await this.findAttachmentOrThrow(assetId, attachmentId);
    const buffer = await this.storage.readFile(attachment.fileKey);
    return { attachment, buffer };
  }

  async removeAttachment(assetId: string, attachmentId: string) {
    const attachment = await this.findAttachmentOrThrow(assetId, attachmentId);
    await this.prisma.assetAttachment.delete({ where: { id: attachmentId } });
    await this.storage.deleteFile(attachment.fileKey);
    return attachment;
  }
}
