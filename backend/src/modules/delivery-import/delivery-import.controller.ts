import { Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DeliveryImportService } from './delivery-import.service';
import { ConfirmDeliveryImportDto } from './dto/confirm-delivery-import.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Importação de Guia de Entrega')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('delivery-import')
export class DeliveryImportController {
  constructor(private readonly deliveryImportService: DeliveryImportService) {}

  /**
   * Passo 1: OCR do PDF escaneado da guia de entrega, devolve cabeçalho e
   * itens já pré-preenchidos (mas editáveis na tela) — nada é gravado ainda.
   */
  @Post('preview')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Lê uma guia de entrega (PDF escaneado) via OCR e retorna uma prévia editável' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async preview(@UploadedFile() file: Express.Multer.File) {
    return this.deliveryImportService.preview(file);
  }

  /**
   * Passo 2: recebe os dados JÁ EDITADOS pelo usuário (não reprocessa o PDF)
   * e grava Cliente/Site/Obra/Ativos/Alocações/Anexo.
   */
  @Post('execute')
  @Roles(UserRole.ADMIN, UserRole.SUPORTE)
  @ApiOperation({ summary: 'Confirma a importação com os dados revisados e grava no banco' })
  async execute(@Body() dto: ConfirmDeliveryImportDto) {
    return this.deliveryImportService.execute(dto);
  }
}
