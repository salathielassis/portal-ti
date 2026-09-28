/**
 * Lista duplicidades que JÁ EXISTEM no banco (o sistema passou a bloquear
 * novas, mas cadastros antigos podem ter entrado antes):
 *   - ativos com o mesmo nº de série ou tombo ignorando maiúsculas/espaços;
 *   - obras do mesmo cliente com o mesmo nome/classificação (sem acento,
 *     espaço ou maiúsculas), em qualquer CNPJ.
 *
 * Só consulta — não altera nada. Obras duplicadas se resolvem com "Mesclar"
 * em Clientes e Obras; ativos duplicados, corrigindo/excluindo na tela de
 * Ativos.
 *
 *   cd backend
 *   npm run check-duplicates
 */
import { PrismaClient } from '@prisma/client';
import { normalizeAssetTag, normalizeSerial } from '../src/common/utils/asset-identifiers';
import { normalizeObraLabel } from '../src/common/utils/obra-matching';

const prisma = new PrismaClient();

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

async function main() {
  let problems = 0;

  const assets = await prisma.asset.findMany({ select: { id: true, assetTag: true, serialNumber: true, status: true } });
  for (const [label, key] of [
    ['nº de série', (a: (typeof assets)[number]) => normalizeSerial(a.serialNumber)],
    ['tombo', (a: (typeof assets)[number]) => normalizeAssetTag(a.assetTag)],
  ] as const) {
    for (const group of groupBy(assets, key)) {
      problems++;
      console.log(`Ativos com o mesmo ${label}: ${group.map((a) => `${a.assetTag}/${a.serialNumber} (${a.status})`).join('  ×  ')}`);
    }
  }

  const obras = await prisma.obra.findMany({ include: { site: { include: { client: true } } } });
  // groupBy descarta grupos de 1 — cliente com uma obra só não tem o que comparar.
  const byClient = groupBy(obras, (o) => o.site.clientId);
  for (const clientObras of byClient) {
    const seen = new Map<string, (typeof obras)[number]>();
    for (const obra of clientObras) {
      for (const label of new Set([obra.name, obra.costCenterLabel, ...obra.aliases].map(normalizeObraLabel))) {
        if (!label) continue;
        const other = seen.get(label);
        if (other && other.id !== obra.id) {
          problems++;
          console.log(
            `Obras duplicadas em ${obra.site.client.name}: "${other.name}" (CNPJ ${other.site.cnpj}) × "${obra.name}" (CNPJ ${obra.site.cnpj}) — ambas respondem por "${label}"`,
          );
        } else {
          seen.set(label, obra);
        }
      }
    }
  }

  console.log(problems ? `\n${problems} duplicidade(s) encontrada(s).` : 'Nenhuma duplicidade de ativo (série/tombo) nem de obra.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
