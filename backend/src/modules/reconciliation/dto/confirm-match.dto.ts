import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum MatchDecision {
  CONFIRMADO = 'CONFIRMADO',
  REJEITADO = 'REJEITADO',
}

export class ConfirmMatchDto {
  @ApiProperty({ description: 'ID do ReconciliationMatch a ser revisado' })
  @IsUUID()
  matchId: string;

  @ApiProperty({ enum: MatchDecision })
  @IsEnum(MatchDecision)
  decision: MatchDecision;
}

export class ManualMatchDto {
  @ApiProperty({ description: 'ID da transação bancária (BankTransaction) sem match' })
  @IsUUID()
  bankTransactionId: string;

  @ApiProperty({ description: 'ID da fatura (Invoice) a associar manualmente' })
  @IsUUID()
  invoiceId: string;
}
