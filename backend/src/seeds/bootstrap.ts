/**
 * Bootstrap de inicialização do container:
 * 1. Aguarda Postgres aceitar conexão
 * 2. Sincroniza schema (cria tabelas a partir das entities) OU roda migrations se existirem
 * 3. Cria/atualiza super admin a partir das envs SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
 *
 * Idempotente: pode rodar a cada boot sem efeitos colaterais.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcryptjs';
import * as net from 'net';
import { DataSource, DataSourceOptions } from 'typeorm';
import { buildPgOptions } from '../db.config';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { Plan } from '../entities/plan.entity';

dotenv.config();

/**
 * Diagnostico do alvo do Postgres.
 *
 * O log de boot e a unica fonte de verdade quando o container morre no
 * EasyPanel (a API nunca abre a porta e o proxy devolve 502 em tudo).
 * Sem isto, a unica pista e um "ECONNREFUSED" generico que nao diz se o
 * problema e nome de servico, porta, senha ou banco inexistente.
 */
function describeDbTarget(): { host: string; port: number; source: string } {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const u = new URL(url);
      return { host: u.hostname, port: +(u.port || 5432), source: 'DATABASE_URL' };
    } catch {
      return { host: '(DATABASE_URL invalida)', port: 5432, source: 'DATABASE_URL' };
    }
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: +(process.env.DB_PORT || 5432),
    source: 'DB_HOST/DB_PORT',
  };
}

/** Traduz o erro do driver em algo que aponta a causa raiz. */
function describeDbError(e: any): string {
  const code = e?.code || e?.driverError?.code || '';
  const msg = String(e?.message || e);
  if (code === '28P01' || /password authentication failed/i.test(msg)) {
    return `senha invalida para o usuario (${code}) - confira DB_PASSWORD/DB_USER`;
  }
  if (code === '28000' || /role .* does not exist/i.test(msg)) {
    return `usuario/role inexistente (${code}) - confira DB_USER`;
  }
  if (code === '3D000' || /database .* does not exist/i.test(msg)) {
    return `banco inexistente (${code}) - confira DB_NAME`;
  }
  if (code === 'ECONNREFUSED') {
    return 'conexao recusada - o Postgres nao esta no ar, ou host/porta apontam para o lugar errado';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'host nao resolvido - o nome do servico de banco no EasyPanel esta errado?';
  }
  if (code === 'ETIMEDOUT') {
    return 'timeout de conexao - firewall ou banco travado';
  }
  return code ? `${code}: ${msg}` : msg;
}

/** Testa o TCP do banco sem autenticar: separa "nao achou o banco" de "senha errada". */
function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (r: { ok: boolean; reason?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, reason: 'timeout' }));
    socket.once('error', (err: any) => finish({ ok: false, reason: err.code || err.message }));
    socket.connect(port, host);
  });
}

async function waitForDb(opts: DataSourceOptions, maxTries = 15, delayMs = 2000) {
  for (let i = 1; i <= maxTries; i++) {
    const probe = new DataSource(opts);
    try {
      await probe.initialize();
      await probe.destroy();
      console.log(`[bootstrap] Postgres pronto (tentativa ${i})`);
      return;
    } catch (e: any) {
      console.log(`[bootstrap] Postgres indisponível (${i}/${maxTries}): ${describeDbError(e)}`);
      try { await probe.destroy(); } catch {}
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('[bootstrap] Postgres não respondeu a tempo');
}

async function run() {
  const baseOpts = {
    ...(buildPgOptions() as DataSourceOptions),
    entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../migrations/*{.ts,.js}'],
    logging: process.env.DB_LOGGING === 'true',
  } as DataSourceOptions;

  const target = describeDbTarget();
  console.log(`[bootstrap] Alvo do Postgres: ${target.host}:${target.port} (via ${target.source})`);
  const tcp = await tcpProbe(target.host, target.port);
  if (!tcp.ok) {
    console.log(`[bootstrap] ATENCAO: TCP inacessivel em ${target.host}:${target.port} - ${tcp.reason}`);
    console.log('[bootstrap] Se o banco roda em outro servico do EasyPanel, confira o NOME do servico e as envs DB_HOST/DB_PORT (ou DATABASE_URL) deste servico.');
  } else {
    console.log(`[bootstrap] TCP OK em ${target.host}:${target.port} - banco alcancavel, autenticando...`);
  }

  await waitForDb(baseOpts);

  // Sincroniza schema (cria tabelas se não existirem). Se você preferir migrations,
  // setar DB_SYNCHRONIZE=false e adicionar migrations em src/migrations/*
  const useSync = process.env.DB_SYNCHRONIZE !== 'false';
  const ds = new DataSource({ ...baseOpts, synchronize: useSync });
  await ds.initialize();
  console.log(`[bootstrap] DataSource inicializado (synchronize=${useSync})`);

  // Roda migrations se existirem (não falha se não houver)
  try {
    const pending = await ds.showMigrations();
    if (pending) {
      console.log('[bootstrap] Rodando migrations pendentes...');
      await ds.runMigrations();
    }
  } catch (e: any) {
    console.log('[bootstrap] Migrations puladas:', e.message);
  }

  // Seed do super admin (idempotente, atualiza senha sempre que envs mudam)
  const repo = ds.getRepository(User);
  const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@mentorflow.com').toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!';
  const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';

  const existing = await repo
    .createQueryBuilder('u')
    .addSelect('u.passwordHash')
    .where('u.email = :email', { email })
    .getOne();

  const passwordHash = await bcrypt.hash(password, 10);

  if (!existing) {
    const u = repo.create({
      email,
      name,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    });
    await repo.save(u);
    console.log(`[bootstrap] Super admin CRIADO: ${email}`);
  } else {
    // Garante role/status corretos e ressincroniza a senha com a env (útil em prod)
    await repo.update(existing.id, {
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      name: existing.name || name,
    });
    console.log(`[bootstrap] Super admin ATUALIZADO: ${email}`);
  }

  // Seed de planos default (idempotente)
  const plansRepo = ds.getRepository(Plan);
  const defaults = [
    { slug: 'free', name: 'Free', description: 'Para começar', priceMonthly: 0, maxMentorados: 3, maxLeads: 50, maxAiMessagesMonth: 30, allowWhatsapp: false, allowAi: true, allowCustomDomain: false, allowMeetings: false, allowAutomations: false, allowLandingBuilder: false, sortOrder: 1 },
    { slug: 'starter', name: 'Starter', description: 'Mentor solo', priceMonthly: 97, maxMentorados: 25, maxLeads: 500, maxAiMessagesMonth: 500, allowWhatsapp: true, allowAi: true, allowCustomDomain: false, allowMeetings: false, allowAutomations: false, allowLandingBuilder: true, sortOrder: 2 },
    { slug: 'pro', name: 'Pro', description: 'Mentoria escalada', priceMonthly: 297, maxMentorados: 100, maxLeads: 2000, maxAiMessagesMonth: 2000, allowWhatsapp: true, allowAi: true, allowCustomDomain: true, allowMeetings: true, allowAutomations: true, allowLandingBuilder: true, sortOrder: 3 },
    { slug: 'enterprise', name: 'Enterprise', description: 'Sem limites', priceMonthly: 997, maxMentorados: -1, maxLeads: -1, maxAiMessagesMonth: -1, allowWhatsapp: true, allowAi: true, allowCustomDomain: true, allowMeetings: true, allowAutomations: true, allowLandingBuilder: true, sortOrder: 4 },
  ];
  for (const p of defaults) {
    const existingPlan = await plansRepo.findOne({ where: { slug: p.slug } });
    if (!existingPlan) {
      await plansRepo.save(plansRepo.create(p));
      console.log(`[bootstrap] Plano CRIADO: ${p.slug}`);
    }
  }

  await ds.destroy();
  console.log('[bootstrap] Concluído com sucesso');
}

run().catch((e) => {
  console.error('[bootstrap] FALHA:', e);
  process.exit(1);
});
