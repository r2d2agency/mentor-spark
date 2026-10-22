import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TenantOriginsService } from './modules/public/tenant-origins.service';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as http from 'http';

const logger = new Logger('Bootstrap');

/**
 * Modo degradado: a API sobe MESMO sem banco de dados.
 *
 * Sem isto, uma falha de conexão com o Postgres no boot mata o Nest com
 * `process.abort()` (SIGABRT) ANTES de a porta abrir. O orquestrador marca o
 * container como unhealthy e o proxy responde 502 em TODAS as rotas — inclusive
 * na de health check — sem nenhuma pista do motivo real.
 *
 * Em modo degradado a porta abre, o health check responde 200 e as rotas /api
 * devolvem 503 com o motivo da falha (visível no console do navegador, sem
 * precisar de acesso ao log do EasyPanel). O processo sai depois de alguns
 * segundos para o entrypoint reiniciá-lo e tentar subir de novo — o banco pode
 * ter voltado nesse meio-tempo.
 */
async function startDegradedServer(port: number, cause: unknown): Promise<never> {
  const reason = cause instanceof Error ? cause.message || cause.name : String(cause);
  const retryIn = +(process.env.DEGRADED_RETRY_SECONDS || 30);

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      // CORS liberado no modo degradado: sem ele o navegador reporta
      // "TypeError: Failed to fetch" em vez do 503 com o motivo real.
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers':
        (req.headers['access-control-request-headers'] as string) ||
        'Content-Type, Authorization, Accept, X-Requested-With, X-Tenant-Id',
      'Access-Control-Max-Age': '86400',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    if (url === '/' || url === '/api/health') {
      res.writeHead(200, headers);
      res.end(
        JSON.stringify({
          status: 'degraded',
          service: 'mentorflow-api',
          reason,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    res.writeHead(503, headers);
    res.end(
      JSON.stringify({
        statusCode: 503,
        error: 'Service Unavailable',
        message: `API em modo degradado: ${reason}`,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  logger.warn(`API em MODO DEGRADADO na porta ${port}: ${reason}`);
  logger.warn(`Rotas /api respondem 503. Saindo em ${retryIn}s para o entrypoint reiniciar e tentar subir de novo.`);

  await new Promise((resolve) => setTimeout(resolve, retryIn * 1000));
  process.exit(1);
}

async function bootstrap() {
  const port = +(process.env.PORT || 3001);

  let app: INestApplication;
  try {
    app = await NestFactory.create(AppModule, {
      cors: false,
      rawBody: true,
      // Padrão do Nest é abortOnError:true — em qualquer falha de init ele chama
      // process.abort() (SIGABRT) e o erro NUNCA chega no catch. Com false, a
      // falha vira uma rejeição normal e podemos cair no modo degradado.
      abortOnError: false,
    });
  } catch (e: any) {
    logger.error(`Falha ao iniciar a API: ${e?.message || e}`);
    if (e?.stack) logger.error(e.stack);
    return startDegradedServer(port, e);
  }

  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(helmet({ crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false }));

  // Domínios próprios dos tenants: lidos do banco para que o CORS libere a
  // origem sem precisar de redeploy a cada tenant novo.
  let tenantOrigins: TenantOriginsService | undefined;
  try {
    tenantOrigins = app.get(TenantOriginsService, { strict: false });
  } catch {
    // Sem o serviço (ex.: AppModule sem o PublicModule) o CORS funciona
    // só com a allowlist estática — não é motivo para derrubar o boot.
  }

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
      // Domínio próprio de tenant (users.customDomain). Sem isto, o frontend
      // de um tenant com domínio custom (ex.: app.alemdolucro.org) recebe
      // "blocked by CORS policy" em TODA chamada — inclusive o login —
      // porque a origem não está na allowlist estática.
      if (tenantOrigins?.isTenantHost(host)) return true;
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

  // Health check na raiz. O orquestrador (EasyPanel) sonda a porta exposta e,
  // sem resposta 2xx na raiz, marca o container como unhealthy — o proxy passa
  // a responder 502 em todas as rotas com a aplicação no ar. Registrado direto
  // no Express porque o prefixo global `/api` não alcança rotas soltas.
  app.getHttpAdapter().getInstance().get('/', (_req: any, res: any) => {
    res.status(200).json({ status: 'ok', service: 'mentorflow-api', timestamp: new Date().toISOString() });
  });

  const config = new DocumentBuilder()
    .setTitle('MentorFlow API')
    .setDescription('SaaS de Mentoria Inteligente Multi-Tenant')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, doc);

  await app.listen(port);
  logger.log(`MentorFlow API on http://localhost:${port}/api`);
  logger.log(`Swagger docs on http://localhost:${port}/api/docs`);
}
bootstrap();
