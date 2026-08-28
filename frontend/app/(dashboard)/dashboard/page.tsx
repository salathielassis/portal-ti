import { Laptop, Wallet, Percent, Building2 } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { CostEvolutionChart } from '@/components/dashboard/cost-evolution-chart';
import { StatusDistributionChart } from '@/components/dashboard/status-distribution-chart';
import { IdleAssetsTable } from '@/components/dashboard/idle-assets-table';

export const metadata = { title: 'Dashboard · Portal TI' };

/**
 * Dashboard Executivo — Visão 360 (Módulo D).
 * Layout em grid: linha de KPIs, gráficos lado a lado, tabela de ociosos.
 */
export default function DashboardPage() {
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total de Ativos" value="738" icon={Laptop} trend={{ value: '+12 este mês', direction: 'up', positive: true }} />
          <KpiCard
            label="Locados vs. Próprios"
            value="521 / 217"
            icon={Building2}
            accent="secondary"
            trend={{ value: '70,6% locados', direction: 'up', positive: false }}
          />
          <KpiCard label="Custo Mensal de Locação" value="R$ 49.100,00" icon={Wallet} trend={{ value: '+1,7% vs. mês anterior', direction: 'up', positive: false }} />
          <KpiCard
            label="Conciliação Automática"
            value="87,4%"
            icon={Percent}
            accent="secondary"
            trend={{ value: '+4,1 p.p. vs. mês anterior', direction: 'up', positive: true }}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <CostEvolutionChart />
          </div>
          <div className="lg:col-span-2">
            <StatusDistributionChart />
          </div>
        </div>

        <IdleAssetsTable />
      </main>
    </>
  );
}
