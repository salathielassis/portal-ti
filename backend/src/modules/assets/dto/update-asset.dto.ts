import { ApiProperty, PartialType } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateAssetDto } from './create-asset.dto';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
  @ApiProperty({ enum: AssetStatus, required: false })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;
}
