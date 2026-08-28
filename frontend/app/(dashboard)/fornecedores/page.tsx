'use client';

import * as React from 'react';
import { Plus, Truck } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  cnpj: string;
  slaHours: number | null;
  contactName: string | null;
  contactEmail: string | null;
  _count: { contracts: number; assets: number };
}

const emptyForm = { name: '', cnpj: '', slaHours: '', contactName: '', contactEmail: '', contactPhone: '' };

export default function FornecedoresPage() {
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(emptyForm);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const loadSuppliers = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<Supplier[]>('/suppliers');
      setSuppliers(data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar os fornecedores.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiFetch('/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          cnpj: form.cnpj,
          slaHours: form.slaHours ? Number(form.slaHours) : undefined,
          contactName: form.contactName || undefined,
          contactEmail: form.contactEmail || undefined,
          contactPhone: form.contactPhone || undefined,
        }),
      });
      setForm(emptyForm);
      setOpen(false);
      await loadSuppliers();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível salvar o fornecedor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Fornecedores' }]} />

      <main className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Fornecedores</h1>
            <p className="text-sm text-muted-foreground">
              Empresas de locação de notebooks e impressoras, com SLA e contatos.
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-1.5 h-4 w-4" /> Novo fornecedor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo fornecedor</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="name">Razão social</Label>
                    <Input
                      id="name"
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cnpj">CNPJ</Label>
                    <Input
                      id="cnpj"
                      required
                      placeholder="00.000.000/0001-00"
                      value={form.cnpj}
                      onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="slaHours">SLA (horas)</Label>
                    <Input
                      id="slaHours"
                      type="number"
                      min={1}
                      value={form.slaHours}
                      onChange={(e) => setForm({ ...form, slaHours: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactName">Contato</Label>
                    <Input
                      id="contactName"
                      value={form.contactName}
                      onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactEmail">E-mail do contato</Label>
                    <Input
                      id="contactEmail"
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
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
          <CardContent className="p-0">
            {loadError && (
              <div className="p-5">
                <Alert variant="destructive">{loadError}</Alert>
              </div>
            )}

            {!loadError && loading && (
              <p className="p-5 text-sm text-muted-foreground">Carregando fornecedores...</p>
            )}

            {!loadError && !loading && suppliers.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <Truck className="h-8 w-8" />
                Nenhum fornecedor cadastrado ainda.
              </div>
            )}

            {!loadError && !loading && suppliers.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Razão social</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead className="text-right">Contratos</TableHead>
                    <TableHead className="text-right">Ativos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{s.cnpj}</TableCell>
                      <TableCell>{s.slaHours ? `${s.slaHours}h` : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.contactName ?? s.contactEmail ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s._count.contracts}</TableCell>
                      <TableCell className="text-right tabular-nums">{s._count.assets}</TableCell>
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
