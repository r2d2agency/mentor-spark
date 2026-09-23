import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Auth } from '../auth/auth.decorators';
import { TenantId } from '../auth/current-user.decorator';
import { LeadsService } from './leads.service';
import { Lead, LeadStage } from '../../entities/lead.entity';
import { CaptureEvent } from '../../entities/capture-event.entity';
import { User, UserRole, UserStatus } from '../../entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(
    private leads: LeadsService,
    private authService: AuthService,
    @InjectRepository(Lead) private leadsRepo: Repository<Lead>,
    @InjectRepository(CaptureEvent) private events: Repository<CaptureEvent>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  /**
   * Cadastro manual completo (sem onboarding público).
   * Aceita todos os campos do lead. Se sendInvite=true, cria usuário PROSPECT
   * e envia email com senha. Caso contrário, fica apenas como registro no funil.
   */
  @Auth('mentor', 'super_admin')
  @Post('manual')
  async createManual(
    @TenantId() mentorId: string,
    @Body() dto: any & { sendInvite?: boolean },
  ) {
    if (!dto.name || !dto.email) throw new BadRequestException('Nome e email são obrigatórios');
    const email = String(dto.email).toLowerCase();

    const existing = await this.leadsRepo.findOne({ where: { mentorId, email } });
    if (existing) throw new BadRequestException('Já existe um lead com este email no seu funil.');

    let userId: string | undefined;
    if (dto.sendInvite) {
      const created = await this.authService.createProspectUser({
        mentorId,
        name: dto.name,
        email,
        phone: dto.phone,
        company: dto.company,
        revenue: dto.revenue ? Number(dto.revenue) : undefined,
      });
      userId = created.user.id;
      if (created.generatedPassword) {
        const mentor = await this.users.findOne({ where: { id: mentorId } });
        await this.authService.sendWelcomeCredentials({
          mentorId,
          email,
          name: dto.name,
          password: created.generatedPassword,
          brandName: mentor?.brandName || 'MentorFlow',
          phone: dto.phone,
        });
      }
    }

    const { sendInvite, ...rest } = dto;
    const lead = this.leadsRepo.create({
      ...rest,
      mentorId,
      userId,
      email,
      stage: dto.stage || 'new',
      source: dto.source || 'manual',
      onboardingCompletedAt: new Date(),
    });
    const saved = await this.leadsRepo.save(lead);
    return Array.isArray(saved) ? saved[0] : saved;
  }

  @Auth('mentor', 'super_admin')
  @Get()
  async list(
    @TenantId() mentorId: string,
    @Query('stage') stage?: LeadStage,
    @Query('q') q?: string,
    @Query('eventId') eventId?: string,
    @Query('source') source?: string,
    @Query('salesPageId') salesPageId?: string,
  ) {
    const filtered = await this.leads.list(mentorId, { stage, q, eventId, source, salesPageId });
    if (filtered.length === 0) return [];

    const evIds = Array.from(new Set(filtered.map((l) => l.eventId).filter(Boolean))) as string[];
    const evs = evIds.length
      ? await this.events.find({ where: { id: In(evIds), mentorId } })
      : [];
    const evMap = new Map(evs.map((e) => [e.id, e]));

    const emails = filtered.map((l) => l.email);
    const usersFound = emails.length
      ? await this.users.find({ where: { email: In(emails), mentorId, role: UserRole.MENTORADO } })
      : [];
    const mentoradoEmails = new Set(usersFound.map((u) => u.email));

    return filtered.map((l) => ({
      ...l,
      eventName: l.eventId ? evMap.get(l.eventId)?.name || null : null,
      eventSlug: l.eventId ? evMap.get(l.eventId)?.slug || null : null,
      isMentorado: mentoradoEmails.has(l.email),
    }));
  }

  /** Detalhe do lead com origem resolvida (para o modal do kanban). */
  @Auth('mentor', 'super_admin')
  @Get(':id')
  async get(@TenantId() mentorId: string, @Param('id') id: string) {
    const lead = await this.leads.getById(mentorId, id);
    let eventName: string | null = null;
    let eventSlug: string | null = null;
    if ((lead as any).eventId) {
      const ev = await this.events.findOne({ where: { id: (lead as any).eventId, mentorId } });
      eventName = ev?.name || null;
      eventSlug = ev?.slug || null;
    }
    return { ...lead, eventName, eventSlug };
  }

  @Auth('mentor', 'super_admin')
  @Get('stats')
  stats(@TenantId() mentorId: string) {
    return this.leads.stats(mentorId);
  }

  /** Agrupa leads por evento (para a tela de captação). */
  @Auth('mentor', 'super_admin')
  @Get('by-event')
  async byEvent(@TenantId() mentorId: string) {
    const evs = await this.events.find({ where: { mentorId } });
    const all = await this.leadsRepo.find({ where: { mentorId } });

    const result: Array<{
      eventId: string | null;
      eventName: string;
      startsAt: Date | null;
      location: string | null;
      slug: string | null;
      total: number;
      mentorados: number;
    }> = evs.map((e) => {
      const items = all.filter((l) => l.eventId === e.id);
      return {
        eventId: e.id,
        eventName: e.name,
        startsAt: e.startsAt || null,
        location: e.location || null,
        slug: e.slug,
        total: items.length,
        mentorados: items.filter((l) => l.stage === LeadStage.CLIENT).length,
      };
    });
    const orphan = all.filter((l) => !l.eventId);
    if (orphan.length > 0) {
      result.push({
        eventId: null,
        eventName: 'Sem evento',
        startsAt: null,
        location: null,
        slug: null,
        total: orphan.length,
        mentorados: orphan.filter((l) => l.stage === LeadStage.CLIENT).length,
      });
    }
    return result;
  }

  @Auth('mentor', 'super_admin')
  @Patch(':id')
  update(@TenantId() mentorId: string, @Param('id') id: string, @Body() dto: any) {
    return this.leads.update(mentorId, id, dto);
  }

  /** Converte lead em mentorado (cria/promove o usuário e marca lead como CLIENT). */
  @Auth('mentor', 'super_admin')
  @Post(':id/convert')
  async convert(@TenantId() mentorId: string, @Param('id') id: string) {
    const lead = await this.leads.getById(mentorId, id);
    let user = await this.users.findOne({ where: { email: lead.email } });
    if (user) {
      if (user.mentorId && user.mentorId !== mentorId && user.role !== UserRole.PROSPECT) {
        throw new BadRequestException('Email já pertence a outro mentor.');
      }
      await this.users.update(user.id, {
        mentorId,
        role: UserRole.MENTORADO,
        status: UserStatus.ACTIVE,
        phone: user.phone || lead.phone || null,
        company: user.company || lead.company || null,
      });
    } else {
      const created = await this.authService.createProspectUser({
        mentorId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        revenue: lead.revenue ? Number(lead.revenue) : undefined,
      });
      await this.users.update(created.user.id, { role: UserRole.MENTORADO, status: UserStatus.ACTIVE });
      user = created.user;
    }
    await this.leadsRepo.update(id, { stage: LeadStage.CLIENT, userId: user.id });
    return { ok: true, userId: user.id };
  }
}
