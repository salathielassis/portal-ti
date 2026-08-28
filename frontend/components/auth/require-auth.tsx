'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

/**
 * Protege as rotas do grupo (dashboard). Como o token vive no localStorage
 * (sem cookie/sessão de servidor), a checagem só é possível no cliente —
 * por isso este componente é 'use client' e redireciona via useEffect em vez
 * de bloquear no middleware do Next.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  }

  if (!user) return null;

  return <>{children}</>;
}
