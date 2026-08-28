import * as React from 'react';
import { cn } from '@/lib/utils';

/** Banner simples de feedback (erro/sucesso) — sem dependência extra de toast. */
function Alert({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' | 'success' }) {
  return (
    <div
      role="alert"
      className={cn(
        'w-full rounded-lg border px-4 py-3 text-sm',
        variant === 'destructive' && 'border-destructive/30 bg-destructive/10 text-destructive',
        variant === 'success' && 'border-success/30 bg-success/10 text-success',
        variant === 'default' && 'border-border bg-muted text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
