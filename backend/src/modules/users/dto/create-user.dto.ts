import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'Maria Silva' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'maria@empresa.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, description: 'Senha inicial do usuário' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: UserRole, example: UserRole.SUPORTE })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({ required: false, description: 'ID do departamento (opcional)' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
