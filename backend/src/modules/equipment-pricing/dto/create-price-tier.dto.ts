import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePriceTierDto {
  @ApiProperty({ example: 'Notebook Core i5' })
  @IsString()
  label: string;

  @ApiProperty({
    example: ['CORE I5'],
    description:
      'Cada item é obrigatório (E) para classificar automaticamente um equipamento neste tipo. Dentro de um item, "A|B" funciona como OU.',
  })
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @ApiProperty({ example: 220.0 })
  @IsNumber()
  @Min(0)
  referenceValue: number;

  @ApiProperty({
    required: false,
    default: 0,
    description: 'Ordem de avaliação (menor = testado antes) — regras mais específicas primeiro',
  })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
