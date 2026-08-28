import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Contratos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Cadastra um novo contrato de locação' })
  create(@Body() dto: CreateContractDto) {
    return this.contractsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista contratos (com dias até o vencimento)' })
  findAll() {
    return this.contractsService.findAll();
  }

  @Get('expiring')
  @ApiOperation({ summary: 'Lista contratos vencendo dentro de N dias (padrão 30)' })
  findExpiring(@Query('days') days?: number) {
    return this.contractsService.findExpiringSoon(Number(days) || 30);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um contrato, seus ativos e faturas' })
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Atualiza um contrato' })
  update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contractsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove um contrato (se não houver vínculos)' })
  remove(@Param('id') id: string) {
    return this.contractsService.remove(id);
  }
}
