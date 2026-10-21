import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true });
  const logger = new Logger('Bootstrap');

  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(helmet({ crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false }));

  // CORS robusto: aceita lista CSV (CORS_ORIGIN), libera *.easypanel.host, localhost
  // e (opcionalmente) qualquer origem extra via CORS_ALLOW_ALL=true.
  const allowList = (process.env.CORS_ORIGIN || 'http://localhost:8080,http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const allowAll = String(process.env.CORS_ALLOW_ALL || '').toLowerCase() === 'true' || allowList.includes('*');

  const isAllowed = (origin: string) => {
    if (allowAll) return true;
    const clean = origin.replace(/\/+$/, '');
    if (allowList.includes(clean)) return true;
    try {
      const host = new URL(clean).hostname;
      if (/\.easypanel\.host$/i.test(host)) return true;
      if (/^localhost$/i.test(host)) return true;
      // libera todos os hosts que constam no allowList por sufixo de domínio
      // (ex.: CORS_ORIGIN=https://gleego.com.br libera mentor.gleego.com.br)
      for (const entry of allowList) {
        try {
          const eh = new URL(entry).hostname;
          if (host === eh || host.endsWith('.' + eh)) return true;
        } catch {}
      }
    } catch {}
    return false;
  };

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/healthchecks/SSR
      cb(null, isAllowed(origin)); // false → sem headers, mas sem 500
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'X-Tenant-Id'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 86400,
  });

  app.setGlobalPrefix('api');
  // Atrás do nginx, `req.protocol`/`req.ip` viram os do proxy sem isto —
  // o throttler contaria o IP do proxy e a URL absoluta do site sairia "http://".
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));

  const config = new DocumentBuilder()
    .setTitle('MentorFlow API')
    .setDescription('SaaS de Mentoria Inteligente Multi-Tenant')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, doc);

  const port = +(process.env.PORT || 3001);
  await app.listen(port);
  logger.log(`MentorFlow API on http://localhost:${port}/api`);
  logger.log(`Swagger docs on http://localhost:${port}/api/docs`);
}
bootstrap();
