import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export enum SalesPageProductType {
  ACADEMY_COURSE = 'academy_course',
  MENTORSHIP = 'mentorship',
  EBOOK = 'ebook',
  EVENT = 'event',
  OTHER = 'other',
}

export enum SalesPagePaymentMode {
  ONE_TIME = 'one_time',
  SUBSCRIPTION = 'subscription',
}

export interface SalesPageFeature {
  icon?: string;
  title: string;
  text?: string;
}
export interface SalesPageFaq {
  q: string;
  a: string;
}
export interface SalesPageTestimonial {
  name: string;
  role?: string;
  quote: string;
  avatarUrl?: string;
}

export interface SalesPageAgendaItem {
  time?: string;
  title: string;
  text?: string;
}

export interface SalesPageSection {
  eyebrow?: string;
  title: string;
  body?: string;
  items?: Array<{ title?: string; text: string }>;
  quote?: string;
  ctaText?: string;
  variant?: 'default' | 'muted' | 'highlight';
}

export interface SalesPageAbout {
  name?: string;
  role?: string;
  bio?: string;
  photoUrl?: string;
  /** Título da seção (ex: "Sobre", "Palestrantes", "Quem ministra") */
  sectionTitle?: string;
  /** Nº de colunas no desktop quando há múltiplos palestrantes (1..4) */
  columns?: number;
  /** Múltiplos palestrantes/mentores. Se vazio, usa os campos legados acima. */
  people?: Array<{ name?: string; role?: string; bio?: string; photoUrl?: string }>;
}

export interface SalesPageEventInfo {
  date?: string;      // "19 de Agosto de 2026"
  time?: string;      // "9h às 17h"
  location?: string;  // "Espaço NWB — Barueri, SP"
  extra?: string;     // "Credenciamento a partir das 8h30"
}

export interface SalesPageCountdown {
  enabled?: boolean;
  endsAt?: string;   // ISO date-time — quando a oferta termina
  label?: string;    // rótulo curto ("Oferta termina em", "Turma fecha em")
  hideWhenExpired?: boolean;
}

export interface SalesPageCoupon {
  code: string;                       // sempre em MAIÚSCULAS
  description?: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;              // percent 1..100 OU centavos abatidos
  maxUses?: number | null;            // null/undefined = ilimitado
  usedCount?: number;                 // incrementado no checkout OK
  usedEmails?: string[];              // p/ oneUsePerPerson
  oneUsePerPerson?: boolean;
  isActive?: boolean;
  startsAt?: string | null;           // ISO
  endsAt?: string | null;             // ISO
}

export interface SalesPageTheme {
  colorSource?: 'brand' | 'custom';
  mode?: 'light' | 'dark';
  primaryColor?: string;
  accentColor?: string;
  bgColor?: string;
  fontFamily?: string;
  /** Estilo visual do hero: split (texto + imagem lado a lado) ou background (imagem de fundo full-bleed com texto sobreposto) */
  heroStyle?: 'split' | 'background';
  /** Posição de foco da imagem de fundo (ex: 'center', 'right', '70% 40%') */
  heroFocus?: string;
  /** Intensidade do overlay escuro sobre a imagem de fundo (0..1). Default 0.6 */
  heroOverlay?: number;
}

export type SalesPageTemplate = 'classic' | 'long_form';

/**
 * Página de vendas 1 produto = 1 página, publicada em /p/:mentorSlug/:pageSlug.
 * Checkout transparente Asaas usa o MentorPaymentProvider vinculado.
 */
@Entity('sales_pages')
@Index(['mentorId'])
@Index(['mentorId', 'slug'], { unique: true })
export class SalesPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  mentorId: string;

  @Column({ length: 80 })
  slug: string;

  // ---- Produto ----
  @Column({ type: 'enum', enum: SalesPageProductType, default: SalesPageProductType.OTHER })
  productType: SalesPageProductType;

  /** ID opcional do curso Academy / mentoria / evento vinculado (para liberar acesso via webhook). */
  @Column({ type: 'uuid', nullable: true })
  productRefId?: string;

  // ---- Conteúdo ----
  @Column()
  title: string;

  @Column({ nullable: true })
  headline?: string;

  @Column({ type: 'text', nullable: true })
  subheadline?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ nullable: true })
  heroImageUrl?: string;

  @Column({ nullable: true })
  videoUrl?: string;

  @Column({ type: 'jsonb', default: '[]' })
  features: SalesPageFeature[];

  @Column({ type: 'jsonb', default: '[]' })
  faqs: SalesPageFaq[];

  @Column({ type: 'jsonb', default: '[]' })
  testimonials: SalesPageTestimonial[];

  @Column({ type: 'jsonb', default: '[]' })
  badges: string[];

  @Column({ nullable: true })
  guaranteeText?: string;

  @Column({ default: 'Quero garantir agora' })
  ctaText: string;

  // ---- Preço ----
  @Column({ type: 'int', default: 0 })
  priceCents: number;

  @Column({ length: 3, default: 'BRL' })
  currency: string;

  @Column({ type: 'int', nullable: true })
  originalPriceCents?: number;

  @Column({ type: 'int', default: 1 })
  maxInstallments: number;

  @Column({ type: 'enum', enum: SalesPagePaymentMode, default: SalesPagePaymentMode.ONE_TIME })
  paymentMode: SalesPagePaymentMode;

  /** Se subscription: MONTHLY | QUARTERLY | SEMIANNUALLY | YEARLY */
  @Column({ nullable: true })
  subscriptionCycle?: string;

  // ---- Provider Asaas por mentor ----
  @Column({ type: 'uuid', nullable: true })
  paymentProviderId?: string;

  // ---- Publicação ----
  @Column({ default: false })
  published: boolean;

  @Column({ type: 'jsonb', nullable: true })
  theme?: SalesPageTheme;

  /** Layout visual: 'classic' (hero premium) | 'long_form' (imersão completa) */
  @Column({ default: 'classic' })
  template: SalesPageTemplate;

  // ---- Campos para versão "long_form" (opcionais) ----
  @Column({ type: 'jsonb', default: '[]' })
  forWho: string[];

  @Column({ type: 'jsonb', default: '[]' })
  notForWho: string[];

  @Column({ type: 'jsonb', default: '[]' })
  agenda: SalesPageAgendaItem[];

  @Column({ type: 'jsonb', default: '[]' })
  sections: SalesPageSection[];

  @Column({ type: 'jsonb', nullable: true })
  about?: SalesPageAbout;

  @Column({ type: 'jsonb', nullable: true })
  eventInfo?: SalesPageEventInfo;

  @Column({ type: 'text', nullable: true })
  urgencyText?: string;

  /** Contagem regressiva opcional (ativada pelo mentor no editor). */
  @Column({ type: 'jsonb', nullable: true })
  countdown?: SalesPageCountdown;

  /** Cupons de desconto do produto (mentor gerencia no editor). */
  @Column({ type: 'jsonb', default: '[]' })
  coupons: SalesPageCoupon[];

  @Column({ type: 'jsonb', nullable: true })
  seo?: { title?: string; description?: string; ogImage?: string };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
