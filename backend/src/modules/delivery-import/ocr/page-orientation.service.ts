import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { Worker } from 'tesseract.js';

/**
 * Diferença mínima de confiança entre as duas orientações para decidir sem
 * ambiguidade quando nenhuma das duas bate a âncora textual (ou as duas
 * batem). Abaixo disso, a leitura é marcada como incerta em vez de escolher
 * "no chute".
 */
const CONFIDENCE_MARGIN = 5;

/**
 * Âncoras textuais que sempre aparecem no layout da Requisição/Guia da
 * LOCAiNFO, tolerantes a ruído comum de OCR (ex.: "LOCAINfO", "LOGAMNfO").
 */
const ANCHOR_PATTERN = /LOCA.?NFO|REQUISI[CÇ][AÃ]O/i;

export interface OrientationResult {
  /** Rotação aplicada à imagem ORIGINAL para chegar no texto escolhido. */
  rotation: 0 | 180;
  confidence: number;
  text: string;
  /** true quando não foi possível decidir com confiança — a página deve gerar um warning na tela. */
  uncertain: boolean;
}

/**
 * As notas de entrega da LOCAiNFO são fotografadas/escaneadas e, com
 * frequência, a página inteira sai de cabeça para baixo (não é continuação de
 * tabela, é a orientação inteira do documento invertida) — confirmado
 * rasterizando os dois PDFs de exemplo e inspecionando visualmente. Por isso a
 * correção é por PÁGINA INTEIRA (0°/180°), não por metade da página.
 */
@Injectable()
export class PageOrientationService {
  private readonly logger = new Logger(PageOrientationService.name);

  async resolve(worker: Worker, pageImage: Buffer): Promise<OrientationResult> {
    const rotatedImage = await sharp(pageImage).rotate(180).png().toBuffer();

    const [at0, at180] = await Promise.all([
      worker.recognize(pageImage),
      worker.recognize(rotatedImage),
    ]);

    const anchor0 = ANCHOR_PATTERN.test(at0.data.text);
    const anchor180 = ANCHOR_PATTERN.test(at180.data.text);

    if (anchor0 && !anchor180) {
      return { rotation: 0, confidence: at0.data.confidence, text: at0.data.text, uncertain: false };
    }
    if (anchor180 && !anchor0) {
      return { rotation: 180, confidence: at180.data.confidence, text: at180.data.text, uncertain: false };
    }

    // Nenhuma das duas bateu a âncora, ou as duas bateram (ambíguo) — desempata pela confiança.
    const diff = Math.abs(at0.data.confidence - at180.data.confidence);
    const winner = at0.data.confidence >= at180.data.confidence ? { rotation: 0 as const, result: at0 } : { rotation: 180 as const, result: at180 };

    if (diff < CONFIDENCE_MARGIN) {
      this.logger.warn(
        `Orientação da página incerta (0°: conf=${at0.data.confidence.toFixed(1)}, âncora=${anchor0}; ` +
          `180°: conf=${at180.data.confidence.toFixed(1)}, âncora=${anchor180}) — usando ${winner.rotation}° como melhor palpite.`,
      );
      return { rotation: winner.rotation, confidence: winner.result.data.confidence, text: winner.result.data.text, uncertain: true };
    }

    return { rotation: winner.rotation, confidence: winner.result.data.confidence, text: winner.result.data.text, uncertain: false };
  }
}
