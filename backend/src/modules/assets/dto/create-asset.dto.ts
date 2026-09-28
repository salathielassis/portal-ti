import { ApiProperty } from '@nestjs/swagger';
import { AssetOwnership, AssetType } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAssetDto {
  @ApiProperty({ example: 'NB-00300' })
  @IsString()
  assetTag: string;

  @ApiProperty()
  @IsString()
  serialNumber: string;

  @ApiProperty({ enum: AssetType })
  @IsEnum(AssetType)
  type: AssetType;

  @ApiProperty({ enum: AssetOwnership })
  @IsEnum(AssetOwnership)
  ownership: AssetOwnership;

  @ApiProperty()
  @IsString()
  brand: string;

  @ApiProperty()
  @IsString()
  model: string;

  @ApiProperty({ required: false, description: 'Ex.: { "cpu": "i5", "ram": "16GB", "storage": "SSD 512GB", "gpu": "RTX 3050 4GB" }' })
  @IsOptional()
  @IsObject()
  specs?: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Obrigatório quando ownership = LOCADO' })
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({
    required: false,
    description: 'Obra / filial onde o ativo já está — se informada, o ativo nasce alocado (Em uso) nela',
  })
  @IsOptional()
  @IsUUID()
  obraId?: string;

  @ApiProperty({ required: false, description: 'Responsável inicial (opcional) — em branco vira "Não informado"' })
  @IsOptional()
  @IsString()
  assignedToName?: string;
}
