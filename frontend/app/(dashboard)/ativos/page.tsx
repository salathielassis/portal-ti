'use client';

import * as React from 'react';
import {
  Laptop,
  PackageCheck,
  PackageMinus,
  Plus,
  MoreVertical,
  History,
  ArrowRightLeft,
  Wrench,
  Undo2,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { apiFetch, ApiError } from '@/lib/api-client';

type AssetType = 'NOTEBOOK' | 'IMPRESSORA' | 'MONITOR' | 'PERIFERICO' | 'OUTRO';
type AssetOwnership = 'PROPRIO' | 'LOCADO';
type AssetStatus = 'EM_USO' | 'ESTOQUE' | 'MANUTENCAO' | 'DESCARTADO' | 'EM_TRANSITO';
type MovementType = 'ENTREGA' | 'DEVOLUCAO' | 'TRANSFERENCIA' | 'MANUTENCAO_ENTRADA' | 'MANUTENCAO_SAIDA' | 'DESCARTE';

interface Contract {
  id: string;
  contractNumber: string;
}

interface Site {
  id: string;
  name: string;
  client: { id: string; name: string };
}

interface PriceTier {
  id: string;
  label: string;
}

interface Asset {
  id: string;
  assetTag: string;
  serialNumber: string;
  type: AssetType;
  ownership: AssetOwnership;
  status: AssetStatus;
  brand: string;
  model: string;
  contract: Contract | null;
  priceTier: PriceTier | null;
  allocations: { assignedToName: string; site: Site | null }[];
}

interface AllocationHistoryEntry {
  id: string;
  assignedToName: string;
  site: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  clientName: string | null;
  deliveryDate: string;
  returnDate: string | null;
  isActive: boolean;
  notes: string | null;
}

interface MovementHistoryEntry {
  id: string;
  type: MovementType;
  fromStatus: AssetStatus | null;
  toStatus: AssetStatus | null;
  description: string | null;
  occurredAt: string;
}

interface AssetDetail extends Omit<Asset, 'allocations'> {
  allocations: AllocationHistoryEntry[];
  movements: MovementHistoryEntry[];
}

const emptyForm = {
  assetTag: '',
  serialNumber: '',
  type: 'NOTEBOOK' as AssetType,
  ownership: 'PROPRIO' as AssetOwnership,
  brand: '',
  model: '',
  contractId: '',
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyAllocateForm = { assignedToName: '', siteId: '', deliveryDate: today() };
const emptyTransferForm = { assignedToName: '', siteId: '', transferDate: today(), notes: '' };
const emptyMaintenanceForm = { date: today(), notes: '' };

const STATUS_LABEL: Record<AssetStatus, string> = {
  EM_USO: 'Em uso',
  ESTOQUE: 'Estoque',
  MANUTENCAO: 'Manutenção',
  DESCARTADO: 'Descartado',
  EM_TRANSITO: 'Em trânsito',
};

const STATUS_VARIANT: Record<AssetStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  EM_USO: 'default',
  ESTOQUE: 'outline',
  MANUTENCAO: 'secondary',
  DESCARTADO: 'destructive',
  EM_TRANSITO: 'secondary',
};

const MOVEMENT_LABEL: Record<MovementType, string> = {
  ENTREGA: 'Entrega',
  DEVOLUCAO: 'Devolução',
  TRANSFERENCIA: 'Transferência',
  MANUTENCAO_ENTRADA: 'Enviado para manutenção',
  MANUTENCAO_SAIDA: 'Retornou da manutenção',
  DESCARTE: 'Descarte',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR');
}

function locationLabel(alloc: { site: { name: string } | null; assignedToName: string }) {
  return alloc.site ? `${alloc.assignedToName} · ${alloc.site.name}` : alloc.assignedToName;
}

export default function AtivosPage() {
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [contracts, setContracts] = React.useState<Contract[]>([]);
  const [sites, setSites] = React.useState<Site[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState('');
  const [ownershipFilter, setOwnershipFilter] = React.useState('');

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [allocatingAsset, setAllocatingAsset] = React.useState<Asset | null>(null);
  const [allocateForm, setAllocateForm] = React.useState(emptyAllocateForm);
  const [allocateError, setAllocateError] = React.useState<string | null>(null);

  const [transferringAsset, setTransferringAsset] = React.useState<Asset | null>(null);
  const [transferForm, setTransferForm] = React.useState(emptyTransferForm);
  const [transferError, setTransferError] = React.useState<string | null>(null);

  const [maintenanceAsset, setMaintenanceAsset] = React.useState<{ asset: Asset; mode: 'start' | 'end' } | null>(null);
  const [maintenanceForm, setMaintenanceForm] = React.useState(emptyMaintenanceForm);
  const [maintenanceError, setMaintenanceError] = React.useState<string | null>(null);

  const [historyAsset, setHistoryAsset] = React.useState<AssetDetail | null>(null);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (ownershipFilter) params.set('ownership', ownershipFilter);
      const query = params.toString() ? `?${params.toString()}` : '';

      const [assetsData, contractsData, sitesData] = await Promise.all([
        apiFetch<Asset[]>(`/assets${query}`),
        apiFetch<Contract[]>('/contracts'),
        apiFetch<Site[]>('/clients/sites'),
      ]);
      setAssets(assetsData);
      setContracts(contractsData);
      setSites(sitesData);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar os ativos.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, ownershipFilter]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (form.ownership === 'LOCADO' && !form.contractId) {
        throw new Error('Selecione o contrato de origem para um ativo locado.');
      }
      await apiFetch('/assets', {
        method: 'POST',
        body: JSON.stringify({
          assetTag: form.assetTag,
          serialNumber: form.serialNumber,
          type: form.type,
          ownership: form.ownership,
          brand: form.brand,
          model: form.model,
          contractId: form.ownership === 'LOCADO' ? form.contractId : undefined,
        }),
      });
      setForm(emptyForm);
      setOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof ApiError || err instanceof Error ? err.message : 'Não foi possível salvar o ativo.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAllocate(e: React.FormEvent) {
    e.preventDefault();
    if (!allocatingAsset) return;
    setAllocateError(null);
    try {
      await apiFetch(`/assets/${allocatingAsset.id}/allocate`, {
        method: 'POST',
        body: JSON.stringify({
          assignedToName: allocateForm.assignedToName,
          siteId: allocateForm.siteId || undefined,
          deliveryDate: allocateForm.deliveryDate,
        }),
      });
      setAllocatingAsset(null);
      setAllocateForm(emptyAllocateForm);
      await loadData();
    } catch (err) {
      setAllocateError(err instanceof ApiError ? err.message : 'Não foi possível registrar a entrega.');
    }
  }

  async function handleReturn(asset: Asset) {
    if (!window.confirm(`Confirmar devolução do ativo ${asset.assetTag}?`)) return;
    try {
      await apiFetch(`/assets/${asset.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ returnDate: today() }),
      });
      await loadData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Não foi possível registrar a devolução.');
    }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferringAsset) return;
    setTransferError(null);
    try {
      await apiFetch(`/assets/${transferringAsset.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({
          assignedToName: transferForm.assignedToName,
          siteId: transferForm.siteId || undefined,
          transferDate: transferForm.transferDate,
          notes: transferForm.notes || undefined,
        }),
      });
      setTransferringAsset(null);
      setTransferForm(emptyTransferForm);
      await loadData();
    } catch (err) {
      setTransferError(err instanceof ApiError ? err.message : 'Não foi possível transferir o ativo.');
    }
  }

  async function handleMaintenanceSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!maintenanceAsset) return;
    setMaintenanceError(null);
    try {
      const path =
        maintenanceAsset.mode === 'start'
          ? `/assets/${maintenanceAsset.asset.id}/maintenance/start`
          : `/assets/${maintenanceAsset.asset.id}/maintenance/end`;
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ date: maintenanceForm.date, notes: maintenanceForm.notes || undefined }),
      });
      setMaintenanceAsset(null);
      setMaintenanceForm(emptyMaintenanceForm);
      await loadData();
    } catch (err) {
      setMaintenanceError(
        err instanceof ApiError
          ? err.message
          : `Não foi possível ${maintenanceAsset.mode === 'start' ? 'enviar para' : 'retornar da'} manutenção.`,
      );
    }
  }

  async function openHistory(asset: Asset) {
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryAsset(null);
    try {
      const detail = await apiFetch<AssetDetail>(`/assets/${asset.id}`);
      setHistoryAsset(detail);
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : 'Não foi possível carregar o histórico.');
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Ativos' }]} />

      <main className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ativos</h1>
            <p className="text-sm text-muted-foreground">
              Notebooks e impressoras, próprios e locados — consulta, transferência entre obras/filiais, devolução
              e manutenção, tudo com histórico completo.
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-1.5 h-4 w-4" /> Novo ativo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo ativo</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="assetTag">Tag de patrimônio</Label>
                    <Input
                      id="assetTag"
                      required
                      placeholder="NB-00301"
                      value={form.assetTag}
                      onChange={(e) => setForm({ ...form, assetTag: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="serialNumber">Número de série</Label>
                    <Input
                      id="serialNumber"
                      required
                      value={form.serialNumber}
                      onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="type">Tipo</Label>
                    <Select
                      id="type"
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value as AssetType })}
                    >
                      <option value="NOTEBOOK">Notebook</option>
                      <option value="IMPRESSORA">Impressora</option>
                      <option value="MONITOR">Monitor</option>
                      <option value="PERIFERICO">Periférico</option>
                      <option value="OUTRO">Outro</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ownership">Propriedade</Label>
                    <Select
                      id="ownership"
                      value={form.ownership}
                      onChange={(e) => setForm({ ...form, ownership: e.target.value as AssetOwnership })}
                    >
                      <option value="PROPRIO">Próprio</option>
                      <option value="LOCADO">Locado</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brand">Marca</Label>
                    <Input
                      id="brand"
                      required
                      value={form.brand}
                      onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="model">Modelo</Label>
                    <Input
                      id="model"
                      required
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                    />
                  </div>
                  {form.ownership === 'LOCADO' && (
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="contractId">Contrato de origem</Label>
                      <Select
                        id="contractId"
                        required
                        value={form.contractId}
                        onChange={(e) => setForm({ ...form, contractId: e.target.value })}
                      >
                        <option value="">Selecione...</option>
                        {contracts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.contractNumber}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Salvando...' : 'Salvar'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

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
        </div>

        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadError && (
              <div className="p-5">
                <Alert variant="destructive">{loadError}</Alert>
              </div>
            )}

            {!loadError && loading && <p className="p-5 text-sm text-muted-foreground">Carregando ativos...</p>}

            {!loadError && !loading && assets.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <Laptop className="h-8 w-8" />
                Nenhum ativo encontrado com esses filtros.
              </div>
            )}

            {!loadError && !loading && assets.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patrimônio</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Tipo (ref.)</TableHead>
                    <TableHead>Propriedade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Alocado para</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset) => {
                    const activeAllocation = asset.allocations[0] ?? null;
                    return (
                      <TableRow key={asset.id}>
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
                        <TableCell className="text-muted-foreground">
                          {activeAllocation ? locationLabel(activeAllocation) : '—'}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openHistory(asset)}>
                                <History className="mr-2 h-3.5 w-3.5" /> Ver histórico
                              </DropdownMenuItem>

                              {asset.status !== 'EM_USO' && asset.status !== 'MANUTENCAO' && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setAllocatingAsset(asset);
                                    setAllocateForm(emptyAllocateForm);
                                    setAllocateError(null);
                                  }}
                                >
                                  <PackageCheck className="mr-2 h-3.5 w-3.5" /> Alocar
                                </DropdownMenuItem>
                              )}

                              {asset.status === 'EM_USO' && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setTransferringAsset(asset);
                                      setTransferForm(emptyTransferForm);
                                      setTransferError(null);
                                    }}
                                  >
                                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" /> Transferir
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleReturn(asset)}>
                                    <PackageMinus className="mr-2 h-3.5 w-3.5" /> Devolver
                                  </DropdownMenuItem>
                                </>
                              )}

                              {asset.status !== 'MANUTENCAO' && asset.status !== 'DESCARTADO' && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setMaintenanceAsset({ asset, mode: 'start' });
                                    setMaintenanceForm(emptyMaintenanceForm);
                                    setMaintenanceError(null);
                                  }}
                                >
                                  <Wrench className="mr-2 h-3.5 w-3.5" /> Enviar para manutenção
                                </DropdownMenuItem>
                              )}

                              {asset.status === 'MANUTENCAO' && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setMaintenanceAsset({ asset, mode: 'end' });
                                    setMaintenanceForm(emptyMaintenanceForm);
                                    setMaintenanceError(null);
                                  }}
                                >
                                  <Undo2 className="mr-2 h-3.5 w-3.5" /> Retornar da manutenção
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* Alocar */}
      <Dialog open={!!allocatingAsset} onOpenChange={(v) => !v && setAllocatingAsset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alocar {allocatingAsset?.assetTag}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAllocate} className="space-y-4">
            {allocateError && <Alert variant="destructive">{allocateError}</Alert>}
            <div className="space-y-1.5">
              <Label htmlFor="assignedToName">Entregar para</Label>
              <Input
                id="assignedToName"
                required
                placeholder="Nome do colaborador ou cliente"
                value={allocateForm.assignedToName}
                onChange={(e) => setAllocateForm({ ...allocateForm, assignedToName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="allocateSiteId">Obra/filial (opcional)</Label>
              <Select
                id="allocateSiteId"
                value={allocateForm.siteId}
                onChange={(e) => setAllocateForm({ ...allocateForm, siteId: e.target.value })}
              >
                <option value="">Sem obra/filial (uso interno)</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.client.name} · {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deliveryDate">Data de entrega</Label>
              <Input
                id="deliveryDate"
                type="date"
                required
                value={allocateForm.deliveryDate}
                onChange={(e) => setAllocateForm({ ...allocateForm, deliveryDate: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="submit">Confirmar entrega</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transferir */}
      <Dialog open={!!transferringAsset} onOpenChange={(v) => !v && setTransferringAsset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir {transferringAsset?.assetTag}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTransfer} className="space-y-4">
            {transferError && <Alert variant="destructive">{transferError}</Alert>}
            <p className="text-sm text-muted-foreground">
              Encerra a alocação atual e abre uma nova no destino informado — use para mover o ativo entre
              obras/filiais (centros de custo) ou entre pessoas/departamentos.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="transferAssignedTo">Novo responsável</Label>
              <Input
                id="transferAssignedTo"
                required
                placeholder="Nome do colaborador ou cliente"
                value={transferForm.assignedToName}
                onChange={(e) => setTransferForm({ ...transferForm, assignedToName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transferSiteId">Nova obra/filial (opcional)</Label>
              <Select
                id="transferSiteId"
                value={transferForm.siteId}
                onChange={(e) => setTransferForm({ ...transferForm, siteId: e.target.value })}
              >
                <option value="">Sem obra/filial (uso interno)</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.client.name} · {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transferDate">Data da transferência</Label>
              <Input
                id="transferDate"
                type="date"
                required
                value={transferForm.transferDate}
                onChange={(e) => setTransferForm({ ...transferForm, transferDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transferNotes">Observações (opcional)</Label>
              <Textarea
                id="transferNotes"
                rows={2}
                value={transferForm.notes}
                onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="submit">Confirmar transferência</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manutenção (enviar / retornar) */}
      <Dialog open={!!maintenanceAsset} onOpenChange={(v) => !v && setMaintenanceAsset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {maintenanceAsset?.mode === 'start' ? 'Enviar para manutenção' : 'Retornar da manutenção'}
              {maintenanceAsset ? ` — ${maintenanceAsset.asset.assetTag}` : ''}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleMaintenanceSubmit} className="space-y-4">
            {maintenanceError && <Alert variant="destructive">{maintenanceError}</Alert>}
            {maintenanceAsset?.mode === 'start' && (
              <p className="text-sm text-muted-foreground">
                Encerra a alocação ativa deste ativo, se houver — ao voltar, ele precisa ser alocado de novo.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="maintenanceDate">Data</Label>
              <Input
                id="maintenanceDate"
                type="date"
                required
                value={maintenanceForm.date}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maintenanceNotes">
                {maintenanceAsset?.mode === 'start' ? 'Motivo/descrição do problema' : 'Observações'} (opcional)
              </Label>
              <Textarea
                id="maintenanceNotes"
                rows={2}
                value={maintenanceForm.notes}
                onChange={(e) => setMaintenanceForm({ ...maintenanceForm, notes: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="submit">Confirmar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Histórico */}
      <Dialog open={historyLoading || !!historyAsset || !!historyError} onOpenChange={(v) => !v && setHistoryAsset(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico {historyAsset ? `— ${historyAsset.assetTag}` : ''}</DialogTitle>
          </DialogHeader>

          {historyLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {historyError && <Alert variant="destructive">{historyError}</Alert>}

          {historyAsset && (
            <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Equipamento</p>
                  <p className="font-medium">
                    {historyAsset.brand} {historyAsset.model}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tipo de referência</p>
                  <p className="font-medium">{historyAsset.priceTier?.label ?? 'Não classificado'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Nº de série</p>
                  <p className="font-medium">{historyAsset.serialNumber}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status atual</p>
                  <Badge variant={STATUS_VARIANT[historyAsset.status]}>{STATUS_LABEL[historyAsset.status]}</Badge>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Alocações</h3>
                {historyAsset.allocations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma alocação registrada ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {historyAsset.allocations.map((a) => (
                      <div key={a.id} className="rounded-lg border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">
                            {a.assignedToName}
                            {a.site && <span className="text-muted-foreground"> · {a.site.name}</span>}
                            {a.department && <span className="text-muted-foreground"> · {a.department.name}</span>}
                          </p>
                          {a.isActive && <Badge>Ativa</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(a.deliveryDate)} → {formatDate(a.returnDate)}
                        </p>
                        {a.notes && <p className="mt-1 text-xs text-muted-foreground">{a.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Movimentações</h3>
                {historyAsset.movements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {historyAsset.movements.map((m) => (
                      <div key={m.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                        <div>
                          <p className="font-medium">{MOVEMENT_LABEL[m.type]}</p>
                          {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                        </div>
                        <p className="shrink-0 text-xs text-muted-foreground">{formatDateTime(m.occurredAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
