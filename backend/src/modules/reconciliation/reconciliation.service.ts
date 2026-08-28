import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { BankStatementParserService } from './parsers/bank-statement-parser.service';
import { ReconciliationMatchingService } from './matching/reconciliation-matching.service';
import { UploadStatementDto } from './dto/upload-statement.dto';
import { ConfirmMatchDto, MatchDecision, ManualMatchDto } from './dto/confirm-match.dto';
import { InvoiceStatus, MatchStatus, ReconciliationStatus } from '@prisma/client';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly parser: BankStatementParserService,
    private readonly matcher: ReconciliationMatchingService,
  ) {}

  /**
   * Fluxo principal do Módulo C: recebe o PDF do extrato, extrai as transações,
   * busca faturas em aberto no período e tenta o match automático/sugerido.
   */
  async processStatementUpload(
    file: Express.Multer.File,
    dto: UploadStatementDto,
    userId: string,
  ) {
    if (!file || file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Arquivo deve ser um PDF válido');
    }

    const fileUrl = await this.storage.save(file, 'statements');

    const reconciliation = await this.prisma.reconciliation.create({
      data: {
        referenceMonth: new Date(dto.referenceMonth),
        fileName: file.originalname,
        fileUrl,
        status: ReconciliationStatus.PROCESSANDO,
        reconciledById: userId,
      },
    });

    try {
      const parsedLines = await this.parser.parse(file.buffer);
      if (parsedLines.length === 0) {
        throw new BadRequestException(
          'Não foi possível extrair transações do PDF. Verifique o layout do extrato.',
        );
      }

      // Persiste todas as linhas extraídas primeiro (rastreabilidade total,
      // mesmo as que não derem match)
      await this.prisma.bankTransaction.createMany({
        data: parsedLines.map((line) => ({
          reconciliationId: reconciliation.id,
          transactionDate: line.transactionDate,
          description: line.description,
          rawText: line.rawText,
          amount: line.amount,
        })),
      });

      const matchedCount = await this.runMatchingEngine(reconciliation.id, dto.referenceMonth);

      return this.prisma.reconciliation.update({
        where: { id: reconciliation.id },
        data: {
          status: ReconciliationStatus.CONCLUIDA,
          totalTransactions: parsedLines.length,
          matchedCount,
        },
        include: { matches: { include: { invoice: true, bankTransaction: true } } },
      });
    } catch (err) {
      this.logger.error(`Falha ao processar conciliação ${reconciliation.id}`, err as Error);
      await this.prisma.reconciliation.update({
        where: { id: reconciliation.id },
        data: { status: ReconciliationStatus.ERRO },
      });
      throw err;
    }
  }

  /**
   * Roda o algoritmo de matching para todas as transações ainda não conciliadas
   * de uma sessão, contra as faturas PENDENTES do período de referência
   * (+/- 1 mês, para cobrir pagamentos antecipados/atrasados).
   */
  private async runMatchingEngine(reconciliationId: string, referenceMonth: string): Promise<number> {
    const transactions = await this.prisma.bankTransaction.findMany({
      where: { reconciliationId, matched: false },
    });

    const refDate = new Date(referenceMonth);
    const rangeStart = new Date(refDate);
    rangeStart.setMonth(rangeStart.getMonth() - 1);
    const rangeEnd = new Date(refDate);
    rangeEnd.setMonth(rangeEnd.getMonth() + 1);

    const openInvoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.PENDENTE, InvoiceStatus.VENCIDA] },
        referenceMonth: { gte: rangeStart, lte: rangeEnd },
      },
      include: { contract: { include: { supplier: true } } },
    });

    const invoicesWithSupplier = openInvoices.map((inv) => ({
      ...inv,
      supplierName: inv.contract.supplier.name,
      supplierDoc: inv.contract.supplier.cnpj,
    }));

    let matchedCount = 0;

    for (const tx of transactions) {
      const candidate = this.matcher.findBestMatch(
        {
          transactionDate: tx.transactionDate,
          description: tx.description,
          amount: Number(tx.amount),
          rawText: tx.rawText,
        },
        invoicesWithSupplier,
      );

      if (!candidate) continue;

      await this.prisma.$transaction([
        this.prisma.reconciliationMatch.create({
          data: {
            reconciliationId,
            bankTransactionId: tx.id,
            invoiceId: candidate.invoice.id,
            matchType: candidate.matchType,
            matchStatus:
              candidate.matchType === 'AUTOMATICO'
                ? MatchStatus.CONFIRMADO
                : MatchStatus.PENDENTE_REVISAO,
            confidenceScore: candidate.confidenceScore,
            valueDelta: candidate.valueDelta,
          },
        }),
        this.prisma.bankTransaction.update({
          where: { id: tx.id },
          data: { matched: true },
        }),
        // Se o match foi automático (alta confiança), já marca a fatura como conciliada
        ...(candidate.matchType === 'AUTOMATICO'
          ? [
              this.prisma.invoice.update({
                where: { id: candidate.invoice.id },
                data: { status: InvoiceStatus.CONCILIADA },
              }),
            ]
          : []),
      ]);

      matchedCount++;
    }

    return matchedCount;
  }

  /** Financeiro confirma ou rejeita um match SUGERIDO pendente de revisão */
  async confirmMatch(dto: ConfirmMatchDto) {
    const match = await this.prisma.reconciliationMatch.findUnique({
      where: { id: dto.matchId },
    });
    if (!match) throw new NotFoundException('Match não encontrado');

    const newStatus =
      dto.decision === MatchDecision.CONFIRMADO ? MatchStatus.CONFIRMADO : MatchStatus.REJEITADO;

    const updated = await this.prisma.reconciliationMatch.update({
      where: { id: dto.matchId },
      data: { matchStatus: newStatus },
    });

    if (dto.decision === MatchDecision.CONFIRMADO) {
      await this.prisma.invoice.update({
        where: { id: match.invoiceId },
        data: { status: InvoiceStatus.CONCILIADA },
      });
    } else {
      // Rejeitado: libera a transação para um novo match manual
      await this.prisma.bankTransaction.update({
        where: { id: match.bankTransactionId },
        data: { matched: false },
      });
    }

    return updated;
  }

  /** Match manual feito pelo usuário do Financeiro, para transações sem sugestão */
  async createManualMatch(dto: ManualMatchDto) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: dto.bankTransactionId },
    });
    if (!tx) throw new NotFoundException('Transação bancária não encontrada');

    const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
    if (!invoice) throw new NotFoundException('Fatura não encontrada');

    return this.prisma.$transaction(async (trx) => {
      const match = await trx.reconciliationMatch.create({
        data: {
          reconciliationId: tx.reconciliationId,
          bankTransactionId: tx.id,
          invoiceId: invoice.id,
          matchType: 'MANUAL',
          matchStatus: MatchStatus.CONFIRMADO,
          confidenceScore: 100,
          valueDelta: Number(tx.amount.toString()) + Number(invoice.grossValue.toString()),
        },
      });
      await trx.bankTransaction.update({ where: { id: tx.id }, data: { matched: true } });
      await trx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.CONCILIADA },
      });
      return match;
    });
  }

  async getReconciliationDetail(id: string) {
    const reconciliation = await this.prisma.reconciliation.findUnique({
      where: { id },
      include: {
        transactions: true,
        matches: { include: { invoice: true, bankTransaction: true } },
      },
    });
    if (!reconciliation) throw new NotFoundException('Conciliação não encontrada');
    return reconciliation;
  }

  async listReconciliations(page = 1, pageSize = 20) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.reconciliation.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reconciliation.count(),
    ]);
    return { items, total, page, pageSize };
  }
}
