import { ApiProperty } from '@nestjs/swagger';
import { AssetAttachmentType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadAttachmentDto {
  @ApiProperty({ enum: AssetAttachmentType, description: 'Foto do equipamento, nota fiscal, termo assinado, etc.' })
  @IsEnum(AssetAttachmentType)
  type: AssetAttachmentType;
}
