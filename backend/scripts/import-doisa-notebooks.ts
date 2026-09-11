/**
 * Importa o parque de notebooks PRÓPRIOS da DOISA a partir da planilha de
 * controle manual (`notebooks doisa.xlsx`, na raiz do repo) direto para o
 * banco — poupa o cadastro um-a-um pela tela.
 *
 * Mapeamento planilha -> schema:
 *   PROPRIETÁRIO      -> (sempre "DOISA"; define ownership = PROPRIO)
 *   CENTRO DE CUSTO   -> prefixo do nº de patrimônio + texto em allocation.clientName
 *   SETOR             -> Department (upsert por nome, reaproveitando o que já existe)
 *   FUNCIONÁRIO       -> allocation.assignedToName ("Não informado" quando vazio)
 *   MODELO            -> brand (1ª palavra, normalizada) + model (texto completo)
 *   PROCESSADOR       -> specs.cpu
 *   MEM. RAM          -> specs.ram
 *   HD/SSD            -> specs.storage
 *   SN                -> serialNumber (quando vazio: "SEM-SN-<assetTag>")
 *
 * Regras:
 *   - type = NOTEBOOK, ownership = PROPRIO, status = EM_USO para todos.
 *   - assetTag = "<PREFIXO>-<NNN>" sequencial por unidade, na ordem da planilha
 *     (determinístico: independe do estado do banco).
 *   - Idempotente: pula linha cujo assetTag OU serialNumber já exista.
 *   - Cada ativo ganha uma alocação ATIVA (responsável + depto + centro de
 *     custo em texto) e um movimento ENTREGA de "cadastro inicial".
 *
 * Uso:
 *   cd backend
 *   npm run import-doisa-notebooks
 *
 * Contra outro banco (ex.: produção), sem mexer no .env:
 *   $env:DATABASE_URL="postgresql://..."; npm run import-doisa-notebooks
 */
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import {
  PrismaClient,
  AssetType,
  AssetOwnership,
  AssetStatus,
  MovementType,
  UserRole,
} from '@prisma/client';

const prisma = new PrismaClient();

const XLSX_PATH = path.resolve(__dirname, '..', '..', 'notebooks doisa.xlsx');

// Prefixo do nº de patrimônio por CENTRO DE CUSTO da planilha.
const UNIT_PREFIX: Record<string, string> = {
  'DOISA NATAL - SEDE': 'NAT',
  'DOISA POTENGI': 'POT',
  'DOISA RESERVA PIPA': 'PIP',
  'GERENCIA DE INCORPORACOE': 'GDI', // vem truncado na planilha ("Incorporaçõe")
  'PE SERRA DA PALMEIRA': 'PSP',
  'UFV NORONHA VERDE': 'UNV',
};

const BRAND_MAP: Record<string, string> = {
  DELL: 'Dell',
  AVELL: 'Avell',
  LENOVO: 'Lenovo',
  ACER: 'Acer',
  HP: 'HP',
  SAMSUNG: 'Samsung',
  MACBOOK: 'Apple',
  APPLE: 'Apple',
  LOQ: 'Lenovo',
};

const SMALL_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
// Siglas que devem permanecer em caixa alta ao "prettificar" o nome do setor.
const ACRONYMS = new Set(['TI', 'DHO', 'QSMS', 'RH', 'GO', 'SGI', 'CPD', 'SESMT', 'PCP']);

function clean(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(typeof v === 'object' && v && 'text' in (v as any) ? (v as any).text : v);
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function unitPrefix(centroCusto: string): string {
  const key = stripDiacritics(centroCusto).toUpperCase();
  return UNIT_PREFIX[key] ?? 'OUT';
}

function deriveBrand(modelo: string): string {
  let s = modelo.trim();
  // "NOTEBOOK DELL INSPIRON ..." -> tira o prefixo genérico e reavalia
  const withoutNotebook = s.replace(/^NOTEBOOK\s+/i, '');
  if (withoutNotebook !== s && withoutNotebook.length > 0) s = withoutNotebook;
  const first = stripDiacritics(s.split(/\s+/)[0] ?? '').toUpperCase();
  if (BRAND_MAP[first]) return BRAND_MAP[first];
  if (!first) return 'Desconhecida';
  return first.charAt(0) + first.slice(1).toLowerCase();
}

function prettifyDept(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  return s
    .split(' ')
    .map((w, i) => {
      if (w === '-') return w;
      if (ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

interface Row {
  rowNumber: number;
  centroCusto: string;
  setor: string;
  funcionario: string;
  modelo: string;
  cpu: string;
  ram: string;
  storage: string;
  sn: string;
}

async function main() {
  console.log(`Lendo planilha: ${XLSX_PATH}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.worksheets[0];

  const rows: Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // cabeçalho
    const cell = (n: number) => clean(row.getCell(n).value);
    const modelo = cell(5);
    const sn = cell(9);
    if (!modelo && !sn) return; // linha vazia
    rows.push({
      rowNumber,
      centroCusto: cell(2),
      setor: cell(3),
      funcionario: cell(4),
      modelo,
      cpu: cell(6),
      ram: cell(7),
      storage: cell(8),
      sn,
    });
  });
  console.log(`${rows.length} linhas de equipamento encontradas.\n`);

  // Usuário que "registra" as movimentações (opcional).
  const admin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });

  // Cache de departamentos: chave = nome normalizado (sem acento, minúsculo).
  const deptList = await prisma.department.findMany();
  const deptByKey = new Map<string, string>(); // key -> id
  for (const d of deptList) deptByKey.set(stripDiacritics(d.name).toLowerCase().trim(), d.id);

  async function resolveDept(setor: string): Promise<string | null> {
    const s = setor.replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const key = stripDiacritics(s).toLowerCase();
    const hit = deptByKey.get(key);
    if (hit) return hit;
    const created = await prisma.department.create({ data: { name: prettifyDept(s) } });
    deptByKey.set(key, created.id);
    console.log(`  + Departamento criado: "${created.name}"`);
    return created.id;
  }

  const seqByPrefix = new Map<string, number>();
  const usedSerials = new Set<string>();

  const importedAt = new Date();
  const results = { created: 0, skipped: 0, errors: 0 };
  const summary: string[] = [];

  for (const r of rows) {
    const prefix = unitPrefix(r.centroCusto);
    const seq = (seqByPrefix.get(prefix) ?? 0) + 1;
    seqByPrefix.set(prefix, seq);
    const assetTag = `${prefix}-${String(seq).padStart(3, '0')}`;

    let serialNumber = r.sn.trim();
    if (!serialNumber || usedSerials.has(serialNumber)) {
      if (serialNumber && usedSerials.has(serialNumber)) {
        console.warn(`  ! SN repetido "${serialNumber}" na linha ${r.rowNumber} — usando placeholder.`);
      }
      serialNumber = `SEM-SN-${assetTag}`;
    }
    usedSerials.add(serialNumber);

    try {
      const existing = await prisma.asset.findFirst({
        where: { OR: [{ assetTag }, { serialNumber }] },
        select: { id: true, assetTag: true },
      });
      if (existing) {
        results.skipped++;
        summary.push(`SKIP  ${assetTag.padEnd(8)} ${serialNumber.padEnd(24)} (já existe)`);
        continue;
      }

      const brand = deriveBrand(r.modelo);
      const specs: Record<string, string> = {};
      if (r.cpu) specs.cpu = r.cpu;
      if (r.ram) specs.ram = r.ram;
      if (r.storage) specs.storage = r.storage;

      const departmentId = await resolveDept(r.setor);
      const assignedToName = r.funcionario.trim() || 'Não informado';

      const asset = await prisma.asset.create({
        data: {
          assetTag,
          serialNumber,
          type: AssetType.NOTEBOOK,
          ownership: AssetOwnership.PROPRIO,
          brand,
          model: r.modelo,
          specs: Object.keys(specs).length ? specs : undefined,
          status: AssetStatus.EM_USO,
        },
      });

      await prisma.assetAllocation.create({
        data: {
          assetId: asset.id,
          assignedToName,
          departmentId: departmentId ?? undefined,
          clientName: r.centroCusto || undefined,
          deliveryDate: importedAt,
          isActive: true,
          allocatedById: admin?.id,
          notes: `Cadastro inicial via importação da planilha "notebooks doisa.xlsx" (linha ${r.rowNumber}).`,
        },
      });

      await prisma.assetMovement.create({
        data: {
          assetId: asset.id,
          type: MovementType.ENTREGA,
          fromStatus: AssetStatus.ESTOQUE,
          toStatus: AssetStatus.EM_USO,
          loggedById: admin?.id,
          description: `Cadastro inicial via importação da planilha DOISA — entregue a ${assignedToName}`,
          occurredAt: importedAt,
        },
      });

      results.created++;
      summary.push(
        `OK    ${assetTag.padEnd(8)} ${serialNumber.padEnd(24)} ${brand.padEnd(8)} | ${assignedToName} · ${r.centroCusto}`,
      );
    } catch (err) {
      results.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      summary.push(`ERRO  ${assetTag.padEnd(8)} linha ${r.rowNumber}: ${msg}`);
      console.error(`  x Erro na linha ${r.rowNumber} (${assetTag}): ${msg}`);
    }
  }

  console.log('\n' + summary.join('\n'));
  console.log('\n=====================================');
  console.log(`Criados:  ${results.created}`);
  console.log(`Pulados:  ${results.skipped} (já existiam)`);
  console.log(`Erros:    ${results.errors}`);
  console.log('=====================================');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
