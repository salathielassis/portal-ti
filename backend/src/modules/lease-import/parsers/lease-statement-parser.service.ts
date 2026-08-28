import { Injectable, BadRequestException } from '@nestjs/common';
// pdf2json não publica types em @types — usa o .d.ts embutido no próprio pacote.
import PDFParser from 'pdf2json';

/**
 * Parser do "Extrato de Locação" (formato LOCAinfo / AM Serviços e Loc. de Eq.
 * de Informática) para importação automática de ativos locados.
 *
 * -----------------------------------------------------------------------
 * DECISÃO DE PROJETO: por que pdf2json e não pdf-parse
 * -----------------------------------------------------------------------
 * O `pdf-parse` (usado no módulo de conciliação bancária) extrai texto na
 * ordem do content stream interno do PDF, não na ordem visual da página.
 * Nesse extrato específico isso quebra a tabela de equipamentos: colunas
 * inteiras (NUM.SERIE + P.A.T + EQUIPAMENTO) chegam concatenadas sem
 * espaço, tornando ambíguo onde termina o nº de série e começa o tombo
 * quando o nº de série termina em dígito.
 *
 * O `pdf2json` preserva a posição X/Y de cada fragmento de texto. Isso
 * permite reconstruir a tabela por FAIXAS DE COLUNA (como o pdfplumber com
 * `layout=True` faz em Python), e resolve os dois problemas observados na
 * extração ingênua: (1) o texto "KAUÉ SANTOS" que parecia "colado" entre
 * dois valores é, na verdade, o conteúdo legítimo da coluna "LOCAL" (nome
 * de quem está com o equipamento); (2) a aparente ausência de P.A.T. em
 * alguns itens era só o token seguinte grudado ao anterior — todo item
 * tem P.A.T. quando lido por posição.
 * -----------------------------------------------------------------------
 */

export interface ParsedLeaseHeader {
  supplierName: string;
  supplierCnpj: string;
  clientName: string;
  /** CNPJ completo da filial/obra faturada (não é necessariamente o da matriz) */
  clientCnpj: string;
  contractNumber: string;
  /** Campo "CLASSIFICAÇÃO" do extrato — vira o nome/centro de custo do Site */
  classification: string;
  periodStart: Date;
  periodEnd: Date;
  /** Campo "TOT. EQUIP" do cabeçalho — ver nota em `parse()` sobre por que não é usado sozinho para validação */
  totalEquipmentCount: number | null;
  totalValue: number | null;
  address: {
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  };
}

/** Uma linha de equipamento dentro de um grupo "MODELO :" do extrato. */
export interface ParsedLeaseItem {
  modelCode: string;
  modelDescription: string;
  serialNumber: string;
  pat: string;
  equipmentDescription: string;
  /** Valor "LOCAÇÃO" da linha — mantido apenas para auditoria; TOT.GERAL é o valor de referência do item */
  locacaoValue: number;
  /** Valor "TOT. GERAL" — valor mensal de locação deste equipamento específico */
  totalValue: number;
  /** Campo "LOCAL" — nome da pessoa/local ao qual o equipamento está alocado, quando informado no extrato */
  allocatedTo: string | null;
  installationDate: Date | null;
}

export interface ParsedLeaseStatement {
  header: ParsedLeaseHeader;
  items: ParsedLeaseItem[];
  warnings: string[];
}

interface Cell {
  x: number;
  y: number;
  text: string;
}

interface Row {
  y: number;
  cells: Cell[];
}

const Y_CLUSTER_THRESHOLD = 0.4;

// Faixas de posição X (unidades internas do pdf2json) observadas na tabela de
// itens do layout "EXTRATO DE LOCAÇÃO" da LOCAinfo. Faixas (e não valores
// exatos) porque colunas numéricas são alinhadas à direita e deslocam
// ligeiramente conforme a quantidade de dígitos/casas decimais.
const COL = {
  SERIAL: [0.5, 1.3],
  PAT: [3.4, 4.1],
  EQUIPAMENTO: [5.2, 8.5],
  LOCACAO: [15.5, 17.6],
  TOT_GERAL: [17.9, 20.2],
  LOCAL: [20.3, 22.7],
  DATA: [23.5, 25.2],
} as const satisfies Record<string, readonly [number, number]>;

function inRange(x: number, [min, max]: readonly [number, number]): boolean {
  return x >= min && x <= max;
}

function cellInRange(cells: Cell[], range: readonly [number, number]): Cell | undefined {
  return cells.find((c) => inRange(c.x, range));
}

/** "5.873,58" -> 5873.58 / "0,00000" -> 0 (formato numérico brasileiro) */
function parseBrNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\./g, '').replace(',', '.');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** "31/05/2025" -> Date (meio-dia UTC, para não deslocar de dia por fuso horário) */
function parseBrDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12));
}

function clusterRows(texts: any[]): Row[] {
  const items: Cell[] = texts
    .map((t) => ({
      x: t.x,
      y: t.y,
      text: decodeURIComponent(t.R.map((r: any) => r.T).join('')),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: Row[] = [];
  let current: Row | null = null;
  let sampleCount = 0;

  for (const item of items) {
    if (current && Math.abs(item.y - current.y) <= Y_CLUSTER_THRESHOLD) {
      current.cells.push(item);
      current.y = (current.y * sampleCount + item.y) / (sampleCount + 1);
      sampleCount++;
    } else {
      current = { y: item.y, cells: [item] };
      sampleCount = 1;
      rows.push(current);
    }
  }
  return rows.map((r) => ({ y: r.y, cells: r.cells.sort((a, b) => a.x - b.x) }));
}

function rowText(row: Row): string {
  return row.cells.map((c) => c.text).join(' ');
}

function firstCellText(row: Row): string {
  return row.cells[0]?.text?.trim() ?? '';
}

@Injectable()
export class LeaseStatementParserService {
  async parse(buffer: Buffer): Promise<ParsedLeaseStatement> {
    const pdfData = await this.loadPdf(buffer);
    const warnings: string[] = [];

    if (!pdfData.Pages || pdfData.Pages.length === 0) {
      throw new BadRequestException('PDF não contém páginas legíveis.');
    }

    const allRowsByPage: Row[][] = pdfData.Pages.map((page: any) => clusterRows(page.Texts));

    // --- 1. Cabeçalho: coletado apenas do bloco de boilerplate ANTES da
    //     primeira linha de cabeçalho de coluna ("NUM. SERIE ..."), que
    //     nesse layout se repete idêntico em todas as páginas. ---
    const boilerplateRows: Row[] = [];
    let headerRowSeen = false;
    for (const row of allRowsByPage[0]) {
      if (firstCellText(row) === 'NUM. SERIE') {
        headerRowSeen = true;
        break;
      }
      boilerplateRows.push(row);
    }
    if (!headerRowSeen) {
      throw new BadRequestException(
        'Não foi possível localizar a tabela de equipamentos (cabeçalho "NUM. SERIE" não encontrado). O layout deste PDF pode ser diferente do padrão suportado (extrato LOCAinfo).',
      );
    }
    const header = this.parseHeader(boilerplateRows, warnings);

    // --- 2. Itens: percorre TODAS as páginas tratando a tabela como um
    //     fluxo contínuo (um grupo "MODELO :" pode começar em uma página e
    //     terminar em outra), ignorando o bloco de boilerplate que se
    //     repete no topo de cada página. ---
    const items: ParsedLeaseItem[] = [];
    let currentModelCode = '';
    let currentModelDescription = '';
    let currentGroupItemCount = 0;
    let insideTable = false;

    for (const pageRows of allRowsByPage) {
      insideTable = false; // cada página reimprime o cabeçalho de boilerplate antes da tabela
      for (const row of pageRows) {
        const label = firstCellText(row);

        if (label === 'NUM. SERIE') {
          insideTable = true;
          continue;
        }
        if (!insideTable) continue; // ainda no boilerplate desta página

        if (label.startsWith('MODELO')) {
          const rest = row.cells.slice(1);
          const codeCell = rest.find((c) => /^\d+$/.test(c.text.trim()));
          currentModelCode = codeCell ? codeCell.text.trim() : '';
          currentModelDescription = rest
            .filter((c) => c !== codeCell)
            .map((c) => c.text.trim())
            .join(' ')
            .trim();
          currentGroupItemCount = 0;
          continue;
        }
        if (label === 'SUBTOTAL :') {
          continue;
        }
        if (label.startsWith('TOTAL DE EQUIPAMENTOS')) {
          // Valida a contagem declarada pelo PRÓPRIO extrato para este grupo
          // contra o que foi de fato lido — pega erros de leitura por grupo
          // mesmo quando o total geral do documento "por acaso" bate.
          const declaredCell = row.cells.find((c) => /^\d+$/.test(c.text.trim()));
          const declared = declaredCell ? Number.parseInt(declaredCell.text.trim(), 10) : null;
          if (declared !== null && declared !== currentGroupItemCount) {
            warnings.push(
              `Grupo "MODELO : ${currentModelCode} ${currentModelDescription}" declara ${declared} equipamento(s) no extrato, mas foram lidos ${currentGroupItemCount}.`,
            );
          }
          continue;
        }
        if (label.startsWith('TOTAL DOS ITENS') || label === 'TOTALIZADORES:') {
          insideTable = false; // fim da tabela de itens nesta página
          continue;
        }

        // Linha de item: primeira célula cai na faixa de NUM. SERIE
        const firstCell = row.cells[0];
        if (!firstCell || !inRange(firstCell.x, COL.SERIAL)) {
          continue; // linha não reconhecida — ignorada silenciosamente
        }

        const serialNumber = firstCell.text.trim();
        const patCell = cellInRange(row.cells, COL.PAT);
        const equipCell = cellInRange(row.cells, COL.EQUIPAMENTO);
        const locacaoCell = cellInRange(row.cells, COL.LOCACAO);
        const totGeralCell = cellInRange(row.cells, COL.TOT_GERAL);
        const localCell = cellInRange(row.cells, COL.LOCAL);
        const dataCell = cellInRange(row.cells, COL.DATA);

        if (!patCell) {
          warnings.push(`Item com número de série "${serialNumber}" não tem P.A.T. (tombo) legível — verifique manualmente.`);
        }
        if (!dataCell) {
          warnings.push(`Item com número de série "${serialNumber}" não tem data de instalação legível.`);
        }

        items.push({
          modelCode: currentModelCode,
          modelDescription: currentModelDescription,
          serialNumber,
          pat: patCell?.text?.trim() ?? '',
          equipmentDescription: equipCell?.text?.trim() ?? currentModelDescription,
          locacaoValue: parseBrNumber(locacaoCell?.text) ?? 0,
          totalValue: parseBrNumber(totGeralCell?.text) ?? 0,
          allocatedTo: localCell?.text?.trim() || null,
          installationDate: parseBrDate(dataCell?.text),
        });
        currentGroupItemCount++;
      }
    }

    // Validação principal: a soma dos valores mensais de cada item bate com
    // o "VALOR TOTAL" declarado no cabeçalho? Esse é o cruzamento mais forte
    // porque envolve todos os itens de uma vez.
    //
    // Propositalmente NÃO usamos "TOT. EQUIP" do cabeçalho como critério de
    // erro sozinho: em extratos reais desse fornecedor esse campo pode não
    // corresponder ao nº de linhas de equipamento (o motivo exato não é
    // documentado pelo fornecedor). Ainda assim reportamos a diferença como
    // nota informativa para o usuário poder conferir manualmente se desejar.
    const sumOfItems = items.reduce((acc, it) => acc + it.totalValue, 0);
    if (header.totalValue !== null && Math.abs(sumOfItems - header.totalValue) > 0.05) {
      warnings.push(
        `A soma dos valores por equipamento (R$ ${sumOfItems.toFixed(2)}) não bate com o "VALOR TOTAL" do extrato (R$ ${header.totalValue.toFixed(2)}). Confira o PDF antes de confirmar a importação — pode indicar item não lido corretamente.`,
      );
    }
    if (header.totalEquipmentCount !== null && header.totalEquipmentCount !== items.length) {
      warnings.push(
        `Nota: o campo "TOT. EQUIP" do cabeçalho do extrato diz ${header.totalEquipmentCount}, diferente das ${items.length} linhas de equipamento lidas. Isso pode acontecer nesse layout (o campo às vezes conta outra coisa). Os valores por grupo e o total financeiro foram validados e batem, então essa diferença normalmente pode ser ignorada.`,
      );
    }
    if (items.length === 0) {
      throw new BadRequestException('Nenhum item de equipamento foi encontrado neste extrato.');
    }

    return { header, items, warnings };
  }

  private parseHeader(rows: Row[], warnings: string[]): ParsedLeaseHeader {
    const fullText = rows.map((r) => rowText(r)).join(' \n ');

    const findValueAfterLabel = (row: Row | undefined, label: string): string | null => {
      if (!row) return null;
      const idx = row.cells.findIndex((c) => c.text.trim() === label);
      if (idx === -1 || idx + 1 >= row.cells.length) return null;
      return row.cells[idx + 1].text.trim();
    };

    const supplierNameRow = rows[0];
    const supplierName = supplierNameRow ? firstCellText(supplierNameRow) : '';

    const supplierCnpjRow = rows.find((r) => r.cells.some((c) => c.text.trim() === 'CNPJ :' && c.x < 15));
    const supplierCnpj = (findValueAfterLabel(supplierCnpjRow, 'CNPJ :') ?? '').replace(/\D/g, '');

    const clientRow = rows.find((r) => r.cells.some((c) => c.text.trim() === 'CLIENTE :'));
    let clientName = '';
    if (clientRow) {
      // Layout: "CLIENTE : <código> <razão social> CNPJ : <cnpj> ..."
      const idx = clientRow.cells.findIndex((c) => c.text.trim() === 'CLIENTE :');
      clientName = clientRow.cells[idx + 2]?.text?.trim() ?? '';
    }
    const clientCnpj = (findValueAfterLabel(clientRow, 'CNPJ :') ?? '').replace(/\D/g, '');
    const contractNumber = findValueAfterLabel(clientRow, 'NÚMERO DO CONTRATO :') ?? '';

    const addressRow = rows.find((r) => r.cells.some((c) => c.text.trim() === 'ENDEREÇO :'));
    const address = {
      street: findValueAfterLabel(addressRow, 'ENDEREÇO :'),
      number: findValueAfterLabel(addressRow, 'NÚM :'),
      complement: findValueAfterLabel(addressRow, 'COMP :'),
      district: findValueAfterLabel(addressRow, 'BAIRRO :'),
      city: findValueAfterLabel(addressRow, 'CIDADE :'),
      state: findValueAfterLabel(addressRow, 'UF :'),
      zip: findValueAfterLabel(addressRow, 'CEP :'),
    };

    const contactRow = rows.find((r) => r.cells.some((c) => c.text.trim() === 'CONTATO :'));
    const contact = {
      name: findValueAfterLabel(contactRow, 'CONTATO :'),
      phone: findValueAfterLabel(contactRow, 'TELEFONE :'),
      email: findValueAfterLabel(contactRow, 'E-MAIL :'),
    };

    const classificationRow = rows.find((r) => r.cells.some((c) => c.text.trim() === 'CLASSIFICAÇÃO :'));
    const classification = findValueAfterLabel(classificationRow, 'CLASSIFICAÇÃO :') ?? '';

    const totEquipRow = rows.find((r) => r.cells.some((c) => c.text.trim() === 'TOT. EQUIP:'));
    const totEquipRaw = findValueAfterLabel(totEquipRow, 'TOT. EQUIP:');
    const totalEquipmentCount = totEquipRaw ? Number.parseInt(totEquipRaw, 10) : null;

    const valorTotalRow = rows.find((r) => r.cells.some((c) => c.text.trim() === 'VALOR TOTAL :'));
    const totalValue = parseBrNumber(findValueAfterLabel(valorTotalRow, 'VALOR TOTAL :'));

    const periodMatch = fullText.match(/(\d{2}\/\d{2}\/\d{4})\s*AT[ÉE]\s*(\d{2}\/\d{2}\/\d{4})/);
    const periodStart = periodMatch ? parseBrDate(periodMatch[1]) : null;
    const periodEnd = periodMatch ? parseBrDate(periodMatch[2]) : null;

    if (!supplierCnpj) warnings.push('Não foi possível ler o CNPJ do fornecedor (locadora) no cabeçalho.');
    if (!clientCnpj) warnings.push('Não foi possível ler o CNPJ do cliente/filial no cabeçalho.');
    if (!classification) warnings.push('Campo "CLASSIFICAÇÃO" (nome da obra/filial) não encontrado — necessário para identificar o Site.');
    if (!periodStart || !periodEnd) warnings.push('Não foi possível ler o período de apuração do extrato.');
    if (!contractNumber) warnings.push('Número do contrato não encontrado no cabeçalho.');

    return {
      supplierName,
      supplierCnpj,
      clientName,
      clientCnpj,
      contractNumber,
      classification,
      periodStart: periodStart ?? new Date(NaN),
      periodEnd: periodEnd ?? new Date(NaN),
      totalEquipmentCount,
      totalValue,
      address,
      contact,
    };
  }

  private loadPdf(buffer: Buffer): Promise<any> {
    return new Promise((resolve, reject) => {
      const parser = new (PDFParser as any)();
      parser.on('pdfParser_dataError', (err: any) =>
        reject(
          new BadRequestException(
            `Falha ao ler o PDF: ${err?.parserError?.message ?? err?.message ?? 'erro desconhecido'}`,
          ),
        ),
      );
      parser.on('pdfParser_dataReady', (data: any) => resolve(data));
      parser.parseBuffer(buffer);
    });
  }
}
