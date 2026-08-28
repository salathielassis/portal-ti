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
  locacao: number;
  manutencao: number;
}

const data: CostPoint[] = [
  { month: 'Jan', locacao: 42000, manutencao: 3200 },
  { month: 'Fev', locacao: 43500, manutencao: 2800 },
  { month: 'Mar', locacao: 44100, manutencao: 4100 },
  { month: 'Abr', locacao: 45800, manutencao: 3000 },
  { month: 'Mai', locacao: 46200, manutencao: 5200 },
  { month: 'Jun', locacao: 47950, manutencao: 2600 },
  { month: 'Jul', locacao: 48300, manutencao: 3400 },
  { month: 'Ago', locacao: 49100, manutencao: 3900 },
];

/**
 * Evolução de custos de locação ao longo do ano (Módulo D).
 * Cores consomem os tokens `--chart-1` / `--chart-2`, que já se adaptam
 * automaticamente ao tema claro/escuro (ver globals.css).
 */
export function CostEvolutionChart() {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Evolução de Custos de Locação</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -12, right: 12, top: 8 }}>
            <defs>
              <linearGradient id="fillLocacao" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fillManutencao" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="month"
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
              formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, undefined]}
            />
            <Area
              type="monotone"
              dataKey="locacao"
              name="Locação"
              stroke="hsl(var(--chart-1))"
              fill="url(#fillLocacao)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="manutencao"
              name="Manutenção"
              stroke="hsl(var(--chart-2))"
              fill="url(#fillManutencao)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
