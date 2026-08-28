import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateClientDto {
  @ApiProperty({ example: 'DOISA' })
  @IsString()
  name: string;

  @ApiProperty({
    example: '03092799',
    description: '8 primeiros dígitos do CNPJ (raiz), compartilhados entre matriz e filiais',
  })
  @IsString()
  @Length(8, 8)
  cnpjRoot: string;
}
