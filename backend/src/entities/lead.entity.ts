import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { User } from './user.entity';
import { Company } from './company.entity';

export enum LeadStage {
  NEW = 'new',
  TESTED = 'tested',
  ENGAGED = 'engaged',
  NEGOTIATING = 'negotiating',
  CLIENT = 'client',
  LOST = 'lost',
}

export enum LeadTemperature {
  COLD = 'cold',
  WARM = 'warm',
  HOT = 'hot',
}

@Entity('leads')
@Index(['mentorId', 'stage'])
@Index(['mentorId', 'eventId'])
@Index(['mentorId', 'salesPageId'])
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  mentorId: string;

  @ManyToOne(() => User, (u) => u.leads, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mentorId' })
  mentor: User;

  /** Usuário criado para o prospect (com senha enviada por email) */
  @Column({ type: 'uuid', nullable: true })
  userId?: string;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  company?: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  revenue?: number;

  @Column({ nullable: true })
  source?: string; // evento, qr, link

  /** FK para events.id quando o lead veio de um evento específico. */
  @Column({ type: 'uuid', nullable: true })
  eventId?: string;

  /** FK para sales_pages.id quando o lead veio de uma página de vendas. */
  @Column({ type: 'uuid', nullable: true })
  salesPageId?: string;

  /** Slug da página de vendas de origem (ex.: sales:minha-pagina). */
  @Column({ nullable: true })
  salesPageSlug?: string;

  @Column({ type: 'enum', enum: LeadStage, default: LeadStage.NEW })
  stage: LeadStage;

  @Column({ type: 'enum', enum: LeadTemperature, nullable: true })
  temperature?: LeadTemperature;

  @Column({ type: 'int', nullable: true })
  score?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ==================== Onboarding completo ====================
  @Column({ nullable: true })
  cpf?: string;

  @Column({ nullable: true })
  rg?: string;

  @Column({ type: 'date', nullable: true })
  birthDate?: string;

  @Column({ nullable: true })
  addressZip?: string;

  @Column({ nullable: true })
  addressStreet?: string;

  @Column({ nullable: true })
  addressNumber?: string;

  @Column({ nullable: true })
  addressComplement?: string;

  @Column({ nullable: true })
  addressNeighborhood?: string;

  @Column({ nullable: true })
  addressCity?: string;

  @Column({ nullable: true })
  addressState?: string;

  // ---- Empresa
  @Column({ nullable: true })
  companyLegalName?: string; // razão social

  @Column({ nullable: true })
  companyCnpj?: string;

  @Column({ nullable: true })
  companyAddressZip?: string;

  @Column({ nullable: true })
  companyAddressStreet?: string;

  @Column({ nullable: true })
  companyAddressNumber?: string;

  @Column({ nullable: true })
  companyAddressCity?: string;

  @Column({ nullable: true })
  companyAddressState?: string;

  // ---- Perfil de negócio
  @Column({ nullable: true })
  segment?: string;

  @Column({ type: 'int', nullable: true })
  employees?: number;

  @Column({ type: 'text', nullable: true })
  challenges?: string;

  @Column({ type: 'text', nullable: true })
  goals?: string;

  /** Marca quando o lead completou o onboarding via token público */
  @Column({ type: 'timestamptz', nullable: true })
  onboardingCompletedAt?: Date;

  // ==================== Vínculo com Empresa (opcional — sócios) ====================
  /** FK para companies.id quando este lead é sócio de uma empresa */
  @Column({ type: 'uuid', nullable: true })
  companyId?: string;

  @ManyToOne(() => Company, (c) => c.partners, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'companyId' })
  companyEntity?: Company;

  /** Indica se o lead é sócio de uma entidade (empresa) */
  @Column({ default: false })
  isPartner: boolean;

  /** Cargo/papel do sócio na empresa (CEO, CFO, etc.) */
  @Column({ nullable: true })
  partnerRole?: string;

  /** % de participação societária */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  partnerShare?: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
