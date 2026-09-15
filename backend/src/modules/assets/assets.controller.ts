import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssetOwnership, AssetStatus, AssetType, UserRole } from '@prisma/client';
import { AssetsService } from './assets.service';
import { AssetsExportService, ExportFormat } from './assets-export.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import {
  AllocateAssetDto,
  ReturnAssetDto,
  TransferAssetDto,
  UpdateAssignedToDto,
  SendToMaintenanceDto,
  ReturnFromMaintenanceDto,
  DiscardAssetDto,
} from './dto/allocate-asset.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Ativos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly assetsExportService: AssetsExportService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Cadastra um novo ativo (notebook, impressora, etc.)' })
  create(@Body() dto: CreateAssetDto) {
    return this.assetsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'Lista ativos, com filtros opcionais por status, propriedade, tipo, contrato, filial e busca livre (tag/série/marca/modelo)',
  })
  findAll(
    @Query('status') status?: AssetStatus,
    @Query('ownership') ownership?: AssetOwnership,
    @Query('type') type?: AssetType,
    @Query('contractId') contractId?: string,
    @Query('siteId') siteId?: string,
    @Query('obraId') obraId?: string,
    @Query('search') search?: string,
  ) {
    return this.assetsService.findAll({ status, ownership, type, contractId, siteId, obraId, search });
  }

  @Get('idle')
  @ApiOperation({ summary: 'Lista ativos locados parados em estoque (ociosos)' })
  findIdle(@Query('minDays') minDays?: number) {
    return this.assetsService.findIdle(Number(minDays) || 15);
  }

  @Get('export')
  @ApiOperation({
    summary:
      'Exporta os equipamentos filtrados (ou uma seleção via ?ids=a,b,c) em XLSX (todas as colunas) ou PDF (resumo), com totais por centro de custo e status',
  })
  async export(
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('status') status?: AssetStatus,
    @Query('ownership') ownership?: AssetOwnership,
    @Query('type') type?: AssetType,
    @Query('contractId') contractId?: string,
    @Query('siteId') siteId?: string,
    @Query('obraId') obraId?: string,
    @Query('search') search?: string,
    @Query('ids') ids?: string,
  ) {
    const fmt: ExportFormat = format === 'pdf' ? 'pdf' : 'xlsx';
    const idList = ids
      ? ids.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const { buffer, filename, contentType } = await this.assetsExportService.generate(fmt, {
      status,
      ownership,
      type,
      contractId,
      siteId,
      obraId,
      search,
      ids: idList,
    });

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get('by-serial/:serialNumber')
  @ApiOperation({
    summary:
      'Busca exata por nº de série — usado pela leitura de código de barras (bipador), que lê o mesmo nº de série já impresso pelo fabricante embaixo do equipamento',
  })
  findBySerial(@Param('serialNumber') serialNumber: string) {
    return this.assetsService.findBySerial(serialNumber);
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

  @Patch(':id/assigned-to')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({
    summary:
      'Corrige/preenche só o nome do responsável na alocação ativa atual (ex.: ativo importado do extrato de locação sem colaborador informado)',
  })
  updateAssignedTo(@Param('id') id: string, @Body() dto: UpdateAssignedToDto) {
    return this.assetsService.updateAssignedTo(id, dto);
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

  @Post(':id/discard')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Dá baixa definitiva no ativo (defeito sem conserto viável, perda, etc.)' })
  discard(@Param('id') id: string, @Body() dto: DiscardAssetDto, @CurrentUser() user: { id: string }) {
    return this.assetsService.discard(id, dto, user.id);
  }

  @Post(':id/attachments')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Anexa um arquivo ao ativo (foto do equipamento, nota fiscal, termo assinado, etc.)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.assetsService.addAttachment(id, file, dto.type, user.id);
  }

  @Get(':id/attachments/:attachmentId/file')
  @ApiOperation({ summary: 'Baixa o arquivo de um anexo do ativo' })
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const { attachment, buffer } = await this.assetsService.getAttachmentFile(id, attachmentId);
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${attachment.fileName}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get(':id/termo')
  @ApiOperation({ summary: 'Gera o termo de responsabilidade (PDF) da alocação ativa do ativo' })
  async downloadTermo(@Param('id') id: string, @Res() res: Response) {
    const { asset, allocation } = await this.assetsService.findActiveAllocationForTermo(id);
    const buffer = await this.assetsExportService.generateTermo(asset, allocation);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="termo-${asset.assetTag}.pdf"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Delete(':id/attachments/:attachmentId')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Remove um anexo do ativo' })
  removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.assetsService.removeAttachment(id, attachmentId);
  }
}
