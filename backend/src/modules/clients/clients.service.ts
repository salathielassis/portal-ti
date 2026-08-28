import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateSiteDto } from './dto/create-site.dto';

/**
 * CRUD leve de Cliente (grupo empresarial) e Site (obra/filial). Na prática,
 * a maioria dos Sites nasce automaticamente via importação de extrato de
 * locação (`LeaseImportService`) — este módulo cobre a listagem para telas
 * (dropdown de alocação de ativo, tela de Clientes/Obras) e a criação manual
 * para quando não há um extrato para "descobrir" o Site ainda.
 */
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: { sites: { orderBy: { name: 'asc' } }, _count: { select: { sites: true } } },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { sites: { orderBy: { name: 'asc' } } },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado');
    return client;
  }

  async create(dto: CreateClientDto) {
    const exists = await this.prisma.client.findUnique({ where: { cnpjRoot: dto.cnpjRoot } });
    if (exists) throw new ConflictException('Já existe um cliente com essa raiz de CNPJ');
    return this.prisma.client.create({ data: dto });
  }

  async findAllSites() {
    return this.prisma.site.findMany({
      orderBy: { name: 'asc' },
      include: { client: { select: { id: true, name: true } }, _count: { select: { allocations: true } } },
    });
  }

  async createSite(clientId: string, dto: CreateSiteDto) {
    await this.findOne(clientId);
    const exists = await this.prisma.site.findUnique({ where: { cnpj: dto.cnpj } });
    if (exists) throw new ConflictException('Já existe uma obra/filial com esse CNPJ');
    return this.prisma.site.create({ data: { ...dto, clientId } });
  }
}
