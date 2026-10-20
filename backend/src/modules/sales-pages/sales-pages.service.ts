import { BadRequestException, ForbiddenException, Injectable, Inject, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import {
  SalesPage, SalesPagePaymentMode, SalesPageProductType,
  SalesPageCoupon, SalesPageDocument, SalesPageBlock,
} from '../../entities/sales-page.entity';
import { User, UserStatus } from '../../entities/user.entity';
import { MentorPaymentProvider, PaymentProviderType } from '../../entities/mentor-payment-provider.entity';
import { Charge, ChargeMethod, ChargeStatus } from '../../entities/charge.entity';
import { Trail } from '../../entities/trail.entity';
import { TrailAccess, TrailAccessSource } from '../../entities/trail-access.entity';
import { AiService } from '../ai/ai.service';
import { LeadsService } from '../leads/leads.service';
import { PurchaseLinksService } from './purchase-links.service';

type SalesPageOutputFormat = 'blocks' | 'html';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char] || char));
}

const BLOCK_TYPES = new Set<SalesPageBlock['type']>(['hero', 'text', 'features', 'faq', 'cta', 'testimonial', 'section']);
const MAX_DOCUMENT_BLOCKS = 50;
const MAX_DOCUMENT_BYTES = 500_000;

function validateDocument(value: unknown): SalesPageDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('document deve ser um objeto SalesPageDocument.');
  }
  const input = value as Partial<SalesPageDocument>;
  if (input.version !== 1 || !Array.isArray(input.blocks)) {
    throw new BadRequestException('document deve conter version 1 e uma lista de blocks.');
  }
  if (input.blocks.length > MAX_DOCUMENT_BLOCKS || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new BadRequestException('document excede os limites de tamanho ou quantidade de blocos.');
  }
  const blocks = input.blocks.map((block) => {
    if (!block || typeof block !== 'object' || !BLOCK_TYPES.has((block as SalesPageBlock).type) || !block.props || typeof block.props !== 'object' || Array.isArray(block.props)) {
      throw new BadRequestException('document contém um bloco inválido.');
    }
    return {
      type: block.type,
      ...(typeof block.id === 'string' ? { id: block.id.slice(0, 100) } : {}),
      props: block.props as Record<string, unknown>,
    };
  });
  return { version: 1, blocks };
}

function normalizeBlocks(content: any): { document: SalesPageDocument; warnings: string[] } {
  const warnings: string[] = [];
  const blocks: SalesPageBlock[] = [];
  const add = (type: SalesPageBlock['type'], props: Record<string, unknown>) => blocks.push({ type, props });
  if (content.title || content.headline) add('hero', { title: content.title, headline: content.headline, subheadline: content.subheadline });
  if (content.description) add('text', { text: content.description });
  if (Array.isArray(content.features) && content.features.length) add('features', { items: content.features });
  if (Array.isArray(content.sections)) content.sections.forEach((section: any) => add('section', section));
  if (Array.isArray(content.faqs) && content.faqs.length) add('faq', { items: content.faqs });
  if (content.ctaText) add('cta', { text: content.ctaText });
  if (!blocks.length) warnings.push('Nenhum bloco de conteúdo foi gerado.');
  return { document: { version: 1, blocks }, warnings };
}

function sanitizeHtml(value: unknown): string {
  return String(value ?? '')
    .slice(0, 200000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'about:blank');
}

function blocksToHtml(document: SalesPageDocument): string {
  return document.blocks.map((block) => {
    const p: any = block.props;
    switch (block.type) {
      case 'hero': return `<header><h1>${escapeHtml(p.headline || p.title)}</h1><p>${escapeHtml(p.subheadline)}</p></header>`;
      case 'text': return `<section><p>${escapeHtml(p.text)}</p></section>`;
      case 'features': return `<section><ul>${(Array.isArray(p.items) ? p.items : []).map((i: any) => `<li><strong>${escapeHtml(i.title)}</strong> ${escapeHtml(i.text)}</li>`).join('')}</ul></section>`;
      case 'faq': return `<section><dl>${(Array.isArray(p.items) ? p.items : []).map((i: any) => `<dt>${escapeHtml(i.q)}</dt><dd>${escapeHtml(i.a)}</dd>`).join('')}</dl></section>`;
      case 'cta': return `<section><a href="#checkout">${escapeHtml(p.text)}</a></section>`;
      case 'section': return `<section><h2>${escapeHtml(p.title)}</h2><p>${escapeHtml(p.body)}</p></section>`;
      default: return '';
    }
  }).join('');
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `p-${Date.now().toString(36)}`;
}

@Injectable()
export class SalesPagesService {
  private readonly logger = new Logger(SalesPagesService.name);

  constructor(
    @InjectRepository(SalesPage) private pages: Repository<SalesPage>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(MentorPaymentProvider) private providers: Repository<MentorPaymentProvider>,
    @InjectRepository(Charge) private charges: Repository<Charge>,
    @InjectRepository(Trail) private trails: Repository<Trail>,
    @InjectRepository(TrailAccess) private accesses: Repository<TrailAccess>,
    private ai: AiService,
    private leadsService: LeadsService,
    private purchaseLinks: PurchaseLinksService,
    @Inject(JwtService) private jwt: JwtService,
  ) {}

  // ==================== CRUD mentor ====================
  async list(mentorId: string) {
    return this.pages.find({ where: { mentorId }, order: { updatedAt: 'DESC' } });
  }

  async get(mentorId: string, id: string) {
    const p = await this.pages.findOne({ where: { id, mentorId } });
    if (!p) throw new NotFoundException('Página não encontrada');
    return p;
  }

  private async ensureUniqueSlug(mentorId: string, base: string, ignoreId?: string) {
    let slug = slugify(base);
    for (let i = 0; i < 20; i++) {
      const existing = await this.pages.findOne({ where: { mentorId, slug } });
      if (!existing || existing.id === ignoreId) return slug;
      slug = `${slugify(base)}-${i + 2}`;
    }
    return `${slugify(base)}-${Date.now().toString(36)}`;
  }

  async create(mentorId: string, dto: Partial<SalesPage>) {
    if (!dto.title) throw new BadRequestException('Título é obrigatório');
    const slug = await this.ensureUniqueSlug(mentorId, dto.slug || dto.title);
    const p = this.pages.create({
      mentorId,
      title: dto.title,
      slug,
      productType: dto.productType || SalesPageProductType.OTHER,
      productRefId: dto.productRefId,
      autoEnrollOnPayment: dto.autoEnrollOnPayment !== false,
      enrollAsMentorado: dto.enrollAsMentorado !== false,
      upsellTrailId: dto.upsellTrailId || null,
      upsellPriceCents: dto.upsellPriceCents ?? null,
      upsellCurrency: dto.upsellCurrency || null,
      upsellHeadline: dto.upsellHeadline || null,
      upsellBody: dto.upsellBody || null,
      upsellDelayMinutes: dto.upsellDelayMinutes ?? 0,
      headline: dto.headline,
      subheadline: dto.subheadline,
      description: dto.description,
      heroImageUrl: dto.heroImageUrl,
      videoUrl: dto.videoUrl,
      features: dto.features || [],
      document: dto.document === undefined ? undefined : validateDocument(dto.document),
      faqs: dto.faqs || [],
      testimonials: dto.testimonials || [],
      badges: dto.badges || [],
      guaranteeText: dto.guaranteeText,
      ctaText: dto.ctaText || 'Quero garantir agora',
      priceCents: dto.priceCents || 0,
      currency: dto.currency || 'BRL',
      originalPriceCents: dto.originalPriceCents,
      maxInstallments: dto.maxInstallments || 1,
      paymentMode: dto.paymentMode || SalesPagePaymentMode.ONE_TIME,
      subscriptionCycle: dto.subscriptionCycle,
      paymentProviderId: dto.paymentProviderId,
      theme: dto.theme,
      seo: dto.seo,
      published: false,
      template: (dto as any).template || 'classic',
      forWho: (dto as any).forWho || [],
      notForWho: (dto as any).notForWho || [],
      agenda: (dto as any).agenda || [],
      sections: (dto as any).sections || [],
      about: (dto as any).about,
      eventInfo: (dto as any).eventInfo,
      urgencyText: (dto as any).urgencyText,
    });
    return this.pages.save(p);
  }

  async duplicate(mentorId: string, id: string) {
    const source = await this.get(mentorId, id);
    const slug = await this.ensureUniqueSlug(mentorId, `${source.slug}-copia`);

    const copy = this.pages.create({
      mentorId,
      slug,
      productType: source.productType,
      productRefId: source.productRefId,
      autoEnrollOnPayment: source.autoEnrollOnPayment,
      enrollAsMentorado: source.enrollAsMentorado,
      upsellTrailId: source.upsellTrailId,
      upsellPriceCents: source.upsellPriceCents,
      upsellCurrency: source.upsellCurrency,
      upsellHeadline: source.upsellHeadline,
      upsellBody: source.upsellBody,
      upsellDelayMinutes: source.upsellDelayMinutes,
      title: source.title,
      headline: source.headline,
      subheadline: source.subheadline,
      description: source.description,
      heroImageUrl: source.heroImageUrl,
      videoUrl: source.videoUrl,
      features: structuredClone(source.features || []),
      document: source.document ? structuredClone(source.document) : source.document,
      html: source.html,
      faqs: structuredClone(source.faqs || []),
      testimonials: structuredClone(source.testimonials || []),
      badges: structuredClone(source.badges || []),
      guaranteeText: source.guaranteeText,
      ctaText: source.ctaText,
      priceCents: source.priceCents,
      currency: source.currency,
      originalPriceCents: source.originalPriceCents,
      maxInstallments: source.maxInstallments,
      paymentMode: source.paymentMode,
      subscriptionCycle: source.subscriptionCycle,
      paymentProviderId: source.paymentProviderId,
      published: source.published,
      theme: source.theme ? structuredClone(source.theme) : source.theme,
      template: source.template,
      forWho: structuredClone(source.forWho || []),
      notForWho: structuredClone(source.notForWho || []),
      agenda: structuredClone(source.agenda || []),
      sections: structuredClone(source.sections || []),
      about: source.about ? structuredClone(source.about) : source.about,
      eventInfo: source.eventInfo ? structuredClone(source.eventInfo) : source.eventInfo,
      urgencyText: source.urgencyText,
      countdown: source.countdown ? structuredClone(source.countdown) : source.countdown,
      coupons: structuredClone(source.coupons || []),
      seo: source.seo ? structuredClone(source.seo) : source.seo,
    });

    return this.pages.save(copy);
  }

  async update(mentorId: string, id: string, dto: Partial<SalesPage>) {
    const p = await this.get(mentorId, id);
    if (dto.slug && dto.slug !== p.slug) {
      p.slug = await this.ensureUniqueSlug(mentorId, dto.slug, p.id);
    }
    const editable: (keyof SalesPage)[] = [
      'title', 'productType', 'productRefId', 'autoEnrollOnPayment', 'enrollAsMentorado', 'headline', 'subheadline', 'description',
      'heroImageUrl', 'videoUrl', 'features', 'faqs', 'testimonials', 'badges',
      'guaranteeText', 'ctaText', 'priceCents', 'currency', 'originalPriceCents',
      'maxInstallments', 'paymentMode', 'subscriptionCycle', 'paymentProviderId',
      'theme', 'seo', 'published', 'document', 'html',
      'template', 'forWho', 'notForWho', 'agenda', 'sections', 'about', 'eventInfo', 'urgencyText',
      'coupons', 'countdown',
      'upsellTrailId', 'upsellPriceCents', 'upsellCurrency',
      'upsellHeadline', 'upsellBody', 'upsellDelayMinutes',
    ];
    for (const k of editable) {
      if (dto[k] !== undefined) (p as any)[k] = k === 'document' ? validateDocument(dto[k]) : dto[k];
    }
    return this.pages.save(p);
  }

  async remove(mentorId: string, id: string) {
    await this.get(mentorId, id);
    await this.pages.delete({ id, mentorId } as any);
    return { ok: true };
  }

  // ==================== Geração com IA ====================
  async generate(mentorId: string, dto: {
    briefing: string;
    audience?: string;
    priceHint?: string;
    productType?: SalesPageProductType;
    tone?: string;
    template?: 'classic' | 'long_form';
    outputFormat?: SalesPageOutputFormat;
  }) {
    if (!dto.briefing || dto.briefing.trim().length < 10) {
      throw new BadRequestException('Descreva melhor o produto (mínimo 10 caracteres).');
    }

    const isLong = dto.template === 'long_form';

    const longExtra = `,
  "forWho": string[] (5 a 7 itens curtos começando com "Você" — para quem O produto É indicado),
  "notForWho": string[] (3 a 4 itens curtos — para quem NÃO é indicado),
  "agenda": [{"time": string, "title": string, "text": string}] (5 a 8 blocos com horário/etapa e descrição curta — se for evento use horários "9h", "10h30" etc; se for curso use "Módulo 1", "Módulo 2"…),
  "sections": [{"eyebrow": string, "title": string, "body": string, "items": [{"title": string, "text": string}], "quote": string, "ctaText": string, "variant": "default"|"muted"|"highlight"}] (4 a 7 blocos ordenados: dor, mecanismo, aplicações, transformação e oferta; use parágrafos em body, listas em items e CTA quando fizer sentido),
  "about": {"name": string, "role": string, "bio": string} (mentor — se não souber, deixe placeholders coerentes com o briefing),
  "eventInfo": {"date": string, "time": string, "location": string, "extra": string} (só se o briefing indicar evento/imersão presencial; caso contrário deixe strings vazias),
  "urgencyText": string (frase curta de escassez, ex: "Lote 1 esgota em 48h · Vagas limitadas")`;

    const system = `Você é copywriter de páginas de vendas de alta conversão para mentores e infoprodutores brasileiros.
Gere APENAS um JSON válido, sem markdown, no formato exato:
{
  "title": string (nome curto do produto, até 60 chars),
  "headline": string (título principal do hero, até 90 chars, direto e emocional),
  "subheadline": string (subtítulo do hero, até 200 chars, prova + benefício),
  "description": string (parágrafo persuasivo de 2-3 frases sobre a transformação),
  "features": [{"icon": "sparkles"|"target"|"trending-up"|"shield-check"|"zap"|"book-open"|"clock"|"users", "title": string, "text": string}] (4 a 6 itens),
  "badges": string[] (3 itens curtos, ex: "Acesso vitalício", "Garantia 7 dias", "Certificado digital"),
  "guaranteeText": string (frase de garantia curta),
  "ctaText": string (texto do botão, até 30 chars, ação clara),
  "faqs": [{"q": string, "a": string}] (4 perguntas objetivas com respostas curtas),
  "seo": {"title": string (até 60 chars), "description": string (até 155 chars)}${isLong ? longExtra : ''}
}
Português do Brasil. Tom: ${dto.tone || 'profissional, próximo, sem clichês vazios'}.`;

    const user = `Produto: ${dto.briefing}
Público: ${dto.audience || 'não especificado'}
Preço/oferta: ${dto.priceHint || 'não especificado'}
Tipo: ${dto.productType || 'não especificado'}

Gere o JSON agora.`;

    let raw = '';
    try {
      raw = await this.ai.chat(system, user, { mentorId, useCase: 'sales_page_generate' });
    } catch (e: any) {
      if (e instanceof ForbiddenException) throw e;
      throw new BadRequestException(`Falha ao chamar IA: ${e?.message || e}`);
    }

    // Extrai JSON (remove ```json fences se houver)
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) {
      throw new BadRequestException('IA não retornou JSON válido. Tente novamente.');
    }
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new BadRequestException('IA retornou JSON malformado. Tente novamente.');
    }
    // sanitiza
    const legacy = {
      title: String(parsed.title || '').slice(0, 100),
      headline: String(parsed.headline || '').slice(0, 200),
      subheadline: String(parsed.subheadline || '').slice(0, 400),
      description: String(parsed.description || '').slice(0, 1200),
      features: Array.isArray(parsed.features) ? parsed.features.slice(0, 8).map((f: any) => ({
        icon: String(f.icon || 'sparkles'),
        title: String(f.title || '').slice(0, 80),
        text: String(f.text || '').slice(0, 200),
      })) : [],
      badges: Array.isArray(parsed.badges) ? parsed.badges.slice(0, 5).map((b: any) => String(b).slice(0, 40)) : [],
      guaranteeText: String(parsed.guaranteeText || '').slice(0, 200),
      ctaText: String(parsed.ctaText || 'Quero garantir agora').slice(0, 40),
      faqs: Array.isArray(parsed.faqs) ? parsed.faqs.slice(0, 8).map((f: any) => ({
        q: String(f.q || '').slice(0, 200),
        a: String(f.a || '').slice(0, 800),
      })) : [],
      seo: {
        title: String(parsed?.seo?.title || parsed.title || '').slice(0, 70),
        description: String(parsed?.seo?.description || '').slice(0, 165),
      },
      forWho: Array.isArray(parsed.forWho) ? parsed.forWho.slice(0, 10).map((s: any) => String(s).slice(0, 240)) : [],
      notForWho: Array.isArray(parsed.notForWho) ? parsed.notForWho.slice(0, 8).map((s: any) => String(s).slice(0, 240)) : [],
      agenda: Array.isArray(parsed.agenda) ? parsed.agenda.slice(0, 12).map((a: any) => ({
        time: String(a?.time || '').slice(0, 40),
        title: String(a?.title || '').slice(0, 120),
        text: String(a?.text || '').slice(0, 300),
      })) : [],
      sections: Array.isArray(parsed.sections) ? parsed.sections.slice(0, 10).map((s: any) => ({
        eyebrow: String(s?.eyebrow || '').slice(0, 80),
        title: String(s?.title || '').slice(0, 180),
        body: String(s?.body || '').slice(0, 3000),
        items: Array.isArray(s?.items) ? s.items.slice(0, 10).map((item: any) => ({
          title: String(item?.title || '').slice(0, 100),
          text: String(item?.text || item || '').slice(0, 500),
        })) : [],
        quote: String(s?.quote || '').slice(0, 500),
        ctaText: String(s?.ctaText || '').slice(0, 60),
        variant: ['default', 'muted', 'highlight'].includes(s?.variant) ? s.variant : 'default',
      })).filter((s: any) => s.title) : [],
      about: parsed.about && typeof parsed.about === 'object' ? {
        name: String(parsed.about.name || '').slice(0, 100),
        role: String(parsed.about.role || '').slice(0, 120),
        bio: String(parsed.about.bio || '').slice(0, 1200),
      } : undefined,
      eventInfo: parsed.eventInfo && typeof parsed.eventInfo === 'object' ? {
        date: String(parsed.eventInfo.date || '').slice(0, 80),
        time: String(parsed.eventInfo.time || '').slice(0, 80),
        location: String(parsed.eventInfo.location || '').slice(0, 160),
        extra: String(parsed.eventInfo.extra || '').slice(0, 160),
      } : undefined,
      urgencyText: String(parsed.urgencyText || '').slice(0, 200),
    };
    const normalized = normalizeBlocks(legacy);
    return {
      ...legacy,
      document: normalized.document,
      warnings: normalized.warnings,
      ...(dto.outputFormat === 'html' ? { html: sanitizeHtml(blocksToHtml(normalized.document)) } : {}),
    };
  }

  // ==================== Público ====================
  async publicBySlug(mentorSlug: string, pageSlug: string) {
    const m = await this.users.findOne({ where: { slug: mentorSlug, status: UserStatus.ACTIVE } });
    if (!m) throw new NotFoundException('Mentor não encontrado');
    const p = await this.pages.findOne({ where: { mentorId: m.id, slug: pageSlug, published: true } });
    if (!p) throw new NotFoundException('Página não encontrada ou não publicada');
    // Não exporta a lista completa de cupons publicamente (usuário digita o código).
    const publicPage: any = { ...p };
    delete publicPage.coupons;
    return {
      mentor: {
        id: m.id,
        slug: m.slug,
        brandName: m.brandName,
        brandLogoUrl: m.brandLogoUrl,
        brandPrimaryColor: m.brandPrimaryColor,
        brandAccentColor: m.brandAccentColor,
      },
      page: publicPage,
    };
  }

  // ==================== Cupons ====================
  /** Encontra cupom por código (case-insensitive) sem checar regras. */
  private findCoupon(page: SalesPage, code: string): SalesPageCoupon | null {
    const c = (code || '').trim().toUpperCase();
    if (!c) return null;
    const list = Array.isArray(page.coupons) ? page.coupons : [];
    return list.find((x) => (x.code || '').toUpperCase() === c) || null;
  }

  /** Aplica cupom e retorna centavos abatidos + finais. Lança BadRequest se inválido. */
  private applyCoupon(
    page: SalesPage,
    priceCents: number,
    code: string,
    email: string,
  ): { coupon: SalesPageCoupon; discountCents: number; finalCents: number } {
    const coupon = this.findCoupon(page, code);
    if (!coupon) throw new BadRequestException('Cupom não encontrado.');
    if (coupon.isActive === false) throw new BadRequestException('Cupom inativo.');
    const now = Date.now();
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) {
      throw new BadRequestException('Cupom ainda não está válido.');
    }
    if (coupon.endsAt && new Date(coupon.endsAt).getTime() < now) {
      throw new BadRequestException('Cupom expirado.');
    }
    if (coupon.maxUses && (coupon.usedCount || 0) >= coupon.maxUses) {
      throw new BadRequestException('Cupom esgotado.');
    }
    if (coupon.oneUsePerPerson && email) {
      const used = (coupon.usedEmails || []).map((x) => (x || '').toLowerCase());
      if (used.includes(email.trim().toLowerCase())) {
        throw new BadRequestException('Você já usou este cupom.');
      }
    }
    let discountCents = 0;
    if (coupon.discountType === 'percent') {
      const pct = Math.max(0, Math.min(100, coupon.discountValue || 0));
      discountCents = Math.floor((priceCents * pct) / 100);
    } else {
      discountCents = Math.max(0, Math.floor(coupon.discountValue || 0));
    }
    if (discountCents > priceCents) discountCents = priceCents;
    const finalCents = Math.max(0, priceCents - discountCents);
    return { coupon, discountCents, finalCents };
  }

  /** Endpoint público: valida cupom e retorna preview do desconto. */
  async validateCoupon(mentorSlug: string, pageSlug: string, dto: { code: string; email?: string }) {
    const m = await this.users.findOne({ where: { slug: mentorSlug, status: UserStatus.ACTIVE } });
    if (!m) throw new NotFoundException('Mentor não encontrado');
    const page = await this.pages.findOne({ where: { mentorId: m.id, slug: pageSlug, published: true } });
    if (!page) throw new NotFoundException('Página não encontrada');
    try {
      const { coupon, discountCents, finalCents } = this.applyCoupon(
        page, page.priceCents, dto.code, dto.email || '',
      );
      return {
        valid: true,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountCents,
        originalCents: page.priceCents,
        finalCents,
      };
    } catch (e: any) {
      return { valid: false, message: e?.message || 'Cupom inválido' };
    }
  }

  // ==================== Checkout transparente Asaas ====================
  async checkout(
    mentorSlug: string,
    pageSlug: string,
    dto: {
      name: string;
      email: string;
      cpfCnpj: string;
      phone?: string;
      billingType: 'PIX' | 'CREDIT_CARD';
      creditCard?: {
        holderName: string;
        number: string;
        expiryMonth: string;
        expiryYear: string;
        ccv: string;
      };
      creditCardHolderInfo?: {
        name: string;
        email: string;
        cpfCnpj: string;
        postalCode: string;
        addressNumber: string;
        phone?: string;
      };
      installments?: number;
      couponCode?: string;
    },
  ) {
    if (!dto?.name || !dto?.email || !dto?.cpfCnpj) {
      throw new BadRequestException('Nome, e-mail e CPF/CNPJ são obrigatórios.');
    }
    // Carrega direto (com cupons) — publicBySlug esconde a lista.
    const mentor = await this.users.findOne({ where: { slug: mentorSlug, status: UserStatus.ACTIVE } });
    if (!mentor) throw new NotFoundException('Mentor não encontrado');
    const page = await this.pages.findOne({ where: { mentorId: mentor.id, slug: pageSlug, published: true } });
    if (!page) throw new NotFoundException('Página não encontrada');
    if (!page.paymentProviderId) {
      throw new BadRequestException('Página sem provedor de pagamento configurado.');
    }
    if (!page.priceCents || page.priceCents < 100) {
      throw new BadRequestException('Preço inválido.');
    }

    // Aplica cupom (se houver) — reduz o valor cobrado no Asaas.
    let appliedCoupon: SalesPageCoupon | null = null;
    let discountCents = 0;
    let chargeCents = page.priceCents;
    if (dto.couponCode && dto.couponCode.trim()) {
      const res = this.applyCoupon(page, page.priceCents, dto.couponCode, dto.email);
      appliedCoupon = res.coupon;
      discountCents = res.discountCents;
      chargeCents = res.finalCents;
      if (chargeCents < 100) {
        throw new BadRequestException('Valor final após desconto é menor que R$ 1,00.');
      }
    }

    // Carrega provider com apiKey
    const provider = await this.providers
      .createQueryBuilder('p')
      .addSelect('p.apiKey')
      .where('p.id = :id AND p.mentorId = :mid', { id: page.paymentProviderId, mid: mentor.id })
      .getOne();

    if (!provider) throw new BadRequestException('Provedor de pagamento não encontrado.');
    if (provider.type !== PaymentProviderType.ASAAS) {
      throw new BadRequestException('Somente Asaas é suportado neste checkout.');
    }
    if (!provider.apiKey) throw new BadRequestException('API key Asaas ausente.');

    const baseUrl = provider.environment === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://sandbox.asaas.com/api/v3';
    const headers = {
      access_token: provider.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'MentorGleego/1.0',
    };

    // 1. cliente
    const customer = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        cpfCnpj: dto.cpfCnpj.replace(/\D/g, ''),
        externalReference: `salespage:${page.id}`,
      }),
    }).then((r) => r.json());
    if (!customer?.id) {
      throw new BadRequestException(customer?.errors?.[0]?.description || 'Falha ao criar cliente Asaas.');
    }

    const value = chargeCents / 100;
    const description = `${page.title} — ${mentor.brandName || 'Compra'}`;

    // 2. Cobrança
    const dueDate = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const chargePayload: any = {
      customer: customer.id,
      billingType: dto.billingType,
      value,
      dueDate,
      description,
      externalReference: `salespage:${page.id}`,
    };
    if (dto.billingType === 'CREDIT_CARD') {
      if (!dto.creditCard || !dto.creditCardHolderInfo) {
        throw new BadRequestException('Dados do cartão obrigatórios.');
      }
      chargePayload.installmentCount = Math.max(1, Math.min(dto.installments || 1, page.maxInstallments));
      if (chargePayload.installmentCount > 1) {
        chargePayload.totalValue = value;
        delete chargePayload.value;
      }
      chargePayload.creditCard = {
        holderName: dto.creditCard.holderName,
        number: dto.creditCard.number.replace(/\s/g, ''),
        expiryMonth: dto.creditCard.expiryMonth,
        expiryYear: dto.creditCard.expiryYear,
        ccv: dto.creditCard.ccv,
      };
      chargePayload.creditCardHolderInfo = {
        name: dto.creditCardHolderInfo.name,
        email: dto.creditCardHolderInfo.email,
        cpfCnpj: dto.creditCardHolderInfo.cpfCnpj.replace(/\D/g, ''),
        postalCode: dto.creditCardHolderInfo.postalCode.replace(/\D/g, ''),
        addressNumber: dto.creditCardHolderInfo.addressNumber,
        phone: dto.creditCardHolderInfo.phone,
      };
    }

    const endpoint = dto.billingType === 'CREDIT_CARD' && (chargePayload.installmentCount || 1) > 1
      ? '/installments'
      : '/payments';

    const charge = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chargePayload),
    }).then((r) => r.json());

    if (!charge?.id && !charge?.installment) {
      throw new BadRequestException(charge?.errors?.[0]?.description || 'Falha ao criar cobrança.');
    }

    const chargeId = charge.id || charge.installment;

    // Vincula o comprador ao funil de leads (best-effort — nunca quebra o checkout).
    let leadId: string | null = null;
    try {
      const res = await this.leadsService.createFromCapture({
        mentorId: mentor.id,
        mentorBrand: mentor.brandName || mentor.name,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        source: `sales:${page.slug}`,
        salesPageId: page.id,
        salesPageSlug: page.slug,
      });
      leadId = res.lead?.id || null;
    } catch (e: any) {
      this.logger.warn(`Checkout criou cobrança mas falhou ao vincular lead: ${e?.message}`);
    }

    // Persiste a cobrança local. Este é o elo que faltava: sem linha de Charge o
    // webhook Asaas saía em `if (!charge) return` e nada era liberado. O metadata
    // carrega o que o webhook precisa para conceder o acesso.
    const local = this.charges.create({
      mentorId: mentor.id,
      leadId: leadId || undefined,
      description,
      amount: value,
      dueDate,
      status: ChargeStatus.PENDING,
      method: dto.billingType === 'CREDIT_CARD' ? ChargeMethod.CREDIT_CARD : ChargeMethod.PIX,
      asaasChargeId: chargeId,
      invoiceUrl: charge.invoiceUrl,
      pixQrCode: charge.pixQrCode,
      pixCopyPaste: charge.pixCopyPaste,
      bankSlipUrl: charge.bankSlipUrl,
      installmentNumber: charge.installmentNumber,
      installmentTotal: charge.installmentTotal,
      metadata: {
        kind: 'sales-page',
        salesPageId: page.id,
        salesPageSlug: page.slug,
        trailId: page.productRefId || null,
        productRefId: page.productRefId || null,
        productType: page.productType,
        autoEnroll: page.autoEnrollOnPayment !== false,
        enrollAsMentorado: page.enrollAsMentorado !== false,
        upsellTrailId: page.upsellTrailId || null,
        leadId: leadId,
        buyerEmail: dto.email,
        buyerName: dto.name,
      },
    });
    const savedCharge = await this.charges.save(local);

    // Marca uso do cupom (best-effort). Se der erro persistente, seguimos com a cobrança criada.
    if (appliedCoupon) {
      try {
        const idx = (page.coupons || []).findIndex(
          (c) => (c.code || '').toUpperCase() === appliedCoupon!.code.toUpperCase(),
        );
        if (idx >= 0) {
          const list = [...(page.coupons || [])];
          const cur = { ...list[idx] };
          cur.usedCount = (cur.usedCount || 0) + 1;
          if (cur.oneUsePerPerson) {
            const emails = new Set([...(cur.usedEmails || []).map((x) => x.toLowerCase()), dto.email.toLowerCase()]);
            cur.usedEmails = Array.from(emails);
          }
          list[idx] = cur;
          page.coupons = list;
          await this.pages.save(page);
        }
      } catch (e: any) {
        this.logger.warn(`Falha ao atualizar uso do cupom: ${e?.message}`);
      }
    }

    // 3. Se PIX → busca QR
    let pix: { payload?: string; qrImage?: string } | null = null;
    if (dto.billingType === 'PIX') {
      try {
        const q = await fetch(`${baseUrl}/payments/${chargeId}/pixQrCode`, { headers }).then((r) => r.json());
        pix = {
          payload: q.payload,
          qrImage: q.encodedImage ? `data:image/png;base64,${q.encodedImage}` : undefined,
        };
        if (q.payload && !savedCharge.pixCopyPaste) {
          savedCharge.pixCopyPaste = q.payload;
          if (q.encodedImage) savedCharge.pixQrCode = `data:image/png;base64,${q.encodedImage}`;
          await this.charges.save(savedCharge);
        }
      } catch (e: any) {
        this.logger.warn(`Asaas pix qrcode falhou: ${e?.message}`);
      }
    }

    // Link de uso único para o comprador cair direto na área de acesso assim que
    // o pagamento for confirmado — sem depender do e-mail com as credenciais.
    const access = await this.purchaseLinks.issue({
      mentorId: mentor.id,
      mentorSlug: mentor.slug,
      leadId: leadId || undefined,
      email: dto.email,
    });

    return {
      ok: true,
      chargeId,
      status: charge.status || 'PENDING',
      billingType: dto.billingType,
      value,
      originalValue: page.priceCents / 100,
      discountValue: discountCents / 100,
      couponCode: appliedCoupon?.code || null,
      invoiceUrl: charge.invoiceUrl || null,
      bankSlipUrl: charge.bankSlipUrl || null,
      pix,
      accessUrl: access.url,
      trailId: page.productRefId || null,
      trailAccessGranted: false,
      upsell: page.upsellTrailId && page.upsellPriceCents && page.upsellPriceCents >= 100
        ? {
            trailId: page.upsellTrailId,
            priceCents: page.upsellPriceCents,
            currency: page.upsellCurrency || page.currency,
            headline: page.upsellHeadline || 'Quer ir além?',
            body: page.upsellBody || null,
            delayMinutes: page.upsellDelayMinutes || 0,
          }
        : null,
    };
  }

  // ==================== Upsell interno (pós-pagamento) ====================
  /**
   * Cria a cobrança da oferta de upgrade apresentada logo após a compra.
   * Segue o mesmo fluxo do checkout principal (cliente Asaas + charge + PIX),
   * só que com o próprio PROSPECT já identificado e sem pedir dados de novo.
   */
  async upsellCheckout(mentorSlug: string, pageSlug: string, chargeId: string, dto: { name?: string; email?: string }) {
    const mentor = await this.users.findOne({ where: { slug: mentorSlug, status: UserStatus.ACTIVE } });
    if (!mentor) throw new NotFoundException('Mentor não encontrado');
    const page = await this.pages.findOne({ where: { mentorId: mentor.id, slug: pageSlug } });
    if (!page?.published) throw new NotFoundException('Página não encontrada');

    const original = await this.charges.findOne({ where: { id: chargeId } });
    if (!original) throw new NotFoundException('Compra original não encontrada');
    if ((original.metadata as any)?.salesPageId !== page.id) {
      throw new BadRequestException('Compra não pertence a esta página.');
    }
    if (original.status !== ChargeStatus.PAID) {
      throw new BadRequestException('A compra original ainda não foi confirmada.');
    }
    if (!page.upsellTrailId || !page.upsellPriceCents || page.upsellPriceCents < 100) {
      throw new BadRequestException('Upsell não configurado nesta página.');
    }

    const already = await this.charges
      .createQueryBuilder('c')
      .where('c.mentorId = :mentorId', { mentorId: mentor.id })
      .andWhere(`c.metadata->>'kind' = 'sales-page-upsell'`)
      .andWhere(`c.metadata->>'salesPageId' = :pageId`, { pageId: page.id })
      .andWhere(`c.metadata->>'parentChargeId' = :parentId`, { parentId: original.id })
      .getOne();
    if (already) {
      throw new BadRequestException('Upsell já adquirido para esta compra.');
    }

    const provider = await this.providers.findOne({
      where: { mentorId: mentor.id, id: page.paymentProviderId!, type: PaymentProviderType.ASAAS },
    });
    if (!provider) throw new BadRequestException('Provedor de pagamento não encontrado.');
    if (!provider.apiKey) throw new BadRequestException('API key Asaas ausente.');

    const lead = original.leadId
      ? await this.leadsService.getById(original.mentorId, original.leadId).catch(() => null)
      : null;

    const baseUrl = (provider as any).sandbox
      ? 'https://sandbox.asaas.com/api/v3'
      : 'https://api.asaas.com/api/v3';
    const headers = { 'Content-Type': 'application/json', access_token: provider.apiKey } as any;

    const customerPayload: any = {
      name: dto.name || lead?.name || original.description,
      email: dto.email || lead?.email || (original.metadata as any)?.buyerEmail,
      cpfCnpj: (original.metadata as any)?.buyerCpf || undefined,
      externalReference: `salespage-upsell:${page.id}`,
    };
    const customer = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(customerPayload),
    }).then((r) => r.json());
    if (customer?.errors?.[0]?.description) {
      throw new BadRequestException(customer.errors[0].description || 'Falha ao criar cliente Asaas.');
    }

    const description = `Upsell ${page.title} — trilha ${page.upsellTrailId}`;
    const chargePayload: any = {
      customer: customer.id,
      billingType: 'PIX',
      value: page.upsellPriceCents / 100,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      description,
      externalReference: `salespage-upsell:${page.id}:${original.asaasChargeId}`,
    };
    const charge = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chargePayload),
    }).then((r) => r.json());
    if (charge?.errors?.[0]?.description) {
      throw new BadRequestException(charge.errors[0].description || 'Falha ao criar cobrança.');
    }

    const asaasChargeId = charge.id as string;
    const local = this.charges.create({
      mentorId: mentor.id,
      leadId: original.leadId,
      description,
      amount: page.upsellPriceCents / 100,
      dueDate: chargePayload.dueDate,
      status: ChargeStatus.PENDING,
      method: ChargeMethod.PIX,
      asaasChargeId,
      invoiceUrl: charge.invoiceUrl,
      metadata: {
        kind: 'sales-page-upsell',
        salesPageId: page.id,
        salesPageSlug: page.slug,
        trailId: page.upsellTrailId,
        leadId: original.leadId || (original.metadata as any)?.leadId || null,
        parentChargeId: original.id,
      },
    });
    const saved = await this.charges.save(local);

    let pix: { payload?: string; qrImage?: string } | null = null;
    try {
      const q = await fetch(`${baseUrl}/payments/${asaasChargeId}/pixQrCode`, { headers }).then((r) => r.json());
      pix = { payload: q.payload, qrImage: q.encodedImage ? `data:image/png;base64,${q.encodedImage}` : undefined };
      saved.pixCopyPaste = q.payload || saved.pixCopyPaste;
      if (q.encodedImage) saved.pixQrCode = `data:image/png;base64,${q.encodedImage}`;
      await this.charges.save(saved);
    } catch (e: any) {
      this.logger.warn(`Upsell pix qrcode falhou: ${e?.message}`);
    }

    return {
      ok: true,
      chargeId: asaasChargeId,
      localChargeId: saved.id,
      status: 'PENDING',
      value: page.upsellPriceCents / 100,
      currency: page.upsellCurrency || 'BRL',
      trailId: page.upsellTrailId,
      invoiceUrl: charge.invoiceUrl || null,
      pix,
    };
  }

  /**
   * Consulta o status de uma cobrança de página de vendas. Usado pelo comprador
   * na tela de obrigado para detectar a aprovação e liberar o botão de acesso.
   */
  async chargeStatus(mentorSlug: string, pageSlug: string, chargeId: string) {
    const mentor = await this.users.findOne({ where: { slug: mentorSlug, status: UserStatus.ACTIVE } });
    if (!mentor) throw new NotFoundException('Mentor não encontrado');
    const charge = await this.charges.findOne({
      where: { mentorId: mentor.id, asaasChargeId: chargeId },
    });
    if (!charge) throw new NotFoundException('Cobrança não encontrada');
    const meta = (charge.metadata as any) || {};
    if (meta.salesPageSlug && meta.salesPageSlug !== pageSlug) {
      throw new NotFoundException('Cobrança não encontrada');
    }
    return {
      chargeId: charge.id,
      asaasChargeId: charge.asaasChargeId,
      status: charge.status,
      paidAt: charge.paidAt,
      trailId: (charge.metadata as any)?.trailId || null,
    };
  }

  /**
   * Troca o link de compra (`?tk=`) por uma sessão real de PROSPECT.
   * O JWT de compra (aud `sales-page-checkout`) é validado pelo PurchaseLinksService;
   * em seguida emitimos o mesmo payload do `auth.login`, com o brand do mentor,
   * para o comprador cair na área de membro já autenticado — sem depender de e-mail.
   */
  async redeemAccessLink(token?: string) {
    if (!token) throw new UnauthorizedException('Link de acesso ausente');
    const link = await this.purchaseLinks.consume(token);
    if (!link?.userId) throw new UnauthorizedException('Link de acesso inválido');

    const user = await this.users.findOne({ where: { id: link.userId } });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      mentorId: user.mentorId,
      parentMentorId: user.parentMentorId,
      teamRole: user.teamRole,
    };
    const tenantMentorId = user.mentorId;
    const mentor = tenantMentorId ? await this.users.findOne({ where: { id: tenantMentorId } }) : null;

    return {
      access_token: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        slug: user.slug,
        brandName: user.brandName,
        brandLogoUrl: user.brandLogoUrl,
        brandBannerUrl: user.brandBannerUrl,
        brandMobileBannerUrl: user.brandMobileBannerUrl,
        brandPrimaryColor: user.brandPrimaryColor,
        brandAccentColor: user.brandAccentColor,
        brandTheme: user.brandTheme,
        brandHighlightTheme: user.brandHighlightTheme,
        brandCoursesLayout: user.brandCoursesLayout,
        brandDarkBannerUrl: user.brandDarkBannerUrl,
        brandDarkLogoUrl: user.brandDarkLogoUrl,
        customDomain: user.customDomain,
        onboardingCompleted: user.onboardingCompleted,
        mentorId: user.mentorId,
        parentMentorId: user.parentMentorId,
        teamRole: user.teamRole,
        mustChangePassword: user.mustChangePassword,
        tenantBrand: mentor
          ? {
              name: mentor.name,
              brandName: mentor.brandName,
              brandLogoUrl: mentor.brandLogoUrl,
              brandPrimaryColor: mentor.brandPrimaryColor,
              brandAccentColor: mentor.brandAccentColor,
              brandTheme: mentor.brandTheme,
            }
          : null,
      },
    };
  }
}
