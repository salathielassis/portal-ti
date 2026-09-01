import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

@ApiTags('Usuários')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // --- Conta do próprio usuário autenticado (qualquer perfil) ---------------

  @Get('me')
  @ApiOperation({ summary: 'Dados atualizados do usuário autenticado' })
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.findOne(user.id);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Troca a própria senha (confirmando a senha atual)' })
  changeOwnPassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeOwnPassword(user.id, dto.currentPassword, dto.newPassword);
  }

  // --- Administração de usuários (somente ADMIN) ---------------------------

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Lista todos os usuários' })
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cria um novo usuário' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Atualiza nome, perfil, departamento ou status de um usuário' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.usersService.update(id, dto, user.id);
  }

  @Patch(':id/password')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Redefine a senha de um usuário' })
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto.newPassword);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Exclui um usuário (se não houver registros vinculados)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.usersService.remove(id, user.id);
  }
}
