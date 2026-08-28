'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_LABEL: Record<string, string> = {
  EM_USO: 'Em uso',
  ESTOQUE: 'Estoque',
  MANUTENCAO: 'Manutenção',
  DESCARTADO: 'Descartado',
  EM_TRANSITO: 'Em trânsito',
};

const STATUS_COLOR: Record<string, string> = {
  EM_USO: 'hsl(var(--chart-1))',
  ESTOQUE: 'hsl(var(--chart-3))',
  MANUTENCAO: 'hsl(var(--chart-2))',
  DESCARTADO: 'hsl(var(--chart-5))',
  EM_TRANSITO: 'hsl(var(--chart-4))',
};

interface StatusDistributionChartProps {
  data: { status: string; count: number }[];
}

/** Distribuição real de equipamentos por status (Módulo D). */
export function StatusDistributionChart({ data }: StatusDistributionChartProps) {
  const chartData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: STATUS_LABEL[d.status] ?? d.status,
      value: d.count,
      color: STATUS_COLOR[d.status] ?? 'hsl(var(--chart-1))',
    }));

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Distribuição por Status</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhum ativo cadastrado ainda.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={64}
                outerRadius={92}
                paddingAngle={2}
                strokeWidth={0}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 'var(--radius)',
                  fontSize: 12,
                }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                wrapperStyle={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
