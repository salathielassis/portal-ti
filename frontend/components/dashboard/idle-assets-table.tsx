import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface IdleAsset {
  tag: string;
  model: string;
  ownership: 'Próprio' | 'Locado';
  idleDays: number;
  monthlyCost: number;
}

interface IdleAssetsTableProps {
  data: IdleAsset[];
  idleMonthlyCost: number;
}

/**
 * Tabela de equipamentos ociosos gerando custo sem uso (Módulo D) — foco em
 * ativos LOCADOS parados, já que representam sangria financeira direta.
 * Dados reais vindos de `AssetsService.findIdle()` via `GET /dashboard/summary`.
 */
export function IdleAssetsTable({ data, idleMonthlyCost }: IdleAssetsTableProps) {
  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold">Equipamentos Ociosos</CardTitle>
        <span className="text-sm text-muted-foreground">
          Custo mensal ocioso:{' '}
          <span className="font-semibold text-destructive">R$ {idleMonthlyCost.toFixed(2)}</span>
        </span>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum equipamento ocioso no momento.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patrimônio</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ocioso há</TableHead>
                <TableHead className="text-right">Custo/mês</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((asset) => (
                <TableRow key={asset.tag}>
                  <TableCell className="font-medium">{asset.tag}</TableCell>
                  <TableCell>{asset.model}</TableCell>
                  <TableCell>
                    <Badge variant={asset.ownership === 'Locado' ? 'secondary' : 'outline'}>
                      {asset.ownership}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{asset.idleDays} dias</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {asset.monthlyCost > 0 ? `R$ ${asset.monthlyCost.toFixed(2)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
