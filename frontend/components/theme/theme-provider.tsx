'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

// Deriva o tipo das props diretamente do componente, em vez de importar de um
// subpath interno do pacote (`next-themes/dist/types`), que muda entre versões
// e quebra o build silenciosamente.
type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

/**
 * Envolve o app com o provedor de tema (next-themes).
 * `attribute="class"` faz o toggle adicionar/remover a classe `.dark` na <html>,
 * que é exatamente o seletor usado em globals.css para os tokens escuros.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem {...props}>
      {children}
    </NextThemesProvider>
  );
}
