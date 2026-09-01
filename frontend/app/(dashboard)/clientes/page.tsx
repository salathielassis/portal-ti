'use client';

import * as React from 'react';
import { Building2, MapPin, Pencil, Plus, HardHat } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
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
  active: boolean;
  _count: { allocations: number; contracts: number };
}

interface Site {
  id: string;
  name: string;
  costCenterLabel: string | null;
  cnpj: string;
  isHeadquarters: boolean;
  addressCity: string | null;
  addressState: string | null;
  obras: Obra[];
}

interface ClientWithSites {
  id: string;
  name: string;
  cnpjRoot: string;
  sites: Site[];
}

const emptyClientForm = { name: '', cnpjRoot: '' };

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
 * A maioria nasce automaticamente pela importação de extrato; o cadastro e a
 * renomeação manual servem para dar nome às obras que a importação antiga
 * deixou rotuladas só pelo número do contrato.
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

  const [obraDialogSite, setObraDialogSite] = React.useState<Site | null>(null);
  const [editingObra, setEditingObra] = React.useState<Obra | null>(null);

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
              Cliente = grupo empresarial (raiz do CNPJ). Abaixo dele, cada <strong>estabelecimento</strong> tem
              CNPJ próprio (matriz, filial de um estado, SPE); e cada <strong>obra</strong> dentro do
              estabelecimento é o centro de custo onde os ativos ficam de fato alocados.
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
          {clients.map((client) => (
            <Card key={client.id} className="shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <h2 className="font-semibold">{client.name}</h2>
                    <span className="text-xs text-muted-foreground">raiz CNPJ {client.cnpjRoot}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSiteDialogClient(client);
                      setSiteForm(emptySiteForm);
                      setSiteFormError(null);
                    }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Novo estabelecimento
                  </Button>
                </div>

                {client.sites.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum estabelecimento cadastrado ainda.</p>
                )}

                <div className="space-y-3">
                  {client.sites.map((site) => (
                    <div key={site.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">
                              {site.name}
                              {site.isHeadquarters && (
                                <Badge className="ml-2 align-middle">Matriz</Badge>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              CNPJ {site.cnpj}
                              {site.addressCity &&
                                ` · ${site.addressCity}${site.addressState ? '/' + site.addressState : ''}`}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setObraDialogSite(site)}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" /> Obra
                        </Button>
                      </div>

                      <div className="mt-2 space-y-1.5 pl-6">
                        {site.obras.length === 0 && (
                          <p className="text-xs text-muted-foreground">Nenhuma obra neste estabelecimento.</p>
                        )}
                        {site.obras.map((obra) => (
                          <div
                            key={obra.id}
                            className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <HardHat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate text-sm">{obra.name}</span>
                              {!obra.active && (
                                <Badge variant="outline" className="shrink-0">
                                  inativa
                                </Badge>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                              <span className="tabular-nums">{obra._count.allocations} ativos</span>
                              <Button variant="ghost" size="sm" onClick={() => setEditingObra(obra)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      {/* Novo estabelecimento (Site) */}
      <Dialog open={!!siteDialogClient} onOpenChange={(v) => !v && setSiteDialogClient(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Novo estabelecimento {siteDialogClient ? `— ${siteDialogClient.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSite} className="space-y-4">
            {siteFormError && <Alert variant="destructive">{siteFormError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="siteName">Nome do estabelecimento</Label>
                <Input
                  id="siteName"
                  required
                  placeholder="DOISA FILIAL GO"
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
        site={obraDialogSite}
        onClose={() => setObraDialogSite(null)}
        onSaved={() => {
          setObraDialogSite(null);
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
    </>
  );
}

/** Cria (recebe `site`) ou edita (recebe `obra`) uma obra. */
function ObraDialog({
  site,
  obra,
  onClose,
  onSaved,
}: {
  site?: Site | null;
  obra?: Obra | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!obra;
  const open = !!site || !!obra;

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
    setError(null);
  }, [obra, site]);

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
      } else if (site) {
        await apiFetch(`/clients/sites/${site.id}/obras`, {
          method: 'POST',
          body: JSON.stringify({ name, costCenterLabel: label }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a obra.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar obra — ${obra?.name}` : `Nova obra${site ? ` — ${site.name}` : ''}`}
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
