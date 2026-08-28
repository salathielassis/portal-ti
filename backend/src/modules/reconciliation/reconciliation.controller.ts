import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { UploadStatementDto } from './dto/upload-statement.dto';
import { ConfirmMatchDto, ManualMatchDto } from './dto/confirm-match.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Conciliação Financeira')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  /**
   * Upload em lote do extrato bancário (PDF). Dispara parsing + matching
   * automático/sugerido de forma síncrona (para extratos grandes, considerar
   * mover para uma fila BullMQ e retornar 202 Accepted).
   */
  @Post('upload')
  @Roles(UserRole.FINANCEIRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Upload de extrato bancário em PDF para conciliação em lote' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadStatement(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadStatementDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.reconciliationService.processStatementUpload(file, dto, user.id);
  }

  @Get()
  @Roles(UserRole.FINANCEIRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Lista as sessões de conciliação (histórico de uploads)' })
  async list(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.reconciliationService.listReconciliations(Number(page) || 1, Number(pageSize) || 20);
  }

  @Get(':id')
  @Roles(UserRole.FINANCEIRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Detalha uma sessão de conciliação: transações e matches' })
  async detail(@Param('id') id: string) {
    return this.reconciliationService.getReconciliationDetail(id);
  }

  @Post('matches/confirm')
  @Roles(UserRole.FINANCEIRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Confirma ou rejeita um match SUGERIDO pendente de revisão' })
  async confirmMatch(@Body() dto: ConfirmMatchDto) {
    return this.reconciliationService.confirmMatch(dto);
  }

  @Post('matches/manual')
  @Roles(UserRole.FINANCEIRO, UserRole.ADMIN)
  @ApiOperation({ summary: 'Cria um match manual entre transação bancária e fatura' })
  async manualMatch(@Body() dto: ManualMatchDto) {
    return this.reconciliationService.createManualMatch(dto);
  }
}
