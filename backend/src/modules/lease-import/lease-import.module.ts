import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LeaseImportController } from './lease-import.controller';
import { LeaseImportService } from './lease-import.service';
import { LeaseStatementParserService } from './parsers/lease-statement-parser.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EquipmentPricingModule } from '../equipment-pricing/equipment-pricing.module';

@Module({
  imports: [
    PrismaModule,
    EquipmentPricingModule,
    MulterModule.register({
      // memoryStorage é obrigatório: o parser (pdf2json) lê `file.buffer` em memória.
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB por extrato
    }),
  ],
  controllers: [LeaseImportController],
  providers: [LeaseImportService, LeaseStatementParserService],
  exports: [LeaseImportService],
})
export class LeaseImportModule {}
