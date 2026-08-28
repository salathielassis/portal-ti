import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadStatementDto {
  @ApiProperty({
    description: 'Mês de competência do extrato (referente às faturas a conciliar)',
    example: '2026-08-01',
  })
  @IsDateString()
  referenceMonth: string;

  @ApiProperty({ required: false, description: 'Observações sobre o upload' })
  @IsOptional()
  @IsString()
  notes?: string;
}
