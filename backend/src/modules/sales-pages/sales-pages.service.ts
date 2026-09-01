import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SalesPage, SalesPagePaymentMode, SalesPageProductType,
  SalesPageCoupon,
} from '../../entities/sales-page.entity';
import { User, UserStatus } from '../../entities/user.entity';
import { MentorPaymentProvider, PaymentProviderType } from '../../entities/mentor-payment-provider.entity';
import { AiService } from '../ai/ai.service';

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
    private ai: AiService,
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
      headline: dto.headline,
      subheadline: dto.subheadline,
      description: dto.description,
      heroImageUrl: dto.heroImageUrl,
      videoUrl: dto.videoUrl,
      features: dto.features || [],
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

  async update(mentorId: string, id: string, dto: Partial<SalesPage>) {
    const p = await this.get(mentorId, id);
    if (dto.slug && dto.slug !== p.slug) {
      p.slug = await this.ensureUniqueSlug(mentorId, dto.slug, p.id);
    }
    const editable: (keyof SalesPage)[] = [
      'title', 'productType', 'productRefId', 'headline', 'subheadline', 'description',
      'heroImageUrl', 'videoUrl', 'features', 'faqs', 'testimonials', 'badges',
      'guaranteeText', 'ctaText', 'priceCents', 'currency', 'originalPriceCents',
      'maxInstallments', 'paymentMode', 'subscriptionCycle', 'paymentProviderId',
      'theme', 'seo', 'published',
      'template', 'forWho', 'notForWho', 'agenda', 'sections', 'about', 'eventInfo', 'urgencyText',
      'coupons', 'countdown',
    ];
    for (const k of editable) {
      if (dto[k] !== undefined) (p as any)[k] = dto[k];
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
    return {
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
      } catch (e: any) {
        this.logger.warn(`Asaas pix qrcode falhou: ${e?.message}`);
      }
    }

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
    };
  }
}
