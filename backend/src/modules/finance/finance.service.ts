import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { CreateCostAllocationDto } from './dto/create-cost-allocation.dto';

/** Converte "YYYY-MM" no primeiro e último dia (23:59:59.999) daquele mês, em UTC. */
function parseMonthRange(month: string): { periodStart: Date; periodEnd: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!match) {
    throw new BadRequestException('Informe o mês no formato AAAA-MM, ex.: 2026-08');
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const periodStart = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  return { periodStart, periodEnd };
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvoice(dto: CreateInvoiceDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id: dto.contractId } });
    if (!contract) throw new NotFoundException('Contrato não encontrado');

    return this.prisma.invoice.create({
      data: {
        contractId: dto.contractId,
        referenceMonth: new Date(dto.referenceMonth),
        dueDate: new Date(dto.dueDate),
        grossValue: dto.grossValue,
      },
    });
  }

  async findAll(status?: InvoiceStatus) {
    return this.prisma.invoice.findMany({
      where: { ...(status && { status }) },
      include: { contract: { include: { supplier: true } }, costAllocations: true },
      orderBy: { dueDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        contract: { include: { supplier: true } },
        costAllocations: { include: { department: true } },
        reconciliationMatches: true,
      },
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');
    return invoice;
  }

  async updateStatus(id: string, dto: UpdateInvoiceStatusDto) {
    await this.findOne(id);
    return this.prisma.invoice.update({ where: { id }, data: { status: dto.status } });
  }

  /** Rateia a fatura entre departamentos — a soma dos percentuais não pode passar de 100% */
  async addCostAllocation(invoiceId: string, dto: CreateCostAllocationDto) {
    const invoice = await this.findOne(invoiceId);

    const department = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
    if (!department) throw new NotFoundException('Departamento não encontrado');

    const currentTotal = invoice.costAllocations.reduce((sum, a) => sum + Number(a.percentage), 0);
    if (currentTotal + dto.percentage > 100) {
      throw new BadRequestException(
        `Rateio excede 100%: já alocado ${currentTotal}%, tentando adicionar mais ${dto.percentage}%`,
      );
    }

    const value = Number(invoice.grossValue) * (dto.percentage / 100);

    return this.prisma.invoiceCostAllocation.create({
      data: { invoiceId, departmentId: dto.departmentId, percentage: dto.percentage, value },
    });
  }

  /** Custo mensal de locação nos últimos `months` meses — alimenta o gráfico do Dashboard */
  async monthlyCostSummary(months = 8) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    const invoices = await this.prisma.invoice.findMany({
      where: { referenceMonth: { gte: start } },
      select: { referenceMonth: true, grossValue: true },
    });

    const byMonth = new Map<string, number>();
    for (const inv of invoices) {
      const key = `${inv.referenceMonth.getUTCFullYear()}-${String(inv.referenceMonth.getUTCMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(inv.grossValue));
    }

    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));
  }

  /**
   * Relatório de atividade mensal de ativos — pensado para o financeiro
   * conferir a fatura contra o histórico real de alocações: quantos ativos
   * estavam de fato em uso no mês, quem entrou/saiu e em que dia exato (o
   * extrato costuma cobrar proporcional ao dia de instalação/devolução no
   * meio do mês), e o que é equipamento novo no inventário (cadastrado pela
   * primeira vez, e não apenas transferido de outra obra).
   *
   * `siteId` opcional restringe a uma obra/filial específica; omitido, o
   * relatório cobre todos os sites.
   */
  async assetActivityReport(month: string, siteId?: string) {
    const { periodStart, periodEnd } = parseMonthRange(month);

    let site: { id: string; name: string } | null = null;
    if (siteId) {
      site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
      if (!site) throw new NotFoundException('Obra/filial não encontrada');
    }

    // Toda alocação que se sobrepõe a algum dia do mês: começou até o fim do
    // mês, e (ainda está ativa) ou (só terminou depois do início do mês).
    const allocations = await this.prisma.assetAllocation.findMany({
      where: {
        ...(siteId && { siteId }),
        deliveryDate: { lte: periodEnd },
        OR: [{ returnDate: null }, { returnDate: { gte: periodStart } }],
      },
      include: { asset: true, site: true },
      orderBy: { deliveryDate: 'asc' },
    });

    const isNewEquipment = (assetCreatedAt: Date) => assetCreatedAt >= periodStart && assetCreatedAt <= periodEnd;

    const activeAtEnd = allocations.filter(
      (a) => a.deliveryDate <= periodEnd && (!a.returnDate || a.returnDate > periodEnd),
    );
    const activatedDuringMonth = allocations.filter((a) => a.deliveryDate >= periodStart && a.deliveryDate <= periodEnd);
    const returnedDuringMonth = allocations.filter(
      (a) => a.returnDate && a.returnDate >= periodStart && a.returnDate <= periodEnd,
    );

    const movements = [
      ...activatedDuringMonth.map((a) => ({
        assetId: a.asset.id,
        assetTag: a.asset.assetTag,
        serialNumber: a.asset.serialNumber,
        brand: a.asset.brand,
        model: a.asset.model,
        siteId: a.siteId,
        siteName: a.site?.name ?? null,
        type: 'ENTRADA' as const,
        date: a.deliveryDate.toISOString().slice(0, 10),
        isNewEquipment: isNewEquipment(a.asset.createdAt),
      })),
      ...returnedDuringMonth.map((a) => ({
        assetId: a.asset.id,
        assetTag: a.asset.assetTag,
        serialNumber: a.asset.serialNumber,
        brand: a.asset.brand,
        model: a.asset.model,
        siteId: a.siteId,
        siteName: a.site?.name ?? null,
        type: 'SAIDA' as const,
        date: a.returnDate!.toISOString().slice(0, 10),
        isNewEquipment: false,
      })),
    ].sort((x, y) => x.date.localeCompare(y.date));

    const activeAssets = activeAtEnd.map((a) => ({
      assetId: a.asset.id,
      assetTag: a.asset.assetTag,
      serialNumber: a.asset.serialNumber,
      brand: a.asset.brand,
      model: a.asset.model,
      siteId: a.siteId,
      siteName: a.site?.name ?? null,
      assignedToName: a.assignedToName,
      deliveryDate: a.deliveryDate.toISOString().slice(0, 10),
      monthlyValue: a.asset.monthlyValue ? Number(a.asset.monthlyValue) : null,
      isNewEquipment: isNewEquipment(a.asset.createdAt),
    }));

    return {
      referenceMonth: month,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      site,
      totals: {
        activeAtEnd: activeAtEnd.length,
        activatedDuringMonth: activatedDuringMonth.length,
        returnedDuringMonth: returnedDuringMonth.length,
        newEquipment: activatedDuringMonth.filter((a) => isNewEquipment(a.asset.createdAt)).length,
      },
      movements,
      activeAssets,
    };
  }
}
