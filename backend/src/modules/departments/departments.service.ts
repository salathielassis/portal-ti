import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista simples de departamentos, usada para preencher dropdowns (alocação
   * de ativo, rateio de fatura). CRUD completo de departamentos fica para uma
   * próxima etapa — hoje são criados via seed/administração direta do banco.
   */
  findAll() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' } });
  }
}
