import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContractDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');

    const exists = await this.prisma.contract.findUnique({
      where: { contractNumber: dto.contractNumber },
    });
    if (exists) throw new ConflictException('Já existe um contrato com esse número');

    return this.prisma.contract.create({
      data: {
        contractNumber: dto.contractNumber,
        supplierId: dto.supplierId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        monthlyValuePerAsset: dto.monthlyValuePerAsset,
        earlyTerminationFee: dto.earlyTerminationFee,
        annualReadjustIndex: dto.annualReadjustIndex,
        annualReadjustPct: dto.annualReadjustPct,
      },
    });
  }

  async findAll() {
    const contracts = await this.prisma.contract.findMany({
      orderBy: { endDate: 'asc' },
      include: { supplier: true, _count: { select: { assets: true } } },
    });

    // Anexa quantos dias faltam para o vencimento — usado pela UI para colorir o badge
    const now = new Date();
    return contracts.map((c) => ({
      ...c,
      daysUntilExpiration: Math.ceil((c.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    }));
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: { supplier: true, assets: true, invoices: { orderBy: { referenceMonth: 'desc' } } },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    return contract;
  }

  async update(id: string, dto: UpdateContractDto) {
    await this.findOne(id);
    const { startDate, endDate, ...rest } = dto;
    return this.prisma.contract.update({
      where: { id },
      data: {
        ...rest,
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.contract.delete({ where: { id } });
    } catch {
      throw new ConflictException(
        'Não é possível excluir: este contrato tem ativos ou faturas vinculados.',
      );
    }
  }

  /** Usado pelo job de alerta (30/15/7 dias) e pelo card do Dashboard */
  async findExpiringSoon(withinDays = 30) {
    const now = new Date();
    const limit = new Date(now);
    limit.setDate(limit.getDate() + withinDays);

    return this.prisma.contract.findMany({
      where: { endDate: { gte: now, lte: limit } },
      include: { supplier: true },
      orderBy: { endDate: 'asc' },
    });
  }
}
