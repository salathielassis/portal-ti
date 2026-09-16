import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class DeliveryItemSerialDto {
  @IsString()
  serviceTag: string;

  @IsString()
  assetTag: string;
}

export class DeliveryItemDto {
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryItemSerialDto)
  serials: DeliveryItemSerialDto[];
}

export class DeliveryHeaderDto {
  @IsString()
  clientCnpj: string;

  @IsString()
  clientName: string;

  /** "Nome do Site" — vira a Obra. */
  @IsString()
  siteName: string;

  @IsOptional()
  @IsString()
  requisitionNumber?: string;
}

export class ConfirmDeliveryImportDto {
  @IsString()
  fileKey: string;

  @ValidateNested()
  @Type(() => DeliveryHeaderDto)
  header: DeliveryHeaderDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeliveryItemDto)
  items: DeliveryItemDto[];
}
