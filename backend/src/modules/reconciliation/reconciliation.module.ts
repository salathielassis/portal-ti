import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { BankStatementParserService } from './parsers/bank-statement-parser.service';
import { ReconciliationMatchingService } from './matching/reconciliation-matching.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    MulterModule.register({
      // memoryStorage é obrigatório aqui: o parser (pdf-parse) e o StorageService
      // leem `file.buffer` em memória. Para extratos muito grandes, trocar por
      // diskStorage + leitura em stream.
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB por extrato
    }),
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, BankStatementParserService, ReconciliationMatchingService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
