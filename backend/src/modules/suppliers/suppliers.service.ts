import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSupplierDto) {
    const exists = await this.prisma.supplier.findUnique({ where: { cnpj: dto.cnpj } });
    if (exists) throw new ConflictException('Já existe um fornecedor com esse CNPJ');
    return this.prisma.supplier.create({ data: dto });
  }

  async findAll() {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { contracts: true, assets: true } } },
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { contracts: true },
    });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.supplier.delete({ where: { id } });
    } catch (err) {
      // P2003/P2014: violação de chave estrangeira — existem contratos/ativos vinculados
      throw new ConflictException(
        'Não é possível excluir: este fornecedor tem contratos ou ativos vinculados.',
      );
    }
  }
}
