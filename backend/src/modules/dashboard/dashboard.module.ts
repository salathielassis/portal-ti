import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AssetsModule } from '../assets/assets.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [PrismaModule, AssetsModule, FinanceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
