import { Injectable } from '@nestjs/common';
import { Invoice } from '@prisma/client';
import { ParsedBankLine } from '../parsers/bank-statement-parser.service';

export interface MatchCandidate {
  invoice: Invoice;
  confidenceScore: number; // 0-100
  valueDelta: number;
  matchType: 'AUTOMATICO' | 'SUGERIDO';
}

/**
 * Motor de matching entre transações bancárias e faturas em aberto.
 *
 * Regras de pontuação (score 0-100):
 *  - Valor exatamente igual (tolerância de R$ 0,05):      +60 pts
 *  - Valor dentro de 2% de diferença (multas/juros):       +35 pts
 *  - Data da transação dentro da janela [dueDate-5, dueDate+10]: +25 pts
 *  - Data fora da janela mas no mesmo mês de referência:   +10 pts
 *  - Descrição do lançamento contém nome/CNPJ do fornecedor: +15 pts
 *
 * >= 85 pts  -> match AUTOMÁTICO (aplicado direto, fica como CONFIRMADO)
 * 50-84 pts  -> match SUGERIDO (fica PENDENTE_REVISAO para o Financeiro confirmar)
 * < 50 pts   -> não é sugerido, transação fica "não conciliada"
 */
@Injectable()
export class ReconciliationMatchingService {
  private static readonly AUTO_THRESHOLD = 85;
  private static readonly SUGGEST_THRESHOLD = 50;
  private static readonly VALUE_EXACT_TOLERANCE = 0.05;
  private static readonly VALUE_PERCENT_TOLERANCE = 0.02;

  /**
   * Para uma transação bancária, retorna a melhor fatura candidata (se houver)
   * dentre a lista de faturas pendentes fornecida.
   */
  findBestMatch(
    transaction: ParsedBankLine,
    openInvoices: Array<Invoice & { supplierName: string; supplierDoc: string }>,
  ): MatchCandidate | null {
    // Só avaliamos saídas (débitos) — extrato bancário representa dinheiro saindo
    if (transaction.amount >= 0) return null;

    const paidAmount = Math.abs(transaction.amount);
    let best: MatchCandidate | null = null;

    for (const invoice of openInvoices) {
      const score = this.score(transaction, paidAmount, invoice);
      if (score <= 0) continue;

      if (!best || score > best.confidenceScore) {
        best = {
          invoice,
          confidenceScore: score,
          valueDelta: Number((paidAmount - Number(invoice.grossValue)).toFixed(2)),
          matchType:
            score >= ReconciliationMatchingService.AUTO_THRESHOLD ? 'AUTOMATICO' : 'SUGERIDO',
        };
      }
    }

    if (best && best.confidenceScore < ReconciliationMatchingService.SUGGEST_THRESHOLD) {
      return null;
    }
    return best;
  }

  private score(
    transaction: ParsedBankLine,
    paidAmount: number,
    invoice: Invoice & { supplierName: string; supplierDoc: string },
  ): number {
    let score = 0;
    const invoiceValue = Number(invoice.grossValue);

    // --- Valor ---
    const absoluteDelta = Math.abs(paidAmount - invoiceValue);
    if (absoluteDelta <= ReconciliationMatchingService.VALUE_EXACT_TOLERANCE) {
      score += 60;
    } else if (absoluteDelta / invoiceValue <= ReconciliationMatchingService.VALUE_PERCENT_TOLERANCE) {
      score += 35;
    } else {
      // valor muito discrepante: ainda pode ser a fatura certa (pagamento parcial
      // ou com multa alta), mas penalizamos fortemente
      return 0;
    }

    // --- Data ---
    const dueDate = new Date(invoice.dueDate);
    const windowStart = new Date(dueDate);
    windowStart.setDate(windowStart.getDate() - 5);
    const windowEnd = new Date(dueDate);
    windowEnd.setDate(windowEnd.getDate() + 10);

    if (transaction.transactionDate >= windowStart && transaction.transactionDate <= windowEnd) {
      score += 25;
    } else if (this.sameMonth(transaction.transactionDate, new Date(invoice.referenceMonth))) {
      score += 10;
    }

    // --- Descrição / fornecedor ---
    const descNormalized = this.normalize(transaction.description);
    if (
      descNormalized.includes(this.normalize(invoice.supplierName)) ||
      descNormalized.includes(invoice.supplierDoc.replace(/\D/g, ''))
    ) {
      score += 15;
    }

    return Math.min(score, 100);
  }

  private sameMonth(a: Date, b: Date): boolean {
    return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .trim();
  }
}
