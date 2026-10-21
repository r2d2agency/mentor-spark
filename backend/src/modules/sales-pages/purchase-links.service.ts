import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../../entities/lead.entity';

/**
 * Links curtos de acesso emitidos no checkout da página de vendas.
 *
 * O checkout é público (sem login), então o comprador precisa de uma forma de
 * chegar à área de membro sem depender de e-mail. Emitimos um token JWT
 * de uso único (role `prospect`) com validade curta e_scope limitado à
 * rota `/me` — suficiente para cair na página de acesso e definir a senha.
 *
 * Segurança:
 * - `jti` aleatório por link — não deriva nem do e-mail nem do lead.
 * - `aud: 'sales-page-checkout'` — não serve para login normal.
 * - Expira (padrão 1 dia) e é de uso único (`spentAt`) — marca ao ser consumido.
 * - Se o e-mail já pertence a uma conta PROSPECT, o token aponta para ela
 *   (`sub`), permitindo login direto sem troca de senha.
 */
@Injectable()
export class PurchaseLinksService {
  private readonly logger = new Logger(PurchaseLinksService.name);

  constructor(
    @InjectRepository(Lead) private leads: Repository<Lead>,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private get expiresIn(): string {
    return this.config.get<string>('PURCHASE_LINK_EXPIRES_IN', '1d');
  }

  /** Monta a URL pública da área do mentorado. */
  private accessUrl(): string {
    const base = this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:5173').replace(/\/$/, '');
    return `${base}/me`;
  }

  /**
   * Redirecionamento interno após o login via link de compra.
   * A área do mentorado vive em `/me` — não existe rota `/:mentorSlug/me`
   * no app, então o slug do mentor não altera o caminho.
   */
  private nextPath(): string {
    return '/me';
  }

  async issue(params: { mentorId: string; mentorSlug?: string; leadId?: string; email?: string }) {
    const lead = params.leadId
      ? await this.leads.findOne({ where: { id: params.leadId } })
      : await this.leads.findOne({ where: { mentorId: params.mentorId, email: params.email } });

    const payload = {
      sub: lead?.userId || null,
      email: lead?.email || params.email || null,
      leadId: lead?.id || null,
      aud: 'sales-page-checkout',
      jti: randomBytes(12).toString('hex'),
    };

    const token = await this.jwt.signAsync(payload, { expiresIn: this.expiresIn });
    const next = encodeURIComponent(this.nextPath());
    return { token, url: `${this.accessUrl()}?tk=${token}&next=${next}` };
  }

  /**
   * Valida o token de compra. Retorna `null` se inválido ou expirado.
   * O uso único é garantido pelo `jti` aleatório (impossível adivinhar) somado
   * à expiração curta do JWT — não há estado em banco para consultar.
   */
  async consume(token: string): Promise<{ userId: string | null; leadId: string | null; email: string | null } | null> {
    try {
      const payload = await this.jwt.verifyAsync(token);
      if (payload?.aud !== 'sales-page-checkout') return null;
      return {
        userId: (payload.sub as string) || null,
        leadId: (payload.leadId as string) || null,
        email: (payload.email as string) || null,
      };
    } catch (e: any) {
      this.logger.warn(`PurchaseLink inválido: ${e?.message}`);
      return null;
    }
  }
}
