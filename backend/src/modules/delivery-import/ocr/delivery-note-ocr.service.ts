import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { PdfRasterizerService } from '../../../common/pdf/pdf-rasterizer.service';
import { PageOrientationService } from './page-orientation.service';

export interface OcrPage {
  pageNumber: number;
  text: string;
  confidence: number;
  orientationUncertain: boolean;
}

/**
 * Orquestra o pipeline de OCR de uma guia de entrega: rasteriza o PDF
 * (escaneado, sem camada de texto — ver PdfRasterizerService), corrige a
 * orientação de cada página e devolve o texto reconhecido, pronto para o
 * `DeliveryNoteParserService` extrair os campos por regex/linha.
 *
 * Primeira implementação real de OCR do projeto — `tesseract.js` já era
 * dependência (citada como comentário morto em
 * `reconciliation/parsers/bank-statement-parser.service.ts`), mas nunca tinha
 * sido de fato ligada a um pipeline de rasterização.
 */
@Injectable()
export class DeliveryNoteOcrService {
  private readonly logger = new Logger(DeliveryNoteOcrService.name);

  constructor(
    private readonly rasterizer: PdfRasterizerService,
    private readonly orientation: PageOrientationService,
  ) {}

  async ocrPdf(buffer: Buffer): Promise<OcrPage[]> {
    const pageImages = await this.rasterizer.rasterize(buffer, 300);

    // Um único worker reaproveitado entre todas as páginas/orientações desta
    // guia — inicializar um worker do Tesseract é caro, não vale recriar por página.
    const worker = await createWorker('por');
    try {
      const pages: OcrPage[] = [];
      for (let i = 0; i < pageImages.length; i++) {
        const result = await this.orientation.resolve(worker, pageImages[i]);
        this.logger.log(
          `Página ${i + 1}/${pageImages.length}: rotação ${result.rotation}°, confiança ${result.confidence.toFixed(1)}${result.uncertain ? ' (incerta)' : ''}`,
        );
        pages.push({
          pageNumber: i + 1,
          text: result.text,
          confidence: result.confidence,
          orientationUncertain: result.uncertain,
        });
      }
      return pages;
    } finally {
      await worker.terminate();
    }
  }
}
