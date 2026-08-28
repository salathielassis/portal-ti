import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EquipmentPricingService } from './equipment-pricing.service';
import { CreatePriceTierDto } from './dto/create-price-tier.dto';
import { UpdatePriceTierDto } from './dto/update-price-tier.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Tabela de Preços de Referência')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('equipment-price-tiers')
export class EquipmentPricingController {
  constructor(private readonly equipmentPricingService: EquipmentPricingService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os tipos de equipamento e seus valores de referência' })
  findAll() {
    return this.equipmentPricingService.findAll();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Cadastra um novo tipo de equipamento com valor de referência' })
  create(@Body() dto: CreatePriceTierDto) {
    return this.equipmentPricingService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Atualiza um tipo de equipamento (nome, palavras-chave, valor, ordem)' })
  update(@Param('id') id: string, @Body() dto: UpdatePriceTierDto) {
    return this.equipmentPricingService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove um tipo de equipamento (se não houver ativos classificados nele)' })
  remove(@Param('id') id: string) {
    return this.equipmentPricingService.remove(id);
  }
}
