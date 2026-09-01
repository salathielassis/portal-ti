'use client';

import * as React from 'react';
import { FileSpreadsheet, FileText, ClipboardList } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch, apiFetchBlob, ApiError } from '@/lib/api-client';

type AssetType = 'NOTEBOOK' | 'IMPRESSORA' | 'MONITOR' | 'PERIFERICO' | 'OUTRO';
type AssetOwnership = 'PROPRIO' | 'LOCADO';
type AssetStatus = 'EM_USO' | 'ESTOQUE' | 'MANUTENCAO' | 'DESCARTADO' | 'EM_TRANSITO' | 'DEVOLVIDO';

interface Contract {
  id: string;
  contractNumber: string;
}

interface Obra {
  id: string;
  name: string;
  site: { id: string; name: string };
}

interface Asset {
  id: string;
  assetTag: string;
  serialNumber: string;
  brand: string;
  model: string;
  ownership: AssetOwnership;
  status: AssetStatus;
  monthlyValue: string | null;
  priceTier: { id: string; label: string } | null;
  allocations: {
    assignedToName: string;
    site: { name: string; costCenterLabel: string | null } | null;
    obra: { name: string } | null;
  }[];
}

const TYPE_LABEL: Record<AssetType, string> = {
  NOTEBOOK: 'Notebook',
  IMPRESSORA: 'Impressora',
  MONITOR: 'Monitor',
  PERIFERICO: 'Periférico',
  OUTRO: 'Outro',
};

const STATUS_LABEL: Record<AssetStatus, string> = {
  EM_USO: 'Em uso',
  ESTOQUE: 'Estoque',
  MANUTENCAO: 'Manutenção',
  DESCARTADO: 'Descartado',
  EM_TRANSITO: 'Em trânsito',
  DEVOLVIDO: 'Devolvido',
};

const STATUS_VARIANT: Record<AssetStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  EM_USO: 'default',
  ESTOQUE: 'outline',
  MANUTENCAO: 'secondary',
  DESCARTADO: 'destructive',
  EM_TRANSITO: 'secondary',
  DEVOLVIDO: 'outline',
};

const today = () => new Date().toISOString().slice(0, 10);

function currency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function costCenterOf(asset: Asset) {
  const alloc = asset.allocations[0];
  return alloc?.obra?.name || alloc?.site?.costCenterLabel || alloc?.site?.name || '—';
}

/**
 * Aba "Relatórios" — exporta os equipamentos (filtrados ou selecionados
 * manualmente) para XLSX ou PDF, com resumo por centro de custo e status.
 * Usa os mesmos filtros da tela de Ativos; a geração do arquivo é feita no
 * backend (`GET /assets/export`).
 */
export default function RelatoriosPage() {
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [contracts, setContracts] = React.useState<Contract[]>([]);
  const [obras, setObras] = React.useState<Obra[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [statusFilter, setStatusFilter] = React.useState('');
  const [ownershipFilter, setOwnershipFilter] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [contractFilter, setContractFilter] = React.useState('');
  const [obraFilter, setObraFilter] = React.useState('');
  const [searchText, setSearchText] = React.useState('');

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [exporting, setExporting] = React.useState<null | 'xlsx' | 'pdf'>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (ownershipFilter) params.set('ownership', ownershipFilter);
      if (typeFilter) params.set('type', typeFilter);
      if (contractFilter) params.set('contractId', contractFilter);
      if (obraFilter) params.set('obraId', obraFilter);
      const query = params.toString() ? `?${params.toString()}` : '';

      const [assetsData, contractsData, obrasData] = await Promise.all([
        apiFetch<Asset[]>(`/assets${query}`),
        apiFetch<Contract[]>('/contracts'),
        apiFetch<Obra[]>('/clients/obras'),
      ]);
      setAssets(assetsData);
      setContracts(contractsData);
      setObras(obrasData);
      // Descarta seleções de linhas que sumiram após mudar os filtros.
      setSelectedIds((prev) => {
        const valid = new Set(assetsData.map((a) => a.id));
        const next = new Set<string>();
        prev.forEach((id) => valid.has(id) && next.add(id));
        return next;
      });
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar os equipamentos.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, ownershipFilter, typeFilter, contractFilter, obraFilter]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Busca livre aplicada no cliente (tag, série, marca, modelo) — o mesmo
  // termo é enviado ao backend na exportação por filtros.
  const filteredAssets = React.useMemo(() => {
    const term = searchText.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((a) =>
      [a.assetTag, a.serialNumber, a.brand, a.model]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(term)),
    );
  }, [assets, searchText]);

  const allVisibleSelected =
    filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id));

  function toggleAll() {
    setSelectedIds((prev) => {
      if (filteredAssets.every((a) => prev.has(a.id))) {
        const next = new Set(prev);
        filteredAssets.forEach((a) => next.delete(a.id));
        return next;
      }
      const next = new Set(prev);
      filteredAssets.forEach((a) => next.add(a.id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const exportCount = selectedIds.size > 0 ? selectedIds.size : filteredAssets.length;

  async function handleExport(format: 'xlsx' | 'pdf') {
    setExporting(format);
    setExportError(null);
    try {
      const params = new URLSearchParams();
      params.set('format', format);
      if (selectedIds.size > 0) {
        params.set('ids', Array.from(selectedIds).join(','));
      } else {
        if (statusFilter) params.set('status', statusFilter);
        if (ownershipFilter) params.set('ownership', ownershipFilter);
        if (typeFilter) params.set('type', typeFilter);
        if (contractFilter) params.set('contractId', contractFilter);
        if (obraFilter) params.set('obraId', obraFilter);
        if (searchText.trim()) params.set('search', searchText.trim());
      }

      const blob = await apiFetchBlob(`/assets/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-equipamentos-${today()}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Não foi possível gerar o relatório.');
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Relatórios' }]} />

      <main className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            Exporte os equipamentos por centro de custo, contrato ou outros filtros para levar à gestão/diretoria.
            O <strong>XLS</strong> traz todas as colunas de referência (série, fornecedor, datas, valores, diferença
            vs. referência). O <strong>PDF</strong> é um resumo em paisagem com as colunas principais e os totais
            por centro de custo e status.
          </p>
        </div>

        <Card className="shadow-card">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap gap-3">
              <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos os status</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select className="w-44" value={ownershipFilter} onChange={(e) => setOwnershipFilter(e.target.value)}>
                <option value="">Próprio e locado</option>
                <option value="PROPRIO">Próprio</option>
                <option value="LOCADO">Locado</option>
              </Select>
              <Select className="w-44" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">Todos os tipos</option>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select className="w-48" value={contractFilter} onChange={(e) => setContractFilter(e.target.value)}>
                <option value="">Todos os contratos</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contractNumber}
                  </option>
                ))}
              </Select>
              <Select className="w-56" value={obraFilter} onChange={(e) => setObraFilter(e.target.value)}>
                <option value="">Todas as obras / centros de custo</option>
                {obras.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.site.name} · {o.name}
                  </option>
                ))}
              </Select>
              <Input
                className="w-56"
                placeholder="Buscar tag, série, marca ou modelo..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                {selectedIds.size > 0 ? (
                  <>
                    <strong>{selectedIds.size}</strong> equipamento(s) selecionado(s) manualmente serão exportados.
                  </>
                ) : (
                  <>
                    Sem seleção manual — serão exportados os <strong>{filteredAssets.length}</strong> equipamento(s)
                    que casam com os filtros.
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleExport('xlsx')}
                  disabled={exportCount === 0 || exporting !== null}
                >
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  {exporting === 'xlsx' ? 'Gerando XLS...' : 'Exportar XLS'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleExport('pdf')}
                  disabled={exportCount === 0 || exporting !== null}
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  {exporting === 'pdf' ? 'Gerando PDF...' : 'Exportar PDF'}
                </Button>
              </div>
            </div>

            {exportError && <Alert variant="destructive">{exportError}</Alert>}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadError && (
              <div className="p-5">
                <Alert variant="destructive">{loadError}</Alert>
              </div>
            )}

            {!loadError && loading && (
              <p className="p-5 text-sm text-muted-foreground">Carregando equipamentos...</p>
            )}

            {!loadError && !loading && filteredAssets.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <ClipboardList className="h-8 w-8" />
                Nenhum equipamento encontrado com esses filtros.
              </div>
            )}

            {!loadError && !loading && filteredAssets.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        className="h-4 w-4 rounded border-border"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Patrimônio</TableHead>
                    <TableHead>Equipamento</TableHead>
                    <TableHead>Tipo de ref.</TableHead>
                    <TableHead>Propriedade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Centro de custo</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="text-right">Valor mensal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.map((asset) => {
                    const alloc = asset.allocations[0] ?? null;
                    const monthly = asset.monthlyValue != null ? Number(asset.monthlyValue) : null;
                    return (
                      <TableRow key={asset.id} data-state={selectedIds.has(asset.id) ? 'selected' : undefined}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${asset.assetTag}`}
                            className="h-4 w-4 rounded border-border"
                            checked={selectedIds.has(asset.id)}
                            onChange={() => toggleOne(asset.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{asset.assetTag}</TableCell>
                        <TableCell>
                          {asset.brand} {asset.model}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {asset.priceTier ? asset.priceTier.label : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={asset.ownership === 'LOCADO' ? 'secondary' : 'outline'}>
                            {asset.ownership === 'LOCADO' ? 'Locado' : 'Próprio'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{costCenterOf(asset)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {alloc ? alloc.assignedToName : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {monthly != null ? currency(monthly) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
