import { Module } from '@nestjs/common';
import { EquipmentPricingController } from './equipment-pricing.controller';
import { EquipmentPricingService } from './equipment-pricing.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EquipmentPricingController],
  providers: [EquipmentPricingService],
  exports: [EquipmentPricingService],
})
export class EquipmentPricingModule {}
