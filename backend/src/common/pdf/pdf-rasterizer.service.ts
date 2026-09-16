import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Rasteriza PDFs para PNG via `pdftoppm` (poppler-utils) — usado para dar OCR
 * em PDFs escaneados/fotografados (sem camada de texto), diferente do
 * `lease-import`, cujo PDF tem texto real extraível direto.
 *
 * `pdftoppm` é um binário de SISTEMA, não uma dependência npm — precisa estar
 * instalado no ambiente (`apt-get install poppler-utils` na VM de produção;
 * ver docs/PRODUCAO_VM.md). Optamos por ele em vez de `node-canvas`/
 * `pdfjs-dist`+canvas para evitar build nativo (`node-gyp`) no `npm install`.
 */
@Injectable()
export class PdfRasterizerService {
  private readonly logger = new Logger(PdfRasterizerService.name);

  /** Converte cada página do PDF em um PNG (buffer), na ordem das páginas. */
  async rasterize(buffer: Buffer, dpi = 300): Promise<Buffer[]> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'delivery-note-'));
    const inputPath = path.join(tmpDir, 'input.pdf');
    const outputPrefix = path.join(tmpDir, 'page');

    try {
      await fs.writeFile(inputPath, buffer);

      try {
        await execFileAsync('pdftoppm', ['-png', '-r', String(dpi), inputPath, outputPrefix]);
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          throw new BadRequestException(
            'Dependência de sistema ausente: "pdftoppm" (poppler-utils) não foi encontrado. ' +
              'Instale com "apt-get install poppler-utils" no servidor — ver docs/PRODUCAO_VM.md.',
          );
        }
        throw new BadRequestException(`Falha ao rasterizar o PDF: ${err?.message ?? 'erro desconhecido'}`);
      }

      const files = (await fs.readdir(tmpDir))
        .filter((name) => name.startsWith('page') && name.endsWith('.png'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (files.length === 0) {
        throw new BadRequestException('Nenhuma página pôde ser lida deste PDF.');
      }

      return await Promise.all(files.map((name) => fs.readFile(path.join(tmpDir, name))));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`Falha ao limpar diretório temporário ${tmpDir}: ${err?.message}`);
      });
    }
  }
}
