import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Trail, TrailAccessMode } from '../../entities/trail.entity';
import { TrailModule as TrailModuleEntity } from '../../entities/trail-module.entity';
import { TrailLesson } from '../../entities/trail-lesson.entity';
import { TrailProgress } from '../../entities/trail-progress.entity';
import { TrailAccess, TrailAccessSource } from '../../entities/trail-access.entity';
import { TrailAccessRequest, TrailAccessRequestStatus } from '../../entities/trail-access-request.entity';
import { Lead } from '../../entities/lead.entity';
import { User } from '../../entities/user.entity';
import { Charge, ChargeStatus, ChargeMethod } from '../../entities/charge.entity';
import { AccessGroupsService } from '../access-groups/access-groups.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface AccessResult {
  allowed: boolean;
  reason?:
    | 'not_in_group'
    | 'prerequisite_trail'
    | 'available_at'
    | 'paid'
    | 'request_required'
    | 'request_pending'
    | 'request_denied'
    | 'audience_mismatch';
  message?: string;
  /** Para o card bloqueado: oferta de upgrade/solicitação. */
  cta?: {
    kind: 'pay' | 'request' | 'wait';
    priceCents?: number;
    label: string;
    pendingRequestId?: string;
  };
}

/**
 * Centraliza a decisão de acesso a uma trilha para um lead/mentorado.
 * Não toca em CRUD de trilhas — apenas leitura + emissão de TrailAccess + requests.
 */
@Injectable()
export class TrailAccessService {
  private readonly logger = new Logger(TrailAccessService.name);

  constructor(
    @InjectRepository(Trail) private trails: Repository<Trail>,
    @InjectRepository(TrailModuleEntity) private modules: Repository<TrailModuleEntity>,
    @InjectRepository(TrailLesson) private lessons: Repository<TrailLesson>,
    @InjectRepository(TrailProgress) private progress: Repository<TrailProgress>,
    @InjectRepository(TrailAccess) private accesses: Repository<TrailAccess>,
    @InjectRepository(TrailAccessRequest) private requests: Repository<TrailAccessRequest>,
    @InjectRepository(Lead) private leads: Repository<Lead>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Charge) private charges: Repository<Charge>,
    private groups: AccessGroupsService,
    private notifications: NotificationsService,
  ) {}

  /** Resolve o lead do mentorado dentro do tenant do mentor. */
  async resolveLeadOf(userId: string, mentorId: string): Promise<Lead | null> {
    return this.leads.findOne({ where: { userId, mentorId } });
  }

  /** Calcula se o lead tem acesso à trilha agora. */
  async evaluateTrailAccess(trail: Trail, lead: Lead | null): Promise<AccessResult> {
    // 1) override manual / pago
    if (lead) {
      const override = await this.accesses.findOne({ where: { trailId: trail.id, leadId: lead.id } });
      if (override) {
        if (!override.expiresAt || override.expiresAt > new Date()) {
          return { allowed: true };
        }
      }
    }

    // 2) data fixa
    if (trail.availableAt && trail.availableAt > new Date()) {
      return {
        allowed: false,
        reason: 'available_at',
        message: `Disponível a partir de ${new Date(trail.availableAt).toLocaleDateString('pt-BR')}`,
        cta: { kind: 'wait', label: 'Em breve' },
      };
    }

    // 3) modo de acesso (paid / request / open)
    if (trail.accessMode === TrailAccessMode.PAID) {
      const pending = lead
        ? await this.requests.findOne({
            where: { trailId: trail.id, leadId: lead.id, status: TrailAccessRequestStatus.PENDING },
          })
        : null;
      return {
        allowed: false,
        reason: 'paid',
        message: trail.upgradeCallout || 'Conteúdo pago — desbloqueie para acessar',
        cta: {
          kind: 'pay',
          priceCents: trail.priceCents,
          label: `Desbloquear por R$ ${(trail.priceCents / 100).toFixed(2).replace('.', ',')}`,
          pendingRequestId: pending?.id,
        },
      };
    }

    if (trail.accessMode === TrailAccessMode.REQUEST) {
      const last = lead
        ? await this.requests.findOne({
            where: { trailId: trail.id, leadId: lead.id },
            order: { createdAt: 'DESC' },
          })
        : null;
      if (last?.status === TrailAccessRequestStatus.PENDING) {
        return {
          allowed: false,
          reason: 'request_pending',
          message: 'Solicitação enviada — aguardando liberação do mentor',
          cta: { kind: 'wait', label: 'Aguardando aprovação', pendingRequestId: last.id },
        };
      }
      if (last?.status === TrailAccessRequestStatus.DENIED) {
        return {
          allowed: false,
          reason: 'request_denied',
          message: 'Solicitação anterior negada — fale com o mentor',
          cta: { kind: 'request', label: 'Solicitar novamente' },
        };
      }
      return {
        allowed: false,
        reason: 'request_required',
        message: trail.upgradeCallout || 'Solicite acesso ao mentor',
        cta: { kind: 'request', label: 'Solicitar acesso' },
      };
    }

    // 4) grupos: se a trilha define grupos, lead precisa pertencer a algum
    if (Array.isArray(trail.groupIds) && trail.groupIds.length > 0) {
      if (!lead) return { allowed: false, reason: 'not_in_group', message: 'Acesso restrito' };
      const myGroups = await this.groups.groupsOfLead(trail.mentorId, lead.id);
      const ok = trail.groupIds.some((g) => myGroups.includes(g));
      if (!ok) {
        return {
          allowed: false,
          reason: 'not_in_group',
          message: trail.upgradeCallout || 'Conteúdo exclusivo para grupos específicos',
          cta: { kind: 'request', label: 'Solicitar acesso' },
        };
      }
    }

    // 5) pré-requisitos de outras trilhas
    if (Array.isArray(trail.prerequisiteTrailIds) && trail.prerequisiteTrailIds.length > 0) {
      if (!lead?.userId) {
        return { allowed: false, reason: 'prerequisite_trail', message: 'Conclua as trilhas anteriores' };
      }
      for (const prereqId of trail.prerequisiteTrailIds) {
        const done = await this.isTrailCompletedByUser(lead.userId, prereqId);
        if (!done) {
          const prereq = await this.trails.findOne({ where: { id: prereqId } });
          return {
            allowed: false,
            reason: 'prerequisite_trail',
            message: `Conclua antes: ${prereq?.title || 'trilha pré-requisito'}`,
            cta: { kind: 'wait', label: 'Conclua o pré-requisito' },
          };
        }
      }
    }

    return { allowed: true };
  }

  private async isTrailCompletedByUser(userId: string, trailId: string): Promise<boolean> {
    const mods = await this.modules.find({ where: { trailId } });
    if (!mods.length) return true;
    const lessons = await this.lessons.find({ where: { moduleId: In(mods.map((m) => m.id)) } });
    if (!lessons.length) return true;
    const prog = await this.progress.find({ where: { userId, trailId } });
    return lessons.every((l) => prog.find((p) => p.lessonId === l.id)?.completed);
  }

  // ============ Override manual (mentor) ============
  async grantManual(mentorId: string, trailId: string, leadId: string, expiresAt?: Date) {
    const trail = await this.trails.findOne({ where: { id: trailId, mentorId } });
    if (!trail) throw new NotFoundException('Trilha não encontrada');
    const lead = await this.leads.findOne({ where: { id: leadId, mentorId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    let acc = await this.accesses.findOne({ where: { trailId, leadId } });
    if (!acc) {
      acc = this.accesses.create({
        mentorId, trailId, leadId,
        source: TrailAccessSource.MANUAL,
      });
    }
    acc.expiresAt = expiresAt;
    acc.source = TrailAccessSource.MANUAL;
    const saved = await this.accesses.save(acc);
    if (lead.userId) {
      await this.notifications.create({
        userId: lead.userId,
        type: 'trail',
        title: 'Trilha liberada',
        body: `Você ganhou acesso à trilha "${trail.title}"`,
        link: `/me/trails/${trail.id}`,
      }).catch(() => null);
    }
    return saved;
  }

  async revokeManual(mentorId: string, trailId: string, leadId: string) {
    await this.accesses.delete({ mentorId, trailId, leadId } as any);
    return { ok: true };
  }

  async listAccessesForTrail(mentorId: string, trailId: string) {
    const items = await this.accesses.find({ where: { mentorId, trailId } });
    if (!items.length) return [];
    const leads = await this.leads.find({ where: { id: In(items.map((i) => i.leadId)) } });
    return items.map((i) => ({ ...i, lead: leads.find((l) => l.id === i.leadId) }));
  }

  // ============ Solicitação de acesso (mentorado) ============
  async requestAccess(userId: string, trailId: string, message?: string) {
    const trail = await this.trails.findOne({ where: { id: trailId, published: true } });
    if (!trail) throw new NotFoundException('Trilha não encontrada');
    const lead = await this.leads.findOne({ where: { userId, mentorId: trail.mentorId } });
    if (!lead) throw new BadRequestException('Você não está vinculado a este mentor');

    // já tem acesso?
    const has = await this.accesses.findOne({ where: { trailId, leadId: lead.id } });
    if (has) return { ok: true, alreadyGranted: true };

    const pending = await this.requests.findOne({
      where: { trailId, leadId: lead.id, status: TrailAccessRequestStatus.PENDING },
    });
    if (pending) return { ...pending, alreadyPending: true };

    if (trail.accessMode === TrailAccessMode.PAID) {
      // cria request + cobrança Asaas via Charge (sem dep direta do MentorBillingService para evitar ciclo)
      const req = await this.requests.save(this.requests.create({
        mentorId: trail.mentorId,
        trailId,
        leadId: lead.id,
        status: TrailAccessRequestStatus.PENDING,
        amountCents: trail.priceCents,
        message,
      }));
      const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      const charge = await this.charges.save(this.charges.create({
        mentorId: trail.mentorId,
        leadId: lead.id,
        description: `Acesso à trilha: ${trail.title}`,
        amount: trail.priceCents / 100 as any,
        dueDate: due,
        status: ChargeStatus.PENDING,
        method: ChargeMethod.PIX,
        metadata: { trailAccessRequestId: req.id, trailId },
      }));
      req.chargeId = charge.id;
      await this.requests.save(req);
      // notifica mentor
      await this.notifications.create({
        userId: trail.mentorId,
        type: 'trail',
        title: 'Nova solicitação de acesso (paga)',
        body: `${lead.name} solicitou "${trail.title}" — R$ ${(trail.priceCents / 100).toFixed(2)}`,
        link: `/app/trails/${trail.id}`,
      }).catch(() => null);
      return { ...req, chargeId: charge.id };
    }

    // REQUEST (sem cobrança automática) — mesmo se accessMode = OPEN, deixa solicitar (caso bloqueio por grupo)
    const req = await this.requests.save(this.requests.create({
      mentorId: trail.mentorId,
      trailId,
      leadId: lead.id,
      status: TrailAccessRequestStatus.PENDING,
      message,
    }));
    await this.notifications.create({
      userId: trail.mentorId,
      type: 'trail',
      title: 'Nova solicitação de acesso',
      body: `${lead.name} solicitou a trilha "${trail.title}"`,
      link: `/app/trails/${trail.id}`,
    }).catch(() => null);
    return req;
  }

  async listRequests(mentorId: string, status?: TrailAccessRequestStatus) {
    const where: any = { mentorId };
    if (status) where.status = status;
    const items = await this.requests.find({ where, order: { createdAt: 'DESC' } });
    if (!items.length) return [];
    const leads = await this.leads.find({ where: { id: In(items.map((i) => i.leadId)) } });
    const trails = await this.trails.find({ where: { id: In(items.map((i) => i.trailId)) } });
    return items.map((i) => ({
      ...i,
      lead: leads.find((l) => l.id === i.leadId),
      trail: trails.find((t) => t.id === i.trailId),
    }));
  }

  async resolveRequest(mentorId: string, requestId: string, action: 'approve' | 'deny') {
    const req = await this.requests.findOne({ where: { id: requestId, mentorId } });
    if (!req) throw new NotFoundException();
    if (action === 'approve') {
      await this.grantFromRequest(req);
      req.status = TrailAccessRequestStatus.APPROVED;
    } else {
      req.status = TrailAccessRequestStatus.DENIED;
      const lead = await this.leads.findOne({ where: { id: req.leadId } });
      if (lead?.userId) {
        await this.notifications.create({
          userId: lead.userId,
          type: 'trail',
          title: 'Solicitação não aprovada',
          body: 'Sua solicitação de acesso à trilha foi recusada.',
          link: '/me/trails',
        }).catch(() => null);
      }
    }
    req.resolvedAt = new Date();
    return this.requests.save(req);
  }

  private async grantFromRequest(req: TrailAccessRequest) {
    let acc = await this.accesses.findOne({ where: { trailId: req.trailId, leadId: req.leadId } });
    if (!acc) {
      acc = this.accesses.create({
        mentorId: req.mentorId,
        trailId: req.trailId,
        leadId: req.leadId,
        source: req.chargeId ? TrailAccessSource.PAYMENT : TrailAccessSource.REQUEST,
        sourceRef: req.chargeId || req.id,
      });
      await this.accesses.save(acc);
    }
    const lead = await this.leads.findOne({ where: { id: req.leadId } });
    const trail = await this.trails.findOne({ where: { id: req.trailId } });
    if (lead?.userId && trail) {
      await this.notifications.create({
        userId: lead.userId,
        type: 'trail',
        title: 'Trilha liberada 🎉',
        body: `Você já pode acessar "${trail.title}"`,
        link: `/me/trails/${trail.id}`,
      }).catch(() => null);
    }
  }

  /**
   * Hook chamado pelo webhook de pagamento. Se a charge estiver vinculada a uma
   * trail-request (via metadata.trailAccessRequestId), libera o acesso e marca PAID.
   */
  async onChargePaid(chargeId: string) {
    const charge = await this.charges.findOne({ where: { id: chargeId } });
    const meta = (charge?.metadata as any) || {};

    // Caminho 1: compra vindo de página de vendas.
    // metadata.kind === 'sales-page' traz productRefId (conteúdo comprado) e,
    // opcionalmente, upsellTrailId (oferta de upgrade apresentada no pós-venda).
    if (meta.kind === 'sales-page') {
      await this.grantSalesPageAccess(charge!, meta);
      return;
    }

    // Caminho 1b: upsell adquirido no pós-venda — libera a trilha extra.
    if (meta.kind === 'sales-page-upsell' && meta.trailId && meta.leadId) {
      await this.grantOverride(charge!.mentorId, meta.trailId, meta.leadId, TrailAccessSource.PAYMENT, charge!.id);
      return;
    }

    // Caminho 2: cobrança de paywall de trilha (fluxo legado).
    const reqId = meta.trailAccessRequestId;
    if (!reqId) return;
    const req = await this.requests.findOne({ where: { id: reqId } });
    if (!req) return;
    if (req.status === TrailAccessRequestStatus.PAID || req.status === TrailAccessRequestStatus.APPROVED) return;
    await this.grantFromRequest(req);
    req.status = TrailAccessRequestStatus.PAID;
    req.resolvedAt = new Date();
    await this.requests.save(req);
  }

  /**
   * Concede o acesso ao conteúdo da página de vendas recém-paga. O override de
   * TrailAccess tem prioridade sobre accessMode/grupos/pré-requisitos, então o
   * comprador cai direto nos vídeos — mesmo que a trilha seja REQUEST ou esteja
   * liberada por grupo. Best-effort: nunca lança para não quebrar o webhook.
   */
  async grantSalesPageAccess(charge: Charge, meta: any) {
    const trailId: string | null = meta.trailId || meta.productRefId || null;
    const leadId: string | null = meta.leadId || charge.leadId || null;
    const mentorId: string = charge.mentorId;
    if (!trailId || !leadId) return;

    const lead = await this.leads.findOne({ where: { id: leadId, mentorId } });
    if (!lead) return;
    const trail = await this.trails.findOne({ where: { id: trailId, mentorId } });
    if (!trail) {
      this.logger.warn(`grantSalesPageAccess: trilha ${trailId} não existe no mentor ${mentorId}`);
      return;
    }

    await this.grantOverride(mentorId, trailId, leadId, TrailAccessSource.PAYMENT, charge.id);
  }

  /** Upsert de override de acesso + notificação para o comprador. */
  private async grantOverride(
    mentorId: string,
    trailId: string,
    leadId: string,
    source: TrailAccessSource,
    sourceRef?: string,
  ) {
    let acc = await this.accesses.findOne({ where: { trailId, leadId } });
    if (!acc) {
      acc = this.accesses.create({ mentorId, trailId, leadId });
    }
    acc.source = source;
    acc.sourceRef = sourceRef;
    acc.expiresAt = null; // compra de conteúdo = acesso vitalício
    await this.accesses.save(acc);

    const lead = await this.leads.findOne({ where: { id: leadId } });
    const trail = await this.trails.findOne({ where: { id: trailId } });
    if (lead?.userId && trail) {
      await this.notifications.create({
        userId: lead.userId,
        type: 'trail',
        title: 'Trilha liberada 🎉',
        body: `Você já pode acessar "${trail.title}"`,
        link: `/me/trails/${trail.id}`,
      }).catch(() => null);
    }
  }
}