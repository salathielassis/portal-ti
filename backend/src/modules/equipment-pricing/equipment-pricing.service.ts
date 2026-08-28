import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { classifyEquipmentTier } from '../../common/utils/classify-equipment-tier';
import { CreatePriceTierDto } from './dto/create-price-tier.dto';
import { UpdatePriceTierDto } from './dto/update-price-tier.dto';

@Injectable()
export class EquipmentPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.equipmentPriceTier.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: { _count: { select: { assets: true } } },
    });
  }

  async findOne(id: string) {
    const tier = await this.prisma.equipmentPriceTier.findUnique({ where: { id } });
    if (!tier) throw new NotFoundException('Tipo de equipamento não encontrado');
    return tier;
  }

  async create(dto: CreatePriceTierDto) {
    const exists = await this.prisma.equipmentPriceTier.findUnique({ where: { label: dto.label } });
    if (exists) throw new ConflictException('Já existe um tipo com esse nome');
    return this.prisma.equipmentPriceTier.create({ data: dto });
  }

  async update(id: string, dto: UpdatePriceTierDto) {
    await this.findOne(id);
    return this.prisma.equipmentPriceTier.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.equipmentPriceTier.delete({ where: { id } });
    } catch {
      throw new ConflictException('Não é possível excluir: existem ativos classificados neste tipo.');
    }
  }

  /**
   * Usado por outros módulos (lease-import, assets) para classificar um
   * equipamento a partir da descrição textual. Só considera tiers `active`.
   * Retorna `null` quando nenhuma regra casa (equipamento fica "não
   * classificado" — não é um erro, é informação insuficiente).
   */
  async classify(description: string) {
    const tiers = await this.prisma.equipmentPriceTier.findMany({ where: { active: true } });
    return classifyEquipmentTier(description, tiers);
  }
}
