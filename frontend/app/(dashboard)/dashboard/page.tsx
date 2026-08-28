'use client';

import * as React from 'react';
import { Laptop, Wallet, Percent, Building2 } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Alert } from '@/components/ui/alert';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { CostEvolutionChart } from '@/components/dashboard/cost-evolution-chart';
import { StatusDistributionChart } from '@/components/dashboard/status-distribution-chart';
import { IdleAssetsTable } from '@/components/dashboard/idle-assets-table';
import { apiFetch, ApiError } from '@/lib/api-client';

interface DashboardSummary {
  totalAssets: number;
  newAssetsThisMonth: number;
  locadoCount: number;
  proprioCount: number;
  percentLocado: number;
  monthlyLeaseCost: number;
  monthlyLeaseCostChangePct: number | null;
  reconciliationRate: number;
  totalReconciliationMatches: number;
  statusDistribution: { status: string; count: number }[];
  costEvolution: { month: string; total: number }[];
  idleAssets: { tag: string; model: string; ownership: 'Próprio' | 'Locado'; idleDays: number; monthlyCost: number }[];
  idleMonthlyCost: number;
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Dashboard Executivo — Visão 360 (Módulo D).
 * Layout em grid: linha de KPIs, gráficos lado a lado, tabela de ociosos.
 * Todos os números vêm de `GET /dashboard/summary` (dados reais do Neon) —
 * nada aqui é mais fixo/exemplo.
 */
export default function DashboardPage() {
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    apiFetch<DashboardSummary>('/dashboard/summary')
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((err) => {
        if (active) {
          setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar o dashboard.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Dashboard' }]} />

      <main className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
          <p className="text-sm text-muted-foreground">
            Panorama consolidado do parque de ativos de TI e custos de locação.
          </p>
        </div>

        {loadError && <Alert variant="destructive">{loadError}</Alert>}

        {!loadError && loading && <p className="text-sm text-muted-foreground">Carregando dashboard...</p>}

        {!loadError && !loading && summary && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Total de Ativos"
                value={summary.totalAssets.toLocaleString('pt-BR')}
                icon={Laptop}
                trend={
                  summary.newAssetsThisMonth > 0
                    ? { value: `+${summary.newAssetsThisMonth} este mês`, direction: 'up', positive: true }
                    : undefined
                }
              />
              <KpiCard
                label="Locados vs. Próprios"
                value={`${summary.locadoCount} / ${summary.proprioCount}`}
                icon={Building2}
                accent="secondary"
                trend={
                  summary.totalAssets > 0
                    ? { value: `${summary.percentLocado.toFixed(1)}% locados`, direction: 'up', positive: false }
                    : undefined
                }
              />
              <KpiCard
                label="Custo Mensal de Locação"
                value={formatCurrency(summary.monthlyLeaseCost)}
                icon={Wallet}
                trend={
                  summary.monthlyLeaseCostChangePct !== null
                    ? {
                        value: `${summary.monthlyLeaseCostChangePct >= 0 ? '+' : ''}${summary.monthlyLeaseCostChangePct.toFixed(1)}% vs. mês anterior`,
                        direction: summary.monthlyLeaseCostChangePct >= 0 ? 'up' : 'down',
                        positive: summary.monthlyLeaseCostChangePct < 0,
                      }
                    : undefined
                }
              />
              <KpiCard
                label="Conciliação Automática"
                value={`${summary.reconciliationRate.toFixed(1)}%`}
                icon={Percent}
                accent="secondary"
                trend={
                  summary.totalReconciliationMatches > 0
                    ? { value: `${summary.totalReconciliationMatches} conciliações no total`, direction: 'up', positive: true }
                    : undefined
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <CostEvolutionChart data={summary.costEvolution} />
              </div>
              <div className="lg:col-span-2">
                <StatusDistributionChart data={summary.statusDistribution} />
              </div>
            </div>

            <IdleAssetsTable data={summary.idleAssets} idleMonthlyCost={summary.idleMonthlyCost} />
          </>
        )}
      </main>
    </>
  );
}
