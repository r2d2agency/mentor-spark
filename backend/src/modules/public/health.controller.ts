import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

/**
 * Health check da API.
 *
 * O EasyPanel (e qualquer orquestrador) sonda a porta exposta para saber se o
 * container está pronto. Sem uma rota que responda 2xx na raiz, o serviço era
 * marcado como *unhealthy* e o proxy respondia 502 em TODAS as rotas mesmo
 * com a aplicação no ar.
 *
 * Fica sob o prefixo global `/api` (→ `/api/health`). A raiz `/` é servida
 * por um handler direto no Express, registrado em `main.ts` — o prefixo
 * global não alcança rotas registradas fora do router do Nest.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'mentorflow-api',
      timestamp: new Date().toISOString(),
    };
  }
}
