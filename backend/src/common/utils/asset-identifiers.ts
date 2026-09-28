import { Prisma } from '@prisma/client';

/**
 * Forma canônica do nº de série e do tombo (patrimônio): sem espaços e em
 * maiúsculas. O banco só impede repetição EXATA (`@unique`), então
 * "abc123", "ABC123" e " ABC 123" virariam três ativos — todo ponto de
 * gravação (cadastro manual, edição, extrato, guia de entrega) passa por
 * aqui antes de salvar ou procurar.
 */
export function normalizeSerial(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function normalizeAssetTag(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * Filtro que acha ativos por nº de série OU tombo ignorando maiúsculas —
 * cobre também cadastros antigos gravados antes da normalização.
 */
export function assetIdentifierFilter(serials: string[], tags: string[]): Prisma.AssetWhereInput {
  return {
    OR: [
      ...serials.filter(Boolean).map((s) => ({ serialNumber: { equals: s, mode: 'insensitive' as const } })),
      ...tags.filter(Boolean).map((t) => ({ assetTag: { equals: t, mode: 'insensitive' as const } })),
    ],
  };
}
