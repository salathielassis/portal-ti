import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateSiteDto } from './dto/create-site.dto';
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
  @ApiOperation({ summary: 'Lista clientes (grupos empresariais) com suas obras/filiais' })
  findAll() {
    return this.clientsService.findAll();
  }

  @Get('sites')
  @ApiOperation({ summary: 'Lista todas as obras/filiais (achatado, para dropdowns de alocação)' })
  findAllSites() {
    return this.clientsService.findAllSites();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um cliente e suas obras/filiais' })
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cria um cliente manualmente (normalmente criado automaticamente pela importação de extrato)' })
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Post(':id/sites')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cria uma obra/filial manualmente sob um cliente' })
  createSite(@Param('id') id: string, @Body() dto: CreateSiteDto) {
    return this.clientsService.createSite(id, dto);
  }
}
