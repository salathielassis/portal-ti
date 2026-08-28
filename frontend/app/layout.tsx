import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { AuthProvider } from '@/contexts/auth-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Portal TI · Controle de Ativos',
  description: 'Gestão de ativos de TI, contratos de locação e conciliação financeira.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      {/* Fonte via stack de sistema (sem next/font/google): evita depender de
          acesso à Google Fonts durante o build, o que já derrubou pipelines
          de CI/hospedagens com rede restrita. Troque por next/font ou
          @font-face se quiser uma fonte de marca específica. */}
      <body className="font-sans antialiased">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
