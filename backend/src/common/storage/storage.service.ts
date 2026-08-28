import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Abstração de armazenamento de arquivos. Em produção, trocar a implementação
 * por um adapter de S3 / Azure Blob / GCS mantendo a mesma interface.
 */
@Injectable()
export class StorageService {
  async save(file: Express.Multer.File, folder: string): Promise<string> {
    const key = `${folder}/${randomUUID()}-${file.originalname}`;
    // Exemplo com AWS S3 (substituir pela implementação real):
    // await this.s3.putObject({ Bucket: process.env.S3_BUCKET, Key: key, Body: file.buffer }).promise();
    return `${process.env.STORAGE_BASE_URL ?? 'local://storage'}/${key}`;
  }
}
