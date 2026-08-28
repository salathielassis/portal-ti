'use client';

import * as React from 'react';
import { CheckCircle2, ScanLine, Upload, XCircle } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { apiFetch, ApiError } from '@/lib/api-client';

type ReconciliationStatus = 'PROCESSANDO' | 'CONCLUIDA' | 'ERRO';
type MatchStatus = 'PENDENTE_REVISAO' | 'CONFIRMADO' | 'REJEITADO';

interface ReconciliationSummary {
  id: string;
  fileName: string;
  referenceMonth: string;
  status: ReconciliationStatus;
  totalTransactions: number;
  matchedCount: number;
  createdAt: string;
}

interface ReconciliationDetail extends ReconciliationSummary {
  transactions: { id: string; description: string; amount: string; matched: boolean }[];
  matches: {
    id: string;
    matchType: 'AUTOMATICO' | 'SUGERIDO' | 'MANUAL';
    matchStatus: MatchStatus;
    confidenceScore: string;
    invoice: { contractId: string; grossValue: string };
    bankTransaction: { description: string; amount: string };
  }[];
}

const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  PROCESSANDO: 'Processando',
  CONCLUIDA: 'Concluída',
  ERRO: 'Erro',
};
const STATUS_VARIANT: Record<ReconciliationStatus, 'default' | 'secondary' | 'destructive'> = {
  PROCESSANDO: 'secondary',
  CONCLUIDA: 'default',
  ERRO: 'destructive',
};

export default function ConciliacaoPage() {
  const [sessions, setSessions] = React.useState<ReconciliationSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [referenceMonth, setReferenceMonth] = React.useState('');
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const [detail, setDetail] = React.useState<ReconciliationDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  const loadSessions = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<{ items: ReconciliationSummary[] }>('/reconciliation');
      setSessions(data.items);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar as conciliações.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setUploadError('Selecione um arquivo PDF.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('referenceMonth', referenceMonth);
      await apiFetch('/reconciliation/upload', { method: 'POST', body: formData });
      setFile(null);
      setReferenceMonth('');
      setUploadOpen(false);
      await loadSessions();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Não foi possível processar o extrato.');
    } finally {
      setUploading(false);
    }
  }

  async function openDetail(session: ReconciliationSummary) {
    setDetailError(null);
    try {
      const data = await apiFetch<ReconciliationDetail>(`/reconciliation/${session.id}`);
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Não foi possível carregar os detalhes.');
    }
  }

  async function decideMatch(matchId: string, decision: 'CONFIRMADO' | 'REJEITADO') {
    try {
      await apiFetch('/reconciliation/matches/confirm', {
        method: 'POST',
        body: JSON.stringify({ matchId, decision }),
      });
      if (detail) await openDetail(detail);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Não foi possível registrar a decisão.');
    }
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Conciliação PDF' }]} />

      <main className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Conciliação Financeira</h1>
            <p className="text-sm text-muted-foreground">
              Envie o extrato bancário do mês em PDF — o sistema tenta casar as saídas com as faturas em aberto.
            </p>
          </div>

          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button>
                <Upload className="mr-1.5 h-4 w-4" /> Enviar extrato
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enviar extrato bancário</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleUpload} className="space-y-4">
                {uploadError && <Alert variant="destructive">{uploadError}</Alert>}
                <div className="space-y-1.5">
                  <Label htmlFor="referenceMonth">Mês de competência</Label>
                  <Input
                    id="referenceMonth"
                    type="date"
                    required
                    value={referenceMonth}
                    onChange={(e) => setReferenceMonth(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="file">Arquivo PDF do extrato</Label>
                  <Input
                    id="file"
                    type="file"
                    accept="application/pdf"
                    required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={uploading}>
                    {uploading ? 'Processando...' : 'Enviar e conciliar'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadError && (
              <div className="p-5">
                <Alert variant="destructive">{loadError}</Alert>
              </div>
            )}

            {!loadError && loading && <p className="p-5 text-sm text-muted-foreground">Carregando...</p>}

            {!loadError && !loading && sessions.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <ScanLine className="h-8 w-8" />
                Nenhum extrato enviado ainda.
              </div>
            )}

            {!loadError && !loading && sessions.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Competência</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Transações</TableHead>
                    <TableHead className="text-right">Conciliadas</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">{session.fileName}</TableCell>
                      <TableCell>
                        {new Date(session.referenceMonth).toLocaleDateString('pt-BR', {
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'UTC',
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[session.status]}>{STATUS_LABEL[session.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{session.totalTransactions}</TableCell>
                      <TableCell className="text-right tabular-nums">{session.matchedCount}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openDetail(session)}>
                          Ver detalhes
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.fileName}</DialogTitle>
          </DialogHeader>
          {detailError && <Alert variant="destructive">{detailError}</Alert>}
          {detail && (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              <div>
                <p className="mb-2 text-sm font-medium">Matches encontrados</p>
                {detail.matches.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum match encontrado nesta sessão.</p>
                )}
                {detail.matches.map((m) => (
                  <div
                    key={m.id}
                    className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{m.bankTransaction.description}</p>
                      <p className="text-xs text-muted-foreground">
                        R$ {Math.abs(Number(m.bankTransaction.amount)).toFixed(2)} · confiança{' '}
                        {Number(m.confidenceScore).toFixed(0)}% · {m.matchType}
                      </p>
                    </div>
                    {m.matchStatus === 'PENDENTE_REVISAO' ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => decideMatch(m.id, 'CONFIRMADO')}>
                          <CheckCircle2 className="mr-1 h-4 w-4 text-success" /> Confirmar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => decideMatch(m.id, 'REJEITADO')}>
                          <XCircle className="mr-1 h-4 w-4 text-destructive" /> Rejeitar
                        </Button>
                      </div>
                    ) : (
                      <Badge variant={m.matchStatus === 'CONFIRMADO' ? 'default' : 'destructive'}>
                        {m.matchStatus === 'CONFIRMADO' ? 'Confirmado' : 'Rejeitado'}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Transações sem match</p>
                {detail.transactions.filter((t) => !t.matched).length === 0 && (
                  <p className="text-sm text-muted-foreground">Todas as transações foram conciliadas.</p>
                )}
                {detail.transactions
                  .filter((t) => !t.matched)
                  .map((t) => (
                    <div key={t.id} className="mb-1.5 flex justify-between text-sm text-muted-foreground">
                      <span>{t.description}</span>
                      <span className="tabular-nums">R$ {Math.abs(Number(t.amount)).toFixed(2)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
