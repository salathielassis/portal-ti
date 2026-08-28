'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const data = [
  { name: 'Em uso', value: 612, color: 'hsl(var(--chart-1))' },
  { name: 'Estoque', value: 84, color: 'hsl(var(--chart-3))' },
  { name: 'Manutenção', value: 27, color: 'hsl(var(--chart-2))' },
  { name: 'Descartado', value: 15, color: 'hsl(var(--chart-5))' },
];

/** Distribuição de equipamentos por status (Módulo D). */
export function StatusDistributionChart() {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Distribuição por Status</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={64}
              outerRadius={92}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry) => (
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
      </CardContent>
    </Card>
  );
}
