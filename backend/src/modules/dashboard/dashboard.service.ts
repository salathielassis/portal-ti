import { Injectable } from '@nestjs/common';
import { AssetOwnership } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { FinanceService } from '../finance/finance.service';

const OWNERSHIP_LABEL: Record<AssetOwnership, 'Próprio' | 'Locado'> = {
  PROPRIO: 'Próprio',
  LOCADO: 'Locado',
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly finance: FinanceService,
  ) {}

  /**
   * Consolida os números reais que alimentam o Dashboard (Módulo D): total
   * de ativos, locados vs. próprios, custo mensal de locação (a partir das
   * faturas reais), taxa de conciliação automática, evolução de custo dos
   * últimos meses, distribuição por status e os equipamentos ociosos.
   */
  async getSummary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalAssets, locadoCount, proprioCount, newAssetsThisMonth, statusGroups] = await Promise.all([
      this.prisma.asset.count(),
      this.prisma.asset.count({ where: { ownership: AssetOwnership.LOCADO } }),
      this.prisma.asset.count({ where: { ownership: AssetOwnership.PROPRIO } }),
      this.prisma.asset.count({ where: { createdAt: { gte: startOfMonth } } }),
      this.prisma.asset.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const costSeries = await this.finance.monthlyCostSummary(8);
    const currentMonthCost = costSeries.length > 0 ? costSeries[costSeries.length - 1].total : 0;
    const previousMonthCost = costSeries.length > 1 ? costSeries[costSeries.length - 2].total : null;
    const monthlyLeaseCostChangePct =
      previousMonthCost && previousMonthCost > 0
        ? ((currentMonthCost - previousMonthCost) / previousMonthCost) * 100
        : null;

    const [automaticMatches, totalMatches] = await Promise.all([
      this.prisma.reconciliationMatch.count({ where: { matchType: 'AUTOMATICO' } }),
      this.prisma.reconciliationMatch.count(),
    ]);
    const reconciliationRate = totalMatches > 0 ? (automaticMatches / totalMatches) * 100 : 0;

    const idle = await this.assets.findIdle(15);

    return {
      totalAssets,
      newAssetsThisMonth,
      locadoCount,
      proprioCount,
      percentLocado: totalAssets > 0 ? (locadoCount / totalAssets) * 100 : 0,
      monthlyLeaseCost: currentMonthCost,
      monthlyLeaseCostChangePct,
      reconciliationRate,
      totalReconciliationMatches: totalMatches,
      statusDistribution: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      costEvolution: costSeries,
      idleAssets: idle.map((asset) => ({
        tag: asset.assetTag,
        model: `${asset.brand} ${asset.model}`,
        ownership: OWNERSHIP_LABEL[asset.ownership],
        idleDays: asset.idleDays,
        monthlyCost: asset.monthlyCost,
      })),
      idleMonthlyCost: idle.reduce((sum, a) => sum + a.monthlyCost, 0),
    };
  }
}
