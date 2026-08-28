import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssetOwnership, AssetStatus, UserRole } from '@prisma/client';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import {
  AllocateAssetDto,
  ReturnAssetDto,
  TransferAssetDto,
  SendToMaintenanceDto,
  ReturnFromMaintenanceDto,
} from './dto/allocate-asset.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Ativos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Cadastra um novo ativo (notebook, impressora, etc.)' })
  create(@Body() dto: CreateAssetDto) {
    return this.assetsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista ativos, com filtros opcionais por status e propriedade' })
  findAll(@Query('status') status?: AssetStatus, @Query('ownership') ownership?: AssetOwnership) {
    return this.assetsService.findAll({ status, ownership });
  }

  @Get('idle')
  @ApiOperation({ summary: 'Lista ativos locados parados em estoque (ociosos)' })
  findIdle(@Query('minDays') minDays?: number) {
    return this.assetsService.findIdle(Number(minDays) || 15);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um ativo: alocações e histórico de movimentação' })
  findOne(@Param('id') id: string) {
    return this.assetsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Atualiza dados cadastrais de um ativo' })
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assetsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove um ativo (se não houver histórico vinculado)' })
  remove(@Param('id') id: string) {
    return this.assetsService.remove(id);
  }

  @Post(':id/allocate')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Entrega o ativo a um colaborador, departamento, obra/site ou cliente' })
  allocate(@Param('id') id: string, @Body() dto: AllocateAssetDto, @CurrentUser() user: { id: string }) {
    return this.assetsService.allocate(id, dto, user.id);
  }

  @Post(':id/return')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Registra a devolução do ativo, liberando-o para estoque' })
  returnAsset(@Param('id') id: string, @Body() dto: ReturnAssetDto, @CurrentUser() user: { id: string }) {
    return this.assetsService.returnAsset(id, dto, user.id);
  }

  @Post(':id/transfer')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Transfere o ativo diretamente para outra obra/pessoa/departamento (devolve + realoca em um passo)' })
  transfer(@Param('id') id: string, @Body() dto: TransferAssetDto, @CurrentUser() user: { id: string }) {
    return this.assetsService.transfer(id, dto, user.id);
  }

  @Post(':id/maintenance/start')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Envia o ativo para manutenção (encerra alocação ativa, se houver)' })
  sendToMaintenance(
    @Param('id') id: string,
    @Body() dto: SendToMaintenanceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.assetsService.sendToMaintenance(id, dto, user.id);
  }

  @Post(':id/maintenance/end')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Retorna o ativo da manutenção para o estoque' })
  returnFromMaintenance(
    @Param('id') id: string,
    @Body() dto: ReturnFromMaintenanceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.assetsService.returnFromMaintenance(id, dto, user.id);
  }
}
