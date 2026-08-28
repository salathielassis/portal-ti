import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreateSiteDto {
  @ApiProperty({ example: 'EQUIP - BARRO ALTO GO' })
  @IsString()
  name: string;

  @ApiProperty({ required: false, example: 'EQUIP - BARRO ALTO GO' })
  @IsOptional()
  @IsString()
  costCenterLabel?: string;

  @ApiProperty({ example: '03092799000858', description: 'CNPJ completo desta filial/obra (14 dígitos)' })
  @IsString()
  @Length(14, 14)
  cnpj: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isHeadquarters?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressStreet?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressComplement?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressDistrict?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressCity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressState?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressZip?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}
