import { AssetStatus } from '@prisma/client';
import { ParsedLeaseHeader, ParsedLeaseItem } from './parsers/lease-statement-parser.service';

/** Um item cujo valor cobrado destoa do valor de referência cadastrado para o tipo classificado. */
export interface PriceMismatchAlert {
  serialNumber: string;
  description: string;
  tierLabel: string;
  referenceValue: number;
  chargedValue: number;
}

/**
 * Situação de um equipamento do extrato comparado com o cadastro atual.
 * Um item pode ter mais de uma (ex.: OUTRA_OBRA + VALOR_ALTERADO).
 */
export type ReconciliationFlag =
  /** Não existe no sistema — será cadastrado. */
  | 'NOVO'
  /** Já está nesta obra, mesmo valor, nada muda. */
  | 'SEM_MUDANCA'
  /** Valor mensal cobrado mudou em relação ao cadastrado. */
  | 'VALOR_ALTERADO'
  /** Ativo não tinha valor mensal (ex.: veio da guia de entrega) — será preenchido. */
  | 'VALOR_PREENCHIDO'
  /** No sistema o ativo está em OUTRA obra — a locadora fatura nesta. */
  | 'OUTRA_OBRA'
  /** No sistema o ativo está no estoque (sem uso), mas segue sendo cobrado. */
  | 'EM_ESTOQUE'
  /** Em manutenção no sistema, mas segue sendo cobrado. */
  | 'EM_MANUTENCAO'
  /** Marcado como devolvido à locadora, mas ainda aparece cobrado no extrato. */
  | 'DEVOLVIDO_MAS_COBRADO'
  /** Descartado no sistema, mas ainda aparece cobrado no extrato. */
  | 'DESCARTADO_MAS_COBRADO'
  /** O tombo (P.A.T.) do extrato é diferente do patrimônio cadastrado. */
  | 'TOMBO_DIVERGENTE'
  /** Achado pelo tombo, mas o nº de série cadastrado é outro. */
  | 'SERIE_DIVERGENTE'
  /** O extrato traz um responsável (campo LOCAL) diferente do cadastrado. */
  | 'RESPONSAVEL_DIFERENTE'
  /** Cadastro com modelo "cru" (descrição inteira) — marca/modelo/CPU/RAM/SSD serão separados. */
  | 'DADOS_A_ORGANIZAR';

export interface ReconciliationSystemSide {
  assetId: string;
  assetTag: string;
  serialNumber: string;
  brand: string;
  model: string;
  status: AssetStatus;
  monthlyValue: number | null;
  obraId: string | null;
  obraName: string | null;
  siteName: string | null;
  assignedToName: string | null;
}

export interface ReconciliationRow {
  serialNumber: string;
  pat: string;
  description: string;
  allocatedTo: string | null;
  installationDate: Date | null;
  extratoValue: number;
  /** Como a descrição do extrato será separada nos campos do ativo. */
  parsed: { brand: string; model: string; cpu: string | null; ram: string | null; storage: string | null; gpu: string | null };
  system: ReconciliationSystemSide | null;
  flags: ReconciliationFlag[];
}

/** Ativo que está no sistema (nesta obra ou neste contrato) mas NÃO veio no extrato. */
export interface ReconciliationMissingRow {
  assetId: string;
  assetTag: string;
  serialNumber: string;
  brand: string;
  model: string;
  status: AssetStatus;
  monthlyValue: number | null;
  obraName: string | null;
  assignedToName: string | null;
  reason: 'NA_OBRA' | 'NO_CONTRATO';
}

export interface LeaseReconciliation {
  rows: ReconciliationRow[];
  missing: ReconciliationMissingRow[];
  summary: Record<ReconciliationFlag, number> & { total: number; missing: number };
}

export interface ObraOption {
  id: string;
  name: string;
  costCenterLabel: string;
  aliases: string[];
  siteId: string;
  siteName: string;
  siteCnpj: string;
  active: boolean;
  /** Quantos equipamentos deste extrato já estão alocados nesta obra hoje. */
  assetsFromStatement: number;
}

/** Resultado de uma pré-visualização (dry-run) — nada é gravado no banco. */
export interface LeaseImportPreview {
  header: ParsedLeaseHeader;
  items: ParsedLeaseItem[];
  warnings: string[];
  diff: {
    client: { action: 'CRIAR' | 'JÁ EXISTE'; cnpjRoot: string; name: string };
    site: { action: 'CRIAR' | 'JÁ EXISTE'; cnpj: string; name: string };
    obra: {
      action: 'CRIAR' | 'JÁ EXISTE';
      costCenterLabel: string;
      name: string;
      obraId: string | null;
      /** Como a obra de destino foi escolhida. */
      matchedBy: 'ESCOLHIDA' | 'CLASSIFICACAO' | 'EQUIPAMENTOS' | 'NOVA';
    };
    supplier: { action: 'CRIAR' | 'JÁ EXISTE'; cnpj: string; name: string };
    contract: { action: 'CRIAR' | 'JÁ EXISTE'; contractNumber: string };
    invoice: { action: 'CRIAR' | 'ATUALIZAR'; referenceMonth: string; grossValue: number | null };
    assets: { toCreate: number; toUpdate: number; total: number };
  };
  /** Obras já cadastradas do cliente — a tela deixa escolher o destino em vez de criar outra. */
  obraOptions: ObraOption[];
  reconciliation: LeaseReconciliation;
  priceAlerts: PriceMismatchAlert[];
}

/** Opções escolhidas pelo usuário na tela, enviadas junto com o PDF. */
export interface LeaseImportOptions {
  /** Obra existente de destino. Vazio = resolver pela CLASSIFICAÇÃO (ou criar nova). */
  obraId?: string;
  /** Nome legível da obra quando ela for criada agora. */
  newObraName?: string;
  /**
   * Não sugerir obra pelos equipamentos — criar uma nova (a menos que já
   * exista, no estabelecimento, uma obra que responda por esta mesma
   * classificação: aí usa ela, para não duplicar).
   */
  forceNewObra?: boolean;
  /** Mover para a obra de destino os ativos que o sistema tem em outra obra. Padrão: não mover. */
  moveFromOtherObras?: boolean;
}

/** Resultado da execução real da importação. */
export interface LeaseImportSummary {
  clientId: string;
  clientCreated: boolean;
  siteId: string;
  siteCreated: boolean;
  obraId: string;
  obraCreated: boolean;
  supplierId: string;
  supplierCreated: boolean;
  contractId: string;
  contractCreated: boolean;
  invoiceId: string;
  invoiceCreated: boolean;
  assetsCreated: number;
  assetsUpdated: number;
  assetsReorganized: number;
  allocationsCreated: number;
  allocationsUpdated: number;
  allocationsClosed: number;
  /** Ativos que o sistema tem em outra obra e foram mantidos lá (não movidos). */
  keptInOtherObra: number;
  /** Ativos em estoque/manutenção/devolvidos/descartados cujo status foi preservado. */
  statusPreserved: number;
  warnings: string[];
}
