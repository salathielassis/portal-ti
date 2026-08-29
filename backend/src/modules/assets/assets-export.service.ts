import { Injectable } from '@nestjs/common';
import { AssetOwnership, AssetStatus, AssetType, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';

export type ExportFormat = 'xlsx' | 'pdf';

export interface ExportFilters {
  status?: AssetStatus;
  ownership?: AssetOwnership;
  type?: AssetType;
  contractId?: string;
  siteId?: string;
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
          include: { site: { include: { client: true } }, department: true },
        },
      },
      orderBy: [{ status: 'asc' }, { assetTag: 'asc' }],
    });

    return assets.map((a) => {
      const alloc = a.allocations[0] ?? null;
      const ref = a.priceTier ? Number(a.priceTier.referenceValue) : null;
      const monthly = a.monthlyValue != null ? Number(a.monthlyValue) : null;
      return {
        assetTag: a.assetTag,
        serialNumber: a.serialNumber,
        type: TYPE_LABEL[a.type],
        brand: a.brand,
        model: a.model,
        ownership: OWNERSHIP_LABEL[a.ownership],
        status: STATUS_LABEL[a.status],
        priceTierLabel: a.priceTier?.label ?? '',
        referenceValue: ref,
        monthlyValue: monthly,
        priceDelta: ref != null && monthly != null ? Number((monthly - ref).toFixed(2)) : null,
        contractNumber: a.contract?.contractNumber ?? '',
        supplierName: a.supplier?.name ?? '',
        costCenter: alloc?.site?.costCenterLabel || alloc?.site?.name || '',
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
      if (s) parts.push(`Filial/centro de custo: ${s.costCenterLabel || s.name}`);
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
}
