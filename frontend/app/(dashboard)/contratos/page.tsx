'use client';

import * as React from 'react';
import { FileText, Plus } from 'lucide-react';
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

interface Supplier {
  id: string;
  name: string;
}

interface Contract {
  id: string;
  contractNumber: string;
  status: 'ATIVO' | 'ENCERRADO' | 'EM_RENOVACAO' | 'CANCELADO';
  startDate: string;
  endDate: string;
  monthlyValuePerAsset: string;
  daysUntilExpiration: number;
  supplier: Supplier;
  _count: { assets: number };
}

const emptyForm = {
  contractNumber: '',
  supplierId: '',
  startDate: '',
  endDate: '',
  monthlyValuePerAsset: '',
  annualReadjustIndex: '',
  annualReadjustPct: '',
};

/** Cor do badge de vencimento: vermelho perto do fim, laranja se dentro de 30 dias, neutro caso contrário. */
function expirationVariant(days: number): 'destructive' | 'secondary' | 'outline' {
  if (days <= 7) return 'destructive';
  if (days <= 30) return 'secondary';
  return 'outline';
}

export default function ContratosPage() {
  const [contracts, setContracts] = React.useState<Contract[]>([]);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [contractsData, suppliersData] = await Promise.all([
        apiFetch<Contract[]>('/contracts'),
        apiFetch<Supplier[]>('/suppliers'),
      ]);
      setContracts(contractsData);
      setSuppliers(suppliersData);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar os contratos.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiFetch('/contracts', {
        method: 'POST',
        body: JSON.stringify({
          contractNumber: form.contractNumber,
          supplierId: form.supplierId,
          startDate: form.startDate,
          endDate: form.endDate,
          monthlyValuePerAsset: Number(form.monthlyValuePerAsset),
          annualReadjustIndex: form.annualReadjustIndex || undefined,
          annualReadjustPct: form.annualReadjustPct ? Number(form.annualReadjustPct) : undefined,
        }),
      });
      setForm(emptyForm);
      setOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível salvar o contrato.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Contratos' }]} />

      <main className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contratos de Locação</h1>
            <p className="text-sm text-muted-foreground">
              Vigência, valor mensal por equipamento e alertas de vencimento.
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={suppliers.length === 0}>
                <Plus className="mr-1.5 h-4 w-4" /> Novo contrato
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo contrato</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="contractNumber">Número do contrato</Label>
                    <Input
                      id="contractNumber"
                      required
                      placeholder="CTR-2026-0002"
                      value={form.contractNumber}
                      onChange={(e) => setForm({ ...form, contractNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplierId">Fornecedor</Label>
                    <Select
                      id="supplierId"
                      required
                      value={form.supplierId}
                      onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="startDate">Início da vigência</Label>
                    <Input
                      id="startDate"
                      type="date"
                      required
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="endDate">Fim da vigência</Label>
                    <Input
                      id="endDate"
                      type="date"
                      required
                      value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="monthlyValuePerAsset">Valor mensal/equipamento (R$)</Label>
                    <Input
                      id="monthlyValuePerAsset"
                      type="number"
                      step="0.01"
                      min={0}
                      required
                      value={form.monthlyValuePerAsset}
                      onChange={(e) => setForm({ ...form, monthlyValuePerAsset: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="annualReadjustIndex">Índice de reajuste</Label>
                    <Input
                      id="annualReadjustIndex"
                      placeholder="IPCA, IGP-M..."
                      value={form.annualReadjustIndex}
                      onChange={(e) => setForm({ ...form, annualReadjustIndex: e.target.value })}
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

        {suppliers.length === 0 && !loading && !loadError && (
          <Alert>Cadastre pelo menos um fornecedor antes de criar um contrato.</Alert>
        )}

        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadError && (
              <div className="p-5">
                <Alert variant="destructive">{loadError}</Alert>
              </div>
            )}

            {!loadError && loading && (
              <p className="p-5 text-sm text-muted-foreground">Carregando contratos...</p>
            )}

            {!loadError && !loading && contracts.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <FileText className="h-8 w-8" />
                Nenhum contrato cadastrado ainda.
              </div>
            )}

            {!loadError && !loading && contracts.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Valor/equip.</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Ativos vinculados</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.contractNumber}</TableCell>
                      <TableCell>{c.supplier.name}</TableCell>
                      <TableCell className="tabular-nums">
                        R$ {Number(c.monthlyValuePerAsset).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={expirationVariant(c.daysUntilExpiration)}>
                          {c.daysUntilExpiration >= 0
                            ? `${c.daysUntilExpiration} dias`
                            : 'Vencido'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c._count.assets}</TableCell>
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
