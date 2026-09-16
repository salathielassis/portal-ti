import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DeliveryImportController } from './delivery-import.controller';
import { DeliveryImportService } from './delivery-import.service';
import { DeliveryNoteOcrService } from './ocr/delivery-note-ocr.service';
import { PageOrientationService } from './ocr/page-orientation.service';
import { DeliveryNoteParserService } from './parsers/delivery-note-parser.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../common/storage/storage.module';
import { PdfModule } from '../../common/pdf/pdf.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    PdfModule,
    MulterModule.register({
      // memoryStorage é obrigatório: o pipeline de OCR lê `file.buffer` em memória.
      storage: memoryStorage(),
      limits: { fileSize: 30 * 1024 * 1024 }, // 30MB — PDFs escaneados são maiores que o extrato mensal (texto puro)
    }),
  ],
  controllers: [DeliveryImportController],
  providers: [DeliveryImportService, DeliveryNoteOcrService, PageOrientationService, DeliveryNoteParserService],
})
export class DeliveryImportModule {}
