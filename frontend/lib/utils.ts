import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Helper padrão shadcn/ui para mesclar classes Tailwind condicionalmente. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
