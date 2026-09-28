import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { AssetStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateAssetDto } from './create-asset.dto';

// Local/responsável iniciais só valem no cadastro — depois, use Alocar/Transferir.
export class UpdateAssetDto extends PartialType(OmitType(CreateAssetDto, ['obraId', 'assignedToName'] as const)) {
  @ApiProperty({ enum: AssetStatus, required: false })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;
}
