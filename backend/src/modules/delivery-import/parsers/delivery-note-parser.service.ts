import { Injectable } from '@nestjs/common';
import { OcrPage } from '../ocr/delivery-note-ocr.service';

/** CNPJ fixo da locadora — usado para diferenciar o CNPJ do fornecedor do CNPJ do cliente no texto OCR. */
export const LOCAINFO_CNPJ = '04999366000177';
export const LOCAINFO_NAME = 'LOCAiNFO';

/** Formato observado no documento: `<SERVICE TAG DELL, 7 alfanuméricos>/<TOMBO, dígitos>`. */
const SERIAL_PATTERN = /^([A-Z0-9]{7})\/(\d{3,6})$/;

export interface ParsedDeliverySerial {
  /** Texto bruto lido (antes de normalizar), útil para o usuário conferir contra o original. */
  raw: string;
  serviceTag: string;
  assetTag: string;
  valid: boolean;
  flagReason: string | null;
}

export interface ParsedDeliveryItem {
  referencia: string | null;
  codigo: string | null;
  description: string;
  quantity: number | null;
  serials: ParsedDeliverySerial[];
}

export interface ParsedDeliveryHeader {
  requisitionNumber: string | null;
  supplierName: string;
  supplierCnpj: string;
  clientName: string | null;
  clientCnpj: string | null;
  /** Campo "Nome do Site" do rodapé — é o que identifica a Obra de destino, não a "CLASSIFICAÇÃO". */
  siteName: string | null;
  deliveryAddress: string | null;
  declaredPieceCount: number | null;
}

export interface ParsedDeliveryNote {
  header: ParsedDeliveryHeader;
  items: ParsedDeliveryItem[];
  warnings: string[];
}

function normalizeLine(line: string): string {
  return line.trim();
}

/** Confusões clássicas de OCR entre dígito e letra parecida, aplicadas só quando o valor não é um número puro. */
const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', Z: '2', S: '5', B: '8', I: '1', L: '1', G: '6' };

function normalizeQuantity(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  const fixed = raw
    .toUpperCase()
    .split('')
    .map((ch) => DIGIT_LOOKALIKES[ch] ?? ch)
    .join('');
  return /^\d+$/.test(fixed) ? Number.parseInt(fixed, 10) : null;
}

/** Remove espaços internos que o OCR às vezes insere no meio de um token (ex.: "6Y DNYM4" -> "6YDNYM4"). */
function tightenToken(token: string): string {
  return token.replace(/\s+/g, '').toUpperCase();
}

function parseSerialToken(raw: string): ParsedDeliverySerial {
  const tightened = tightenToken(raw);
  const match = tightened.match(SERIAL_PATTERN);
  if (match) {
    return { raw, serviceTag: match[1], assetTag: match[2], valid: true, flagReason: null };
  }
  // Tenta separar mesmo fora do formato esperado, pra pelo menos pré-preencher os campos editáveis.
  const [serviceTag = '', assetTag = ''] = tightened.split('/');
  return {
    raw,
    serviceTag,
    assetTag,
    valid: false,
    flagReason: 'Formato inesperado (esperado: 7 caracteres + "/" + número do tombo) — confira contra a nota original.',
  };
}

// Quantidade como [A-Z0-9]: o OCR ocasionalmente lê um dígito de 1 caractere
// como letra parecida (ex.: "2" -> "Z") — normalizeQuantity() tenta corrigir.
const ITEM_LINE = /^(\d{3,6})\s+([A-Z0-9-]{5,20})\s+(.+?)\s+UN\s+([A-Z0-9]{1,3})\s*$/i;
const COM_ESTOQUE_LINE = /^COM\.?\s*:?\s*ESTOQUE/i;
const SERIAIS_LINE = /^SERIAIS\s*:?\s*(.*)$/i;
const TABLE_HEADER_LINE = /REFER[EÊ]NCIA/i;
const QUANTIDADE_LINE = /QUANTIDADE DE PE[CÇ]AS\s*:?\s*(\d+)/i;
/** Heurística pra reconhecer uma linha de CONTINUAÇÃO de seriais (sem o prefixo "SERIAIS:") — vírgula + barra são a assinatura do formato. */
const LOOKS_LIKE_SERIAL_CONTINUATION = /^[A-Z0-9\s,/]+$/i;

@Injectable()
export class DeliveryNoteParserService {
  parse(pages: OcrPage[]): ParsedDeliveryNote {
    const warnings: string[] = [];
    pages.forEach((p) => {
      if (p.orientationUncertain) {
        warnings.push(
          `Não foi possível confirmar com segurança a orientação da página ${p.pageNumber} do PDF — confira os dados dessa página com atenção redobrada.`,
        );
      }
    });

    const combinedText = pages.map((p) => p.text).join('\n');
    const header = this.parseHeader(combinedText, warnings);
    const items = this.parseItems(combinedText, warnings);

    if (items.length === 0) {
      warnings.push('Nenhum item de equipamento foi reconhecido nesta guia — confira o PDF manualmente.');
    }

    const totalSerials = items.reduce((acc, i) => acc + i.serials.length, 0);
    if (header.declaredPieceCount !== null && header.declaredPieceCount !== totalSerials) {
      warnings.push(
        `A guia declara "QUANTIDADE DE PEÇAS: ${header.declaredPieceCount}", mas foram lidos ${totalSerials} número(s) de série no total — confira se algum item não foi reconhecido.`,
      );
    }
    for (const item of items) {
      if (item.quantity !== null && item.quantity !== item.serials.length) {
        warnings.push(
          `Item "${item.description}" declara quantidade ${item.quantity}, mas foram lidos ${item.serials.length} número(s) de série para ele.`,
        );
      }
      for (const serial of item.serials) {
        if (!serial.valid) {
          warnings.push(`Número de série "${serial.raw}" (item "${item.description}") ${serial.flagReason}`);
        }
      }
    }

    return { header, items, warnings };
  }

  private parseHeader(text: string, warnings: string[]): ParsedDeliveryHeader {
    const requisitionMatch = text.match(/REQUISI[CÇ][AÃ]O\s*:?\s*([A-Z0-9]+)/i);
    const clientNameMatch = text.match(/CLIENTE\s*:\s*\d+\s+(.+)/i);
    const siteMatch = text.match(/Nome do Site\s*:\s*([\s\S]+?)\s+Local de Entrega\s*:\s*([\s\S]+?)(?:\n\s*\n|$)/i);
    const quantidadeMatch = text.match(QUANTIDADE_LINE);

    const cnpjMatches = [...text.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)].map((m) => m[0].replace(/\D/g, ''));
    const clientCnpj = cnpjMatches.find((c) => c !== LOCAINFO_CNPJ) ?? null;

    if (!clientCnpj) warnings.push('Não foi possível ler o CNPJ do cliente/filial nesta guia.');
    if (!siteMatch) {
      warnings.push(
        'Não foi possível ler o campo "Nome do Site" (rodapé "OBSERVAÇÕES ADICIONAIS") — é esse campo que indica a obra de destino. Preencha manualmente antes de confirmar.',
      );
    }

    return {
      requisitionNumber: requisitionMatch?.[1]?.trim() ?? null,
      supplierName: LOCAINFO_NAME,
      supplierCnpj: LOCAINFO_CNPJ,
      clientName: clientNameMatch?.[1]?.trim() ?? null,
      clientCnpj,
      siteName: siteMatch?.[1]?.trim() ?? null,
      deliveryAddress: siteMatch?.[2]?.trim().replace(/\s+/g, ' ') ?? null,
      declaredPieceCount: quantidadeMatch ? Number.parseInt(quantidadeMatch[1], 10) : null,
    };
  }

  private parseItems(text: string, warnings: string[]): ParsedDeliveryItem[] {
    const lines = text.split('\n').map(normalizeLine).filter(Boolean);
    const items: ParsedDeliveryItem[] = [];
    let insideTable = false;
    let expectingSerialContinuation = false;

    for (const line of lines) {
      if (TABLE_HEADER_LINE.test(line) && /QTDE/i.test(line)) {
        insideTable = true;
        continue;
      }
      if (!insideTable) continue;

      const quantidadeMatch = line.match(QUANTIDADE_LINE);
      if (quantidadeMatch) {
        insideTable = false;
        expectingSerialContinuation = false;
        continue;
      }

      const itemMatch = line.match(ITEM_LINE);
      if (itemMatch) {
        const [, referencia, codigo, description, rawQuantity] = itemMatch;
        const quantity = normalizeQuantity(rawQuantity);
        if (quantity === null) {
          warnings.push(
            `Quantidade "${rawQuantity}" do item "${description.trim()}" não pôde ser lida como número — confira manualmente.`,
          );
        }
        items.push({
          referencia,
          codigo,
          description: description.trim(),
          quantity,
          serials: [],
        });
        expectingSerialContinuation = false;
        continue;
      }

      if (COM_ESTOQUE_LINE.test(line)) {
        continue;
      }

      const seriaisMatch = line.match(SERIAIS_LINE);
      if (seriaisMatch) {
        this.appendSerials(items, seriaisMatch[1], warnings);
        expectingSerialContinuation = true;
        continue;
      }

      if (expectingSerialContinuation && LOOKS_LIKE_SERIAL_CONTINUATION.test(line) && line.includes('/')) {
        this.appendSerials(items, line, warnings);
        continue;
      }

      // Linha que não é item/seriais/marcador conhecido — encerra a continuação de seriais em curso.
      expectingSerialContinuation = false;
    }

    return items;
  }

  private appendSerials(items: ParsedDeliveryItem[], rawSegment: string, warnings: string[]): void {
    let currentItem = items[items.length - 1];
    if (!currentItem) {
      // Nunca descarta seriais lidos — mesmo sem conseguir casar a linha do
      // produto (ex.: OCR bagunçou a linha de código/quantidade), cria um
      // item "placeholder" editável na tela em vez de perder os equipamentos.
      warnings.push(
        `Números de série lidos sem conseguir identificar a linha do produto correspondente: "${rawSegment.trim()}" — descrição/quantidade deste item precisam ser preenchidas manualmente.`,
      );
      currentItem = { referencia: null, codigo: null, description: '(item não reconhecido — preencha manualmente)', quantity: null, serials: [] };
      items.push(currentItem);
    }
    const tokens = rawSegment
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const token of tokens) {
      currentItem.serials.push(parseSerialToken(token));
    }
  }
}
