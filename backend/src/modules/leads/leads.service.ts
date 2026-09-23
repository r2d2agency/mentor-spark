import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadStage } from '../../entities/lead.entity';
import { AuthService } from '../auth/auth.service';
import { User, UserStatus } from '../../entities/user.entity';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead) private leads: Repository<Lead>,
    @InjectRepository(User) private users: Repository<User>,
    private authService: AuthService,
  ) {}

  list(mentorId: string, filter?: { stage?: LeadStage; q?: string; eventId?: string; source?: string; salesPageId?: string }) {
    const qb = this.leads.createQueryBuilder('l').where('l.mentorId = :mentorId', { mentorId }).orderBy('l.updatedAt', 'DESC');
    if (filter?.stage) qb.andWhere('l.stage = :stage', { stage: filter.stage });
    if (filter?.q) qb.andWhere('(l.name ILIKE :q OR l.email ILIKE :q OR l.company ILIKE :q)', { q: `%${filter.q}%` });
    if (filter?.eventId) {
      if (filter.eventId === 'none') qb.andWhere('l.eventId IS NULL');
      else qb.andWhere('l.eventId = :eventId', { eventId: filter.eventId });
    }
    if (filter?.source) qb.andWhere('l.source ILIKE :source', { source: `%${filter.source}%` });
    if (filter?.salesPageId) qb.andWhere('l.salesPageId = :salesPageId', { salesPageId: filter.salesPageId });
    return qb.getMany();
  }

  async getById(mentorId: string, id: string) {
    const lead = await this.leads.findOne({ where: { id, mentorId } });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }

  async update(mentorId: string, id: string, dto: Partial<Lead>) {
    await this.getById(mentorId, id);
    // Whitelist: nunca permitir trocar dono/vínculos de usuário por aqui.
    const { mentorId: _m, userId: _u, id: _id, createdAt: _c, updatedAt: _up, ...safe } = dto as any;
    if ((safe as any).email) {
      const email = String((safe as any).email).toLowerCase();
      const dup = await this.leads.findOne({ where: { mentorId, email } });
      if (dup && dup.id !== id) {
        const { BadRequestException } = await import('@nestjs/common');
        throw new BadRequestException('Já existe um lead com este email no seu funil.');
      }
      (safe as any).email = email;
    }
    await this.leads.update(id, safe);
    return this.getById(mentorId, id);
  }

  async createFromCapture(params: {
    mentorId: string;
    mentorBrand: string;
    name: string;
    email: string;
    phone?: string;
    company?: string;
    revenue?: number;
    source?: string;
    eventId?: string;
    salesPageId?: string;
    salesPageSlug?: string;
    /** Senha definida pelo próprio lead no auto-cadastro público. */
    password?: string;
  }) {
    // Cria usuário PROSPECT — usa a senha do lead se informada; senão, gera temporária
    const { user, generatedPassword, userChosePassword } = await this.authService.createProspectUser({
      mentorId: params.mentorId,
      name: params.name,
      email: params.email,
      phone: params.phone,
      company: params.company,
      revenue: params.revenue,
      password: params.password,
    });

    // Verifica se já existe lead com o mesmo email para este mentor
    let lead = await this.leads.findOne({ where: { mentorId: params.mentorId, email: params.email.toLowerCase() } });
    if (!lead) {
      lead = this.leads.create({
        mentorId: params.mentorId,
        userId: user.id,
        name: params.name,
        email: params.email.toLowerCase(),
        phone: params.phone,
        company: params.company,
        revenue: params.revenue,
        source: params.source || 'capture',
        eventId: params.eventId,
        salesPageId: params.salesPageId,
        salesPageSlug: params.salesPageSlug,
        stage: LeadStage.NEW,
      });
      await this.leads.save(lead);
    } else if ((params.eventId && !lead.eventId) || (params.salesPageId && !(lead as any).salesPageId)) {
      if (params.eventId && !lead.eventId) lead.eventId = params.eventId;
      if (params.salesPageId && !(lead as any).salesPageId) {
        (lead as any).salesPageId = params.salesPageId;
        (lead as any).salesPageSlug = params.salesPageSlug;
      }
      await this.leads.save(lead);
    }

    // Se usou senha temporária, dispara WhatsApp/email com credenciais.
    if (generatedPassword) {
      await this.authService.sendWelcomeCredentials({
        mentorId: params.mentorId,
        email: params.email,
        name: params.name,
        password: generatedPassword,
        brandName: params.mentorBrand,
        phone: params.phone,
      });
    } else if (userChosePassword) {
      // Lead definiu a própria senha — envia apenas confirmação de boas-vindas (sem senha)
      await this.authService.sendWelcomeNotice({
        mentorId: params.mentorId,
        email: params.email,
        name: params.name,
        brandName: params.mentorBrand,
        phone: params.phone,
      });
    }

    return { lead, accountCreated: !!user, userChosePassword };
  }

  async stats(mentorId: string) {
    const counts = await this.leads
      .createQueryBuilder('l')
      .select('l.stage', 'stage')
      .addSelect('COUNT(*)', 'count')
      .where('l.mentorId = :mentorId', { mentorId })
      .groupBy('l.stage')
      .getRawMany();
    const byStage: Record<string, number> = {};
    counts.forEach((r) => (byStage[r.stage] = +r.count));
    const total = Object.values(byStage).reduce((a, b) => a + b, 0);
    const clients = byStage[LeadStage.CLIENT] || 0;
    return { total, byStage, conversion: total ? Math.round((clients / total) * 1000) / 10 : 0 };
  }
}
