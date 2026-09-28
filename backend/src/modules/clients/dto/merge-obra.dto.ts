import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MergeObraDto {
  @ApiProperty({ description: 'Obra que vai ficar — recebe os ativos, contratos e a classificação da obra mesclada' })
  @IsUUID()
  targetObraId: string;
}
