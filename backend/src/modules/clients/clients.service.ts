import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateSiteDto } from './dto/create-site.dto';
import { CreateObraDto } from './dto/create-obra.dto';
import { UpdateObraDto } from './dto/update-obra.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { findObraByLabelInClient, obraMatchesLabel } from '../../common/utils/obra-matching';

/**
 * CRUD leve da hierarquia Cliente (grupo empresarial) -> Site
 * (estabelecimento com CNPJ) -> Obra (centro de custo / canteiro). Na
 * prática, a maioria nasce automaticamente via importação de extrato de
 * locação (`LeaseImportService`) — este módulo cobre a listagem para telas
 * (dropdown de alocação de ativo, tela de Clientes/Obras), a criação manual
 * quando não há extrato ainda, a renomeação, e a limpeza de duplicatas
 * (mesclar obras, excluir obra/estabelecimento/cliente vazios).
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

    await this.assertNoObraClash(site.clientId, [dto.name, dto.costCenterLabel]);
    return this.prisma.obra.create({ data: { ...dto, siteId } });
  }

  async updateObra(id: string, dto: UpdateObraDto) {
    const obra = await this.prisma.obra.findUnique({ where: { id }, include: { site: true } });
    if (!obra) throw new NotFoundException('Obra não encontrada');

    await this.assertNoObraClash(
      obra.site.clientId,
      [dto.name, dto.costCenterLabel].filter((v): v is string => !!v),
      obra.id,
    );

    return this.prisma.obra.update({ where: { id }, data: dto });
  }

  /**
   * Impede duas obras com o mesmo nome/classificação no mesmo cliente
   * (em qualquer CNPJ), comparando sem acento, espaço extra ou maiúsculas —
   * o controle das obras é feito pelo nome.
   */
  private async assertNoObraClash(clientId: string, labels: string[], excludeObraId?: string) {
    for (const label of labels) {
      const clash = await findObraByLabelInClient(this.prisma, clientId, label, excludeObraId);
      if (clash) {
        throw new ConflictException(
          `Já existe a obra "${clash.name}" com esse nome/classificação neste cliente — use-a (ou mescle) em vez de criar outra.`,
        );
      }
    }
  }

  async updateSite(id: string, dto: UpdateSiteDto) {
    const site = await this.prisma.site.findUnique({ where: { id } });
    if (!site) throw new NotFoundException('Estabelecimento (Site) não encontrado');
    return this.prisma.site.update({ where: { id }, data: dto });
  }

  /** Só exclui estabelecimento vazio — com obras, ativos ou contratos, é preciso mesclar antes. */
  async removeSite(id: string) {
    const site = await this.prisma.site.findUnique({
      where: { id },
      include: { _count: { select: { obras: true, allocations: true, contracts: true } } },
    });
    if (!site) throw new NotFoundException('Estabelecimento (Site) não encontrado');
    const { obras, allocations, contracts } = site._count;
    if (obras || allocations || contracts) {
      throw new ConflictException(
        `Este estabelecimento ainda tem ${obras} obra(s), ${allocations} alocação(ões) e ${contracts} contrato(s). ` +
          'Mescle as obras dele em obras de outro estabelecimento antes de excluir.',
      );
    }
    return this.prisma.site.delete({ where: { id } });
  }

  /** Só exclui cliente sem estabelecimentos. */
  async removeClient(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { _count: { select: { sites: true } } },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado');
    if (client._count.sites) {
      throw new ConflictException('Este cliente ainda tem estabelecimentos — exclua-os antes.');
    }
    return this.prisma.client.delete({ where: { id } });
  }

  /** Exclui uma obra vazia (sem histórico de alocação nem contrato). */
  async removeObra(id: string) {
    const obra = await this.prisma.obra.findUnique({
      where: { id },
      include: { _count: { select: { allocations: true, contracts: true } } },
    });
    if (!obra) throw new NotFoundException('Obra não encontrada');
    if (obra._count.allocations || obra._count.contracts) {
      throw new ConflictException(
        `Esta obra tem ${obra._count.allocations} alocação(ões) e ${obra._count.contracts} contrato(s) vinculados — ` +
          'use "Mesclar" para passar tudo para a obra correta (ela é excluída em seguida).',
      );
    }
    return this.prisma.obra.delete({ where: { id } });
  }

  /**
   * Mescla uma obra duplicada (`id`) em outra (`targetObraId`): todas as
   * alocações (atuais e históricas) e contratos passam para a obra de
   * destino — com o estabelecimento/CNPJ da obra de destino —, a
   * classificação e os apelidos da obra mesclada viram apelidos da de
   * destino (para a próxima importação de extrato/guia cair direto nela) e
   * a obra mesclada é excluída.
   */
  async mergeObra(id: string, targetObraId: string) {
    if (id === targetObraId) throw new BadRequestException('Escolha uma obra diferente para mesclar.');
    const [source, target] = await Promise.all([
      this.prisma.obra.findUnique({ where: { id }, include: { site: true } }),
      this.prisma.obra.findUnique({ where: { id: targetObraId }, include: { site: true } }),
    ]);
    if (!source) throw new NotFoundException('Obra a mesclar não encontrada');
    if (!target) throw new NotFoundException('Obra de destino não encontrada');
    if (source.site.clientId !== target.site.clientId) {
      throw new BadRequestException('Só é possível mesclar obras do mesmo cliente.');
    }

    const newAliases: string[] = [];
    for (const label of [source.costCenterLabel, source.name, ...source.aliases]) {
      const probe = { ...target, aliases: [...target.aliases, ...newAliases] };
      if (label.trim() && !obraMatchesLabel(probe, label)) newAliases.push(label.trim());
    }

    // Sequência simples (sem `$transaction` interativa) — mesma decisão do
    // resto do sistema (pooler serverless). Se falhar no meio, rodar de novo
    // termina o serviço: as etapas são idempotentes.
    const allocations = await this.prisma.assetAllocation.updateMany({
      where: { obraId: source.id },
      data: { obraId: target.id, siteId: target.siteId },
    });
    const contracts = await this.prisma.contract.updateMany({
      where: { obraId: source.id },
      data: { obraId: target.id, siteId: target.siteId },
    });
    await this.prisma.obra.update({
      where: { id: target.id },
      data: { aliases: [...target.aliases, ...newAliases] },
    });
    await this.prisma.obra.delete({ where: { id: source.id } });

    return {
      targetObraId: target.id,
      allocationsMoved: allocations.count,
      contractsMoved: contracts.count,
      aliasesAdded: newAliases,
    };
  }
}
