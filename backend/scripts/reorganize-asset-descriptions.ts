/**
 * Reorganiza ativos que ficaram com a descrição inteira da locadora no campo
 * "modelo" (ex.: "NOTEBOOK CORE I5-1135G7 8GB SSD 256GB DELL VOSTRO 15 3500")
 * — era o que as importações de extrato/guia de entrega faziam até a
 * separação automática em marca / modelo / processador / RAM /
 * armazenamento / placa de vídeo.
 *
 * Só mexe em ativos cujo modelo ainda contém processador, memória ou
 * armazenamento reconhecíveis (ou seja, nunca foram arrumados à mão). Os
 * campos de especificação que você já preencheu manualmente têm prioridade
 * sobre o que for extraído da descrição. A descrição original fica guardada
 * em specs.raw.
 *
 * Por padrão só MOSTRA o que mudaria (simulação). Para gravar, passe --apply:
 *   cd backend
 *   npm run reorganize-asset-descriptions             # simulação
 *   npm run reorganize-asset-descriptions -- --apply  # grava
 *
 * Seguro de rodar mais de uma vez: depois de arrumado, o modelo não contém
 * mais CPU/RAM/SSD e o ativo é ignorado.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  buildSpecsFromDescription,
  parseEquipmentDescription,
} from '../src/common/utils/parse-equipment-description';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const assets = await prisma.asset.findMany({ orderBy: { assetTag: 'asc' } });
  let changed = 0;

  for (const asset of assets) {
    const parsed = parseEquipmentDescription(asset.model);
    if (!parsed.cpu && !parsed.ram && !parsed.storage && !parsed.gpu) continue;

    const currentSpecs = (asset.specs as Record<string, unknown> | null) ?? {};
    const raw = typeof currentSpecs.raw === 'string' && currentSpecs.raw ? currentSpecs.raw : asset.model;
    // O que já estava preenchido (à mão) vence o que foi extraído do texto.
    const specs = { ...buildSpecsFromDescription(parsed, raw), ...currentSpecs };
    const brand = asset.brand === 'NÃO INFORMADA' && parsed.brand !== 'NÃO INFORMADA' ? parsed.brand : asset.brand;

    changed++;
    console.log(
      `${asset.assetTag.padEnd(14)} "${asset.model}"\n` +
        `${' '.repeat(14)} -> marca "${brand}" · modelo "${parsed.model}" · CPU ${specs.cpu ?? '—'} · RAM ${specs.ram ?? '—'} · ` +
        `armaz. ${specs.storage ?? '—'} · vídeo ${specs.gpu ?? '—'}`,
    );

    if (APPLY) {
      await prisma.asset.update({
        where: { id: asset.id },
        data: { brand, model: parsed.model, specs: specs as Prisma.InputJsonValue },
      });
    }
  }

  console.log(
    `\n${changed} ativo(s) ${APPLY ? 'reorganizado(s)' : 'seriam reorganizados'} de ${assets.length}.` +
      (APPLY || changed === 0 ? '' : ' Rode de novo com --apply para gravar.'),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
