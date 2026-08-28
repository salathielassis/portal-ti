import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateContractDto {
  @ApiProperty({ example: 'CTR-2026-0002' })
  @IsString()
  contractNumber: string;

  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiProperty()
  @IsDateString()
  startDate: string;

  @ApiProperty()
  @IsDateString()
  endDate: string;

  @ApiProperty({ description: 'Valor mensal cobrado por equipamento locado' })
  @IsNumber()
  @Min(0)
  monthlyValuePerAsset: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  earlyTerminationFee?: number;

  @ApiProperty({ required: false, example: 'IPCA' })
  @IsOptional()
  @IsString()
  annualReadjustIndex?: string;

  @ApiProperty({ required: false, example: 4.5 })
  @IsOptional()
  @IsNumber()
  annualReadjustPct?: number;
}
