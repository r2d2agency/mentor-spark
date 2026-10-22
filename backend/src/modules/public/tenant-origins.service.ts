import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';

/**
 * Origens (hosts) dos tenants com domínio próprio.
 *
 * Cada mentor pode ter um `customDomain` (ex.: `app.alemdolucro.org`) que
 * hospeda o frontend do tenant. O browser então chama a API a partir desse
 * host — e a API precisa responder com `Access-Control-Allow-Origin` para o
 * origin, senão TODA chamada falha no console com "blocked by CORS policy"
 * (inclusive o login).
 *
 * Manter esses hosts numa allowlist estática (`CORS_ORIGIN`) não escala: cada
 * tenant novo exigiria um redeploy. Aqui os hosts são lidos do banco e
 * mantidos em memória, com refresh periódico — o mesmo motivo pelo qual o
 * `tenant-by-host` resolve o mentor por `customDomain`.
 *
 * Se o banco estiver fora do ar, o set fica vazio e o CORS volta ao
 * comportamento padrão (allowlist + `*.easypanel.host` + localhost) — sem
 * abrir a API para origens arbitrárias.
 */
@Injectable()
export class TenantOriginsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TenantOrigins');
  private hosts = new Set<string>();
  private timer?: NodeJS.Timeout;

  /** Intervalo do refresh (ms). Configurável para teste/ops. */
  private readonly refreshMs = +(process.env.TENANT_ORIGINS_REFRESH_MS || 5 * 60 * 1000);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((e) =>
        this.logger.warn(`Falha ao atualizar origens de tenant: ${e?.message || e}`),
      );
    }, this.refreshMs);
    // Não segura o processo aberto só por causa do refresh.
    this.timer?.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Normaliza um host: sem protocolo, sem barra, sem porta, sem `www.`. */
  private normalize(value?: string | null) {
    return (value || '')
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .replace(/\.$/, '')
      .replace(/^www\./, '');
  }

  async refresh() {
    try {
      const rows = await this.users
        .createQueryBuilder('u')
        .select('u."customDomain"', 'customDomain')
        .where('u."customDomain" IS NOT NULL')
        .andWhere("u.\"customDomain\" <> ''")
        .getRawMany();

      const next = new Set<string>();
      for (const row of rows || []) {
        const host = this.normalize(row.customDomain);
        if (host) next.add(host);
      }
      this.hosts = next;
      this.logger.log(`${next.size} origem(ns) de tenant carregada(s)`);
    } catch (e: any) {
      // Sem banco a API pode nem subir; não derruba o boot por causa do CORS.
      this.logger.warn(`Não foi possível carregar as origens de tenant: ${e?.message || e}`);
    }
  }

  /** O host (ou um de seus hosts equivalententes) é de um tenant? */
  isTenantHost(originOrHost: string): boolean {
    const host = this.normalize(originOrHost);
    if (!host) return false;
    if (this.hosts.has(host)) return true;
    // `www.app.x.com` <-> `app.x.com`
    if (host.startsWith('www.')) return this.hosts.has(host.slice(4));
    return this.hosts.has('www.' + host);
  }
}
