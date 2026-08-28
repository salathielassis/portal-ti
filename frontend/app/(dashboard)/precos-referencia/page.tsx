'use client';

import * as React from 'react';
import { Plus, Tags, MoreVertical, Pencil, Trash2 } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { apiFetch, ApiError } from '@/lib/api-client';

interface PriceTier {
  id: string;
  label: string;
  keywords: string[];
  referenceValue: number;
  sortOrder: number;
  active: boolean;
  _count: { assets: number };
}

interface TierForm {
  label: string;
  keywords: string;
  referenceValue: string;
  sortOrder: string;
  active: boolean;
}

const emptyForm: TierForm = { label: '', keywords: '', referenceValue: '', sortOrder: '0', active: true };

function currency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Tabela de preços de referência por tipo de equipamento — cada linha vira
 * uma regra de classificação automática: se a descrição do item no extrato
 * contém todas as palavras-chave, o ativo é classificado nesse tipo, e o
 * valor de referência é usado para alertar quando o extrato cobra diferente
 * do esperado (ver "Importar Extrato").
 */
export default function PrecosReferenciaPage() {
  const [tiers, setTiers] = React.useState<PriceTier[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<TierForm>(emptyForm);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<PriceTier[]>('/equipment-price-tiers');
      setTiers(data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar a tabela de preços.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(tier: PriceTier) {
    setEditingId(tier.id);
    setForm({
      label: tier.label,
      keywords: tier.keywords.join(', '),
      referenceValue: String(tier.referenceValue),
      sortOrder: String(tier.sortOrder),
      active: tier.active,
    });
    setFormError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = {
        label: form.label,
        keywords: form.keywords
          .split(',')
          .map((k) => k.trim().toUpperCase())
          .filter(Boolean),
        referenceValue: Number(form.referenceValue),
        sortOrder: Number(form.sortOrder) || 0,
        active: form.active,
      };
      if (payload.keywords.length === 0) {
        throw new ApiError('Informe pelo menos uma palavra-chave.', 400);
      }
      if (editingId) {
        await apiFetch(`/equipment-price-tiers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/equipment-price-tiers', { method: 'POST', body: JSON.stringify(payload) });
      }
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível salvar o tipo de equipamento.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(tier: PriceTier) {
    if (!window.confirm(`Excluir o tipo "${tier.label}"? Só é possível se não houver ativos classificados nele.`)) {
      return;
    }
    try {
      await apiFetch(`/equipment-price-tiers/${tier.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Não foi possível excluir.');
    }
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Tabela de Preços de Referência' }]} />

      <main className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tabela de Preços de Referência</h1>
            <p className="text-sm text-muted-foreground">
              Cada tipo é reconhecido automaticamente pela descrição do equipamento no extrato (palavras-chave).
              Quando a regra casa, o valor de referência é comparado ao valor cobrado e um alerta aparece na
              importação em caso de diferença.
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" /> Novo tipo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Editar tipo de equipamento' : 'Novo tipo de equipamento'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <div className="space-y-1.5">
                  <Label htmlFor="label">Nome do tipo</Label>
                  <Input
                    id="label"
                    required
                    placeholder="Notebook Core i5"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="keywords">Palavras-chave (separadas por vírgula)</Label>
                  <Input
                    id="keywords"
                    required
                    placeholder="NOTEBOOK, CORE I5"
                    value={form.keywords}
                    onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    A descrição do item precisa conter TODAS as palavras para casar com esta regra. Use{' '}
                    <code>A|B</code> dentro de uma palavra para "A ou B" (ex.: <code>ULTRA 3|U3</code>).
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="referenceValue">Valor de referência (R$)</Label>
                    <Input
                      id="referenceValue"
                      type="number"
                      step="0.01"
                      min={0}
                      required
                      value={form.referenceValue}
                      onChange={(e) => setForm({ ...form, referenceValue: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sortOrder">Prioridade de avaliação</Label>
                    <Input
                      id="sortOrder"
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Menor número é avaliado primeiro.</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  Regra ativa (usada na classificação automática)
                </label>
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
              <p className="p-5 text-sm text-muted-foreground">Carregando...</p>
            )}

            {!loadError && !loading && tiers.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <Tags className="h-8 w-8" />
                Nenhum tipo de equipamento cadastrado ainda.
              </div>
            )}

            {!loadError && !loading && tiers.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Palavras-chave</TableHead>
                    <TableHead className="text-right">Valor de referência</TableHead>
                    <TableHead className="text-right">Prioridade</TableHead>
                    <TableHead className="text-right">Ativos classificados</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => (
                    <TableRow key={tier.id}>
                      <TableCell className="font-medium">{tier.label}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex flex-wrap gap-1">
                          {tier.keywords.map((kw) => (
                            <Badge key={kw} variant="outline" className="font-normal">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{currency(tier.referenceValue)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{tier.sortOrder}</TableCell>
                      <TableCell className="text-right tabular-nums">{tier._count.assets}</TableCell>
                      <TableCell>
                        {tier.active ? <Badge>Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(tier)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(tier)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
