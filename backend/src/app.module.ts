import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { AssetsModule } from './modules/assets/assets.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { ClientsModule } from './modules/clients/clients.module';
import { LeaseImportModule } from './modules/lease-import/lease-import.module';
import { EquipmentPricingModule } from './modules/equipment-pricing/equipment-pricing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
// Próximo módulo de domínio a implementar: UsersModule (CRUD de usuários/RBAC).

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DepartmentsModule,
    ClientsModule,
    EquipmentPricingModule,
    SuppliersModule,
    ContractsModule,
    AssetsModule,
    FinanceModule,
    ReconciliationModule,
    LeaseImportModule,
    DashboardModule,
  ],
})
export class AppModule {}
