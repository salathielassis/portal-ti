'use client';

import * as React from 'react';
import {
  CheckCircle2,
  Plus,
  Wallet,
  ClipboardList,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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
import { apiFetch, ApiError } from '@/lib/api-client';

type InvoiceStatus = 'PENDENTE' | 'CONCILIADA' | 'PAGA' | 'VENCIDA' | 'CONTESTADA';

interface Contract {
  id: string;
  contractNumber: string;
  supplier: { name: string };
}

interface Invoice {
  id: string;
  referenceMonth: string;
  dueDate: string;
  grossValue: string;
  status: InvoiceStatus;
  contract: Contract;
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  PENDENTE: 'Pendente',
  CONCILIADA: 'Conciliada',
  PAGA: 'Paga',
  VENCIDA: 'Vencida',
  CONTESTADA: 'Contestada',
};

const STATUS_VARIANT: Record<InvoiceStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PENDENTE: 'outline',
  CONCILIADA: 'secondary',
  PAGA: 'default',
  VENCIDA: 'destructive',
  CONTESTADA: 'destructive',
};

interface Site {
  id: string;
  name: string;
  client: { id: string; name: string };
}

interface AssetActivityMovement {
  assetId: string;
  assetTag: string;
  serialNumber: string;
  brand: string;
  model: string;
  siteId: string | null;
  siteName: string | null;
  type: 'ENTRADA' | 'SAIDA';
  date: string;
  isNewEquipment: boolean;
}

interface AssetActivityAsset {
  assetId: string;
  assetTag: string;
  serialNumber: string;
  brand: string;
  model: string;
  siteId: string | null;
  siteName: string | null;
  assignedToName: string;
  deliveryDate: string;
  monthlyValue: number | null;
  isNewEquipment: boolean;
}

interface AssetActivityReport {
  referenceMonth: string;
  periodStart: string;
  periodEnd: string;
  site: { id: string; name: string } | null;
  totals: {
    activeAtEnd: number;
    activatedDuringMonth: number;
    returnedDuringMonth: number;
    newEquipment: number;
  };
  movements: AssetActivityMovement[];
  activeAssets: AssetActivityAsset[];
}

const emptyForm = { contractId: '', referenceMonth: '', dueDate: '', grossValue: '' };

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function FinanceiroPage() {
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [contracts, setContracts] = React.useState<Contract[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState('');

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [sites, setSites] = React.useState<Site[]>([]);
  const [reportMonth, setReportMonth] = React.useState(currentMonth());
  const [reportSiteId, setReportSiteId] = React.useState('');
  const [report, setReport] = React.useState<AssetActivityReport | null>(null);
  const [reportLoading, setReportLoading] = React.useState(false);
  const [reportError, setReportError] = React.useState<string | null>(null);

  const loadReport = React.useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const params = new URLSearchParams({ month: reportMonth });
      if (reportSiteId) params.set('siteId', reportSiteId);
      const data = await apiFetch<AssetActivityReport>(`/finance/invoices/reports/asset-activity?${params.toString()}`);
      setReport(data);
    } catch (err) {
      setReportError(err instanceof ApiError ? err.message : 'Não foi possível carregar o relatório de atividade.');
    } finally {
      setReportLoading(false);
    }
  }, [reportMonth, reportSiteId]);

  React.useEffect(() => {
    apiFetch<Site[]>('/clients/sites')
      .then(setSites)
      .catch(() => {
        /* seletor de obra/filial é opcional — se falhar, o relatório ainda funciona sem filtro */
      });
  }, []);

  React.useEffect(() => {
    loadReport();
  }, [loadReport]);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const [invoicesData, contractsData] = await Promise.all([
        apiFetch<Invoice[]>(`/finance/invoices${query}`),
        apiFetch<Contract[]>('/contracts'),
      ]);
      setInvoices(invoicesData);
      setContracts(contractsData);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar as faturas.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiFetch('/finance/invoices', {
        method: 'POST',
        body: JSON.stringify({
          contractId: form.contractId,
          referenceMonth: form.referenceMonth,
          dueDate: form.dueDate,
          grossValue: Number(form.grossValue),
        }),
      });
      setForm(emptyForm);
      setOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível lançar a fatura.');
    } finally {
      setSubmitting(false);
    }
  }

  async function markAsPaid(invoice: Invoice) {
    try {
      await apiFetch(`/finance/invoices/${invoice.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'PAGA' }),
      });
      await loadData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Não foi possível atualizar a fatura.');
    }
  }

  const totalPendente = invoices
    .filter((i) => i.status === 'PENDENTE' || i.status === 'VENCIDA')
    .reduce((sum, i) => sum + Number(i.grossValue), 0);

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Financeiro' }]} />

      <main className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
            <p className="text-sm text-muted-foreground">
              Contas a pagar das faturas de locação. Total em aberto:{' '}
              <span className="font-semibold text-foreground">R$ {totalPendente.toFixed(2)}</span>
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={contracts.length === 0}>
                <Plus className="mr-1.5 h-4 w-4" /> Lançar fatura
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Lançar fatura</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="contractId">Contrato</Label>
                    <Select
                      id="contractId"
                      required
                      value={form.contractId}
                      onChange={(e) => setForm({ ...form, contractId: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {contracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.contractNumber} — {c.supplier.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="referenceMonth">Mês de competência</Label>
                    <Input
                      id="referenceMonth"
                      type="date"
                      required
                      value={form.referenceMonth}
                      onChange={(e) => setForm({ ...form, referenceMonth: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dueDate">Vencimento</Label>
                    <Input
                      id="dueDate"
                      type="date"
                      required
                      value={form.dueDate}
                      onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="grossValue">Valor total (R$)</Label>
                    <Input
                      id="grossValue"
                      type="number"
                      step="0.01"
                      min={0}
                      required
                      value={form.grossValue}
                      onChange={(e) => setForm({ ...form, grossValue: e.target.value })}
                    />
                  </div>
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

        <Card className="shadow-card">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Relatório de atividade mensal de ativos</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Contagem completa de ativos por mês — quantos estavam ativos, quantos foram devolvidos, quantos são
              equipamento novo, e a data exata em que cada um entrou ou saiu da fatura.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reportMonth">Mês</Label>
                <Input
                  id="reportMonth"
                  type="month"
                  className="w-44"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reportSite">Obra/filial</Label>
                <Select id="reportSite" className="w-56" value={reportSiteId} onChange={(e) => setReportSiteId(e.target.value)}>
                  <option value="">Todas as obras/filiais</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.client.name} · {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {reportError && <Alert variant="destructive">{reportError}</Alert>}
            {reportLoading && <p className="text-sm text-muted-foreground">Carregando relatório...</p>}

            {!reportLoading && !reportError && report && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Ativos no fim do mês
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">{report.totals.activeAtEnd}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Entraram na fatura
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">{report.totals.activatedDuringMonth}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Devolvidos</p>
                    <p className="text-2xl font-semibold tabular-nums">{report.totals.returnedDuringMonth}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Equipamento novo
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">{report.totals.newEquipment}</p>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">Entradas e saídas do mês (data exata)</h3>
                  {report.movements.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma entrada ou saída neste mês.</p>
                  ) : (
                    <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Equipamento</TableHead>
                            <TableHead>Obra/filial</TableHead>
                            <TableHead>Data</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.movements.map((m, i) => (
                            <TableRow key={`${m.assetId}-${m.type}-${i}`}>
                              <TableCell>
                                {m.type === 'ENTRADA' ? (
                                  <span className="flex items-center gap-1.5 text-sm text-success">
                                    <ArrowDownToLine className="h-3.5 w-3.5" /> Entrada
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1.5 text-sm text-destructive">
                                    <ArrowUpFromLine className="h-3.5 w-3.5" /> Saída
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {m.brand} {m.model}{' '}
                                <span className="text-xs text-muted-foreground">({m.assetTag})</span>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{m.siteName ?? '—'}</TableCell>
                              <TableCell>{formatDay(m.date)}</TableCell>
                              <TableCell>
                                {m.isNewEquipment && (
                                  <Badge variant="secondary" className="whitespace-nowrap">
                                    <Sparkles className="mr-1 h-3 w-3" /> Novo
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    Ativos em uso no fim do mês ({report.activeAssets.length})
                  </h3>
                  {report.activeAssets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum ativo em uso neste período.</p>
                  ) : (
                    <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Equipamento</TableHead>
                            <TableHead>Responsável</TableHead>
                            <TableHead>Obra/filial</TableHead>
                            <TableHead>Desde</TableHead>
                            <TableHead className="text-right">Valor mensal</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.activeAssets.map((a) => (
                            <TableRow key={a.assetId}>
                              <TableCell>
                                {a.brand} {a.model}{' '}
                                <span className="text-xs text-muted-foreground">({a.assetTag})</span>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{a.assignedToName}</TableCell>
                              <TableCell className="text-muted-foreground">{a.siteName ?? '—'}</TableCell>
                              <TableCell>{formatDay(a.deliveryDate)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {a.monthlyValue !== null ? `R$ ${a.monthlyValue.toFixed(2)}` : '—'}
                              </TableCell>
                              <TableCell>
                                {a.isNewEquipment && (
                                  <Badge variant="secondary" className="whitespace-nowrap">
                                    <Sparkles className="mr-1 h-3 w-3" /> Novo
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Select className="w-56" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadError && (
              <div className="p-5">
                <Alert variant="destructive">{loadError}</Alert>
              </div>
            )}

            {!loadError && loading && <p className="p-5 text-sm text-muted-foreground">Carregando faturas...</p>}

            {!loadError && !loading && invoices.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <Wallet className="h-8 w-8" />
                Nenhuma fatura encontrada.
              </div>
            )}

            {!loadError && !loading && invoices.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Competência</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.contract.contractNumber}</TableCell>
                      <TableCell>{invoice.contract.supplier.name}</TableCell>
                      <TableCell className="capitalize">{formatMonth(invoice.referenceMonth)}</TableCell>
                      <TableCell>{new Date(invoice.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        R$ {Number(invoice.grossValue).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[invoice.status]}>{STATUS_LABEL[invoice.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {invoice.status !== 'PAGA' && (
                          <Button variant="ghost" size="sm" onClick={() => markAsPaid(invoice)}>
                            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Marcar como paga
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
