import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateSiteDto } from './dto/create-site.dto';
import { CreateObraDto } from './dto/create-obra.dto';
import { UpdateObraDto } from './dto/update-obra.dto';

/**
 * CRUD leve da hierarquia Cliente (grupo empresarial) -> Site
 * (estabelecimento com CNPJ) -> Obra (centro de custo / canteiro). Na
 * prática, a maioria nasce automaticamente via importação de extrato de
 * locação (`LeaseImportService`) — este módulo cobre a listagem para telas
 * (dropdown de alocação de ativo, tela de Clientes/Obras), a criação manual
 * quando não há extrato ainda, e a renomeação de obras (útil para dar nome
 * às obras que a importação antiga deixou rotuladas pelo número do contrato).
 */
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: {
        sites: {
          orderBy: { name: 'asc' },
          include: {
            obras: {
              orderBy: { name: 'asc' },
              include: { _count: { select: { allocations: true, contracts: true } } },
            },
          },
        },
        _count: { select: { sites: true } },
      },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        sites: {
          orderBy: { name: 'asc' },
          include: {
            obras: {
              orderBy: { name: 'asc' },
              include: { _count: { select: { allocations: true, contracts: true } } },
            },
          },
        },
      },
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
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { allocations: true, obras: true } },
      },
    });
  }

  async createSite(clientId: string, dto: CreateSiteDto) {
    await this.findOne(clientId);
    const exists = await this.prisma.site.findUnique({ where: { cnpj: dto.cnpj } });
    if (exists) throw new ConflictException('Já existe um estabelecimento (Site) com esse CNPJ');
    return this.prisma.site.create({ data: { ...dto, clientId } });
  }

  /** Lista achatada de obras (obra + site + cliente) — para dropdowns de alocação. */
  async findAllObras() {
    return this.prisma.obra.findMany({
      orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
      include: {
        site: {
          select: {
            id: true,
            name: true,
            cnpj: true,
            addressState: true,
            client: { select: { id: true, name: true } },
          },
        },
        _count: { select: { allocations: true, contracts: true } },
      },
    });
  }

  async createObra(siteId: string, dto: CreateObraDto) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Estabelecimento (Site) não encontrado');

    const clash = await this.prisma.obra.findUnique({
      where: { siteId_costCenterLabel: { siteId, costCenterLabel: dto.costCenterLabel } },
    });
    if (clash) {
      throw new ConflictException('Já existe uma obra com essa classificação neste estabelecimento');
    }

    return this.prisma.obra.create({ data: { ...dto, siteId } });
  }

  async updateObra(id: string, dto: UpdateObraDto) {
    const obra = await this.prisma.obra.findUnique({ where: { id } });
    if (!obra) throw new NotFoundException('Obra não encontrada');

    if (dto.costCenterLabel && dto.costCenterLabel !== obra.costCenterLabel) {
      const clash = await this.prisma.obra.findUnique({
        where: {
          siteId_costCenterLabel: { siteId: obra.siteId, costCenterLabel: dto.costCenterLabel },
        },
      });
      if (clash) {
        throw new ConflictException('Já existe uma obra com essa classificação neste estabelecimento');
      }
    }

    return this.prisma.obra.update({ where: { id }, data: dto });
  }
}
