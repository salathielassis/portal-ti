import { Settings } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';

export const metadata = { title: 'Configurações · Portal TI' };

/**
 * Placeholder — cadastro de usuários/RBAC, preferências de notificação de
 * alertas de contrato, etc. ficam para uma próxima etapa (ver ARCHITECTURE.md).
 */
export default function ConfiguracoesPage() {
  return (
    <>
      <Header breadcrumbs={[{ label: 'Portal TI' }, { label: 'Configurações' }]} />
      <main className="p-6">
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
            <Settings className="h-8 w-8" />
            Em construção — gestão de usuários e preferências chega em uma próxima etapa.
          </CardContent>
        </Card>
      </main>
    </>
  );
}
