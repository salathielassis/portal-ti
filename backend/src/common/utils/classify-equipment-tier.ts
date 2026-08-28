/**
 * Classificação automática de um equipamento num "tipo" (EquipmentPriceTier)
 * a partir da descrição textual (ex.: "NOTEBOOK CORE I5-1135G7 8GB SSD 256GB
 * DELL VOSTRO 15 3500"), usada tanto pelo importador de extrato de locação
 * quanto pelo cadastro manual de ativos, para preencher `Asset.priceTierId`.
 *
 * Formato de `keywords` de um tier: array onde cada item é obrigatório (E
 * lógico) — a descrição precisa conter TODOS os itens para o tier casar.
 * Dentro de um item, "A|B|C" funciona como OU (a descrição precisa conter
 * pelo menos uma das alternativas separadas por "|").
 *
 * Exemplo: tier "Notebook Core Ultra 7 Gamer" com
 * keywords = ["CORE ULTRA 7", "GTX|RTX|V-"] casa uma descrição que contenha
 * "CORE ULTRA 7" E (também contenha "GTX" OU "RTX" OU "V-").
 *
 * A ordem de avaliação é `sortOrder` crescente — regras mais específicas
 * (como a variante "Gamer", que tem uma condição a mais) devem vir com
 * `sortOrder` menor para serem testadas antes da regra genérica, já que a
 * primeira que casar "vence".
 */
export interface ClassifiableTier {
  id: string;
  keywords: string[];
  sortOrder: number;
}

function keywordMatches(descriptionUpper: string, keyword: string): boolean {
  const alternatives = keyword.toUpperCase().split('|');
  return alternatives.some((alt) => descriptionUpper.includes(alt.trim()));
}

export function classifyEquipmentTier<T extends ClassifiableTier>(
  description: string,
  tiers: T[],
): T | null {
  if (!description) return null;
  const descriptionUpper = description.toUpperCase();
  const ordered = [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const tier of ordered) {
    if (tier.keywords.length === 0) continue;
    if (tier.keywords.every((kw) => keywordMatches(descriptionUpper, kw))) {
      return tier;
    }
  }
  return null;
}
