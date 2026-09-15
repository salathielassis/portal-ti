import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetsExportService } from './assets-export.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EquipmentPricingModule } from '../equipment-pricing/equipment-pricing.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    EquipmentPricingModule,
    StorageModule,
    MulterModule.register({
      // memoryStorage: o StorageService lê `file.buffer` para gravar em disco.
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB por anexo (foto/nota fiscal)
    }),
  ],
  controllers: [AssetsController],
  providers: [AssetsService, AssetsExportService],
  exports: [AssetsService],
})
export class AssetsModule {}
