import { Obra, PrismaClient } from '@prisma/client';

/**
 * Normaliza um rótulo de obra para comparação: sem acento, maiúsculo, só
 * letras/números separados por um espaço. "Equip - Barro Alto/GO " e
 * "EQUIP  BARRO ALTO GO" viram a mesma chave. Antes a importação comparava
 * o texto exato da CLASSIFICAÇÃO, e qualquer diferença de espaço, acento ou
 * pontuação criava uma obra nova (duplicada).
 */
export function normalizeObraLabel(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** A obra responde por este rótulo? (classificação, nome ou um dos apelidos) */
export function obraMatchesLabel(obra: Pick<Obra, 'costCenterLabel' | 'name' | 'aliases'>, label: string): boolean {
  const key = normalizeObraLabel(label);
  if (!key) return false;
  return [obra.costCenterLabel, obra.name, ...(obra.aliases ?? [])].some((l) => normalizeObraLabel(l) === key);
}

/** Procura, dentro do estabelecimento (Site), a obra que responde por este rótulo. */
export async function findObraByLabel(
  prisma: Pick<PrismaClient, 'obra'>,
  siteId: string,
  label: string,
): Promise<Obra | null> {
  const obras = await prisma.obra.findMany({ where: { siteId }, orderBy: { createdAt: 'asc' } });
  // Prefere obra ativa quando houver mais de uma candidata (legado de duplicatas).
  const matches = obras.filter((o) => obraMatchesLabel(o, label));
  return matches.find((o) => o.active) ?? matches[0] ?? null;
}

/**
 * Procura em TODAS as obras do cliente (qualquer CNPJ) a que responde por
 * este rótulo. O usuário controla as obras pelo nome, então duas obras com
 * o mesmo nome no mesmo cliente são sempre duplicidade.
 */
export async function findObraByLabelInClient(
  prisma: Pick<PrismaClient, 'obra'>,
  clientId: string,
  label: string,
  excludeObraId?: string,
): Promise<Obra | null> {
  const obras = await prisma.obra.findMany({
    where: { site: { clientId }, ...(excludeObraId && { id: { not: excludeObraId } }) },
    orderBy: { createdAt: 'asc' },
  });
  const matches = obras.filter((o) => obraMatchesLabel(o, label));
  return matches.find((o) => o.active) ?? matches[0] ?? null;
}

/** Acrescenta um apelido à obra se ele ainda não for reconhecido por ela. */
export async function addObraAlias(prisma: Pick<PrismaClient, 'obra'>, obra: Obra, label: string): Promise<Obra> {
  if (!label.trim() || obraMatchesLabel(obra, label)) return obra;
  return prisma.obra.update({ where: { id: obra.id }, data: { aliases: { push: label.trim() } } });
}
