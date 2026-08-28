import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateInvoiceDto {
  @ApiProperty()
  @IsUUID()
  contractId: string;

  @ApiProperty({ example: '2026-08-01', description: 'Mês de competência da fatura' })
  @IsDateString()
  referenceMonth: string;

  @ApiProperty({ example: '2026-09-10' })
  @IsDateString()
  dueDate: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  grossValue: number;
}
