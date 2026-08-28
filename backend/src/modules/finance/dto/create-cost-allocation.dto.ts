import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Max, Min } from 'class-validator';

export class CreateCostAllocationDto {
  @ApiProperty()
  @IsUUID()
  departmentId: string;

  @ApiProperty({ description: 'Percentual do valor da fatura rateado para este departamento', example: 50 })
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage: number;
}
