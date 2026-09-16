import { AssetType } from '@prisma/client';

/**
 * Heurísticas por palavra-chave para preencher marca/tipo do Asset quando a
 * fonte (extrato de locação, guia de entrega) só traz uma descrição textual
 * livre, sem campos estruturados de marca/tipo. Compartilhado entre os
 * importadores de PDF da locadora (lease-import e delivery-import).
 */
const KNOWN_BRANDS = ['DELL', 'HP', 'LENOVO', 'SAMSUNG', 'POSITIVO', 'ACER', 'ASUS', 'APPLE', 'VAIO'];

export function detectBrand(description: string): string {
  const upper = description.toUpperCase();
  const found = KNOWN_BRANDS.find((brand) => upper.includes(brand));
  return found ?? 'NÃO INFORMADA';
}

export function detectAssetType(description: string): AssetType {
  const upper = description.toUpperCase();
  if (upper.includes('IMPRESSORA')) return AssetType.IMPRESSORA;
  if (upper.includes('MONITOR')) return AssetType.MONITOR;
  if (upper.includes('NOTEBOOK') || upper.includes('NOTBOOK')) return AssetType.NOTEBOOK;
  return AssetType.OUTRO;
}
