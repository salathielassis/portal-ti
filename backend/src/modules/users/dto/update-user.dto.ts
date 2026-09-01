import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Atualização de um usuário pelo ADMIN. Não troca senha (endpoint dedicado)
 * nem e-mail (identidade do login — mantido estável de propósito).
 */
export class UpdateUserDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiProperty({ required: false, enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ required: false, description: 'Ativa/desativa o acesso do usuário' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ required: false, nullable: true, description: 'ID do departamento, ou null para desvincular' })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;
}
