'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  Sparkles,
  DollarSign,
  ArrowLeftRight,
  PackageMinus,
  PackagePlus,
  TrendingUp,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { apiFetch, ApiError } from '@/lib/api-client';

interface ParsedHeader {
  supplierName: string;
  supplierCnpj: string;
  clientName: string;
  clientCnpj: string;
  contractNumber: string;
  classification: string;
  periodStart: string;
  periodEnd: string;
  totalEquipmentCount: number | null;
  totalValue: number | null;
}

interface ParsedItem {
  serialNumber: string;
  pat: string;
  equipmentDescription: string;
  totalValue: number;
  allocatedTo: string | null;
  installationDate: string | null;
}

interface PriceMismatchAlert {
  serialNumber: string;
  description: string;
  tierLabel: string;
  referenceValue: number;
  chargedValue: number;
}

interface LeaseImportComparison {
  removed: { serialNumber: string; description: string; assignedToName: string }[];
  valueChanged: { serialNumber: string; description: string; previousValue: number; newValue: number }[];
  newAtSite: { serialNumber: string; description: string; totalValue: number }[];
}

interface PreviewResponse {
  header: ParsedHeader;
  items: ParsedItem[];
  warnings: string[];
  diff: {
    client: { action: string; cnpjRoot: string; name: string };
    site: { action: string; cnpj: string; name: string };
    obra: { action: string; costCenterLabel: string; name: string };
    supplier: { action: string; cnpj: string; name: string };
    contract: { action: string; contractNumber: string };
    invoice: { action: string; referenceMonth: string; grossValue: number | null };
    assets: { toCreate: number; toUpdate: number; total: number };
  };
  comparison: LeaseImportComparison | null;
  priceAlerts: PriceMismatchAlert[];
}

interface ExecuteResponse {
  clientCreated: boolean;
  siteCreated: boolean;
  obraCreated: boolean;
  supplierCreated: boolean;
  contractCreated: boolean;
  invoiceCreated: boolean;
  assetsCreated: number;
  assetsUpdated: number;
  allocationsCreated: number;
  allocationsUpdated: number;
  allocationsClosed: number;
  warnings: string[];
}

function formatBRL(value: number | null) {
  if (value === null) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function ImportarExtratoPage() {
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null);

  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<ExecuteResponse | null>(null);

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Selecione o arquivo PDF do extrato de locação.');
      return;
    }
    setError(null);
    setResult(null);
    setPreview(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<PreviewResponse>('/lease-import/preview', { method: 'POST', body: formData });
      setPreview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível ler este PDF.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setConfirming(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<ExecuteResponse>('/lease-import/execute', { method: 'POST', body: formData });
      setResult(data);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir a importação.');
    } finally {
      setConfirming(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Importar Extrato' }]} />

      <main className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Importar Extrato de Locação</h1>
          <p className="text-sm text-muted-foreground">
            Envie o PDF do &quot;Extrato de Locação&quot; da locadora — o sistema lê o CNPJ da obra/filial, o
            contrato, e cada equipamento (nº de série, tombo/P.A.T., modelo, valor e data de instalação), e
            cadastra ou atualiza automaticamente Cliente, Obra, Fornecedor, Contrato, Fatura e Ativos.
          </p>
        </div>

        {!result && (
          <Card className="shadow-card">
            <CardContent className="space-y-4 p-5">
              <form onSubmit={handlePreview} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[280px] flex-1 space-y-1.5">
                  <Label htmlFor="file">Arquivo PDF do extrato</Label>
                  <Input
                    id="file"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setPreview(null);
                    }}
                  />
                </div>
                <Button type="submit" disabled={loading || !file}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Lendo PDF...
                    </>
                  ) : (
                    <>
                      <FileUp className="mr-1.5 h-4 w-4" /> Analisar extrato
                    </>
                  )}
                </Button>
              </form>
              {error && <Alert variant="destructive">{error}</Alert>}
            </CardContent>
          </Card>
        )}

        {preview && (
          <>
            {preview.warnings.length > 0 && (
              <Alert variant="destructive" className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-sm">
                      {w}
                    </p>
                  ))}
                </div>
              </Alert>
            )}

            <Card className="shadow-card">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">O que será feito ao confirmar</h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DiffRow
                    label="Cliente"
                    action={preview.diff.client.action}
                    detail={`${preview.diff.client.name} (raiz CNPJ ${preview.diff.client.cnpjRoot})`}
                  />
                  <DiffRow
                    label="Estabelecimento (CNPJ)"
                    action={preview.diff.site.action}
                    detail={`${preview.diff.site.name} — CNPJ ${preview.diff.site.cnpj}`}
                  />
                  <DiffRow
                    label="Obra / Centro de custo"
                    action={preview.diff.obra.action}
                    detail={`${preview.diff.obra.name} — classificação "${preview.diff.obra.costCenterLabel}"`}
                  />
                  <DiffRow
                    label="Fornecedor"
                    action={preview.diff.supplier.action}
                    detail={`${preview.diff.supplier.name} — CNPJ ${preview.diff.supplier.cnpj}`}
                  />
                  <DiffRow
                    label="Contrato"
                    action={preview.diff.contract.action}
                    detail={preview.diff.contract.contractNumber}
                  />
                  <DiffRow
                    label="Fatura"
                    action={preview.diff.invoice.action}
                    detail={`Competência ${formatDate(preview.diff.invoice.referenceMonth)} — ${formatBRL(preview.diff.invoice.grossValue)}`}
                  />
                  <DiffRow
                    label="Ativos"
                    action={`${preview.diff.assets.toCreate} novo(s)`}
                    detail={`${preview.diff.assets.toUpdate} já cadastrado(s) serão atualizados · ${preview.diff.assets.total} no total`}
                  />
                </div>

                <div className="flex justify-end gap-2 border-t border-border pt-4">
                  <Button variant="outline" onClick={reset}>
                    Cancelar
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirming}>
                    {confirming ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Importando...
                      </>
                    ) : (
                      'Confirmar importação'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {preview.priceAlerts.length > 0 && (
              <Card className="shadow-card border-warning/40">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-warning" />
                    <h2 className="text-sm font-semibold">
                      Valor cobrado destoa da tabela de referência ({preview.priceAlerts.length})
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {preview.priceAlerts.map((alert, i) => (
                      <div
                        key={`${alert.serialNumber}-${i}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                      >
                        <div>
                          <p className="font-medium">{alert.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Nº série {alert.serialNumber} · classificado como &quot;{alert.tierLabel}&quot;
                          </p>
                        </div>
                        <p className="text-xs">
                          Referência {formatBRL(alert.referenceValue)} · cobrado{' '}
                          <span className="font-semibold text-warning">{formatBRL(alert.chargedValue)}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {preview.comparison && (
              <Card className="shadow-card">
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">Comparação com a última importação nesta obra/filial</h2>
                  </div>

                  {preview.comparison.removed.length === 0 &&
                    preview.comparison.valueChanged.length === 0 &&
                    preview.comparison.newAtSite.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma diferença em relação ao mês anterior — mesmos equipamentos, mesmos valores.
                      </p>
                    )}

                  {preview.comparison.removed.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                        <PackageMinus className="h-3.5 w-3.5" /> Sumiram do extrato ({preview.comparison.removed.length})
                      </div>
                      <div className="space-y-1.5">
                        {preview.comparison.removed.map((r, i) => (
                          <div key={`${r.serialNumber}-${i}`} className="rounded-lg border border-border p-2.5 text-sm">
                            <span className="font-medium">{r.description}</span>{' '}
                            <span className="text-muted-foreground">
                              (nº série {r.serialNumber} · estava com {r.assignedToName})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.comparison.valueChanged.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                        <ArrowLeftRight className="h-3.5 w-3.5" /> Valor mudou ({preview.comparison.valueChanged.length})
                      </div>
                      <div className="space-y-1.5">
                        {preview.comparison.valueChanged.map((v, i) => (
                          <div key={`${v.serialNumber}-${i}`} className="rounded-lg border border-border p-2.5 text-sm">
                            <span className="font-medium">{v.description}</span>{' '}
                            <span className="text-muted-foreground">(nº série {v.serialNumber})</span>{' '}
                            {formatBRL(v.previousValue)} → <span className="font-semibold">{formatBRL(v.newValue)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.comparison.newAtSite.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                        <PackagePlus className="h-3.5 w-3.5" /> Novos nesta obra/filial ({preview.comparison.newAtSite.length})
                      </div>
                      <div className="space-y-1.5">
                        {preview.comparison.newAtSite.map((n, i) => (
                          <div key={`${n.serialNumber}-${i}`} className="rounded-lg border border-border p-2.5 text-sm">
                            <span className="font-medium">{n.description}</span>{' '}
                            <span className="text-muted-foreground">(nº série {n.serialNumber})</span> —{' '}
                            {formatBRL(n.totalValue)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="shadow-card">
              <CardContent className="p-0">
                <div className="flex items-center justify-between border-b border-border p-4">
                  <p className="text-sm font-medium">
                    {preview.header.classification || preview.header.clientName} · {preview.items.length}{' '}
                    equipamento(s) lido(s)
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Fornecedor: {preview.header.supplierName}
                  </p>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nº de série</TableHead>
                        <TableHead>P.A.T.</TableHead>
                        <TableHead>Equipamento</TableHead>
                        <TableHead>Local</TableHead>
                        <TableHead>Instalação</TableHead>
                        <TableHead className="text-right">Valor mensal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.items.map((item, i) => (
                        <TableRow key={`${item.serialNumber}-${i}`}>
                          <TableCell className="font-mono text-xs">{item.serialNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{item.pat || '—'}</TableCell>
                          <TableCell className="max-w-[280px] truncate text-sm">
                            {item.equipmentDescription}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.allocatedTo ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm">{formatDate(item.installationDate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBRL(item.totalValue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {result && (
          <Card className="shadow-card">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-5 w-5" />
                <h2 className="text-base font-semibold">Importação concluída</h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ResultStat label="Ativos criados" value={result.assetsCreated} />
                <ResultStat label="Ativos atualizados" value={result.assetsUpdated} />
                <ResultStat label="Alocações criadas" value={result.allocationsCreated} />
                <ResultStat label="Alocações atualizadas" value={result.allocationsUpdated} />
                <ResultStat label="Alocações encerradas (mudou de obra)" value={result.allocationsClosed} />
              </div>

              <div className="flex flex-wrap gap-2">
                {result.clientCreated && <Badge variant="secondary">Cliente criado</Badge>}
                {result.siteCreated && <Badge variant="secondary">Estabelecimento criado</Badge>}
                {result.obraCreated && <Badge variant="secondary">Obra criada</Badge>}
                {result.supplierCreated && <Badge variant="secondary">Fornecedor criado</Badge>}
                {result.contractCreated && <Badge variant="secondary">Contrato criado</Badge>}
                {result.invoiceCreated && <Badge variant="secondary">Fatura criada</Badge>}
              </div>

              {result.warnings.length > 0 && (
                <Alert variant="destructive" className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    {result.warnings.map((w, i) => (
                      <p key={i} className="text-sm">
                        {w}
                      </p>
                    ))}
                  </div>
                </Alert>
              )}

              <div className="flex justify-end border-t border-border pt-4">
                <Button onClick={reset}>Importar outro extrato</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

function DiffRow({ label, action, detail }: { label: string; action: string; detail: string }) {
  const isCreate = action === 'CRIAR' || action.includes('novo');
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Badge variant={isCreate ? 'default' : 'secondary'}>{action}</Badge>
      </div>
      <p className="text-sm">{detail}</p>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
