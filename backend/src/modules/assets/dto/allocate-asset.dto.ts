import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class AllocateAssetDto {
  @ApiProperty({ description: 'Nome do colaborador ou cliente que vai receber o ativo' })
  @IsString()
  assignedToName: string;

  @ApiProperty({ required: false, description: 'Obra/filial do cliente onde o ativo será instalado' })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiProperty({ required: false, description: 'Centro de custo interno (equipe de TI)' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiProperty({ required: false, description: 'Preencher quando o ativo vai para um cliente externo sem Site cadastrado' })
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiProperty({ example: '2026-08-21' })
  @IsDateString()
  deliveryDate: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReturnAssetDto {
  @ApiProperty({ example: '2026-08-21' })
  @IsDateString()
  returnDate: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Transferência = devolução + nova alocação em um único passo (fecha a
 * alocação ativa atual, se houver, e abre uma nova no destino informado).
 * Usada para mover um ativo entre obras/filiais (centros de custo) ou entre
 * pessoas/departamentos sem precisar de duas chamadas separadas.
 */
export class TransferAssetDto {
  @ApiProperty({ description: 'Nome do colaborador ou cliente que vai passar a ficar com o ativo' })
  @IsString()
  assignedToName: string;

  @ApiProperty({ required: false, description: 'Nova obra/filial de destino' })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiProperty({ required: false, description: 'Novo centro de custo interno de destino' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiProperty({ example: '2026-08-21', description: 'Data em que a transferência ocorre' })
  @IsDateString()
  transferDate: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Corrige/preenche apenas o nome do responsável pela alocação ATIVA atual,
 * sem mexer em site/departamento nem fechar/abrir uma nova alocação — usado
 * principalmente depois de uma importação de extrato de locação, onde o PDF
 * normalmente não traz o nome do colaborador (só a obra/local), então o
 * ativo chega com "Não informado" e precisa ser corrigido manualmente.
 * Diferente de "Transferir": não gera um novo registro de movimentação nem
 * fecha/reabre a alocação, porque fisicamente nada mudou de lugar.
 */
export class UpdateAssignedToDto {
  @ApiProperty({ description: 'Nome do colaborador responsável pelo ativo' })
  @IsString()
  assignedToName: string;
}

export class SendToMaintenanceDto {
  @ApiProperty({ example: '2026-08-21' })
  @IsDateString()
  date: string;

  @ApiProperty({ required: false, description: 'Motivo/descrição do problema' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReturnFromMaintenanceDto {
  @ApiProperty({ example: '2026-08-21' })
  @IsDateString()
  date: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
