import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_ROUNDS = 10;

/** Campos expostos pela API — nunca inclui passwordHash. */
const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: userSelect,
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Já existe um usuário com esse e-mail');

    if (dto.departmentId) await this.assertDepartmentExists(dto.departmentId);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        departmentId: dto.departmentId ?? null,
        passwordHash,
      },
      select: userSelect,
    });
  }

  async update(id: string, dto: UpdateUserDto, actingUserId: string) {
    const target = await this.findOne(id);

    // Não deixar o ADMIN se auto-rebaixar nem se auto-desativar por engano.
    if (id === actingUserId) {
      if (dto.role && dto.role !== UserRole.ADMIN) {
        throw new BadRequestException('Você não pode rebaixar o seu próprio perfil.');
      }
      if (dto.active === false) {
        throw new BadRequestException('Você não pode desativar a sua própria conta.');
      }
    }

    // Preservar sempre pelo menos um ADMIN ativo no sistema.
    const losingAdmin =
      target.role === UserRole.ADMIN &&
      ((dto.role && dto.role !== UserRole.ADMIN) || dto.active === false);
    if (losingAdmin) await this.assertNotLastActiveAdmin(id);

    if (dto.departmentId) await this.assertDepartmentExists(dto.departmentId);

    return this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        role: dto.role,
        active: dto.active,
        ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
      },
      select: userSelect,
    });
  }

  async resetPassword(id: string, newPassword: string) {
    await this.findOne(id);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { ok: true };
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) throw new UnauthorizedException('Senha atual incorreta');

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('A nova senha precisa ser diferente da atual.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  async remove(id: string, actingUserId: string) {
    if (id === actingUserId) {
      throw new BadRequestException('Você não pode excluir a sua própria conta.');
    }
    const target = await this.findOne(id);
    if (target.role === UserRole.ADMIN) await this.assertNotLastActiveAdmin(id);

    try {
      await this.prisma.user.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException(
          'Não é possível excluir: este usuário tem registros vinculados (alocações, movimentações ou conciliações). Desative-o em vez de excluir.',
        );
      }
      throw err;
    }
  }

  private async assertDepartmentExists(departmentId: string) {
    const dep = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!dep) throw new BadRequestException('Departamento informado não existe.');
  }

  private async assertNotLastActiveAdmin(excludingUserId: string) {
    const otherAdmins = await this.prisma.user.count({
      where: { role: UserRole.ADMIN, active: true, id: { not: excludingUserId } },
    });
    if (otherAdmins === 0) {
      throw new ForbiddenException(
        'Esta é a única conta ADMIN ativa. Crie ou ative outro administrador antes de rebaixar, desativar ou excluir esta.',
      );
    }
  }
}
