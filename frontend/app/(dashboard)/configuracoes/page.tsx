'use client';

import * as React from 'react';
import { KeyRound, Plus, ShieldCheck, UserCog, Users } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
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
} from '@/components/ui/dialog';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

type Role = 'ADMIN' | 'FINANCEIRO' | 'SUPORTE';

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  department: { id: string; name: string } | null;
}

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  FINANCEIRO: 'Financeiro',
  SUPORTE: 'Suporte',
};

const ROLE_OPTIONS: Role[] = ['ADMIN', 'FINANCEIRO', 'SUPORTE'];

export default function ConfiguracoesPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Configurações' }]} />
      <main className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground">
            Gestão de usuários e da sua conta de acesso.
          </p>
        </div>

        <ChangeOwnPasswordCard />
        {isAdmin && <UsersManagementCard currentUserId={currentUser!.id} />}
      </main>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Minha conta — trocar a própria senha                                      */
/* -------------------------------------------------------------------------- */

function ChangeOwnPasswordCard() {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirm) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Minha senha
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid max-w-md gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          {success && <Alert variant="success">Senha atualizada com sucesso.</Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Senha atual</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">Nova senha</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Trocar senha'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Administração de usuários (ADMIN)                                          */
/* -------------------------------------------------------------------------- */

function UsersManagementCard({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = React.useState<ManagedUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ManagedUser | null>(null);
  const [resetting, setResetting] = React.useState<ManagedUser | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setUsers(await apiFetch<ManagedUser[]>('/users'));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar os usuários.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" /> Usuários
        </CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Novo usuário
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {loadError && (
          <div className="p-5">
            <Alert variant="destructive">{loadError}</Alert>
          </div>
        )}

        {!loadError && loading && (
          <p className="p-5 text-sm text-muted-foreground">Carregando usuários...</p>
        )}

        {!loadError && !loading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.name}
                    {u.id === currentUserId && (
                      <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      {u.role === 'ADMIN' && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                      {ROLE_LABELS[u.role]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? 'secondary' : 'outline'}>
                      {u.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setResetting(u)}>
                        <KeyRound className="mr-1 h-3.5 w-3.5" /> Senha
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditing(u)}>
                        <UserCog className="mr-1 h-3.5 w-3.5" /> Editar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <EditUserDialog
        user={editing}
        isSelf={editing?.id === currentUserId}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <ResetPasswordDialog
        user={resetting}
        onOpenChange={(open) => !open && setResetting(null)}
        onSaved={() => setResetting(null)}
      />
    </Card>
  );
}

const emptyCreateForm = { name: '', email: '', password: '', role: 'SUPORTE' as Role };

function CreateUserDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState(emptyCreateForm);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(emptyCreateForm);
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError('A senha inicial precisa ter pelo menos 8 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(form) });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar o usuário.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Nome</Label>
            <Input
              id="new-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-email">E-mail</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Senha inicial</Label>
              <Input
                id="new-password"
                type="text"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role">Perfil</Label>
              <Select
                id="new-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Anote a senha inicial e repasse ao usuário — ele pode trocá-la depois em Configurações.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Criando...' : 'Criar usuário'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  isSelf,
  onOpenChange,
  onSaved,
}: {
  user: ManagedUser | null;
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<Role>('SUPORTE');
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setActive(user.active);
      setError(null);
    }
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, role, active }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar as alterações.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
        </DialogHeader>
        {user && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="destructive">{error}</Alert>}
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Nome</Label>
              <Input id="edit-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input value={user.email} disabled />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-role">Perfil</Label>
                <Select
                  id="edit-role"
                  value={role}
                  disabled={isSelf}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-active">Status</Label>
                <Select
                  id="edit-active"
                  value={active ? 'true' : 'false'}
                  disabled={isSelf}
                  onChange={(e) => setActive(e.target.value === 'true')}
                >
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </Select>
              </div>
            </div>
            {isSelf && (
              <p className="text-xs text-muted-foreground">
                Você não pode alterar o próprio perfil ou desativar a própria conta.
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: ManagedUser | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [newPassword, setNewPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setNewPassword('');
      setError(null);
      setDone(false);
    }
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    if (newPassword.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/users/${user.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível redefinir a senha.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha{user ? ` — ${user.name}` : ''}</DialogTitle>
        </DialogHeader>
        {user && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="destructive">{error}</Alert>}
            {done ? (
              <>
                <Alert variant="success">
                  Senha redefinida. Repasse a nova senha ao usuário — ele pode trocá-la depois.
                </Alert>
                <DialogFooter>
                  <Button type="button" onClick={onSaved}>
                    Fechar
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-password">Nova senha</Label>
                  <Input
                    id="reset-password"
                    type="text"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Redefinindo...' : 'Redefinir senha'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
