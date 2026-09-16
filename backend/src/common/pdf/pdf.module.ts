import { Module } from '@nestjs/common';
import { PdfRasterizerService } from './pdf-rasterizer.service';

@Module({
  providers: [PdfRasterizerService],
  exports: [PdfRasterizerService],
})
export class PdfModule {}
