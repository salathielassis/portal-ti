import { Injectable } from '@nestjs/common';
import { AssetOwnership, AssetStatus, AssetType, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

export type ExportFormat = 'xlsx' | 'pdf';

export interface ExportFilters {
  status?: AssetStatus;
  ownership?: AssetOwnership;
  type?: AssetType;
  contractId?: string;
  siteId?: string;
  obraId?: string;
  search?: string;
  /** Seleção manual de linhas — quando presente, ignora os demais filtros. */
  ids?: string[];
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const TYPE_LABEL: Record<AssetType, string> = {
  NOTEBOOK: 'Notebook',
  IMPRESSORA: 'Impressora',
  MONITOR: 'Monitor',
  PERIFERICO: 'Periférico',
  OUTRO: 'Outro',
};

const OWNERSHIP_LABEL: Record<AssetOwnership, string> = {
  PROPRIO: 'Próprio',
  LOCADO: 'Locado',
};

const STATUS_LABEL: Record<AssetStatus, string> = {
  EM_USO: 'Em uso',
  ESTOQUE: 'Estoque',
  MANUTENCAO: 'Manutenção',
  DESCARTADO: 'Descartado',
  EM_TRANSITO: 'Em trânsito',
  DEVOLVIDO: 'Devolvido',
};

interface ExportRow {
  assetTag: string;
  serialNumber: string;
  type: string;
  brand: string;
  model: string;
  cpu: string;
  ram: string;
  storage: string;
  gpu: string;
  ownership: string;
  status: string;
  priceTierLabel: string;
  referenceValue: number | null;
  monthlyValue: number | null;
  priceDelta: number | null;
  contractNumber: string;
  supplierName: string;
  costCenter: string;
  clientName: string;
  department: string;
  assignedToName: string;
  installationDate: Date | null;
  deliveryDate: Date | null;
  returnDate: Date | null;
  purchaseValue: number | null;
  purchaseDate: Date | null;
  warrantyEndDate: Date | null;
}

interface ExportSummary {
  byCostCenter: { label: string; count: number; monthly: number }[];
  byStatus: { label: string; count: number }[];
  totalMonthly: number;
  totalCount: number;
}

function brl(n: number): string {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDateTime(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

type AssetForTermo = Prisma.AssetGetPayload<{ include: { priceTier: true } }>;
type AllocationForTermo = Prisma.AssetAllocationGetPayload<{
  include: { site: true; obra: true; department: true };
}>;

// Conteúdo replicado dos modelos oficiais da empresa (.docx fornecidos pelo
// usuário: "TERMO DE RESPONSABILIDADE - EQUIPAMENTOS DE TI" e "TERMO DE
// DEVOLUCAO - EQUIPAMENTOS DE TI"). A logo (backend/assets/logo-dois-a.png)
// também foi extraída desses arquivos.
const EMPRESA_NOME = 'DOIS A ENGENHARIA';
const EMPRESA_CNPJ = '03.092.799/0001-81';
const LOGO_PATH = path.join(process.cwd(), 'assets', 'logo-dois-a.png');
const LOGO_RATIO = 221 / 746; // altura/largura de logo-dois-a.png
// Contatos do rodapé do timbrado oficial (Manual de Identidade Visual 2023).
const EMPRESA_CONTATO = 'www.doisa.com  |  +55 (84) 3133.4488';
const EMPRESA_ENDERECO = 'Av. Deodoro da Fonseca, 479 - Petrópolis  ·  CEP: 59020-025 - Natal/RN - Brasil';

// Paleta do Manual de Identidade Visual Dois A 2023 (azul Pantone 7687 C =
// RGB 45/79/158; laranja Pantone 716 C = RGB 219/129/46) + neutros de apoio.
const BRAND = {
  blue: '#2D4F9E',
  orange: '#DB812E',
  ink: '#1A1A1A',
  muted: '#5B6475',
  line: '#D5DBE8',
  tint: '#EEF2FA',
  bandText: '#DCE3F3',
} as const;

interface TermoRun {
  text: string;
  bold?: boolean;
}

interface TermoField {
  label: string;
  value: string;
  /** Ocupa a linha inteira da grade (ex.: "Modelo", que costuma ser longo). */
  full?: boolean;
}

interface TermoEquipment {
  title: string;
  fields: TermoField[];
}

const ENTREGA_CLAUSES = [
  'Declaro estar ciente de que o equipamento me foi entregue em perfeito estado de funcionamento e conservação.',
  'Comprometo-me a utilizar os equipamentos única e exclusivamente para fins profissionais, não sendo permitido o uso por terceiros ou para atividades de cunho pessoal ou ilegal.',
  'Fico ciente de que é minha responsabilidade zelar pela conservação, integridade física e segurança dos equipamentos enquanto estiverem sob minha guarda, incluindo cuidados quanto a transporte, armazenamento e uso adequado.',
  'Comprometo-me a comunicar imediatamente ao setor de TI qualquer dano, extravio, furto ou roubo, bem como qualquer defeito que comprometa o funcionamento dos equipamentos.',
  'Em caso de dano decorrente de mau uso, negligência ou uso indevido, autorizo a empresa a avaliar e, se for o caso, descontar de minha remuneração o valor referente ao conserto ou substituição dos equipamentos.',
  'Obrigo-me a devolver os equipamentos ao Setor de Tecnologia da Informação nas mesmas condições em que foram entregues, ressalvado o desgaste natural pelo uso, sempre que solicitado ou ao término do vínculo contratual com a empresa.',
] as const;

const DEVOLUCAO_CLAUSES = [
  'Declaro estar ciente de que o equipamento me foi entregue em perfeito estado de funcionamento e conservação e que estou devolvendo-o da mesma forma.',
  'Declaro estar ciente de que qualquer dano ocorrido de mal uso poderá/será descontado de meu salário.',
] as const;

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * `utc: true` para datas armazenadas como "dia puro" (meia-noite UTC, ex.:
 * Asset­Allocation.deliveryDate) — extrair com getters locais erraria o dia
 * em qualquer servidor com fuso atrás de UTC (ex.: America/Sao_Paulo).
 * `utc: false` (default) para um instante real como "agora" (new Date()).
 */
function dataPorExtenso(d: Date, utc = false): string {
  const day = utc ? d.getUTCDate() : d.getDate();
  const month = utc ? d.getUTCMonth() : d.getMonth();
  const year = utc ? d.getUTCFullYear() : d.getFullYear();
  return `${day} de ${MESES[month]} de ${year}`;
}

/**
 * Geração dos relatórios de equipamentos (aba "Relatórios" do frontend).
 * Reaproveita os mesmos filtros da listagem de ativos (status, propriedade,
 * tipo, contrato, filial/centro de custo, busca livre) e produz um arquivo
 * pronto para enviar à gestão/diretoria:
 *
 *  - XLSX: uma aba "Equipamentos" com TODAS as colunas de referência + uma
 *    aba "Resumo" com totais por centro de custo e contagem por status.
 *  - PDF: paisagem, com um subconjunto das colunas (as que cabem numa
 *    página e interessam à diretoria) + o mesmo resumo ao final.
 */
@Injectable()
export class AssetsExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(format: ExportFormat, filters: ExportFilters): Promise<ExportResult> {
    const rows = await this.fetchRows(filters);
    const summary = this.summarize(rows);
    const filterSummary = await this.describeFilters(filters);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'pdf') {
      const buffer = await this.toPdf(rows, summary, filterSummary);
      return {
        buffer,
        filename: `relatorio-equipamentos-${stamp}.pdf`,
        contentType: 'application/pdf',
      };
    }

    const buffer = await this.toXlsx(rows, summary, filterSummary);
    return {
      buffer,
      filename: `relatorio-equipamentos-${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async fetchRows(f: ExportFilters): Promise<ExportRow[]> {
    const where: Prisma.AssetWhereInput = f.ids?.length
      ? { id: { in: f.ids } }
      : {
          ...(f.status && { status: f.status }),
          ...(f.ownership && { ownership: f.ownership }),
          ...(f.type && { type: f.type }),
          ...(f.contractId && { contractId: f.contractId }),
          ...(f.siteId && { allocations: { some: { isActive: true, siteId: f.siteId } } }),
          ...(f.obraId && { allocations: { some: { isActive: true, obraId: f.obraId } } }),
          ...(f.search && {
            OR: [
              { assetTag: { contains: f.search, mode: 'insensitive' } },
              { serialNumber: { contains: f.search, mode: 'insensitive' } },
              { brand: { contains: f.search, mode: 'insensitive' } },
              { model: { contains: f.search, mode: 'insensitive' } },
            ],
          }),
        };

    const assets = await this.prisma.asset.findMany({
      where,
      include: {
        supplier: true,
        contract: true,
        priceTier: true,
        // Alocação mais recente (ativa ou não) — para ativos DEVOLVIDO/ESTOQUE
        // ainda mostra o último centro de custo/responsável e a data de devolução.
        allocations: {
          orderBy: { deliveryDate: 'desc' },
          take: 1,
          include: { site: { include: { client: true } }, obra: true, department: true },
        },
      },
      orderBy: [{ status: 'asc' }, { assetTag: 'asc' }],
    });

    return assets.map((a) => {
      const alloc = a.allocations[0] ?? null;
      const ref = a.priceTier ? Number(a.priceTier.referenceValue) : null;
      const monthly = a.monthlyValue != null ? Number(a.monthlyValue) : null;
      const specs = (a.specs as { cpu?: string; ram?: string; storage?: string; gpu?: string } | null) ?? {};
      return {
        assetTag: a.assetTag,
        serialNumber: a.serialNumber,
        type: TYPE_LABEL[a.type],
        brand: a.brand,
        model: a.model,
        cpu: specs.cpu ?? '',
        ram: specs.ram ?? '',
        storage: specs.storage ?? '',
        gpu: specs.gpu ?? '',
        ownership: OWNERSHIP_LABEL[a.ownership],
        status: STATUS_LABEL[a.status],
        priceTierLabel: a.priceTier?.label ?? '',
        referenceValue: ref,
        monthlyValue: monthly,
        priceDelta: ref != null && monthly != null ? Number((monthly - ref).toFixed(2)) : null,
        contractNumber: a.contract?.contractNumber ?? '',
        supplierName: a.supplier?.name ?? '',
        costCenter:
          alloc?.obra?.name || alloc?.obra?.costCenterLabel || alloc?.site?.costCenterLabel || alloc?.site?.name || '',
        clientName: alloc?.site?.client?.name || alloc?.clientName || '',
        department: alloc?.department?.name ?? '',
        assignedToName: alloc?.assignedToName ?? '',
        installationDate: a.installationDate ?? null,
        deliveryDate: alloc?.deliveryDate ?? null,
        returnDate: alloc?.returnDate ?? null,
        purchaseValue: a.purchaseValue != null ? Number(a.purchaseValue) : null,
        purchaseDate: a.purchaseDate ?? null,
        warrantyEndDate: a.warrantyEndDate ?? null,
      };
    });
  }

  private summarize(rows: ExportRow[]): ExportSummary {
    const byCostCenter = new Map<string, { count: number; monthly: number }>();
    const byStatus = new Map<string, number>();
    let totalMonthly = 0;

    for (const r of rows) {
      const cc = r.costCenter || '(sem centro de custo)';
      const entry = byCostCenter.get(cc) ?? { count: 0, monthly: 0 };
      entry.count += 1;
      entry.monthly += r.monthlyValue ?? 0;
      byCostCenter.set(cc, entry);

      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
      totalMonthly += r.monthlyValue ?? 0;
    }

    return {
      byCostCenter: [...byCostCenter.entries()]
        .map(([label, e]) => ({ label, count: e.count, monthly: Number(e.monthly.toFixed(2)) }))
        .sort((a, b) => b.monthly - a.monthly),
      byStatus: [...byStatus.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      totalMonthly: Number(totalMonthly.toFixed(2)),
      totalCount: rows.length,
    };
  }

  private async describeFilters(f: ExportFilters): Promise<string> {
    if (f.ids?.length) return `Seleção manual de ${f.ids.length} equipamento(s)`;

    const parts: string[] = [];
    if (f.status) parts.push(`Status: ${STATUS_LABEL[f.status]}`);
    if (f.ownership) parts.push(`Propriedade: ${OWNERSHIP_LABEL[f.ownership]}`);
    if (f.type) parts.push(`Tipo: ${TYPE_LABEL[f.type]}`);
    if (f.contractId) {
      const c = await this.prisma.contract.findUnique({ where: { id: f.contractId } });
      if (c) parts.push(`Contrato: ${c.contractNumber}`);
    }
    if (f.siteId) {
      const s = await this.prisma.site.findUnique({ where: { id: f.siteId } });
      if (s) parts.push(`Estabelecimento: ${s.costCenterLabel || s.name}`);
    }
    if (f.obraId) {
      const o = await this.prisma.obra.findUnique({ where: { id: f.obraId } });
      if (o) parts.push(`Obra: ${o.name}`);
    }
    if (f.search) parts.push(`Busca: "${f.search}"`);
    return parts.length ? parts.join('  ·  ') : 'Todos os equipamentos';
  }

  private async toXlsx(
    rows: ExportRow[],
    summary: ExportSummary,
    filterSummary: string,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal TI';
    wb.created = new Date();

    const ws = wb.addWorksheet('Equipamentos', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Patrimônio', key: 'assetTag', width: 14 },
      { header: 'Nº de série', key: 'serialNumber', width: 20 },
      { header: 'Tipo', key: 'type', width: 12 },
      { header: 'Marca', key: 'brand', width: 14 },
      { header: 'Modelo', key: 'model', width: 26 },
      { header: 'Processador', key: 'cpu', width: 20 },
      { header: 'Memória RAM', key: 'ram', width: 12 },
      { header: 'Armazenamento', key: 'storage', width: 14 },
      { header: 'Placa de vídeo', key: 'gpu', width: 18 },
      { header: 'Propriedade', key: 'ownership', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Tipo de referência', key: 'priceTierLabel', width: 22 },
      { header: 'Valor de referência', key: 'referenceValue', width: 16 },
      { header: 'Valor mensal cobrado', key: 'monthlyValue', width: 18 },
      { header: 'Diferença (mensal − ref.)', key: 'priceDelta', width: 20 },
      { header: 'Contrato', key: 'contractNumber', width: 16 },
      { header: 'Fornecedor', key: 'supplierName', width: 22 },
      { header: 'Centro de custo / Obra', key: 'costCenter', width: 26 },
      { header: 'Cliente', key: 'clientName', width: 20 },
      { header: 'Departamento', key: 'department', width: 18 },
      { header: 'Responsável', key: 'assignedToName', width: 24 },
      { header: 'Data de instalação', key: 'installationDate', width: 16 },
      { header: 'Data de entrega', key: 'deliveryDate', width: 16 },
      { header: 'Data de devolução', key: 'returnDate', width: 16 },
      { header: 'Valor de compra', key: 'purchaseValue', width: 16 },
      { header: 'Data de compra', key: 'purchaseDate', width: 16 },
      { header: 'Fim da garantia', key: 'warrantyEndDate', width: 16 },
    ];

    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    header.alignment = { vertical: 'middle' };

    for (const r of rows) {
      ws.addRow({
        ...r,
        installationDate: r.installationDate ?? null,
        deliveryDate: r.deliveryDate ?? null,
        returnDate: r.returnDate ?? null,
        purchaseDate: r.purchaseDate ?? null,
        warrantyEndDate: r.warrantyEndDate ?? null,
      });
    }

    const currencyCols = ['referenceValue', 'monthlyValue', 'priceDelta', 'purchaseValue'];
    for (const key of currencyCols) {
      ws.getColumn(key).numFmt = '"R$" #,##0.00';
    }
    const dateCols = [
      'installationDate',
      'deliveryDate',
      'returnDate',
      'purchaseDate',
      'warrantyEndDate',
    ];
    for (const key of dateCols) {
      ws.getColumn(key).numFmt = 'dd/mm/yyyy';
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

    // ---- Aba Resumo ----
    const rs = wb.addWorksheet('Resumo');
    rs.getColumn(1).width = 40;
    rs.getColumn(2).width = 20;
    rs.getColumn(3).width = 22;

    rs.addRow(['Relatório de Equipamentos — Portal TI']).font = { bold: true, size: 14 };
    rs.addRow(['Gerado em', fmtDateTime(new Date())]);
    rs.addRow(['Filtros', filterSummary]);
    rs.addRow([]);

    const ccHeader = rs.addRow(['Centro de custo', 'Qtd. equipamentos', 'Valor mensal total']);
    ccHeader.font = { bold: true };
    for (const c of summary.byCostCenter) {
      rs.addRow([c.label, c.count, c.monthly]);
    }
    const totalRow = rs.addRow(['TOTAL', summary.totalCount, summary.totalMonthly]);
    totalRow.font = { bold: true };
    rs.addRow([]);

    const stHeader = rs.addRow(['Status', 'Qtd. equipamentos']);
    stHeader.font = { bold: true };
    for (const s of summary.byStatus) {
      rs.addRow([s.label, s.count]);
    }
    rs.getColumn(3).numFmt = '"R$" #,##0.00';

    const out = await wb.xlsx.writeBuffer();
    return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
  }

  private toPdf(rows: ExportRow[], summary: ExportSummary, filterSummary: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;

      const cols: { header: string; width: number; align?: 'left' | 'right'; get: (r: ExportRow) => string }[] = [
        { header: 'Patrimônio', width: 58, get: (r) => r.assetTag },
        { header: 'Equipamento', width: 138, get: (r) => `${r.brand} ${r.model}`.trim() },
        { header: 'Tipo de ref.', width: 88, get: (r) => r.priceTierLabel || '—' },
        { header: 'Prop.', width: 42, get: (r) => r.ownership },
        { header: 'Status', width: 60, get: (r) => r.status },
        { header: 'Centro de custo', width: 118, get: (r) => r.costCenter || '—' },
        { header: 'Responsável', width: 98, get: (r) => r.assignedToName || '—' },
        { header: 'Contrato', width: 64, get: (r) => r.contractNumber || '—' },
        { header: 'Valor mensal', width: 66, align: 'right', get: (r) => (r.monthlyValue != null ? brl(r.monthlyValue) : '—') },
      ];
      const totalW = cols.reduce((acc, c) => acc + c.width, 0);
      const rowH = 14;

      let y = doc.page.margins.top;

      // Cabeçalho do documento
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a');
      doc.text('Relatório de Equipamentos — Portal TI', left, y);
      y = doc.y + 2;
      doc.font('Helvetica').fontSize(8).fillColor('#475569');
      doc.text(`Gerado em ${fmtDateTime(new Date())}`, left, y);
      y = doc.y;
      doc.text(`Filtros: ${filterSummary}`, left, y, { width: totalW });
      y = doc.y;
      doc.text(`${summary.totalCount} equipamento(s)  ·  Valor mensal total: ${brl(summary.totalMonthly)}`, left, y);
      y = doc.y + 8;

      const drawTableHeader = () => {
        doc.rect(left, y, totalW, rowH + 2).fill('#1e293b');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
        let x = left;
        for (const c of cols) {
          doc.text(c.header, x + 3, y + 4, {
            width: c.width - 6,
            align: c.align ?? 'left',
            lineBreak: false,
            ellipsis: true,
          });
          x += c.width;
        }
        y += rowH + 2;
      };

      drawTableHeader();
      doc.font('Helvetica').fontSize(7);
      rows.forEach((r, i) => {
        if (y + rowH > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
          drawTableHeader();
          doc.font('Helvetica').fontSize(7);
        }
        if (i % 2 === 1) {
          doc.rect(left, y, totalW, rowH).fill('#f1f5f9');
        }
        let x = left;
        for (const c of cols) {
          doc.fillColor('#0f172a').text(c.get(r) || '—', x + 3, y + 3.5, {
            width: c.width - 6,
            align: c.align ?? 'left',
            lineBreak: false,
            ellipsis: true,
          });
          x += c.width;
        }
        y += rowH;
      });

      // ---- Resumo ----
      const ensureSpace = (needed: number) => {
        if (y + needed > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      };

      y += 18;
      ensureSpace(120);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Resumo por centro de custo', left, y);
      y = doc.y + 6;

      const ccCols = [
        { header: 'Centro de custo', width: 320, align: 'left' as const },
        { header: 'Qtd.', width: 70, align: 'right' as const },
        { header: 'Valor mensal', width: 120, align: 'right' as const },
      ];
      const ccW = ccCols.reduce((acc, c) => acc + c.width, 0);
      doc.rect(left, y, ccW, rowH + 2).fill('#1e293b');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      let cx = left;
      for (const c of ccCols) {
        doc.text(c.header, cx + 3, y + 4, { width: c.width - 6, align: c.align, lineBreak: false });
        cx += c.width;
      }
      y += rowH + 2;

      doc.font('Helvetica').fontSize(8);
      summary.byCostCenter.forEach((c, i) => {
        ensureSpace(rowH);
        if (i % 2 === 1) doc.rect(left, y, ccW, rowH).fill('#f1f5f9');
        doc.fillColor('#0f172a');
        doc.text(c.label, left + 3, y + 3.5, { width: ccCols[0].width - 6, lineBreak: false, ellipsis: true });
        doc.text(String(c.count), left + ccCols[0].width + 3, y + 3.5, { width: ccCols[1].width - 6, align: 'right', lineBreak: false });
        doc.text(brl(c.monthly), left + ccCols[0].width + ccCols[1].width + 3, y + 3.5, { width: ccCols[2].width - 6, align: 'right', lineBreak: false });
        y += rowH;
      });
      ensureSpace(rowH);
      doc.font('Helvetica-Bold').fillColor('#0f172a');
      doc.text('TOTAL', left + 3, y + 3.5, { width: ccCols[0].width - 6, lineBreak: false });
      doc.text(String(summary.totalCount), left + ccCols[0].width + 3, y + 3.5, { width: ccCols[1].width - 6, align: 'right', lineBreak: false });
      doc.text(brl(summary.totalMonthly), left + ccCols[0].width + ccCols[1].width + 3, y + 3.5, { width: ccCols[2].width - 6, align: 'right', lineBreak: false });
      y += rowH + 18;

      ensureSpace(40 + summary.byStatus.length * rowH);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Resumo por status', left, y);
      y = doc.y + 6;
      const stW = 390;
      doc.rect(left, y, stW, rowH + 2).fill('#1e293b');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      doc.text('Status', left + 3, y + 4, { width: 300, lineBreak: false });
      doc.text('Qtd.', left + 320, y + 4, { width: 66, align: 'right', lineBreak: false });
      y += rowH + 2;
      doc.font('Helvetica').fontSize(8);
      summary.byStatus.forEach((s, i) => {
        ensureSpace(rowH);
        if (i % 2 === 1) doc.rect(left, y, stW, rowH).fill('#f1f5f9');
        doc.fillColor('#0f172a');
        doc.text(s.label, left + 3, y + 3.5, { width: 300, lineBreak: false });
        doc.text(String(s.count), left + 320, y + 3.5, { width: 66, align: 'right', lineBreak: false });
        y += rowH;
      });

      doc.end();
    });
  }

  private async loadLogo(): Promise<Buffer | null> {
    try {
      return await fs.readFile(LOGO_PATH);
    } catch {
      return null; // segue sem logo se o arquivo não existir no ambiente
    }
  }

  /** Dados do equipamento no formato do card "1. Relação de equipamentos":
   * nome do tipo em destaque + grade de campos (rótulo/valor). Os rótulos
   * seguem cada modelo oficial ("Tombo" no de entrega, "Número do Patrimônio"
   * no de devolução). */
  private equipmentBlock(asset: AssetForTermo, kind: 'entrega' | 'devolucao'): TermoEquipment {
    const specs = asset.specs as { cpu?: string; ram?: string; storage?: string; gpu?: string } | null;
    const modelo = `${asset.brand} ${asset.model}`.trim();
    const comCarregador = asset.type === 'NOTEBOOK';

    const specFields: TermoField[] = [
      ...(specs?.cpu ? [{ label: 'Processador', value: specs.cpu }] : []),
      ...(specs?.ram ? [{ label: 'Memória RAM', value: specs.ram }] : []),
      ...(specs?.storage ? [{ label: 'SSD', value: specs.storage }] : []),
      ...(specs?.gpu ? [{ label: 'Placa de vídeo', value: specs.gpu }] : []),
      ...(comCarregador
        ? [{ label: 'Acessórios', value: kind === 'entrega' ? 'Com carregador' : 'Carregador/Fonte de alimentação' }]
        : []),
    ];

    return {
      title: TYPE_LABEL[asset.type],
      fields: [
        { label: 'Modelo', value: modelo || '—', full: true },
        { label: kind === 'entrega' ? 'Tombo' : 'Número do Patrimônio', value: asset.assetTag },
        { label: 'Número de Série', value: asset.serialNumber },
        ...specFields,
      ],
    };
  }

  /**
   * Monta o PDF do termo (entrega ou devolução). Texto replicado dos modelos
   * oficiais (.docx); visual segue o Manual de Identidade Visual Dois A 2023
   * (azul #2D4F9E, laranja #DB812E, timbrado com faixa azul + logo em caixa
   * branca e rodapé centralizado com contatos). Reaproveitado por
   * generateTermo() e generateTermoDevolucao(), que só variam o texto de
   * abertura, as cláusulas e se há "Disposições gerais".
   */
  private async renderTermo(opts: {
    kind: 'entrega' | 'devolucao';
    title: string;
    subtitle: string;
    openingParagraph: TermoRun[];
    assetTag: string;
    equipment: TermoEquipment;
    clauses: readonly string[];
    disposicoesGerais?: readonly string[];
    signDateLabel: string;
    signerName: string;
    signerCpf?: string | null;
  }): Promise<Buffer> {
    const logo = await this.loadLogo();
    const generatedAt = fmtDateTime(new Date());

    return new Promise((resolve, reject) => {
      // Margens superior/inferior reservam o espaço do timbrado (faixa azul) e
      // do rodapé, que são desenhados no fim em todas as páginas (bufferPages).
      const doc = new PDFDocument({
        size: 'A4',
        bufferPages: true,
        margins: { top: 84, bottom: 66, left: 54, right: 54 },
        info: { Title: opts.title, Author: EMPRESA_NOME, Creator: 'Portal TI' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const left = doc.page.margins.left;
      const contentWidth = pageW - left - doc.page.margins.right;
      const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

      const ensureSpace = (needed: number) => {
        if (doc.y + needed > bottomLimit()) doc.addPage();
        doc.x = left;
      };

      // ---- Título ----
      doc.font('Helvetica-Bold').fontSize(17).fillColor(BRAND.blue);
      doc.text(opts.title, left, doc.y, { width: contentWidth, align: 'center', characterSpacing: 0.4 });
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(10).fillColor(BRAND.orange);
      doc.text(opts.subtitle, left, doc.y, { width: contentWidth, align: 'center' });
      const barY = doc.y + 7;
      doc.rect(left + contentWidth / 2 - 22, barY, 44, 2.5).fill(BRAND.orange);
      doc.x = left;
      doc.y = barY + 13;

      // ---- Abertura (com nome/CPF em negrito) ----
      doc.fontSize(9.8).fillColor(BRAND.ink);
      opts.openingParagraph.forEach((run, i) => {
        doc.font(run.bold ? 'Helvetica-Bold' : 'Helvetica').text(run.text, {
          width: contentWidth,
          align: 'justify',
          lineGap: 2.2,
          continued: i < opts.openingParagraph.length - 1,
        });
      });

      // Cabeçalho de seção: marcador ▸ laranja (como no manual) + título azul
      // + filete até a margem direita.
      const section = (label: string) => {
        ensureSpace(60);
        doc.y += 11;
        const sy = doc.y;
        doc
          .polygon([left, sy + 1.5], [left + 5, sy + 4.75], [left, sy + 8])
          .fill(BRAND.orange);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BRAND.blue);
        doc.text(label, left + 11, sy, { lineBreak: false });
        const textEnd = left + 11 + doc.widthOfString(label) + 8;
        doc
          .moveTo(textEnd, sy + 5)
          .lineTo(left + contentWidth, sy + 5)
          .lineWidth(0.6)
          .strokeColor(BRAND.line)
          .stroke();
        doc.x = left;
        doc.y = sy + 17;
      };

      // ---- 1. Relação de equipamentos (card com grade de campos) ----
      section('1. RELAÇÃO DE EQUIPAMENTOS');
      {
        const pad = 12;
        const accent = 3;
        const innerX = left + accent + pad;
        const innerW = contentWidth - accent - pad * 2;
        const cols = 3;
        const gap = 12;
        const colW = (innerW - gap * (cols - 1)) / cols;
        const labelH = 10;

        // Monta as linhas da grade antes de desenhar, para saber a altura do card.
        type Cell = TermoField & { col: number; span: number };
        const rows: Cell[][] = [];
        let current: Cell[] = [];
        let used = 0;
        for (const f of opts.equipment.fields) {
          const span = f.full ? cols : 1;
          if (used + span > cols) {
            rows.push(current);
            current = [];
            used = 0;
          }
          current.push({ ...f, col: used, span });
          used += span;
        }
        if (current.length) rows.push(current);

        doc.font('Helvetica-Bold').fontSize(9.5);
        const cellW = (c: Cell) => colW * c.span + gap * (c.span - 1);
        const rowHeights = rows.map(
          (r) => labelH + Math.max(...r.map((c) => doc.heightOfString(c.value || '—', { width: cellW(c) }))) + 8,
        );
        const titleH = 16;
        const cardH = pad + titleH + rowHeights.reduce((a, b) => a + b, 0) + pad - 8;

        ensureSpace(cardH);
        const top = doc.y;
        doc.rect(left, top, contentWidth, cardH).fill(BRAND.tint);
        doc.rect(left, top, accent, cardH).fill(BRAND.blue);

        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BRAND.blue);
        doc.text(opts.equipment.title.toUpperCase(), innerX, top + pad, { lineBreak: false, characterSpacing: 0.6 });

        let ry = top + pad + titleH;
        rows.forEach((r, i) => {
          for (const c of r) {
            const cx = innerX + c.col * (colW + gap);
            doc.font('Helvetica').fontSize(7).fillColor(BRAND.muted);
            doc.text(c.label.toUpperCase(), cx, ry, { width: cellW(c), lineBreak: false, characterSpacing: 0.5 });
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BRAND.ink);
            doc.text(c.value || '—', cx, ry + labelH, { width: cellW(c) });
          }
          ry += rowHeights[i];
        });
        doc.x = left;
        doc.y = top + cardH;
      }

      // ---- 2. Cláusulas ----
      section(`2. CLÁUSULAS DE ${opts.kind === 'entrega' ? 'RESPONSABILIDADE' : 'DEVOLUÇÃO'}`);
      opts.clauses.forEach((clause, i) => {
        doc.fontSize(9.3);
        ensureSpace(doc.heightOfString(`Cláusula ${i + 1}ª – ${clause}`, { width: contentWidth }) + 6);
        doc.font('Helvetica-Bold').fillColor(BRAND.blue).text(`Cláusula ${i + 1}ª – `, left, doc.y, {
          width: contentWidth,
          align: 'justify',
          lineGap: 1.3,
          continued: true,
        });
        doc.font('Helvetica').fillColor(BRAND.ink).text(clause, { align: 'justify', lineGap: 1.3 });
        doc.y += 4;
      });

      // ---- 3. Disposições gerais ----
      if (opts.disposicoesGerais?.length) {
        section('3. DISPOSIÇÕES GERAIS');
        doc.font('Helvetica').fontSize(9.3).fillColor(BRAND.ink);
        for (const p of opts.disposicoesGerais) {
          ensureSpace(doc.heightOfString(p, { width: contentWidth }) + 5);
          doc.text(p, left, doc.y, { width: contentWidth, align: 'justify', lineGap: 1.3 });
          doc.y += 4;
        }
      }

      // ---- Data + assinaturas (bloco nunca é quebrado entre páginas) ----
      {
        const colGap = 36;
        const sigW = (contentWidth - colGap) / 2;
        // Espaço livre para a assinatura de próprio punho: mínimo de 46pt,
        // crescendo até 72pt quando sobra página (ex.: termo de devolução).
        const minSignSpace = 46;
        const maxSignSpace = 72;
        const infoH = 46; // nome + detalhe + papel abaixo da linha
        ensureSpace(14 + 14 + minSignSpace + infoH);
        doc.y += 14;

        doc.font('Helvetica-Bold').fontSize(9.8).fillColor(BRAND.ink);
        doc.text(`Natal/RN, ${opts.signDateLabel}.`, left, doc.y, { width: contentWidth, align: 'right' });

        const signSpace = Math.min(maxSignSpace, Math.max(minSignSpace, bottomLimit() - doc.y - infoH));
        const lineY = doc.y + signSpace;
        const signature = (x: number, name: string, detail: string, role: string) => {
          doc.moveTo(x, lineY).lineTo(x + sigW, lineY).lineWidth(0.8).strokeColor(BRAND.ink).stroke();
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BRAND.ink);
          doc.text(name, x, lineY + 6, { width: sigW, align: 'center' });
          doc.font('Helvetica').fontSize(8.5).fillColor(BRAND.muted);
          doc.text(detail, x, doc.y + 1, { width: sigW, align: 'center' });
          doc.font('Helvetica-Bold').fontSize(7).fillColor(BRAND.orange);
          doc.text(role, x, doc.y + 3, { width: sigW, align: 'center', characterSpacing: 0.8 });
          return doc.y;
        };

        const yA = signature(
          left,
          opts.signerName,
          `CPF: ${opts.signerCpf || '____________________'}`,
          'COLABORADOR(A)',
        );
        const yB = signature(
          left + sigW + colGap,
          'Responsável do Setor de TI',
          `${EMPRESA_NOME} – CNPJ: ${EMPRESA_CNPJ}`,
          'TECNOLOGIA DA INFORMAÇÃO',
        );
        doc.x = left;
        doc.y = Math.max(yA, yB);
      }

      // ---- Timbrado (cabeçalho/rodapé) em todas as páginas ----
      const range = doc.bufferedPageRange();
      const docLabel = opts.kind === 'entrega' ? 'Termo de Responsabilidade' : 'Termo de Devolução';
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Sem margem inferior enquanto desenha o rodapé — senão o PDFKit
        // abriria uma página nova ao escrever abaixo dela.
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        // Cabeçalho: faixa azul + filete laranja, logo em caixa branca à esquerda.
        const bandH = 58;
        doc.rect(0, 0, pageW, bandH).fill(BRAND.blue);
        doc.rect(0, bandH, pageW, 3).fill(BRAND.orange);
        const logoBoxW = 118;
        const logoBoxH = 40;
        const logoBoxY = (bandH - logoBoxH) / 2;
        doc.rect(left, logoBoxY, logoBoxW, logoBoxH).fill('#ffffff');
        if (logo) {
          try {
            const lw = logoBoxW - 20;
            doc.image(logo, left + 10, logoBoxY + (logoBoxH - lw * LOGO_RATIO) / 2, { width: lw });
          } catch {
            // logo corrompida/formato inválido — mantém só a caixa
          }
        }
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
        doc.text('TECNOLOGIA DA INFORMAÇÃO', left, 18, {
          width: contentWidth,
          align: 'right',
          characterSpacing: 1.2,
          lineBreak: false,
        });
        doc.font('Helvetica').fontSize(8).fillColor(BRAND.bandText);
        doc.text(`${docLabel}  ·  Patrimônio ${opts.assetTag}`, left, 31, {
          width: contentWidth,
          align: 'right',
          lineBreak: false,
        });

        // Rodapé: contatos centralizados (como no timbrado oficial) + faixa
        // azul/laranja na base, metadados de geração e paginação.
        const fy = pageH - 54;
        doc.moveTo(left, fy - 8).lineTo(left + contentWidth, fy - 8).lineWidth(0.5).strokeColor(BRAND.line).stroke();
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND.blue);
        doc.text(EMPRESA_CONTATO, left, fy, { width: contentWidth, align: 'center', lineBreak: false });
        doc.font('Helvetica').fontSize(7).fillColor(BRAND.muted);
        doc.text(EMPRESA_ENDERECO, left, fy + 10, { width: contentWidth, align: 'center', lineBreak: false });
        doc.fontSize(6.5).fillColor(BRAND.muted);
        doc.text(`Gerado pelo Portal TI em ${generatedAt}`, left, fy + 24, { lineBreak: false });
        doc.text(`Página ${i - range.start + 1} de ${range.count}`, left, fy + 24, {
          width: contentWidth,
          align: 'right',
          lineBreak: false,
        });
        doc.rect(0, pageH - 7, pageW, 7).fill(BRAND.blue);
        doc.rect(pageW - 120, pageH - 7, 120, 7).fill(BRAND.orange);

        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    });
  }

  /**
   * Termo de responsabilidade (entrega) — gerado sob demanda a partir da
   * alocação ATIVA do ativo (ver AssetsService.findActiveAllocationForTermo).
   * Pensado para impressão/assinatura manual — o documento assinado depois
   * volta ao sistema como anexo do ativo (ver AssetsService.addAttachment).
   */
  generateTermo(asset: AssetForTermo, allocation: AllocationForTermo): Promise<Buffer> {
    const cpf = allocation.cpf?.trim();
    return this.renderTermo({
      kind: 'entrega',
      title: 'TERMO DE RESPONSABILIDADE',
      subtitle: 'Pelo uso de equipamentos de Tecnologia da Informação (TI)',
      openingParagraph: [
        { text: 'Pelo presente instrumento particular, eu, ' },
        { text: allocation.assignedToName, bold: true },
        { text: ', brasileiro(a), portador(a) do CPF nº ' },
        { text: cpf || 'não informado', bold: true },
        {
          text:
            `, colaborador(a) da empresa ${EMPRESA_NOME}, inscrita no CNPJ sob o nº ${EMPRESA_CNPJ}, ` +
            `declaro que recebi, para fins de uso exclusivo em atividades profissionais relacionadas às ` +
            `minhas funções, o seguinte equipamento de tecnologia da informação (TI):`,
        },
      ],
      assetTag: asset.assetTag,
      equipment: this.equipmentBlock(asset, 'entrega'),
      clauses: ENTREGA_CLAUSES,
      disposicoesGerais: [
        'Este termo entra em vigor na data de sua assinatura e permanecerá válido enquanto o equipamento estiver sob minha responsabilidade.',
        'Por ser expressão da verdade e para que produza seus efeitos legais, firmo o presente termo em duas vias de igual teor.',
      ],
      signDateLabel: dataPorExtenso(new Date(allocation.deliveryDate), true),
      signerName: allocation.assignedToName,
      signerCpf: cpf,
    });
  }

  /**
   * Termo de devolução — gerado a partir da alocação ATIVA do ativo (mesma
   * resolução do termo de entrega), pensado para ser impresso/assinado no
   * momento em que o colaborador devolve o equipamento fisicamente — ANTES
   * de registrar a devolução no sistema (ver AssetsController.returnAsset).
   * Por isso usa a data de hoje: a `returnDate` real só existe depois que a
   * devolução é confirmada na tela.
   */
  generateTermoDevolucao(asset: AssetForTermo, allocation: AllocationForTermo): Promise<Buffer> {
    const cpf = allocation.cpf?.trim();
    const rg = allocation.rg?.trim();
    return this.renderTermo({
      kind: 'devolucao',
      title: 'TERMO DE DEVOLUÇÃO',
      subtitle: 'De equipamentos de Tecnologia da Informação (TI)',
      openingParagraph: [
        { text: 'Pelo presente instrumento particular, eu, ' },
        { text: allocation.assignedToName, bold: true },
        { text: ', CPF: ' },
        { text: cpf || 'não informado', bold: true },
        { text: ', e RG: ' },
        { text: rg || 'não informado', bold: true },
        {
          text:
            `, colaborador(a) da empresa ${EMPRESA_NOME}, inscrita no CNPJ sob o nº ${EMPRESA_CNPJ}, ` +
            `declaro que devolvi o seguinte equipamento de tecnologia da informação (TI):`,
        },
      ],
      assetTag: asset.assetTag,
      equipment: this.equipmentBlock(asset, 'devolucao'),
      clauses: DEVOLUCAO_CLAUSES,
      signDateLabel: dataPorExtenso(new Date()),
      signerName: allocation.assignedToName,
      signerCpf: cpf,
    });
  }
}
