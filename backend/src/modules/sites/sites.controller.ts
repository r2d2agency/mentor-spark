import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param,
  Post, Put, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import * as fs from 'fs';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Auth } from '../auth/auth.decorators';
import { TenantId } from '../auth/current-user.decorator';
import { SalesPage } from '../../entities/sales-page.entity';
import { SitesService } from './sites.service';

class SiteConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(300) entry?: string | null;
  @IsOptional() @IsIn(['internal', 'url', 'file']) successType?: 'internal' | 'url' | 'file';
  @IsOptional() @IsString() @MaxLength(2000) successUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(300) successFile?: string | null;
  @IsOptional() @IsString() @MaxLength(200) eventSlug?: string | null;
}

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

/**
 * CSP da página do mentor.
 *
 * `script-src` inclui a origem do próprio site porque, com `sandbox` sem
 * `allow-same-origin`, a origem do documento é opaca e `'self'` NÃO casa
 * com ela. `frame-ancestors` limita quem pode embutir a página: só o app.
 */
function contentSecurityPolicy(siteOrigin: string, appOrigin: string): string {
  return [
    "default-src 'self' data: blob: https:",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${siteOrigin} https:`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' https:",
    `frame-ancestors ${appOrigin}`,
  ].join('; ');
}

/**
 * Aplica os headers de isolamento da página do mentor.
 *
 * O `X-Frame-Options` do helmet é removido: `SAMEORIGIN` quebraria o iframe
 * em dev, onde app (8080) e API (3001) são origens diferentes — o
 * `frame-ancestors` do CSP é que restringe o embutimento.
 */
function applySiteHeaders(res: Response, req: any, appOrigin: string) {
  const siteOrigin = siteOriginOf(req);
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(siteOrigin, appOrigin));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Robots-Tag', 'noindex');
}

/** Origem da própria requisição (esquema + host), respeitando o proxy. */
function siteOriginOf(req: any): string {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .toString()
    .split(',')[0]
    .trim();
  return `${proto}://${req.get('host')}`;
}

/**
 * Origem que pode embutir a página (o app).
 *
 * Em produção vem de `PUBLIC_APP_URL`. Em dev o app e a API podem estar em
 * hosts diferentes, e o `Referer` do carregamento no `<iframe>` é quem revela
 * a origem real do app — sem ele o preview no editor seria bloqueado.
 */
function appOriginOf(req: any, fallback: string): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/+$/, '');
  const referer = String(req.headers?.referer || req.headers?.origin || '').trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* referer inválido */
    }
  }
  return fallback;
}

/** Rotas autenticadas do mentor — upload e configuração do site da página. */
@ApiTags('sites')
@ApiBearerAuth()
@Controller('sales-pages/:pageId/site')
export class SitesController {
  constructor(private sites: SitesService) {}

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: MAX_ZIP_BYTES },
    fileFilter: (req: any, file: any, cb: any) => {
      const name = String(file.originalname || '').toLowerCase();
      const zipMime = /^application\/(zip|x-zip-compressed|octet-stream)$/i.test(file.mimetype || '');
      if (!name.endsWith('.zip') || !zipMime) {
        return cb(new BadRequestException('Envie um arquivo .zip.'), false);
      }
      cb(null, true);
    },
  }))
  async upload(
    @TenantId() mentorId: string,
    @Param('pageId') pageId: string,
    @UploadedFile() file: any,
  ) {
    if (!file) throw new BadRequestException('Arquivo ZIP obrigatório.');
    return this.sites.uploadSite(mentorId, pageId, file);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Get()
  info(@TenantId() mentorId: string, @Param('pageId') pageId: string) {
    return this.sites.siteInfo(mentorId, pageId);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Put('config')
  saveConfig(
    @TenantId() mentorId: string,
    @Param('pageId') pageId: string,
    @Body() dto: SiteConfigDto,
  ) {
    return this.sites.saveConfig(mentorId, pageId, dto);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Delete()
  remove(@TenantId() mentorId: string, @Param('pageId') pageId: string) {
    return this.sites.deleteSite(mentorId, pageId);
  }

  /**
   * Preview do site para o editor. A rota pública exige `published`, então uma
   * página ainda não publicada não teria preview. O `<iframe>` do editor não
   * envia header `Authorization`, por isso usamos um token HMAC de curta
   * duração emitido junto do `siteInfo`.
   *
   * O token vai no **caminho**, não na query string: os assets relativos do
   * HTML do mentor (`img/logo.png`) são pedidos pelo navegador sem carregar a
   * query da página, e assim eles continuam autenticados.
   */
  @Get('preview/:token')
  async preview(
    @Param('pageId') pageId: string,
    @Param('token') token: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.servePreview(pageId, token, '', req, res);
  }

  /** Assets do site no preview (imagens, CSS, JS). */
  @Get('preview/:token/*path')
  async previewAsset(
    @Param('pageId') pageId: string,
    @Param('token') token: string,
    @Param('path') pathParam: string | string[],
    @Req() req: any,
    @Res() res: Response,
  ) {
    const rel = Array.isArray(pathParam) ? pathParam.join('/') : String(pathParam || '');
    await this.servePreview(pageId, token, rel, req, res);
  }

  private async servePreview(
    pageId: string,
    token: string,
    assetPath: string,
    req: any,
    res: Response,
  ) {
    if (!this.sites.verifyPreviewToken(pageId, token)) {
      throw new NotFoundException('Preview expirado. Recarregue a aba.');
    }
    const page = await this.sites.pageById(pageId);
    const cfg = page?.siteConfig;
    if (!cfg?.enabled) throw new NotFoundException('Nenhum site enviado para esta página.');
    const rel = (assetPath || cfg.entry || 'index.html').replace(/^\/+/, '');
    const { file } = this.sites.resolveAsset(page.id, rel);
    const mime = this.sites.mimeFor(file);
    // O preview serve o mesmo HTML do mentor: leva a mesma CSP, senão a
    // página abriria no editor sem nenhuma restrição de origem.
    applySiteHeaders(res, req, appOriginOf(req, siteOriginOf(req)));
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    if (mime.startsWith('text/html')) {
      const html = fs.readFileSync(file, 'utf8');
      // O preview não tem bridge: o mentor só quer ver o layout.
      // O `<base>` aponta para a raiz do preview para os caminhos relativos
      // do mentor resolverem (e virem com o token no caminho).
      const base = `${siteOriginOf(req)}/api/sales-pages/${pageId}/site/preview/${token}/`;
      const out = this.sites.injectBase(html, base);
      res.setHeader('Content-Length', Buffer.byteLength(out, 'utf8'));
      res.send(out);
      return;
    }
    res.sendFile(fs.realpathSync(file));
  }
}

/**
 * Serving público do site enviado pelo mentor.
 *
 * Segurança: o HTML vem do mentor e é servido na origem da API, então precisa
 * de CSP restritiva + `frame-ancestors` limitado à origem do app. O `X-Frame-Options`
 * do helmet é removido (SAMEORIGIN quebraria o iframe em dev, onde app e API
 * são origens diferentes).
 */
@ApiTags('sites')
@Controller('public/sites')
export class PublicSitesController {
  constructor(private sites: SitesService) {}

  /** Rota do bridge — precisa ser declarada antes do wildcard. */
  @Get(':siteToken/__mf/bridge.js')
  async bridge(
    @Param('siteToken') siteToken: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const page = await this.requirePublicPage(siteToken);
    const siteBase = this.siteBase(req, siteToken);
    const cfg = this.sites.bridgeConfig(page);
    cfg.apiBase = `${this.origin(req)}/api`;
    cfg.mentorSlug = (page as any).mentorSlug || '';

    this.applyHeaders(res, req);
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(this.sites.bridgeScript(page, cfg));
  }

  /** Entrada do site (redireciona para o arquivo configurado). */
  @Get(':siteToken')
  async entry(
    @Param('siteToken') siteToken: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const page = await this.requirePublicPage(siteToken);
    const entry = page.siteConfig?.entry || 'index.html';
    res.redirect(302, `${this.siteBase(req, siteToken)}/${entry}`);
  }

  /** Qualquer arquivo do site (assets). */
  @Get(':siteToken/*path')
  async asset(
    @Param('siteToken') siteToken: string,
    @Param('path') pathParam: string | string[],
    @Req() req: any,
    @Res() res: Response,
  ) {
    const page = await this.requirePublicPage(siteToken);
    const path = Array.isArray(pathParam) ? pathParam.join('/') : String(pathParam || '');
    const { file, size } = this.sites.resolveAsset(page.id, path);

    const mime = this.sites.mimeFor(file);
    this.applyHeaders(res, req);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('ETag', `"${page.siteConfig?.uploadedAt || '0'}-${path}-${size}"`);

    if (mime.startsWith('text/html')) {
      const html = fs.readFileSync(file, 'utf8');
      const siteBase = this.siteBase(req, siteToken);
      res.setHeader('Content-Length', Buffer.byteLength(html, 'utf8'));
      res.send(this.sites.injectBridge(html, siteBase));
      return;
    }

    res.sendFile(fs.realpathSync(file));
  }

  // ---------- helpers ----------

  private async requirePublicPage(siteToken: string): Promise<SalesPage> {
    const page = await this.sites.pageByToken(siteToken);
    if (!page || !page.published || !page.siteConfig?.enabled) {
      throw new NotFoundException('Site não encontrado');
    }
    return page;
  }

  private origin(req: any): string {
    return siteOriginOf(req);
  }

  private siteBase(req: any, siteToken: string): string {
    return `${this.origin(req)}/api/public/sites/${siteToken}`;
  }

  /**
   * CSP da página do mentor. `script-src` inclui a origem do próprio site
   * porque, com `sandbox` sem `allow-same-origin`, a origem do documento é
   * opaca e `'self'` NÃO casa com ela.
   */
  private applyHeaders(res: Response, req: any) {
    applySiteHeaders(res, req, appOriginOf(req, this.origin(req)));
  }
}
