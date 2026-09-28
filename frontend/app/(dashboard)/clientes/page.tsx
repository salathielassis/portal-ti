'use client';

import * as React from 'react';
import { Building2, MapPin, Merge, Pencil, Plus, HardHat, Trash2 } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { apiFetch, ApiError } from '@/lib/api-client';

interface Obra {
  id: string;
  name: string;
  costCenterLabel: string;
  aliases: string[];
  active: boolean;
  _count: { allocations: number; contracts: number };
}

interface Site {
  id: string;
  name: string;
  costCenterLabel: string | null;
  cnpj: string;
  isHeadquarters: boolean;
  addressStreet: string | null;
  addressNumber: string | null;
  addressCity: string | null;
  addressState: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  obras: Obra[];
}

interface ClientWithSites {
  id: string;
  name: string;
  cnpjRoot: string;
  sites: Site[];
}

const emptyClientForm = { name: '', cnpjRoot: '' };

/** "03092799000343" -> "03.092.799/0003-43" */
function formatCnpj(cnpj: string) {
  const d = cnpj.replace(/\D/g, '');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj;
}

/** Mesma normalização do backend (sem acento/pontuação/caixa) — só para não repetir o nome da obra na linha "reconhece". */
function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const emptySiteForm = {
  name: '',
  costCenterLabel: '',
  cnpj: '',
  isHeadquarters: false,
  addressStreet: '',
  addressNumber: '',
  addressCity: '',
  addressState: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
};

/**
 * Hierarquia Cliente (grupo empresarial) → Estabelecimento (Site, com CNPJ
 * próprio) → Obra (centro de custo / canteiro, a CLASSIFICAÇÃO do extrato).
 * A maioria nasce automaticamente pela importação de extrato; o cadastro, a
 * edição, a exclusão e a mesclagem manuais servem para organizar o que a
 * importação criou (ex.: obra duplicada por grafia diferente da
 * classificação, estabelecimento com nome de obra).
 */
export default function ClientesPage() {
  const [clients, setClients] = React.useState<ClientWithSites[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [clientDialogOpen, setClientDialogOpen] = React.useState(false);
  const [clientForm, setClientForm] = React.useState(emptyClientForm);
  const [clientFormError, setClientFormError] = React.useState<string | null>(null);
  const [submittingClient, setSubmittingClient] = React.useState(false);

  const [siteDialogClient, setSiteDialogClient] = React.useState<ClientWithSites | null>(null);
  const [siteForm, setSiteForm] = React.useState(emptySiteForm);
  const [siteFormError, setSiteFormError] = React.useState<string | null>(null);
  const [submittingSite, setSubmittingSite] = React.useState(false);

  const [obraDialogClient, setObraDialogClient] = React.useState<ClientWithSites | null>(null);
  const [editingObra, setEditingObra] = React.useState<Obra | null>(null);
  const [editingSite, setEditingSite] = React.useState<Site | null>(null);
  const [mergingObra, setMergingObra] = React.useState<{ obra: Obra; client: ClientWithSites } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const loadClients = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<ClientWithSites[]>('/clients');
      setClients(data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar os clientes.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadClients();
  }, [loadClients]);

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setClientFormError(null);
    setSubmittingClient(true);
    try {
      await apiFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({ name: clientForm.name, cnpjRoot: clientForm.cnpjRoot.replace(/\D/g, '') }),
      });
      setClientForm(emptyClientForm);
      setClientDialogOpen(false);
      await loadClients();
    } catch (err) {
      setClientFormError(err instanceof ApiError ? err.message : 'Não foi possível cadastrar o cliente.');
    } finally {
      setSubmittingClient(false);
    }
  }

  async function handleDelete(path: string, what: string) {
    if (!window.confirm(`Excluir ${what}? Essa ação não pode ser desfeita.`)) return;
    setActionError(null);
    try {
      await apiFetch(path, { method: 'DELETE' });
      await loadClients();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Não foi possível excluir ${what}.`);
    }
  }

  async function handleCreateSite(e: React.FormEvent) {
    e.preventDefault();
    if (!siteDialogClient) return;
    setSiteFormError(null);
    setSubmittingSite(true);
    try {
      await apiFetch(`/clients/${siteDialogClient.id}/sites`, {
        method: 'POST',
        body: JSON.stringify({
          name: siteForm.name,
          costCenterLabel: siteForm.costCenterLabel || undefined,
          cnpj: siteForm.cnpj.replace(/\D/g, ''),
          isHeadquarters: siteForm.isHeadquarters,
          addressStreet: siteForm.addressStreet || undefined,
          addressNumber: siteForm.addressNumber || undefined,
          addressCity: siteForm.addressCity || undefined,
          addressState: siteForm.addressState || undefined,
          contactName: siteForm.contactName || undefined,
          contactPhone: siteForm.contactPhone || undefined,
          contactEmail: siteForm.contactEmail || undefined,
        }),
      });
      setSiteForm(emptySiteForm);
      setSiteDialogClient(null);
      await loadClients();
    } catch (err) {
      setSiteFormError(err instanceof ApiError ? err.message : 'Não foi possível cadastrar o estabelecimento.');
    } finally {
      setSubmittingSite(false);
    }
  }

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Clientes e Obras' }]} />

      <main className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Clientes e Obras</h1>
            <p className="text-sm text-muted-foreground">
              Cada <strong>obra</strong> é onde os ativos ficam de fato alocados. Abaixo do nome aparece o CNPJ em
              que a locadora fatura aquela obra (matriz ou filial do estado).
            </p>
          </div>

          <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setClientForm(emptyClientForm);
                  setClientFormError(null);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Novo cliente
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo cliente</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateClient} className="space-y-4">
                {clientFormError && <Alert variant="destructive">{clientFormError}</Alert>}
                <div className="space-y-1.5">
                  <Label htmlFor="clientName">Nome do grupo empresarial</Label>
                  <Input
                    id="clientName"
                    required
                    placeholder="DOISA"
                    value={clientForm.name}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cnpjRoot">Raiz do CNPJ (8 primeiros dígitos)</Label>
                  <Input
                    id="cnpjRoot"
                    required
                    maxLength={8}
                    placeholder="03092799"
                    value={clientForm.cnpjRoot}
                    onChange={(e) => setClientForm({ ...clientForm, cnpjRoot: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Compartilhada entre a matriz e todas as filiais/obras deste grupo.
                  </p>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={submittingClient}>
                    {submittingClient ? 'Salvando...' : 'Salvar'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loadError && <Alert variant="destructive">{loadError}</Alert>}
        {actionError && <Alert variant="destructive">{actionError}</Alert>}
        {!loadError && loading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {!loadError && !loading && clients.length === 0 && (
          <Card className="shadow-card">
            <CardContent className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
              <Building2 className="h-8 w-8" />
              Nenhum cliente cadastrado ainda — cadastre um acima ou importe um extrato de locação para criar o
              primeiro automaticamente.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {clients.map((client) => {
            // O controle do dia a dia é pela OBRA — ela é o item principal. O
            // estabelecimento (CNPJ onde a locadora fatura) aparece só como
            // detalhe de cada obra e, para manutenção, na seção recolhida abaixo.
            const obras = client.sites
              .flatMap((site) => site.obras.map((obra) => ({ obra, site })))
              .sort((a, b) => a.obra.name.localeCompare(b.obra.name, 'pt-BR'));
            return (
              <Card key={client.id} className="shadow-card">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      <h2 className="font-semibold">{client.name}</h2>
                      <span className="text-xs text-muted-foreground">raiz CNPJ {client.cnpjRoot}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={client.sites.length === 0}
                        title={client.sites.length === 0 ? 'Cadastre um CNPJ primeiro' : undefined}
                        onClick={() => setObraDialogClient(client)}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Nova obra
                      </Button>
                      {client.sites.length === 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Excluir cliente"
                          onClick={() => handleDelete(`/clients/${client.id}`, `o cliente "${client.name}"`)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {obras.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhuma obra cadastrada ainda.</p>
                  )}

                  <div className="space-y-1.5">
                    {obras.map(({ obra, site }) => (
                      <div
                        key={obra.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <HardHat className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate text-sm font-medium">{obra.name}</span>
                            {!obra.active && (
                              <Badge variant="outline" className="shrink-0">
                                inativa
                              </Badge>
                            )}
                          </div>
                          <p className="truncate pl-5 text-xs text-muted-foreground">
                            faturado no CNPJ {formatCnpj(site.cnpj)}
                            {site.isHeadquarters ? ' (matriz)' : ''}
                          </p>
                          {(normalizeLabel(obra.costCenterLabel) !== normalizeLabel(obra.name) ||
                            obra.aliases.length > 0) && (
                            <p
                              className="truncate pl-5 text-xs text-muted-foreground"
                              title={[obra.costCenterLabel, ...obra.aliases].join(' · ')}
                            >
                              reconhece: {[obra.costCenterLabel, ...obra.aliases].join(' · ')}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                          <span className="mr-1 tabular-nums" title="Alocações (atuais e históricas)">
                            {obra._count.allocations} aloc.
                          </span>
                          <Button variant="ghost" size="sm" title="Editar obra" onClick={() => setEditingObra(obra)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Mesclar em outra obra (duplicada)"
                            onClick={() => setMergingObra({ obra, client })}
                          >
                            <Merge className="h-3.5 w-3.5" />
                          </Button>
                          {obra._count.allocations === 0 && obra._count.contracts === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Excluir obra"
                              onClick={() => handleDelete(`/clients/obras/${obra.id}`, `a obra "${obra.name}"`)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <details className="rounded-md border border-dashed border-border px-3 py-2 text-sm">
                    <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
                      CNPJs de faturamento ({client.sites.length})
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {client.sites.map((site) => (
                        <div key={site.id} className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs">
                              {formatCnpj(site.cnpj)}
                              {site.isHeadquarters ? ' · matriz' : ''}
                              {site.addressCity
                                ? ` · ${site.addressCity}${site.addressState ? '/' + site.addressState : ''}`
                                : ''}
                              {` · ${site.obras.length} obra(s)`}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Editar CNPJ de faturamento"
                              onClick={() => setEditingSite(site)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {site.obras.length === 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Excluir CNPJ de faturamento"
                                onClick={() =>
                                  handleDelete(`/clients/sites/${site.id}`, `o CNPJ ${formatCnpj(site.cnpj)}`)
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSiteDialogClient(client);
                          setSiteForm(emptySiteForm);
                          setSiteFormError(null);
                        }}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Novo CNPJ de faturamento
                      </Button>
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>

      {/* Novo estabelecimento (Site) */}
      <Dialog open={!!siteDialogClient} onOpenChange={(v) => !v && setSiteDialogClient(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Novo CNPJ de faturamento {siteDialogClient ? `— ${siteDialogClient.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSite} className="space-y-4">
            {siteFormError && <Alert variant="destructive">{siteFormError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="siteName">Nome interno</Label>
                <Input
                  id="siteName"
                  required
                  placeholder="DOISA - Filial GO"
                  value={siteForm.name}
                  onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="siteCnpj">CNPJ completo (14 dígitos)</Label>
                <Input
                  id="siteCnpj"
                  required
                  maxLength={14}
                  placeholder="03092799000858"
                  value={siteForm.cnpj}
                  onChange={(e) => setSiteForm({ ...siteForm, cnpj: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addressCity">Cidade</Label>
                <Input
                  id="addressCity"
                  value={siteForm.addressCity}
                  onChange={(e) => setSiteForm({ ...siteForm, addressCity: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addressState">UF</Label>
                <Input
                  id="addressState"
                  maxLength={2}
                  value={siteForm.addressState}
                  onChange={(e) => setSiteForm({ ...siteForm, addressState: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addressStreet">Endereço</Label>
                <Input
                  id="addressStreet"
                  value={siteForm.addressStreet}
                  onChange={(e) => setSiteForm({ ...siteForm, addressStreet: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="addressNumber">Número</Label>
                <Input
                  id="addressNumber"
                  value={siteForm.addressNumber}
                  onChange={(e) => setSiteForm({ ...siteForm, addressNumber: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="contactName">Contato local (opcional)</Label>
                <Input
                  id="contactName"
                  value={siteForm.contactName}
                  onChange={(e) => setSiteForm({ ...siteForm, contactName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactPhone">Telefone</Label>
                <Input
                  id="contactPhone"
                  value={siteForm.contactPhone}
                  onChange={(e) => setSiteForm({ ...siteForm, contactPhone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactEmail">E-mail</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={siteForm.contactEmail}
                  onChange={(e) => setSiteForm({ ...siteForm, contactEmail: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={siteForm.isHeadquarters}
                onChange={(e) => setSiteForm({ ...siteForm, isHeadquarters: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              Este é a matriz/sede do cliente
            </label>
            <DialogFooter>
              <Button type="submit" disabled={submittingSite}>
                {submittingSite ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ObraDialog
        client={obraDialogClient}
        onClose={() => setObraDialogClient(null)}
        onSaved={() => {
          setObraDialogClient(null);
          loadClients();
        }}
      />
      <ObraDialog
        obra={editingObra}
        onClose={() => setEditingObra(null)}
        onSaved={() => {
          setEditingObra(null);
          loadClients();
        }}
      />
      <EditSiteDialog
        site={editingSite}
        onClose={() => setEditingSite(null)}
        onSaved={() => {
          setEditingSite(null);
          loadClients();
        }}
      />
      <MergeObraDialog
        target={mergingObra}
        onClose={() => setMergingObra(null)}
        onSaved={() => {
          setMergingObra(null);
          loadClients();
        }}
      />
    </>
  );
}

/** Cria (recebe `client` — escolhe o CNPJ de faturamento) ou edita (recebe `obra`) uma obra. */
function ObraDialog({
  client,
  obra,
  onClose,
  onSaved,
}: {
  client?: ClientWithSites | null;
  obra?: Obra | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!obra;
  const open = !!client || !!obra;
  const [siteId, setSiteId] = React.useState('');

  const [name, setName] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (obra) {
      setName(obra.name);
      setLabel(obra.costCenterLabel);
      setActive(obra.active);
    } else {
      setName('');
      setLabel('');
      setActive(true);
    }
    const sites = client?.sites ?? [];
    setSiteId(sites.length === 1 ? sites[0].id : '');
    setError(null);
  }, [obra, client]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit && obra) {
        await apiFetch(`/clients/obras/${obra.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, costCenterLabel: label, active }),
        });
      } else if (client) {
        if (!siteId) throw new Error('Escolha o CNPJ em que a locadora fatura esta obra.');
        await apiFetch(`/clients/sites/${siteId}/obras`, {
          method: 'POST',
          body: JSON.stringify({ name, costCenterLabel: label }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Não foi possível salvar a obra.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar obra — ${obra?.name}` : `Nova obra${client ? ` — ${client.name}` : ''}`}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="obra-name">Nome da obra</Label>
            <Input
              id="obra-name"
              required
              placeholder="Oficina, Urbanização, Barro Alto GO…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obra-label">Classificação (rótulo do extrato)</Label>
            <Input
              id="obra-label"
              required
              placeholder="EQUIP - BARRO ALTO GO"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Texto exato do campo CLASSIFICAÇÃO no extrato da locadora — é o que liga a importação a esta obra.
              Só mude se souber o valor exato.
            </p>
          </div>
          {!isEdit && client && (
            <div className="space-y-1.5">
              <Label htmlFor="obra-site">CNPJ de faturamento</Label>
              <Select id="obra-site" required value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">Selecione...</option>
                {client.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatCnpj(s.cnpj)}
                    {s.isHeadquarters ? ' (matriz)' : ''}
                    {s.addressState ? ` · ${s.addressState}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {isEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Obra ativa
            </label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edita nome/matriz/endereço/contato de um estabelecimento. O CNPJ não muda — é a chave do extrato. */
function EditSiteDialog({ site, onClose, onSaved }: { site: Site | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState(emptySiteForm);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!site) return;
    setForm({
      name: site.name,
      costCenterLabel: site.costCenterLabel ?? '',
      cnpj: site.cnpj,
      isHeadquarters: site.isHeadquarters,
      addressStreet: site.addressStreet ?? '',
      addressNumber: site.addressNumber ?? '',
      addressCity: site.addressCity ?? '',
      addressState: site.addressState ?? '',
      contactName: site.contactName ?? '',
      contactPhone: site.contactPhone ?? '',
      contactEmail: site.contactEmail ?? '',
    });
    setError(null);
  }, [site]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!site) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/clients/sites/${site.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          isHeadquarters: form.isHeadquarters,
          addressStreet: form.addressStreet || undefined,
          addressNumber: form.addressNumber || undefined,
          addressCity: form.addressCity || undefined,
          addressState: form.addressState || undefined,
          contactName: form.contactName || undefined,
          contactPhone: form.contactPhone || undefined,
          contactEmail: form.contactEmail || undefined,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o estabelecimento.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!site} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar CNPJ de faturamento — {site ? formatCnpj(site.cnpj) : ''}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="editSiteName">Nome interno (aparece pouco)</Label>
              <Input
                id="editSiteName"
                required
                placeholder="DOISA - Filial Ceará"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                O controle é pela obra — este nome só identifica o CNPJ onde a locadora fatura.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editSiteCity">Cidade</Label>
              <Input
                id="editSiteCity"
                value={form.addressCity}
                onChange={(e) => setForm({ ...form, addressCity: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editSiteState">UF</Label>
              <Input
                id="editSiteState"
                maxLength={2}
                value={form.addressState}
                onChange={(e) => setForm({ ...form, addressState: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editSiteStreet">Endereço</Label>
              <Input
                id="editSiteStreet"
                value={form.addressStreet}
                onChange={(e) => setForm({ ...form, addressStreet: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editSiteNumber">Número</Label>
              <Input
                id="editSiteNumber"
                value={form.addressNumber}
                onChange={(e) => setForm({ ...form, addressNumber: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="editSiteContact">Contato local (opcional)</Label>
              <Input
                id="editSiteContact"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editSitePhone">Telefone</Label>
              <Input
                id="editSitePhone"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editSiteEmail">E-mail</Label>
              <Input
                id="editSiteEmail"
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isHeadquarters}
              onChange={(e) => setForm({ ...form, isHeadquarters: e.target.checked })}
              className="h-4 w-4 rounded border-border"
            />
            Este é a matriz/sede do cliente
          </label>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mescla uma obra duplicada em outra do mesmo cliente: todos os ativos
 * (alocações atuais e históricas) e contratos vão para a obra escolhida, a
 * classificação da duplicada vira apelido da escolhida (a próxima
 * importação já cai nela) e a duplicada é excluída.
 */
function MergeObraDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { obra: Obra; client: ClientWithSites } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [destinationId, setDestinationId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setDestinationId('');
    setError(null);
  }, [target]);

  const options = React.useMemo(
    () =>
      target
        ? target.client.sites.flatMap((site) =>
            site.obras.filter((o) => o.id !== target.obra.id).map((o) => ({ obra: o, site })),
          )
        : [],
    [target],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !destinationId) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/clients/obras/${target.obra.id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ targetObraId: destinationId }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível mesclar as obras.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mesclar obra — {target?.obra.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <p className="text-sm text-muted-foreground">
            Use quando esta obra é uma <strong>duplicata</strong> de outra. Os{' '}
            <strong>{target?.obra._count.allocations ?? 0} registro(s) de alocação</strong> e{' '}
            <strong>{target?.obra._count.contracts ?? 0} contrato(s)</strong> dela passam para a obra escolhida abaixo,
            a classificação &quot;{target?.obra.costCenterLabel}&quot; passa a ser reconhecida pela obra escolhida (a
            próxima importação já cai nela) e esta obra é excluída.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="mergeDestination">Obra que vai ficar</Label>
            <Select
              id="mergeDestination"
              required
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
            >
              <option value="">Selecione...</option>
              {options.map(({ obra, site }) => (
                <option key={obra.id} value={obra.id}>
                  {obra.name} — CNPJ {formatCnpj(site.cnpj)} ({obra._count.allocations} aloc.)
                </option>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting || !destinationId}>
              {submitting ? 'Mesclando...' : 'Mesclar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
