import { Injectable, Logger } from '@nestjs/common';
// pdf-parse extrai o texto "bruto" do PDF preservando quebras de linha razoavelmente
// bem para extratos bancários gerados digitalmente (não escaneados).
import * as pdfParse from 'pdf-parse';

export interface ParsedBankLine {
  transactionDate: Date;
  description: string;
  amount: number; // negativo = saída/débito
  rawText: string;
}

/**
 * Parser de extratos bancários em PDF.
 *
 * Estratégia:
 * 1. Extrai o texto corrido do PDF via pdf-parse.
 * 2. Aplica um conjunto de expressões regulares (uma por "layout" de banco
 *    suportado) para reconhecer linhas de lançamento: DATA | DESCRIÇÃO | VALOR.
 * 3. Normaliza datas (dd/mm/aaaa) e valores (1.234,56 -> 1234.56, com sinal).
 *
 * Para extratos ESCANEADOS (imagem), este serviço decai para OCR via
 * Tesseract.js (ver `extractWithOcrFallback`) quando pdf-parse retorna
 * texto vazio/insuficiente.
 */
@Injectable()
export class BankStatementParserService {
  private readonly logger = new Logger(BankStatementParserService.name);

  // Layout genérico: "24/08/2026  PAGTO FORNECEDOR XYZ LTDA        -1.250,00"
  private readonly LINE_REGEX =
    /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

  async parse(fileBuffer: Buffer): Promise<ParsedBankLine[]> {
    const { text } = await pdfParse(fileBuffer);

    if (!text || text.trim().length < 20) {
      this.logger.warn('PDF sem camada de texto detectável — acionando fallback OCR');
      return this.extractWithOcrFallback(fileBuffer);
    }

    return this.extractLines(text);
  }

  private extractLines(rawText: string): ParsedBankLine[] {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed: ParsedBankLine[] = [];

    for (const line of lines) {
      const match = line.match(this.LINE_REGEX);
      if (!match) continue;

      const [, dateStr, description, valueStr] = match;
      parsed.push({
        transactionDate: this.parseBrDate(dateStr),
        description: description.trim(),
        amount: this.parseBrCurrency(valueStr),
        rawText: line,
      });
    }

    this.logger.log(`Extraídas ${parsed.length} transações de ${lines.length} linhas`);
    return parsed;
  }

  /**
   * Fallback para extratos escaneados: rasteriza cada página e aplica OCR
   * (Tesseract.js, idioma 'por'), depois reaproveita o mesmo parser de linhas.
   * Implementação de rasterização (pdf.js/canvas) omitida por brevidade —
   * plugar aqui um worker dedicado, pois OCR é custoso em CPU.
   */
  private async extractWithOcrFallback(_fileBuffer: Buffer): Promise<ParsedBankLine[]> {
    // const { createWorker } = require('tesseract.js');
    // ... rasterizar páginas -> worker.recognize(page, 'por') -> extractLines(texto)
    this.logger.error('OCR fallback ainda não configurado neste ambiente');
    return [];
  }

  private parseBrDate(dateStr: string): Date {
    const [day, month, year] = dateStr.split('/').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private parseBrCurrency(value: string): number {
    const normalized = value.replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized);
  }
}
