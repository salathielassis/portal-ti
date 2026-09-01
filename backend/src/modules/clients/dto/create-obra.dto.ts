import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateObraDto {
  @ApiProperty({ example: 'Barro Alto GO', description: 'Nome legível da obra / centro de custo' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    example: 'EQUIP - BARRO ALTO GO',
    description: 'Rótulo do campo CLASSIFICAÇÃO do extrato — chave da obra dentro do estabelecimento (Site)',
  })
  @IsString()
  @MinLength(2)
  costCenterLabel: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
