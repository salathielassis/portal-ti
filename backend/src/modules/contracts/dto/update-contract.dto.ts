import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ContractStatus } from '@prisma/client';
import { CreateContractDto } from './create-contract.dto';

export class UpdateContractDto extends PartialType(CreateContractDto) {
  @ApiProperty({ enum: ContractStatus, required: false })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;
}
