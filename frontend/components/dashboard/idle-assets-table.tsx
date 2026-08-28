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
  idleSince: string;
  monthlyCost: number;
}

const idleAssets: IdleAsset[] = [
  { tag: 'NB-00231', model: 'Dell Latitude 5440', ownership: 'Locado', idleSince: '38 dias', monthlyCost: 189.9 },
  { tag: 'IMP-00042', model: 'HP LaserJet M479', ownership: 'Locado', idleSince: '52 dias', monthlyCost: 240.0 },
  { tag: 'NB-00187', model: 'Lenovo ThinkPad T14', ownership: 'Próprio', idleSince: '21 dias', monthlyCost: 0 },
  { tag: 'NB-00299', model: 'Dell Latitude 5440', ownership: 'Locado', idleSince: '15 dias', monthlyCost: 189.9 },
];

/**
 * Tabela de equipamentos ociosos gerando custo sem uso (Módulo D) — foco em
 * ativos LOCADOS parados, já que representam sangria financeira direta.
 */
export function IdleAssetsTable() {
  const totalWaste = idleAssets.reduce((sum, a) => sum + a.monthlyCost, 0);

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold">Equipamentos Ociosos</CardTitle>
        <span className="text-sm text-muted-foreground">
          Custo mensal ocioso: <span className="font-semibold text-destructive">R$ {totalWaste.toFixed(2)}</span>
        </span>
      </CardHeader>
      <CardContent>
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
            {idleAssets.map((asset) => (
              <TableRow key={asset.tag}>
                <TableCell className="font-medium">{asset.tag}</TableCell>
                <TableCell>{asset.model}</TableCell>
                <TableCell>
                  <Badge variant={asset.ownership === 'Locado' ? 'secondary' : 'outline'}>
                    {asset.ownership}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{asset.idleSince}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {asset.monthlyCost > 0 ? `R$ ${asset.monthlyCost.toFixed(2)}` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
