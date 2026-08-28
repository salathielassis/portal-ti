import { cn } from '@/lib/utils';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: { value: string; direction: 'up' | 'down'; positive?: boolean };
  accent?: 'primary' | 'secondary';
}

/** Card de métrica principal do Dashboard Executivo (Módulo D). */
export function KpiCard({ label, value, icon: Icon, trend, accent = 'primary' }: KpiCardProps) {
  return (
    <Card className="shadow-card">
      <CardContent className="flex items-start justify-between p-5">
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {trend && (
            <p
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                trend.positive ? 'text-success' : 'text-destructive',
              )}
            >
              {trend.direction === 'up' ? (
                <ArrowUpRight className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" />
              )}
              {trend.value}
            </p>
          )}
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            accent === 'primary' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary',
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
