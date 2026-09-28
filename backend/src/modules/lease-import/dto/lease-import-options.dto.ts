import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/** Campos de texto enviados junto com o PDF (multipart — tudo chega como string). */
export class LeaseImportOptionsDto {
  @ApiProperty({ required: false, description: 'Obra existente de destino. Vazio = resolver pela CLASSIFICAÇÃO do extrato' })
  @IsOptional()
  @IsUUID()
  obraId?: string;

  @ApiProperty({ required: false, description: 'Nome legível da obra, quando ela for criada agora' })
  @IsOptional()
  @IsString()
  newObraName?: string;

  @ApiProperty({ required: false, enum: ['true', 'false'], description: 'Criar obra nova em vez de usar a sugerida' })
  @IsOptional()
  @IsIn(['true', 'false'])
  forceNewObra?: string;

  @ApiProperty({
    required: false,
    enum: ['true', 'false'],
    description: 'Mover para a obra de destino os ativos que o sistema tem em outra obra (padrão: não mover)',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  moveFromOtherObras?: string;
}
