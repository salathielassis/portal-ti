'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { apiFetch, ApiError } from '@/lib/api-client';

interface ParsedSerial {
  raw: string;
  serviceTag: string;
  assetTag: string;
  valid: boolean;
  flagReason: string | null;
}

interface ParsedItem {
  referencia: string | null;
  codigo: string | null;
  description: string;
  quantity: number | null;
  serials: ParsedSerial[];
}

interface ParsedHeader {
  requisitionNumber: string | null;
  supplierName: string;
  supplierCnpj: string;
  clientName: string | null;
  clientCnpj: string | null;
  siteName: string | null;
  deliveryAddress: string | null;
  declaredPieceCount: number | null;
}

interface PreviewResponse {
  fileKey: string;
  header: ParsedHeader;
  items: ParsedItem[];
  warnings: string[];
  diff: {
    client: { action: string; cnpjRoot: string; name: string };
    site: { action: string; cnpj: string; name: string };
    obra: { action: string; costCenterLabel: string; name: string };
    assets: { toCreate: number; toUpdate: number; total: number };
  };
}

interface ExecuteResponse {
  siteCreated: boolean;
  obraCreated: boolean;
  assetsCreated: number;
  assetsUpdated: number;
  allocationsCreated: number;
  allocationsClosed: number;
  warnings: string[];
}

export default function ImportarGuiaEntregaPage() {
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null);

  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<ExecuteResponse | null>(null);

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Selecione o arquivo PDF da guia de entrega.');
      return;
    }
    setError(null);
    setResult(null);
    setPreview(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<PreviewResponse>('/delivery-import/preview', { method: 'POST', body: formData });
      setPreview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível ler este PDF.');
    } finally {
      setLoading(false);
    }
  }

  function updateSiteName(value: string) {
    setPreview((prev) => (prev ? { ...prev, header: { ...prev.header, siteName: value } } : prev));
  }

  function updateItemDescription(itemIndex: number, value: string) {
    setPreview((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it, i) => (i === itemIndex ? { ...it, description: value } : it));
      return { ...prev, items };
    });
  }

  function updateSerial(itemIndex: number, serialIndex: number, field: 'serviceTag' | 'assetTag', value: string) {
    setPreview((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it, i) => {
        if (i !== itemIndex) return it;
        const serials = it.serials.map((s, j) => (j === serialIndex ? { ...s, [field]: value.toUpperCase() } : s));
        return { ...it, serials };
      });
      return { ...prev, items };
    });
  }

  async function handleConfirm() {
    if (!preview) return;
    if (!preview.header.siteName?.trim()) {
      setError('Informe o "Nome do Site" (obra de destino) antes de confirmar.');
      return;
    }
    if (!preview.header.clientCnpj) {
      setError('Não foi possível identificar o CNPJ do cliente — confira o PDF.');
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const dto = {
        fileKey: preview.fileKey,
        header: {
          clientCnpj: preview.header.clientCnpj,
          clientName: preview.header.clientName ?? '',
          siteName: preview.header.siteName,
          requisitionNumber: preview.header.requisitionNumber ?? undefined,
        },
        items: preview.items.map((item) => ({
          description: item.description,
          referencia: item.referencia ?? undefined,
          codigo: item.codigo ?? undefined,
          serials: item.serials.map((s) => ({ serviceTag: s.serviceTag, assetTag: s.assetTag })),
        })),
      };
      const data = await apiFetch<ExecuteResponse>('/delivery-import/execute', {
        method: 'POST',
        body: JSON.stringify(dto),
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
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Importar Guia de Entrega' }]} />

      <main className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Importar Guia de Entrega de Notebooks</h1>
          <p className="text-sm text-muted-foreground">
            Envie o PDF da &quot;Requisição/Guia de Movimentação&quot; da locadora (documento assinado no ato da
            entrega) — o sistema lê por OCR o nome dos equipamentos, número de série e tombo, e pré-preenche os
            campos abaixo. Como é uma nota escaneada, a leitura pode conter erros: confira e corrija os campos
            destacados antes de confirmar.
          </p>
        </div>

        {!result && (
          <Card className="shadow-card">
            <CardContent className="space-y-4 p-5">
              <form onSubmit={handlePreview} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[280px] flex-1 space-y-1.5">
                  <Label htmlFor="file">Arquivo PDF da guia de entrega</Label>
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
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Lendo PDF (OCR)... pode levar até 1 minuto
                    </>
                  ) : (
                    <>
                      <FileUp className="mr-1.5 h-4 w-4" /> Analisar guia
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
                    detail={`${preview.diff.site.name || '—'} — CNPJ ${preview.diff.site.cnpj}`}
                  />
                  <DiffRow
                    label="Obra / Centro de custo"
                    action={preview.diff.obra.action}
                    detail={`${preview.diff.obra.name || '—'}`}
                  />
                  <DiffRow
                    label="Ativos"
                    action={`${preview.diff.assets.toCreate} novo(s)`}
                    detail={`${preview.diff.assets.toUpdate} já cadastrado(s) serão atualizados · ${preview.diff.assets.total} no total`}
                  />
                </div>

                <div className="space-y-1.5 border-t border-border pt-4">
                  <Label htmlFor="siteName">
                    Nome do Site (obra de destino) — confira, é o campo mais importante
                  </Label>
                  <Input
                    id="siteName"
                    value={preview.header.siteName ?? ''}
                    onChange={(e) => updateSiteName(e.target.value)}
                    placeholder="Ex.: IBIAPABA - SEDE"
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

            <div className="space-y-4">
              {preview.items.map((item, itemIndex) => (
                <Card key={itemIndex} className="shadow-card">
                  <CardContent className="space-y-3 p-5">
                    <div className="space-y-1.5">
                      <Label htmlFor={`desc-${itemIndex}`}>Equipamento</Label>
                      <Input
                        id={`desc-${itemIndex}`}
                        value={item.description}
                        onChange={(e) => updateItemDescription(itemIndex, e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      {item.serials.map((serial, serialIndex) => (
                        <div
                          key={serialIndex}
                          className={cn(
                            'grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]',
                            serial.valid ? 'border-border' : 'border-warning/60 bg-warning/5',
                          )}
                        >
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Número de série</Label>
                            <Input
                              value={serial.serviceTag}
                              onChange={(e) => updateSerial(itemIndex, serialIndex, 'serviceTag', e.target.value)}
                              className="font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Tombo (P.A.T.)</Label>
                            <Input
                              value={serial.assetTag}
                              onChange={(e) => updateSerial(itemIndex, serialIndex, 'assetTag', e.target.value)}
                              className="font-mono"
                            />
                          </div>
                          <div className="flex items-center gap-1.5 self-end pb-1.5">
                            {!serial.valid && (
                              <span className="flex items-center gap-1 text-xs text-warning">
                                <AlertTriangle className="h-3.5 w-3.5" /> Confira: lido como &quot;{serial.raw}&quot;
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
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
                <ResultStat label="Alocações encerradas (mudou de obra)" value={result.allocationsClosed} />
              </div>

              <div className="flex flex-wrap gap-2">
                {result.siteCreated && <Badge variant="secondary">Estabelecimento criado</Badge>}
                {result.obraCreated && <Badge variant="secondary">Obra criada</Badge>}
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
                <Button onClick={reset}>Importar outra guia</Button>
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
