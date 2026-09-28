'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  HardHat,
  Loader2,
  Sparkles,
  DollarSign,
  PackageMinus,
  Scale,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

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

interface PriceMismatchAlert {
  serialNumber: string;
  description: string;
  tierLabel: string;
  referenceValue: number;
  chargedValue: number;
}

type AssetStatus = 'EM_USO' | 'ESTOQUE' | 'MANUTENCAO' | 'DESCARTADO' | 'EM_TRANSITO' | 'DEVOLVIDO';

type ReconciliationFlag =
  | 'NOVO'
  | 'SEM_MUDANCA'
  | 'VALOR_ALTERADO'
  | 'VALOR_PREENCHIDO'
  | 'OUTRA_OBRA'
  | 'EM_ESTOQUE'
  | 'EM_MANUTENCAO'
  | 'DEVOLVIDO_MAS_COBRADO'
  | 'DESCARTADO_MAS_COBRADO'
  | 'TOMBO_DIVERGENTE'
  | 'SERIE_DIVERGENTE'
  | 'RESPONSAVEL_DIFERENTE'
  | 'DADOS_A_ORGANIZAR';

interface ReconciliationRow {
  serialNumber: string;
  pat: string;
  description: string;
  allocatedTo: string | null;
  installationDate: string | null;
  extratoValue: number;
  parsed: { brand: string; model: string; cpu: string | null; ram: string | null; storage: string | null; gpu: string | null };
  system: {
    assetId: string;
    assetTag: string;
    serialNumber: string;
    brand: string;
    model: string;
    status: AssetStatus;
    monthlyValue: number | null;
    obraId: string | null;
    obraName: string | null;
    siteName: string | null;
    assignedToName: string | null;
  } | null;
  flags: ReconciliationFlag[];
}

interface ReconciliationMissingRow {
  assetId: string;
  assetTag: string;
  serialNumber: string;
  brand: string;
  model: string;
  status: AssetStatus;
  monthlyValue: number | null;
  obraName: string | null;
  assignedToName: string | null;
  reason: 'NA_OBRA' | 'NO_CONTRATO';
}

interface ObraOption {
  id: string;
  name: string;
  costCenterLabel: string;
  aliases: string[];
  siteId: string;
  siteName: string;
  siteCnpj: string;
  active: boolean;
  assetsFromStatement: number;
}

interface PreviewResponse {
  header: ParsedHeader;
  warnings: string[];
  diff: {
    client: { action: string; cnpjRoot: string; name: string };
    site: { action: string; cnpj: string; name: string };
    obra: {
      action: string;
      costCenterLabel: string;
      name: string;
      obraId: string | null;
      matchedBy: 'ESCOLHIDA' | 'CLASSIFICACAO' | 'EQUIPAMENTOS' | 'NOVA';
    };
    supplier: { action: string; cnpj: string; name: string };
    contract: { action: string; contractNumber: string };
    invoice: { action: string; referenceMonth: string; grossValue: number | null };
    assets: { toCreate: number; toUpdate: number; total: number };
  };
  obraOptions: ObraOption[];
  reconciliation: {
    rows: ReconciliationRow[];
    missing: ReconciliationMissingRow[];
    summary: Record<ReconciliationFlag, number> & { total: number; missing: number };
  };
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
  assetsReorganized: number;
  allocationsCreated: number;
  allocationsUpdated: number;
  allocationsClosed: number;
  keptInOtherObra: number;
  statusPreserved: number;
  warnings: string[];
}

type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-success/30 bg-success/10 text-success',
  info: 'border-primary/30 bg-primary/10 text-primary',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  bad: 'border-destructive/40 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted/40 text-muted-foreground',
};

const FLAG_META: Record<ReconciliationFlag, { label: string; tone: Tone; hint: string }> = {
  NOVO: { label: 'Novo', tone: 'info', hint: 'Não existe no sistema — será cadastrado.' },
  SEM_MUDANCA: { label: 'Sem mudança', tone: 'ok', hint: 'Já está nesta obra, com o mesmo valor.' },
  VALOR_ALTERADO: { label: 'Valor alterado', tone: 'warn', hint: 'O valor mensal cobrado mudou.' },
  VALOR_PREENCHIDO: { label: 'Valor a preencher', tone: 'info', hint: 'Ativo sem valor mensal (ex.: veio da guia) — será preenchido.' },
  OUTRA_OBRA: { label: 'Em outra obra', tone: 'warn', hint: 'No sistema ele está em outra obra; a locadora cobra nesta.' },
  EM_ESTOQUE: { label: 'Em estoque', tone: 'warn', hint: 'Parado no estoque, mas segue sendo cobrado.' },
  EM_MANUTENCAO: { label: 'Em manutenção', tone: 'warn', hint: 'Em manutenção, mas segue sendo cobrado.' },
  DEVOLVIDO_MAS_COBRADO: { label: 'Devolvido, mas cobrado', tone: 'bad', hint: 'Marcado como devolvido à locadora, mas ainda aparece no extrato.' },
  DESCARTADO_MAS_COBRADO: { label: 'Descartado, mas cobrado', tone: 'bad', hint: 'Descartado no sistema, mas ainda aparece no extrato.' },
  TOMBO_DIVERGENTE: { label: 'Tombo diferente', tone: 'warn', hint: 'O P.A.T. do extrato é diferente do patrimônio cadastrado.' },
  SERIE_DIVERGENTE: { label: 'Série diferente', tone: 'warn', hint: 'Achado pelo tombo, mas o nº de série cadastrado é outro.' },
  RESPONSAVEL_DIFERENTE: { label: 'Responsável diferente', tone: 'muted', hint: 'O extrato traz outro nome no campo LOCAL (o do sistema é mantido).' },
  DADOS_A_ORGANIZAR: { label: 'Modelo será organizado', tone: 'muted', hint: 'Modelo com a descrição inteira — será separado em marca/modelo/CPU/RAM/SSD/vídeo.' },
};

const FLAG_ORDER: ReconciliationFlag[] = [
  'DEVOLVIDO_MAS_COBRADO',
  'DESCARTADO_MAS_COBRADO',
  'OUTRA_OBRA',
  'EM_ESTOQUE',
  'EM_MANUTENCAO',
  'VALOR_ALTERADO',
  'TOMBO_DIVERGENTE',
  'SERIE_DIVERGENTE',
  'NOVO',
  'VALOR_PREENCHIDO',
  'RESPONSAVEL_DIFERENTE',
  'DADOS_A_ORGANIZAR',
  'SEM_MUDANCA',
];

const STATUS_LABEL: Record<AssetStatus, string> = {
  EM_USO: 'Em uso',
  ESTOQUE: 'Estoque',
  MANUTENCAO: 'Manutenção',
  DESCARTADO: 'Descartado',
  EM_TRANSITO: 'Em trânsito',
  DEVOLVIDO: 'Devolvido',
};

const MATCHED_BY_TEXT: Record<PreviewResponse['diff']['obra']['matchedBy'], string> = {
  ESCOLHIDA: 'Obra escolhida por você.',
  CLASSIFICACAO: 'Encontrada pela classificação do extrato (ignorando acento, espaço e maiúsculas).',
  EQUIPAMENTOS: 'Sugerida porque a maioria dos equipamentos deste extrato já está nela no sistema.',
  NOVA: 'Nenhuma obra cadastrada responde por esta classificação — confira a lista antes de criar uma nova.',
};

type Filter = ReconciliationFlag | 'DIVERGENTES' | 'TODOS' | 'FALTANDO';

const NEW_OBRA = 'NOVA';

/** "03092799000343" -> "03.092.799/0003-43" */
function formatCnpj(cnpj: string) {
  const d = cnpj.replace(/\D/g, '');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj;
}

function formatBRL(value: number | null) {
  if (value === null) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function isDivergent(row: ReconciliationRow) {
  return row.flags.some((f) => FLAG_META[f].tone === 'warn' || FLAG_META[f].tone === 'bad');
}

function FlagBadge({ flag }: { flag: ReconciliationFlag }) {
  const meta = FLAG_META[flag];
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', TONE_CLASS[meta.tone])} title={meta.hint}>
      {meta.label}
    </Badge>
  );
}

function specsLine(p: ReconciliationRow['parsed']) {
  return [p.cpu, p.ram, p.storage, p.gpu].filter(Boolean).join(' · ');
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadReconciliationCsv(preview: PreviewResponse) {
  const lines = [
    [
      'Situação',
      'Nº de série',
      'P.A.T. (extrato)',
      'Patrimônio (sistema)',
      'Marca',
      'Modelo',
      'Processador',
      'RAM',
      'Armazenamento',
      'Placa de vídeo',
      'Status no sistema',
      'Obra no sistema',
      'Responsável no sistema',
      'LOCAL no extrato',
      'Valor no sistema',
      'Valor no extrato',
    ].join(';'),
    ...preview.reconciliation.rows.map((r) =>
      [
        r.flags.map((f) => FLAG_META[f].label).join(' + '),
        r.serialNumber,
        r.pat,
        r.system?.assetTag ?? '',
        r.parsed.brand,
        r.parsed.model,
        r.parsed.cpu ?? '',
        r.parsed.ram ?? '',
        r.parsed.storage ?? '',
        r.parsed.gpu ?? '',
        r.system ? STATUS_LABEL[r.system.status] : '',
        r.system?.obraName ?? '',
        r.system?.assignedToName ?? '',
        r.allocatedTo ?? '',
        r.system?.monthlyValue?.toFixed(2).replace('.', ',') ?? '',
        r.extratoValue.toFixed(2).replace('.', ','),
      ]
        .map(csvCell)
        .join(';'),
    ),
    ...preview.reconciliation.missing.map((m) =>
      [
        m.reason === 'NA_OBRA' ? 'No sistema nesta obra, fora do extrato' : 'No contrato, fora do extrato',
        m.serialNumber,
        '',
        m.assetTag,
        m.brand,
        m.model,
        '',
        '',
        '',
        '',
        STATUS_LABEL[m.status],
        m.obraName ?? '',
        m.assignedToName ?? '',
        '',
        m.monthlyValue?.toFixed(2).replace('.', ',') ?? '',
        '',
      ]
        .map(csvCell)
        .join(';'),
    ),
  ];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conciliacao-${preview.header.contractNumber || 'extrato'}-${preview.diff.invoice.referenceMonth.slice(0, 7)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ImportarExtratoPage() {
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null);

  /** id de uma obra existente, ou NEW_OBRA para criar uma nova. */
  const [obraId, setObraId] = React.useState('');
  const [newObraName, setNewObraName] = React.useState('');
  const [moveFromOtherObras, setMoveFromOtherObras] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>('DIVERGENTES');

  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<ExecuteResponse | null>(null);

  /** `null` = primeira análise: o sistema sugere a obra (classificação / equipamentos). */
  function buildFormData(selectedObraId: string | null) {
    const formData = new FormData();
    if (file) formData.append('file', file);
    if (selectedObraId === NEW_OBRA) {
      formData.append('forceNewObra', 'true');
      if (newObraName.trim()) formData.append('newObraName', newObraName.trim());
    } else if (selectedObraId) {
      formData.append('obraId', selectedObraId);
    }
    formData.append('moveFromOtherObras', String(moveFromOtherObras));
    return formData;
  }

  async function loadPreview(selectedObraId: string | null) {
    if (!file) {
      setError('Selecione o arquivo PDF do extrato de locação.');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await apiFetch<PreviewResponse>('/lease-import/preview', {
        method: 'POST',
        body: buildFormData(selectedObraId),
      });
      setPreview(data);
      // Fixa a obra resolvida pelo sistema, para a confirmação usar exatamente a mesma.
      setObraId(data.diff.obra.obraId ?? NEW_OBRA);
      if (!data.diff.obra.obraId && !newObraName) setNewObraName(data.diff.obra.name);
      const s = data.reconciliation.summary;
      const divergent = data.reconciliation.rows.some(isDivergent);
      setFilter(divergent ? 'DIVERGENTES' : s.missing > 0 ? 'FALTANDO' : 'TODOS');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível ler este PDF.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    setPreview(null);
    setObraId('');
    setNewObraName('');
    setMoveFromOtherObras(false);
    await loadPreview(null);
  }

  async function handleConfirm() {
    if (!file) return;
    setConfirming(true);
    setError(null);
    try {
      const data = await apiFetch<ExecuteResponse>('/lease-import/execute', {
        method: 'POST',
        body: buildFormData(obraId),
      });
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
    setObraId('');
    setNewObraName('');
    setMoveFromOtherObras(false);
  }

  const rows = preview?.reconciliation.rows ?? [];
  const filteredRows = React.useMemo(() => {
    if (filter === 'TODOS') return rows;
    if (filter === 'DIVERGENTES') return rows.filter(isDivergent);
    if (filter === 'FALTANDO') return [];
    return rows.filter((r) => r.flags.includes(filter));
  }, [rows, filter]);
  const divergentCount = rows.filter(isDivergent).length;

  const obraGroups = React.useMemo(() => {
    const groups = new Map<string, ObraOption[]>();
    for (const o of preview?.obraOptions ?? []) {
      const key = `Faturado no CNPJ ${formatCnpj(o.siteCnpj)}`;
      groups.set(key, [...(groups.get(key) ?? []), o]);
    }
    return [...groups.entries()];
  }, [preview]);

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Importar / Conciliar Extrato' }]} />

      <main className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Importar e conciliar extrato de locação</h1>
          <p className="text-sm text-muted-foreground">
            Envie o PDF do &quot;Extrato de Locação&quot; da locadora. Antes de gravar qualquer coisa, o sistema mostra a{' '}
            <strong>conciliação</strong>: cada notebook do extrato comparado com o que está cadastrado (novo, sem
            mudança, valor alterado, em outra obra, em estoque, devolvido mas ainda cobrado…) e o que está no sistema
            mas não veio no extrato. Só ao confirmar o sistema cadastra/atualiza.
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
                  {loading && !preview ? (
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

            {/* Obra de destino */}
            <Card className="shadow-card">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <HardHat className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Em qual obra estes equipamentos ficam?</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Classificação no extrato: <strong>&quot;{preview.diff.obra.costCenterLabel}&quot;</strong> · faturado
                  no CNPJ {formatCnpj(preview.diff.site.cnpj)}
                  {preview.diff.site.action === 'CRIAR' ? ' (CNPJ ainda não cadastrado)' : ''}.{' '}
                  {MATCHED_BY_TEXT[preview.diff.obra.matchedBy]}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="targetObra">Obra de destino</Label>
                    <Select
                      id="targetObra"
                      value={obraId}
                      disabled={loading}
                      onChange={(e) => {
                        setObraId(e.target.value);
                        loadPreview(e.target.value);
                      }}
                    >
                      <option value={NEW_OBRA}>+ Criar obra nova para esta classificação</option>
                      {obraGroups.map(([group, options]) => (
                        <optgroup key={group} label={group}>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                              {o.assetsFromStatement > 0 ? ` — ${o.assetsFromStatement} equip. deste extrato já estão aqui` : ''}
                              {!o.active ? ' (inativa)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    {obraId !== NEW_OBRA && preview.diff.obra.matchedBy !== 'CLASSIFICACAO' && (
                      <p className="text-xs text-muted-foreground">
                        Ao confirmar, a classificação &quot;{preview.diff.obra.costCenterLabel}&quot; passa a ser
                        reconhecida por esta obra — o próximo extrato cai nela automaticamente.
                      </p>
                    )}
                  </div>
                  {obraId === NEW_OBRA && (
                    <div className="space-y-1.5">
                      <Label htmlFor="newObraName">Nome da obra nova</Label>
                      <Input
                        id="newObraName"
                        value={newObraName}
                        onChange={(e) => setNewObraName(e.target.value)}
                        placeholder={preview.diff.obra.costCenterLabel}
                      />
                    </div>
                  )}
                </div>
                {loading && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recalculando a conciliação...
                  </p>
                )}
                {preview.reconciliation.summary.OUTRA_OBRA > 0 && (
                  <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-border"
                      checked={moveFromOtherObras}
                      onChange={(e) => setMoveFromOtherObras(e.target.checked)}
                    />
                    <span>
                      Mover para esta obra os <strong>{preview.reconciliation.summary.OUTRA_OBRA}</strong> equipamento(s)
                      que o sistema tem em outra obra.{' '}
                      <span className="text-muted-foreground">
                        Deixe desmarcado se você já transferiu esses equipamentos e a locadora só ainda não atualizou —
                        eles ficam onde estão e a diferença fica registrada aqui.
                      </span>
                    </span>
                  </label>
                )}
              </CardContent>
            </Card>

            {/* Conciliação */}
            <Card className="shadow-card">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Scale className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">
                      Conciliação — sistema × extrato ({preview.reconciliation.summary.total} equipamento(s) no extrato)
                    </h2>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => downloadReconciliationCsv(preview)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar conciliação (CSV)
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <FilterChip active={filter === 'DIVERGENTES'} tone={divergentCount ? 'warn' : 'ok'} onClick={() => setFilter('DIVERGENTES')}>
                    Divergentes · {divergentCount}
                  </FilterChip>
                  <FilterChip
                    active={filter === 'FALTANDO'}
                    tone={preview.reconciliation.summary.missing ? 'bad' : 'ok'}
                    onClick={() => setFilter('FALTANDO')}
                  >
                    No sistema, fora do extrato · {preview.reconciliation.summary.missing}
                  </FilterChip>
                  {FLAG_ORDER.filter((f) => preview.reconciliation.summary[f] > 0).map((f) => (
                    <FilterChip key={f} active={filter === f} tone={FLAG_META[f].tone} onClick={() => setFilter(f)}>
                      {FLAG_META[f].label} · {preview.reconciliation.summary[f]}
                    </FilterChip>
                  ))}
                  <FilterChip active={filter === 'TODOS'} tone="muted" onClick={() => setFilter('TODOS')}>
                    Todos · {preview.reconciliation.summary.total}
                  </FilterChip>
                </div>

                {filter === 'FALTANDO' ? (
                  <MissingTable rows={preview.reconciliation.missing} />
                ) : filteredRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    {filter === 'DIVERGENTES'
                      ? 'Nenhuma divergência — o extrato bate com o cadastro.'
                      : 'Nenhum equipamento nesta situação.'}
                  </p>
                ) : (
                  <div className="max-h-[520px] overflow-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Série / P.A.T.</TableHead>
                          <TableHead>Equipamento (como será cadastrado)</TableHead>
                          <TableHead>No sistema hoje</TableHead>
                          <TableHead className="text-right">Valor sistema → extrato</TableHead>
                          <TableHead>Situação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.map((r, i) => (
                          <TableRow key={`${r.serialNumber}-${i}`}>
                            <TableCell className="align-top font-mono text-xs">
                              {r.serialNumber}
                              <span className="block text-muted-foreground">{r.pat || '—'}</span>
                            </TableCell>
                            <TableCell className="max-w-[300px] align-top text-sm">
                              <span className="font-medium">
                                {r.parsed.brand !== 'NÃO INFORMADA' ? `${r.parsed.brand} ` : ''}
                                {r.parsed.model}
                              </span>
                              {specsLine(r.parsed) && (
                                <span className="block text-xs text-muted-foreground">{specsLine(r.parsed)}</span>
                              )}
                            </TableCell>
                            <TableCell className="align-top text-sm">
                              {r.system ? (
                                <>
                                  <span className="font-medium">{r.system.assetTag}</span> ·{' '}
                                  {STATUS_LABEL[r.system.status]}
                                  <span className="block text-xs text-muted-foreground">
                                    {r.system.obraName ?? 'sem obra'}
                                    {r.system.assignedToName ? ` · ${r.system.assignedToName}` : ''}
                                  </span>
                                  {r.allocatedTo && (
                                    <span className="block text-xs text-muted-foreground">
                                      LOCAL no extrato: {r.allocatedTo}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">
                                  Não cadastrado{r.allocatedTo ? ` · LOCAL: ${r.allocatedTo}` : ''}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right align-top tabular-nums text-sm">
                              {r.system ? `${formatBRL(r.system.monthlyValue)} → ` : ''}
                              <span className="font-semibold">{formatBRL(r.extratoValue)}</span>
                            </TableCell>
                            <TableCell className="align-top">
                              <div className="flex flex-wrap gap-1">
                                {r.flags.map((f) => (
                                  <FlagBadge key={f} flag={f} />
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
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

            {/* O que será feito */}
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
                    label="CNPJ de faturamento"
                    action={preview.diff.site.action}
                    detail={formatCnpj(preview.diff.site.cnpj)}
                  />
                  <DiffRow
                    label="Obra / Centro de custo"
                    action={obraId !== NEW_OBRA ? 'JÁ EXISTE' : 'CRIAR'}
                    detail={
                      obraId !== NEW_OBRA
                        ? preview.obraOptions.find((o) => o.id === obraId)?.name ?? preview.diff.obra.name
                        : newObraName.trim() || preview.diff.obra.costCenterLabel
                    }
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
                    detail={`${preview.diff.assets.toUpdate} já cadastrado(s) terão valor/contrato atualizados · ${preview.diff.assets.total} no total`}
                  />
                </div>

                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>Responsáveis já preenchidos no sistema não são alterados nem apagados.</li>
                  <li>Equipamentos em estoque, manutenção, devolvidos ou descartados mantêm o status.</li>
                  <li>
                    Equipamentos em outra obra{' '}
                    {moveFromOtherObras ? <strong>serão movidos para a obra de destino</strong> : 'ficam onde estão'}.
                  </li>
                  <li>Nada é excluído — itens &quot;fora do extrato&quot; ficam só listados para você conferir.</li>
                </ul>

                <div className="flex justify-end gap-2 border-t border-border pt-4">
                  <Button variant="outline" onClick={reset}>
                    Cancelar
                  </Button>
                  <Button onClick={handleConfirm} disabled={confirming || loading}>
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
          </>
        )}

        {result && (
          <Card className="shadow-card">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-5 w-5" />
                <h2 className="text-base font-semibold">Importação concluída</h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ResultStat label="Ativos criados" value={result.assetsCreated} />
                <ResultStat label="Ativos atualizados" value={result.assetsUpdated} />
                <ResultStat label="Modelos organizados" value={result.assetsReorganized} />
                <ResultStat label="Alocações criadas" value={result.allocationsCreated} />
                <ResultStat label="Responsáveis preenchidos" value={result.allocationsUpdated} />
                <ResultStat label="Movidos de outra obra" value={result.allocationsClosed} />
                <ResultStat label="Mantidos em outra obra" value={result.keptInOtherObra} />
                <ResultStat label="Status preservado" value={result.statusPreserved} />
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

function FilterChip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: Tone;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        TONE_CLASS[tone],
        active ? 'ring-2 ring-ring ring-offset-1 ring-offset-background' : 'opacity-80 hover:opacity-100',
      )}
    >
      {children}
    </button>
  );
}

function MissingTable({ rows }: { rows: ReconciliationMissingRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Tudo o que está no sistema nesta obra/contrato veio no extrato.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <PackageMinus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Estão no sistema (nesta obra ou neste contrato) mas não vieram no extrato. Pode ser equipamento devolvido à
        locadora sem registrar aqui, ou item que a locadora deixou de cobrar. A importação não mexe neles — se foram
        devolvidos, use &quot;Devolver à locadora&quot; na tela de Ativos.
      </p>
      <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patrimônio / Série</TableHead>
              <TableHead>Equipamento</TableHead>
              <TableHead>No sistema</TableHead>
              <TableHead className="text-right">Valor mensal</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.assetId}>
                <TableCell className="font-mono text-xs">
                  {m.assetTag}
                  <span className="block text-muted-foreground">{m.serialNumber}</span>
                </TableCell>
                <TableCell className="text-sm">
                  {m.brand} {m.model}
                </TableCell>
                <TableCell className="text-sm">
                  {STATUS_LABEL[m.status]}
                  <span className="block text-xs text-muted-foreground">
                    {m.obraName ?? 'sem obra'}
                    {m.assignedToName ? ` · ${m.assignedToName}` : ''}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">{formatBRL(m.monthlyValue)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={TONE_CLASS.bad}>
                    {m.reason === 'NA_OBRA' ? 'Nesta obra, fora do extrato' : 'No contrato, fora do extrato'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
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
