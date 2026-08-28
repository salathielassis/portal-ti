import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoiceStatus, UserRole } from '@prisma/client';
import { FinanceService } from './finance.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { CreateCostAllocationDto } from './dto/create-cost-allocation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Financeiro')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('finance/invoices')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Lança uma fatura de locação (conta a pagar)' })
  create(@Body() dto: CreateInvoiceDto) {
    return this.financeService.createInvoice(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Lista faturas, com filtro opcional por status' })
  findAll(@Query('status') status?: InvoiceStatus) {
    return this.financeService.findAll(status);
  }

  @Get('summary/monthly-cost')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Custo mensal de locação nos últimos N meses (para o gráfico do Dashboard)' })
  monthlyCostSummary(@Query('months') months?: number) {
    return this.financeService.monthlyCostSummary(Number(months) || 8);
  }

  @Get('reports/asset-activity')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({
    summary:
      'Relatório de atividade mensal de ativos: contagem completa de ativos, devolvidos e novos, com data exata de entrada/saída da fatura',
  })
  assetActivityReport(@Query('month') month: string, @Query('siteId') siteId?: string) {
    return this.financeService.assetActivityReport(month, siteId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Detalha uma fatura: rateio e matches de conciliação' })
  findOne(@Param('id') id: string) {
    return this.financeService.findOne(id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Atualiza o status de uma fatura (ex.: marcar como PAGA)' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateInvoiceStatusDto) {
    return this.financeService.updateStatus(id, dto);
  }

  @Post(':id/cost-allocations')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Adiciona um rateio de custo por departamento à fatura' })
  addCostAllocation(@Param('id') id: string, @Body() dto: CreateCostAllocationDto) {
    return this.financeService.addCostAllocation(id, dto);
  }
}
