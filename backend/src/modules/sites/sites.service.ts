import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { SalesPage, SalesPageSiteConfig, SalesPageSiteFile } from '../../entities/sales-page.entity';
import { extractZip, ZipError } from './zip-extract';
import { renderBridgeScript, BridgeConfig } from './bridge';

const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50 MB
const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min

/** MIME por extensão (allowlist). Desconhecido -> octet-stream. */
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

export interface SiteUploadResult {
  ok: true;
  entry: string | null;
  files: SalesPageSiteFile[];
  uploadedAt: string;
  skipped: string[];
}

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);

  constructor(
    @InjectRepository(SalesPage) private pages: Repository<SalesPage>,
  ) {}

  // ==================== Armazenamento em disco ====================

  /** Raiz dos sites — FORA de `uploads/` (que é servido publicamente sem CSP). */
  private sitesRoot(): string {
    return path.resolve(process.cwd(), 'sites');
  }

  private siteDir(pageId: string): string {
    return path.join(this.sitesRoot(), pageId);
  }

  // ==================== CRUD (mentor) ====================

  /** Valida a propriedade da página — o @Auth só diz papel, não dono. */
  async ownedPage(mentorId: string, pageId: string): Promise<SalesPage> {
    const page = await this.pages.findOne({ where: { id: pageId, mentorId } });
    if (!page) throw new NotFoundException('Página não encontrada');
    return page;
  }

  /** Busca a página por id (sem checar dono) — usado no preview. */
  async pageById(pageId: string): Promise<SalesPage | null> {
    if (!pageId) return null;
    return this.pages.findOne({ where: { id: pageId } });
  }

  async uploadSite(
    mentorId: string,
    pageId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<SiteUploadResult> {
    const page = await this.ownedPage(mentorId, pageId);
    if (!file || !file.buffer || !file.buffer.length) {
      throw new BadRequestException('Arquivo ZIP obrigatório.');
    }
    if (file.buffer.length > MAX_ZIP_BYTES) {
      throw new BadRequestException('O ZIP excede o limite de 50 MB.');
    }
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.zip')) {
      throw new BadRequestException('Envie um arquivo .zip.');
    }

    const root = this.sitesRoot();
    fs.mkdirSync(root, { recursive: true });

    // Extração atômica: extrai em diretório temporário e renomeia por último.
    const tmp = path.join(root, `.tmp-${pageId}-${randomUUID()}`);
    const dest = this.siteDir(pageId);
    const backup = path.join(root, `.old-${pageId}-${randomUUID()}`);

    let result;
    try {
      fs.mkdirSync(tmp, { recursive: true });
      result = extractZip(file.buffer, tmp);
    } catch (e: any) {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (e instanceof ZipError) throw new BadRequestException(e.message);
      this.logger.error(`Falha ao extrair ZIP da página ${pageId}: ${e?.message}`);
      throw new BadRequestException('Não foi possível ler o ZIP enviado.');
    }

    // Substitui o site anterior (se houver) de forma atômica.
    const hadPrevious = fs.existsSync(dest);
    try {
      if (hadPrevious) fs.renameSync(dest, backup);
      fs.renameSync(tmp, dest);
      if (hadPrevious) fs.rmSync(backup, { recursive: true, force: true });
    } catch (e: any) {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (hadPrevious && fs.existsSync(backup) && !fs.existsSync(dest)) {
        fs.renameSync(backup, dest);
      }
      this.logger.error(`Falha ao gravar site da página ${pageId}: ${e?.message}`);
      throw new BadRequestException('Não foi possível salvar os arquivos do site.');
    }

    const uploadedAt = new Date().toISOString();
    const siteConfig: SalesPageSiteConfig = {
      enabled: true,
      siteToken: randomUUID(),
      entry: result.entry,
      files: result.files,
      uploadedAt,
      successType: page.siteConfig?.successType || 'internal',
      successUrl: page.siteConfig?.successUrl || null,
      successFile: page.siteConfig?.successFile || null,
      eventSlug: page.siteConfig?.eventSlug || null,
    };
    await this.pages.update({ id: pageId } as any, { siteConfig } as any);

    this.logger.log(`Site da página ${pageId} atualizado: ${result.files.length} arquivos, entry=${result.entry}`);

    return {
      ok: true,
      entry: result.entry,
      files: result.files,
      uploadedAt,
      skipped: result.skipped.slice(0, 50),
    };
  }

  async deleteSite(mentorId: string, pageId: string): Promise<{ ok: true }> {
    const page = await this.ownedPage(mentorId, pageId);
    fs.rmSync(this.siteDir(pageId), { recursive: true, force: true });
    await this.pages.update({ id: pageId } as any, {
      siteConfig: { ...(page.siteConfig || {}), enabled: false, siteToken: null, entry: null, files: [], uploadedAt: null },
    } as any);
    return { ok: true };
  }

  async siteInfo(mentorId: string, pageId: string) {
    const page = await this.ownedPage(mentorId, pageId);
    const cfg = page.siteConfig;
    return {
      enabled: cfg?.enabled ?? false,
      siteToken: cfg?.siteToken ?? null,
      entry: cfg?.entry ?? null,
      files: cfg?.files ?? [],
      uploadedAt: cfg?.uploadedAt ?? null,
      successType: cfg?.successType ?? 'internal',
      successUrl: cfg?.successUrl ?? null,
      successFile: cfg?.successFile ?? null,
      eventSlug: cfg?.eventSlug ?? null,
      previewToken: this.issuePreviewToken(page.id),
      previewExpiresAt: new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString(),
    };
  }

  /**
   * Token de preview — o `<iframe>` do editor não consegue enviar o header
   * `Authorization`, então emitimos um token HMAC com validade curta que
   * authorize a leitura dos arquivos do site **dentro do prazo**.
   */
  private previewSecret(): string {
    return process.env.JWT_SECRET || 'dev-secret-change-me';
  }

  issuePreviewToken(pageId: string): string {
    const exp = Date.now() + PREVIEW_TOKEN_TTL_MS;
    const payload = `${pageId}.${exp}`;
    const sig = createHmac('sha256', this.previewSecret()).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64url')}.${sig}`;
  }

  verifyPreviewToken(pageId: string, token: string | undefined): boolean {
    if (!token) return false;
    const parts = String(token).split('.');
    if (parts.length !== 2) return false;
    let payload = '';
    try {
      payload = Buffer.from(parts[0], 'base64url').toString('utf8');
    } catch {
      return false;
    }
    const expected = createHmac('sha256', this.previewSecret())
      .update(payload)
      .digest('hex');
    if (expected.length !== parts[1].length) return false;
    // comparação em tempo constante
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts[1].charCodeAt(i);
    if (diff !== 0) return false;
    const [pid, expStr] = payload.split('.');
    if (pid !== pageId) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    return true;
  }

  /** Salva as opções editáveis pelo mentor (o resto é server-owned). */
  async saveConfig(
    mentorId: string,
    pageId: string,
    dto: {
      enabled?: boolean;
      entry?: string | null;
      successType?: 'internal' | 'url' | 'file';
      successUrl?: string | null;
      successFile?: string | null;
      eventSlug?: string | null;
    },
  ) {
    const page = await this.ownedPage(mentorId, pageId);
    const cfg: SalesPageSiteConfig = {
      enabled: false,
      siteToken: null,
      entry: null,
      files: [],
      uploadedAt: null,
      successType: 'internal',
      successUrl: null,
      successFile: null,
      eventSlug: null,
      ...(page.siteConfig || {}),
    };

    if (dto.enabled !== undefined) cfg.enabled = !!dto.enabled;

    if (dto.entry !== undefined) {
      if (dto.entry && !cfg.files.some((f) => f.path === dto.entry)) {
        throw new BadRequestException('Arquivo de entrada não existe no site enviado.');
      }
      cfg.entry = dto.entry || null;
    }

    if (dto.successType !== undefined) {
      if (!['internal', 'url', 'file'].includes(dto.successType)) {
        throw new BadRequestException('Destino após o cadastro inválido.');
      }
      cfg.successType = dto.successType;
    }

    if (dto.successUrl !== undefined) {
      if (dto.successUrl) {
        const ok = /^https?:\/\//i.test(dto.successUrl) || dto.successUrl.startsWith('/');
        if (!ok) throw new BadRequestException('O link de redirect deve ser http(s) ou começar com /.');
        if (dto.successUrl.startsWith('//')) throw new BadRequestException('Link de redirect inválido.');
      }
      cfg.successUrl = dto.successUrl || null;
    }

    if (dto.successFile !== undefined) {
      if (dto.successFile) {
        const found = cfg.files.find((f) => f.path === dto.successFile);
        if (!found || !/\.html?$/i.test(found.path)) {
          throw new BadRequestException('A página de "obrigado" precisa ser um HTML existente no site.');
        }
      }
      cfg.successFile = dto.successFile || null;
    }

    if (dto.eventSlug !== undefined) {
      cfg.eventSlug = dto.eventSlug || null;
    }

    await this.pages.update({ id: pageId } as any, { siteConfig: cfg } as any);
    return this.siteInfo(mentorId, pageId);
  }

  // ==================== Serving (público) ====================

  /** Busca a página pelo siteToken (coluna jsonb). */
  async pageByToken(siteToken: string): Promise<SalesPage | null> {
    if (!siteToken) return null;
    const rows = await this.pages
      .createQueryBuilder('p')
      .where(`p."siteConfig"->>'siteToken' = :token`, { token: siteToken })
      .getMany();
    return rows[0] || null;
  }

  /**
   * Resolve um caminho do site para um arquivo em disco.
   * Bloqueia travessia de diretório (path traversal).
   */
  resolveAsset(pageId: string, relPath: string): { file: string; size: number } {
    const root = path.resolve(this.siteDir(pageId));
    const normalized = path.posix.normalize('/' + (relPath || '').replace(/\\/g, '/'));
    if (normalized.includes('..')) {
      throw new NotFoundException('Arquivo não encontrado');
    }
    const rel = normalized.replace(/^\/+/, '');
    if (!rel) throw new NotFoundException('Arquivo não encontrado');
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new NotFoundException('Arquivo não encontrado');
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new NotFoundException('Arquivo não encontrado');
    }
    return { file: target, size: fs.statSync(target).size };
  }

  mimeFor(filePath: string): string {
    const ext = filePath.includes('.') ? filePath.split('.').pop()!.toLowerCase() : '';
    return MIME[ext] || 'application/octet-stream';
  }

  /**
   * Injeta o bridge no HTML servido. A reescrita é feita **em memória** —
   * o arquivo em disco nunca é modificado.
   */
  injectBridge(html: string, siteBase: string): string {
    const tag = `<script src="${siteBase}/__mf/bridge.js"></script>`;
    const lower = html.toLowerCase();
    const headEnd = lower.indexOf('</head>');
    if (headEnd >= 0) {
      return html.slice(0, headEnd) + tag + html.slice(headEnd);
    }
    const bodyStart = lower.indexOf('<body');
    if (bodyStart >= 0) {
      const gt = html.indexOf('>', bodyStart);
      if (gt >= 0) return html.slice(0, gt + 1) + tag + html.slice(gt + 1);
    }
    return tag + html;
  }

  /**
   * Injeta `<base href="...">` no HTML servido.
   *
   * Sem isso, os caminhos relativos do HTML do mentor (`img/logo.png`,
   * `css/style.css`) resolvem contra a URL da rota que serviu a página — e na
   * rota de preview não existe prefixo de asset. O `<base>` faz o navegador
   * resolver contra a raiz do site.
   *
   * O `<base>` precisa ser a **primeira** coisa do `<head>`: por spec, só os
   * elementos que vêm depois dele usam o href — um `<link>` de stylesheet
   * colocado antes ignoraria a base.
   *
   * A reescrita é feita **em memória** — o arquivo em disco nunca muda.
   */
  injectBase(html: string, baseHref: string): string {
    const lower = html.toLowerCase();
    if (lower.includes('<base')) return html; // o mentor já definiu o seu
    const tag = `<base href="${baseHref}">`;
    const headStart = lower.indexOf('<head');
    if (headStart >= 0) {
      const gt = html.indexOf('>', headStart);
      if (gt >= 0) return html.slice(0, gt + 1) + tag + html.slice(gt + 1);
    }
    const bodyStart = lower.indexOf('<body');
    if (bodyStart >= 0) {
      const gt = html.indexOf('>', bodyStart);
      if (gt >= 0) return html.slice(0, gt + 1) + tag + html.slice(gt + 1);
    }
    return tag + html;
  }

  bridgeConfig(page: SalesPage): BridgeConfig {
    const cfg = page.siteConfig;
    return {
      siteToken: cfg?.siteToken || '',
      mentorSlug: '',
      pageSlug: page.slug,
      apiBase: '',
      successType: cfg?.successType || 'internal',
      successFile: cfg?.successFile || null,
      eventSlug: cfg?.eventSlug || null,
    };
  }

  bridgeScript(page: SalesPage, cfg: BridgeConfig): string {
    return renderBridgeScript(cfg);
  }

  /** Metadata pública da página (sem lista de arquivos). */
  publicSiteConfig(page: SalesPage) {
    const cfg = page.siteConfig;
    if (!cfg) return null;
    return {
      enabled: !!cfg.enabled,
      siteToken: cfg.siteToken,
      entry: cfg.entry,
      successType: cfg.successType,
      successUrl: cfg.successUrl,
      successFile: cfg.successFile,
      eventSlug: cfg.eventSlug,
    };
  }

  forbidden(message = 'Acesso negado.'): never {
    throw new ForbiddenException(message);
  }
}
