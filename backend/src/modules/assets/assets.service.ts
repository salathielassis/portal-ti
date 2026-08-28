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

    return this.prisma.$transaction(async (trx) => {
      const allocation = await trx.assetAllocation.create({
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

      await trx.assetMovement.create({
        data: {
          assetId,
          type: MovementType.ENTREGA,
          fromStatus: asset.status,
          toStatus: AssetStatus.EM_USO,
          loggedById: userId,
          description: `Entregue para ${dto.assignedToName}`,
        },
      });

      await trx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.EM_USO } });

      return allocation;
    });
  }

  /** Registra a devolução do ativo, liberando-o para estoque */
  async returnAsset(assetId: string, dto: ReturnAssetDto, userId: string) {
    const asset = await this.findOne(assetId);
    const activeAllocation = await this.prisma.assetAllocation.findFirst({
      where: { assetId, isActive: true },
    });
    if (!activeAllocation) {
      throw new BadRequestException('Este ativo não possui uma alocação ativa para devolver');
    }

    return this.prisma.$transaction(async (trx) => {
      const updated = await trx.assetAllocation.update({
        where: { id: activeAllocation.id },
        data: { returnDate: new Date(dto.returnDate), isActive: false, notes: dto.notes ?? activeAllocation.notes },
      });

      await trx.assetMovement.create({
        data: {
          assetId,
          type: MovementType.DEVOLUCAO,
          fromStatus: asset.status,
          toStatus: AssetStatus.ESTOQUE,
          loggedById: userId,
          description: 'Devolução registrada',
        },
      });

      await trx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.ESTOQUE } });

      return updated;
    });
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

    return this.prisma.$transaction(async (trx) => {
      if (activeAllocation) {
        await trx.assetAllocation.update({
          where: { id: activeAllocation.id },
          data: { isActive: false, returnDate: new Date(dto.transferDate) },
        });
      }

      const newAllocation = await trx.assetAllocation.create({
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
      await trx.assetMovement.create({
        data: {
          assetId,
          type: MovementType.TRANSFERENCIA,
          fromStatus: asset.status,
          toStatus: AssetStatus.EM_USO,
          loggedById: userId,
          description: `Transferido de ${fromLabel} para ${dto.assignedToName}`,
        },
      });

      await trx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.EM_USO } });

      return newAllocation;
    });
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

    return this.prisma.$transaction(async (trx) => {
      if (activeAllocation) {
        await trx.assetAllocation.update({
          where: { id: activeAllocation.id },
          data: { isActive: false, returnDate: new Date(dto.date) },
        });
      }

      await trx.assetMovement.create({
        data: {
          assetId,
          type: MovementType.MANUTENCAO_ENTRADA,
          fromStatus: asset.status,
          toStatus: AssetStatus.MANUTENCAO,
          loggedById: userId,
          description: dto.notes ?? 'Enviado para manutenção',
        },
      });

      return trx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.MANUTENCAO } });
    });
  }

  /** Retorna o ativo da manutenção para o estoque, pronto para nova alocação. */
  async returnFromMaintenance(assetId: string, dto: ReturnFromMaintenanceDto, userId: string) {
    const asset = await this.findOne(assetId);
    if (asset.status !== AssetStatus.MANUTENCAO) {
      throw new BadRequestException('Este ativo não está em manutenção');
    }

    return this.prisma.$transaction(async (trx) => {
      await trx.assetMovement.create({
        data: {
          assetId,
          type: MovementType.MANUTENCAO_SAIDA,
          fromStatus: asset.status,
          toStatus: AssetStatus.ESTOQUE,
          loggedById: userId,
          description: dto.notes ?? 'Retornou da manutenção',
        },
      });

      return trx.asset.update({ where: { id: assetId }, data: { status: AssetStatus.ESTOQUE } });
    });
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
