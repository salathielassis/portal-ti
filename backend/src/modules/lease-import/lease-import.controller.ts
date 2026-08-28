import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { LeaseImportService } from './lease-import.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Importação de Extrato de Locação')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lease-import')
export class LeaseImportController {
  constructor(private readonly leaseImportService: LeaseImportService) {}

  /**
   * Passo 1: lê o PDF e devolve um preview (cabeçalho, itens e o que seria
   * criado/atualizado) SEM gravar nada no banco. A tela de importação usa
   * esse endpoint para o usuário conferir antes de confirmar.
   */
  @Post('preview')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Lê um extrato de locação em PDF e retorna uma prévia (sem gravar no banco)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async preview(@UploadedFile() file: Express.Multer.File) {
    return this.leaseImportService.preview(file);
  }

  /**
   * Passo 2: reprocessa o mesmo PDF e executa a cascata de upserts
   * (Cliente → Site → Fornecedor → Contrato → Fatura → Ativos → Alocações)
   * em uma única transação. Idempotente: reenviar o mesmo extrato atualiza
   * em vez de duplicar.
   */
  @Post('execute')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Confirma a importação: grava Cliente/Site/Fornecedor/Contrato/Fatura/Ativos no banco' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async execute(@UploadedFile() file: Express.Multer.File) {
    return this.leaseImportService.execute(file);
  }
}
