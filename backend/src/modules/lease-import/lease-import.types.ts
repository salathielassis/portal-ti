import { ParsedLeaseHeader, ParsedLeaseItem } from './parsers/lease-statement-parser.service';

/** Um item cujo valor cobrado destoa do valor de referência cadastrado para o tipo classificado. */
export interface PriceMismatchAlert {
  serialNumber: string;
  description: string;
  tierLabel: string;
  referenceValue: number;
  chargedValue: number;
}

/** Comparação do extrato desta importação contra o que já estava ativo naquele Site. */
export interface LeaseImportComparison {
  /** Ativo estava alocado neste Site na última importação e não aparece mais no extrato deste mês */
  removed: { serialNumber: string; description: string; assignedToName: string }[];
  /** Ativo já estava neste Site, mas o valor mensal cobrado mudou */
  valueChanged: { serialNumber: string; description: string; previousValue: number; newValue: number }[];
  /** Ativo aparece no extrato mas não estava alocado neste Site antes (novo ou transferido de outro lugar) */
  newAtSite: { serialNumber: string; description: string; totalValue: number }[];
}

/** Resultado de uma pré-visualização (dry-run) — nada é gravado no banco. */
export interface LeaseImportPreview {
  header: ParsedLeaseHeader;
  items: ParsedLeaseItem[];
  warnings: string[];
  diff: {
    client: { action: 'CRIAR' | 'JÁ EXISTE'; cnpjRoot: string; name: string };
    site: { action: 'CRIAR' | 'JÁ EXISTE'; cnpj: string; name: string };
    obra: { action: 'CRIAR' | 'JÁ EXISTE'; costCenterLabel: string; name: string };
    supplier: { action: 'CRIAR' | 'JÁ EXISTE'; cnpj: string; name: string };
    contract: { action: 'CRIAR' | 'JÁ EXISTE'; contractNumber: string };
    invoice: { action: 'CRIAR' | 'ATUALIZAR'; referenceMonth: string; grossValue: number | null };
    assets: { toCreate: number; toUpdate: number; total: number };
  };
  /** null quando o Site é novo (não há importação anterior para comparar) */
  comparison: LeaseImportComparison | null;
  priceAlerts: PriceMismatchAlert[];
}

/** Resultado da execução real da importação (cascata de upserts em transação). */
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
  allocationsCreated: number;
  allocationsUpdated: number;
  allocationsClosed: number;
  warnings: string[];
}
