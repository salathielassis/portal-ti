'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CostPoint {
  month: string;
  total: number;
}

interface CostEvolutionChartProps {
  data: CostPoint[];
}

function formatMonthLabel(month: string) {
  // `month` chega como "YYYY-MM" (referenceMonth das faturas) — exibimos só o mês abreviado.
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

/**
 * Evolução do custo mensal de locação (Módulo D), a partir das faturas reais
 * (`FinanceService.monthlyCostSummary`). Só existe uma série real — "Locação" —
 * a antiga série fictícia de "Manutenção" foi removida por não ter fonte de
 * dados real no backend.
 */
export function CostEvolutionChart({ data }: CostEvolutionChartProps) {
  const chartData = data.map((point) => ({ ...point, label: formatMonthLabel(point.month) }));

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Evolução de Custos de Locação</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sem faturas suficientes para exibir a evolução de custos.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ left: -12, right: 12, top: 8 }}>
              <defs>
                <linearGradient id="fillLocacao" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 'var(--radius)',
                  fontSize: 12,
                }}
                formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, 'Locação']}
              />
              <Area
                type="monotone"
                dataKey="total"
                name="Locação"
                stroke="hsl(var(--chart-1))"
                fill="url(#fillLocacao)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
