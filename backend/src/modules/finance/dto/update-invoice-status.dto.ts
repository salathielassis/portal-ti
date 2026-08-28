import { ApiProperty } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateInvoiceStatusDto {
  @ApiProperty({ enum: InvoiceStatus })
  @IsEnum(InvoiceStatus)
  status: InvoiceStatus;
}
