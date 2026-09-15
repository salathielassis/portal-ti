import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Armazenamento em disco local (VM própria via systemd, sem S3/Blob
 * configurado — ver docs/PRODUCACAO_VM.md). `UPLOADS_DIR` fica fora de
 * `dist`/`node_modules` de propósito, para sobreviver a `npm ci`/rebuild no
 * deploy (ops/deploy.sh não apaga nada fora de `frontend/.next`).
 */
@Injectable()
export class StorageService {
  private readonly root = path.resolve(process.env.UPLOADS_DIR ?? './uploads');

  /** Grava o arquivo e devolve a key relativa (ex.: "attachments/<uuid>-nota.pdf") para uso em readFile/deleteFile. */
  async save(file: Express.Multer.File, folder: string): Promise<string> {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${folder}/${randomUUID()}-${safeName}`;
    const fullPath = path.join(this.root, key);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);

    return key;
  }

  async readFile(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async deleteFile(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  /** Resolve a key para um path absoluto, sem permitir escapar de `root` (ex.: "../../etc/passwd"). */
  private resolve(key: string): string {
    const fullPath = path.resolve(this.root, key);
    if (!fullPath.startsWith(this.root + path.sep)) {
      throw new Error('Key de arquivo inválida');
    }
    return fullPath;
  }
}
