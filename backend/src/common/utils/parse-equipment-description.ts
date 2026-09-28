import { AssetType } from '@prisma/client';
import { detectAssetType, detectBrand } from './detect-asset-metadata';

/**
 * Quebra a descrição livre que a locadora manda (extrato / guia de entrega),
 * ex.: "NOTEBOOK CORE I5-1135G7 8GB SSD 256GB DELL VOSTRO 15 3500", nos
 * campos estruturados do Asset — antes a descrição inteira ia parar em
 * `model`, e a coluna Modelo da tela de Ativos ficava com marca + CPU + RAM +
 * SSD tudo junto.
 *
 * Heurística por regex (não há padrão fixo no texto da locadora): o que for
 * reconhecido como processador / memória / armazenamento / placa de vídeo /
 * marca é retirado, e o que sobra vira o modelo. Se sobrar nada, o modelo
 * cai para a descrição original — nunca fica vazio.
 */
export interface ParsedEquipmentDescription {
  type: AssetType;
  brand: string;
  model: string;
  cpu: string | null;
  ram: string | null;
  storage: string | null;
  gpu: string | null;
}

// Todos os padrões são case-insensitive: a locadora manda em MAIÚSCULAS,
// mas o mesmo parser roda sobre modelos digitados à mão ("Avell A70 i7") e
// o texto que sobra como modelo mantém a grafia original.
const CPU_PATTERNS: RegExp[] = [
  /\b(?:INTEL\s+)?CORE\s+ULTRA\s*[3579](?:[\s-]+\d{3}[A-Z]{0,2})?\b/i,
  /\bULTRA\s*[3579][\s-]+\d{3}[A-Z]{0,2}\b/i,
  // "[I1L|]": o OCR da guia de entrega costuma ler o "i" de "i7" como "1"
  // ("CORE 17-1355U") — corrigido para "I" em `fixOcrCpu`.
  /\b(?:INTEL\s+)?CORE\s*[I1L|]\s?[3579](?:[\s-]+\d{4,5}[A-Z]{0,2}\d?)?\b/i,
  /\bI[3579]-\d{4,5}[A-Z]{0,2}\d?\b/i,
  /\b(?:AMD\s+)?RYZEN\s*[3579](?:\s+PRO)?(?:[\s-]+\d{4}[A-Z]{0,2})?\b/i,
  /\b(?:INTEL\s+)?(?:CELERON|PENTIUM)(?:\s+(?:GOLD|SILVER))?(?:[\s-]+[A-Z]?\d{4}[A-Z]?)?\b/i,
  /\b(?:INTEL\s+)?XEON(?:\s+[A-Z]-?\d{4}[A-Z]?(?:\s*V\d)?)?\b/i,
  /\bAPPLE\s+M[1-4](?:\s+(?:PRO|MAX))?\b/i,
  // Por último, "i7" solto no meio do nome (ex.: "Avell B.On Lite i7").
  /\bI[3579]\b(?!-)/i,
];

const GPU_PATTERNS: RegExp[] = [
  /\b(?:NVIDIA\s+)?(?:GEFORCE\s+)?(?:RTX|GTX)\s*A?\d{3,4}(?:\s*(?:TI|SUPER))?(?:\s*(?:COM\s*)?\d{1,2}\s?GB)?\b/i,
  /\b(?:NVIDIA\s+)?(?:GEFORCE\s+)?MX\s*\d{3}(?:\s*\d{1,2}\s?GB)?\b/i,
  /\b(?:NVIDIA\s+)?QUADRO\s+[A-Z]?\d{3,4}(?:\s*\d{1,2}\s?GB)?\b/i,
  /\bNVIDIA\s+[TAP]\d{3,4}(?:\s*\d{1,2}\s?GB)?\b/i,
  /\b(?:AMD\s+)?RADEON(?:\s+(?:RX|PRO|VEGA))?\s*[A-Z]?\d{2,4}[A-Z]?(?:\s*\d{1,2}\s?GB)?\b/i,
  /\bINTEL\s+ARC\s+[A-Z]?\d{3,4}[A-Z]?(?:\s*\d{1,2}\s?GB)?\b/i,
  /\b(?:PLACA\s+DE\s+)?V[IÍ]DEO(?:\s+DEDICAD[AO])?\s*(?:DE\s*)?\d{1,2}\s?GB\b/i,
  /\bV-\s?\d{1,2}\s?GB\b/i,
];

const STORAGE_PATTERNS: RegExp[] = [
  /\b(?:SSD|NVME|HDD|HD|M\.2)(?:\s+(?:NVME|M\.2|SATA))?\s*(?:DE\s*)?\d+(?:[.,]\d+)?\s?(?:GB|TB|G|T)\b/i,
  /\b\d+(?:[.,]\d+)?\s?(?:GB|TB)\s*(?:SSD|NVME|HDD|HD|M\.2)\b/i,
];

const RAM_PATTERNS: RegExp[] = [
  /\b(?:MEM(?:[OÓ]RIA)?|RAM)\s*(?:DE\s*)?\d{1,3}\s?GB(?:\s*(?:DDR\d|RAM))?\b/i,
  /\b\d{1,3}\s?GB(?:\s*(?:DE\s*)?(?:RAM|MEM(?:[OÓ]RIA)?|DDR\d))?\b/i,
];

/** Palavras que não fazem parte do modelo e que sobram depois de retirar os campos. */
const NOISE_PATTERNS: RegExp[] = [
  /\bNOTE?BOOK\b/gi,
  /\bLAPTOP\b/gi,
  /\bIMPRESSORA\b/gi,
  /\bMONITOR\b/gi,
  /\bDESKTOP\b/gi,
  /\bINTEL\b/gi,
  /\bAMD\b/gi,
  /\bNVIDIA\b/gi,
  /\bDDR\d\b/gi,
  /\bW(?:IN(?:DOWS)?)?\s*1[01](?:\s*(?:PRO|HOME))?\b/gi,
  /\bTELA\s*\d{2}(?:[.,]\d)?\s*(?:"|POL(?:EGADAS)?)?/gi,
  // "T15" / "T-15" / "T15.6" = tela de 15" na descrição da locadora.
  /\bT-?1[1-7](?:[.,]\d)?\b/gi,
  /\b\d{2}(?:[.,]\d)?\s*(?:"|POL(?:EGADAS)?)\B/gi,
  /\bCOM\b/gi,
  /\bDE\b/gi,
];

function clean(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;/+-]+|[\s,;/+-]+$/g, '')
    .trim();
}

/** Retira o primeiro trecho que casar com algum dos padrões e devolve [trecho, resto]. */
function extract(text: string, patterns: RegExp[]): [string | null, string] {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[0].trim()) {
      const idx = match.index ?? text.indexOf(match[0]);
      return [clean(match[0]), `${text.slice(0, idx)} ${text.slice(idx + match[0].length)}`];
    }
  }
  return [null, text];
}

function normalizeCapacity(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/(\d)\s+(GB|TB)\b/gi, '$1$2');
}

/** "CORE 17-1355U" (OCR) -> "CORE I7-1355U". */
function fixOcrCpu(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\b(CORE\s*)[1L|]\s?([3579])/i, '$1I$2');
}

export function parseEquipmentDescription(description: string): ParsedEquipmentDescription {
  const original = clean(description || '');
  const type = detectAssetType(original);
  const detectedBrand = detectBrand(original);

  let rest = ` ${original} `;
  let cpu: string | null;
  let gpu: string | null;
  let storage: string | null;
  let ram: string | null;

  // Ordem importa: GPU e armazenamento antes da RAM, porque os três usam
  // "NN GB" e a RAM é o "GB" que sobra sozinho.
  [cpu, rest] = extract(rest, CPU_PATTERNS);
  [gpu, rest] = extract(rest, GPU_PATTERNS);
  [storage, rest] = extract(rest, STORAGE_PATTERNS);
  [ram, rest] = extract(rest, RAM_PATTERNS);

  if (detectedBrand !== 'NÃO INFORMADA') {
    rest = rest.replace(new RegExp(`\\b${detectedBrand}\\b`, 'gi'), ' ');
  }
  for (const noise of NOISE_PATTERNS) rest = rest.replace(noise, ' ');

  const model = clean(rest) || original;

  return {
    type,
    brand: detectedBrand,
    model,
    cpu: fixOcrCpu(cpu),
    ram: normalizeCapacity(ram?.replace(/\b(?:MEM(?:[OÓ]RIA)?|RAM|DE)\b/gi, '').trim() ?? null),
    storage: normalizeCapacity(storage),
    gpu: normalizeCapacity(gpu),
  };
}

/** Monta o JSON `specs` do Asset só com as chaves reconhecidas, preservando a descrição original em `raw`. */
export function buildSpecsFromDescription(
  parsed: ParsedEquipmentDescription,
  raw: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(parsed.cpu && { cpu: parsed.cpu }),
    ...(parsed.ram && { ram: parsed.ram }),
    ...(parsed.storage && { storage: parsed.storage }),
    ...(parsed.gpu && { gpu: parsed.gpu }),
    raw,
    ...extra,
  };
}
