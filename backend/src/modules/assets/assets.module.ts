import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EquipmentPricingModule } from '../equipment-pricing/equipment-pricing.module';

@Module({
  imports: [PrismaModule, EquipmentPricingModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
