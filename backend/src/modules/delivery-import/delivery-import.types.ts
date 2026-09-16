import { ParsedDeliveryHeader, ParsedDeliveryItem } from './parsers/delivery-note-parser.service';

export interface DeliveryImportDiff {
  client: { action: 'CRIAR' | 'JÁ EXISTE'; cnpjRoot: string; name: string };
  site: { action: 'CRIAR' | 'JÁ EXISTE'; cnpj: string; name: string };
  obra: { action: 'CRIAR' | 'JÁ EXISTE'; costCenterLabel: string; name: string };
  assets: { toCreate: number; toUpdate: number; total: number };
}

/** Resultado do preview (dry-run) — nada é gravado; tudo aqui pode ser editado pelo usuário antes de confirmar. */
export interface DeliveryImportPreview {
  /** Key do PDF original já salvo no storage — reenviada no `execute` em vez do arquivo, pra não rodar OCR de novo. */
  fileKey: string;
  header: ParsedDeliveryHeader;
  items: ParsedDeliveryItem[];
  warnings: string[];
  diff: DeliveryImportDiff;
  /** Obras já cadastradas no Site resolvido (vazio se o Site ainda não existe) — a tela oferece como opção em vez de deixar digitar um nome novo por engano. */
  existingObras: { id: string; name: string; costCenterLabel: string }[];
}

export interface DeliveryImportSummary {
  clientId: string;
  clientCreated: boolean;
  siteId: string;
  siteCreated: boolean;
  obraId: string;
  obraCreated: boolean;
  supplierId: string;
  assetsCreated: number;
  assetsUpdated: number;
  allocationsCreated: number;
  allocationsClosed: number;
  warnings: string[];
}
