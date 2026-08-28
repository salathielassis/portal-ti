import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS_ORIGIN pode ter uma ou várias origens separadas por vírgula (ex.: "https://portal-ti.netlify.app,https://portal.seudominio.com").
  // Sem a variável definida (ambiente local, por exemplo), libera qualquer origem.
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : true, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Portal TI - Controle de Ativos')
    .setDescription('API de gestão de ativos, contratos e conciliação financeira')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3333;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Portal TI backend rodando em http://localhost:${port}/api (docs em /api/docs)`);
}

bootstrap();
