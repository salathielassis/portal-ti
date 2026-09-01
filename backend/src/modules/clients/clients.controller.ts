import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateSiteDto } from './dto/create-site.dto';
import { CreateObraDto } from './dto/create-obra.dto';
import { UpdateObraDto } from './dto/update-obra.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Clientes e Obras')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista clientes (grupos empresariais) com estabelecimentos e obras' })
  findAll() {
    return this.clientsService.findAll();
  }

  @Get('sites')
  @ApiOperation({ summary: 'Lista todos os estabelecimentos (Sites/CNPJ), achatado' })
  findAllSites() {
    return this.clientsService.findAllSites();
  }

  @Get('obras')
  @ApiOperation({ summary: 'Lista todas as obras/centros de custo (achatado, para dropdowns de alocação)' })
  findAllObras() {
    return this.clientsService.findAllObras();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um cliente, seus estabelecimentos e obras' })
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cria um cliente manualmente (normalmente criado pela importação de extrato)' })
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Post(':id/sites')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cria um estabelecimento (Site/CNPJ) manualmente sob um cliente' })
  createSite(@Param('id') id: string, @Body() dto: CreateSiteDto) {
    return this.clientsService.createSite(id, dto);
  }

  @Post('sites/:siteId/obras')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Cria uma obra / centro de custo sob um estabelecimento' })
  createObra(@Param('siteId') siteId: string, @Body() dto: CreateObraDto) {
    return this.clientsService.createObra(siteId, dto);
  }

  @Patch('obras/:id')
  @Roles(UserRole.ADMIN, UserRole.FINANCEIRO)
  @ApiOperation({ summary: 'Renomeia / ativa / desativa uma obra' })
  updateObra(@Param('id') id: string, @Body() dto: UpdateObraDto) {
    return this.clientsService.updateObra(id, dto);
  }
}
