import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetOwnership, AssetStatus, MovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EquipmentPricingService } from '../equipment-pricing/equipment-pricing.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import {
  AllocateAssetDto,
  ReturnAssetDto,
  TransferAssetDto,
  UpdateAssignedToDto,
  SendToMaintenanceDto,
  ReturnFromMaintenanceDto,
} from './dto/allocate-asset.dto';

interface FindAllFilters {
  status?: AssetStatus;
  ownership?: AssetOwnership;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly equipmentPricing: EquipmentPricingService,
  ) {}

  async create(dto: CreateAssetDto) {
    if (dto.ownership === AssetOwnership.LOCADO && !dto.contractId) {
      throw new BadRequestException('Ativos locados precisam informar o contrato de origem');
    }

    const duplicateTag = await this.prisma.asset.findUnique({ where: { assetTag: dto.assetTag } });
    if (duplicateTag) throw new ConflictException('Já existe um ativo com essa tag de patrimônio');

    const duplicateSerial = await this.prisma.asset.findUnique({
      where: { serialNumber: dto.serialNumber },
    });
    if (duplicateSerial) throw new ConflictException('Já existe um ativo com esse número de série');

    const tier = await this.equipmentPricing.classify(`${dto.brand} ${dto.model}`);

    return this.prisma.asset.create({ data: { ...(dto as any), priceTierId: tier?.id ?? null } });
  }

  async findAll(filters: FindAllFilters) {
    return this.prisma.asset.findMany({
      where: {
        ...(filters.status && { status: filters.status }),
        ...(filters.ownership && { ownership: filters.ownership }),
      },
      include: {
        supplier: true,
        contract: true,
        priceTier: true,
        allocations: { where: { isActive: true }, take: 1, include: { site: true, department: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        supplier: true,
        contract: true,
        priceTier: true,
        allocations: { orderBy: { deliveryDate: 'desc' }, include: { site: true, department: true } },
        movements: { orderBy: { occurredAt: 'desc' } },
      },
    });
    if (!asset) throw new NotFoundException('Ativo não encontrado');
    return asset;
  }

  async update(id: string, dto: UpdateAssetDto) {
    const current = await this.findOne(id);
    // Reclassifica o tipo se marca/modelo mudou — mantém a tabela de preços
    // de referência útil mesmo para ativos cadastrados/corrigidos manualmente.
    let priceTierId = current.priceTierId;
    if (dto.brand || dto.model) {
      const tier = await this.equipmentPricing.classify(`${dto.brand ?? current.brand} ${dto.model ?? current.model}`);
      priceTierId = tier?.id ?? null;
    }
    return this.prisma.asset.update({ where: { id }, data: { ...(dto as any), priceTierId } });
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

    // Sequência simples (sem `$transaction` interativa): contra um banco
    // serverless com pooler (ex.: Neon), uma transação interativa pode
    // manter uma conexão presa e ser derrubada no meio do caminho — o mesmo
    // problema já visto e corrigido na importação de extrato. Como aqui são
    // só 3 escritas dependentes (nunca reexecutadas em lote), rodar em
    // sequência é seguro e evita o risco.
    const allocation = await this.prisma.assetAllocation.create({
      data: {
        assetId,
        assignedToName: dto.assignedToName,
        siteId: dto.siteId,
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
        description: `Entregue para ${dto.assignedToName}`,
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
    const assignedToName = dto.assignedToName.trim() || 'Não informado';
    return this.prisma.assetAllocation.update({
      where: { id: activeAllocation.id },
      data: { assignedToName },
    });
  }

  /**
   * Registra a devolução do ativo. O status de destino depende da
   * propriedade: um ativo PRÓPRIO recolhido volta para ESTOQUE (continua
   * seu, disponível para realocar); um ativo LOCADO devolvido à locadora vai
   * para DEVOLVIDO — ele não volta a ser "estoque disponível" porque não
   * está mais fisicamente com a empresa, e não deve ser contado como
   * ocioso/gerando custo (`findIdle` só considera ESTOQUE). O cadastro e o
   * histórico completo continuam consultáveis normalmente; a fatura do mês
   * seguinte simplesmente não vai mais trazer esse equipamento, já que ela
   * vem do extrato real da locadora, não de um cálculo baseado no status.
   */
  async returnAsset(assetId: string, dto: ReturnAssetDto, userId: string) {
    const asset = await this.findOne(assetId);
    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });
    if (!activeAllocation) {
      throw new BadRequestException('Este ativo não possui uma alocação ativa para devolver');
    }

    const toStatus = asset.ownership === AssetOwnership.LOCADO ? AssetStatus.DEVOLVIDO : AssetStatus.ESTOQUE;

    // Sequência simples (sem `$transaction` interativa) — ver nota em `allocate()`.
    const updated = await this.prisma.assetAllocation.update({
      where: { id: activeAllocation.id },
      data: { returnDate: new Date(dto.returnDate), isActive: false, notes: dto.notes ?? activeAllocation.notes },
    });

    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.DEVOLUCAO,
        fromStatus: asset.status,
        toStatus,
        loggedById: userId,
        description:
          toStatus === AssetStatus.DEVOLVIDO
            ? 'Devolvido à locadora — fim de uso deste equipamento no contrato'
            : 'Devolução registrada',
      },
    });

    await this.prisma.asset.update({ where: { id: assetId }, data: { status: toStatus } });

    return updated;
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
      include: { site: true },
    });

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
        assignedToName: dto.assignedToName,
        siteId: dto.siteId,
        departmentId: dto.departmentId,
        clientName: dto.clientName,
        deliveryDate: new Date(dto.transferDate),
        notes: dto.notes,
        allocatedById: userId,
      },
    });

    const fromLabel = activeAllocation
      ? activeAllocation.site?.name ?? activeAllocation.assignedToName
      : 'estoque';
    await this.prisma.assetMovement.create({
      data: {
        assetId,
        type: MovementType.TRANSFERENCIA,
        fromStatus: asset.status,
        toStatus: AssetStatus.EM_USO,
        loggedById: userId,
        description: `Transferido de ${fromLabel} para ${dto.assignedToName}`,
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
}
