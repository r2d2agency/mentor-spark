import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Auth } from '../auth/auth.decorators';
import { TenantId, CurrentUser } from '../auth/current-user.decorator';
import { KanbanBoard, BoardType } from '../../entities/kanban-board.entity';
import { KanbanColumn } from '../../entities/kanban-column.entity';
import { KanbanCard, CardEntityType } from '../../entities/kanban-card.entity';
import { Lead } from '../../entities/lead.entity';
import { CaptureEvent } from '../../entities/capture-event.entity';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

const DEFAULT_LEAD_COLUMNS = [
  { name: 'Novo Lead', slug: 'new', color: '#64748b', order: 0 },
  { name: 'Fez Teste', slug: 'tested', color: '#3b82f6', order: 1 },
  { name: 'Engajado', slug: 'engaged', color: '#f59e0b', order: 2 },
  { name: 'Negociação', slug: 'negotiating', color: '#8b5cf6', order: 3 },
  { name: 'Mentorado', slug: 'client', color: '#10b981', order: 4, outcome: 'won' as const },
  { name: 'Perdido', slug: 'lost', color: '#ef4444', order: 5, outcome: 'lost' as const },
];

@ApiTags('kanban')
@ApiBearerAuth()
@Controller('kanban')
export class KanbanController {
  constructor(
    @InjectRepository(KanbanBoard) private boards: Repository<KanbanBoard>,
    @InjectRepository(KanbanColumn) private columns: Repository<KanbanColumn>,
    @InjectRepository(KanbanCard) private cards: Repository<KanbanCard>,
    @InjectRepository(Lead) private leads: Repository<Lead>,
    @InjectRepository(CaptureEvent) private events: Repository<CaptureEvent>,
  ) {}

  // ============== BOARDS ==============
  @Auth('mentor', 'super_admin', 'mentor_team')
  @Get('boards')
  async listBoards(@TenantId() mentorId: string, @CurrentUser() user: any, @Query('type') type?: string) {
    let list = await this.boards.find({ where: { mentorId }, order: { order: 'ASC', createdAt: 'ASC' } });
    
    // Filtrar boards permitidos para o membro da equipe
    if (user.role === 'mentor_team' && user.allowedKanbanIds && user.allowedKanbanIds.length > 0) {
      list = list.filter(b => user.allowedKanbanIds.includes(b.id));
    }

    // Auto-cria board default de leads se não houver nenhum
    if (list.length === 0) {
      const board = await this.boards.save(this.boards.create({
        mentorId, name: 'Funil de Leads', type: BoardType.LEADS, isDefault: true, order: 0, color: '#6366f1',
      }));
      const cols: KanbanColumn[] = [];
      for (const c of DEFAULT_LEAD_COLUMNS) {
        cols.push(await this.columns.save(this.columns.create({ ...c, boardId: board.id })));
      }
      // Migra leads existentes
      const existingLeads = await this.leads.find({ where: { mentorId } });
      const colBySlug = new Map(cols.map((c) => [c.slug, c]));
      for (const l of existingLeads) {
        const col = colBySlug.get(l.stage) || cols[0];
        await this.cards.save(this.cards.create({
          mentorId, boardId: board.id, columnId: col.id,
          entityType: CardEntityType.LEAD, entityId: l.id,
          title: l.name, description: l.company || l.email, order: 0,
        }));
      }
      list = [board];
    }

    if (type) list = list.filter((b) => b.type === type);
    return list;
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Get('boards/:id')
  async getBoard(@TenantId() mentorId: string, @Param('id') id: string) {
    const board = await this.boards.findOne({ where: { id, mentorId } });
    if (!board) throw new NotFoundException('Board não encontrado');
    const columns = await this.columns.find({ where: { boardId: id }, order: { order: 'ASC' } });
    const cards = await this.cards.find({ where: { boardId: id, mentorId }, order: { order: 'ASC', createdAt: 'ASC' } });
    const leadIds = Array.from(new Set(cards
      .filter((card) => card.entityType === CardEntityType.LEAD && card.entityId)
      .map((card) => card.entityId!)));

    if (leadIds.length === 0) return { ...board, columns, cards };

    const leads = await this.leads.find({ where: { id: In(leadIds), mentorId } });
    const eventIds = Array.from(new Set(leads.map((lead) => lead.eventId).filter(Boolean))) as string[];
    const events = eventIds.length
      ? await this.events.find({ where: { id: In(eventIds), mentorId } })
      : [];
    const eventNames = new Map(events.map((event) => [event.id, event.name]));
    const leadsById = new Map(leads.map((lead) => [lead.id, lead]));

    const cardsWithOrigin = cards.map((card) => {
      if (card.entityType !== CardEntityType.LEAD || !card.entityId) return card;
      const lead = leadsById.get(card.entityId);
      if (!lead) return card;
      const originLabel = (lead.eventId && eventNames.get(lead.eventId))
        || (lead.salesPageSlug && `Vendas: ${lead.salesPageSlug}`)
        || lead.source
        || null;
      return { ...card, originLabel };
    });

    return { ...board, columns, cards: cardsWithOrigin };
  }

  @Auth('mentor', 'super_admin')
  @Post('boards')
  async createBoard(@TenantId() mentorId: string, @Body() dto: { name: string; type?: BoardType; color?: string; description?: string; useTemplate?: 'leads' | 'tasks' | 'demands' | null }) {
    if (!dto.name) throw new BadRequestException('Nome é obrigatório');
    const last = await this.boards.find({ where: { mentorId }, order: { order: 'DESC' }, take: 1 });
    const order = (last[0]?.order ?? -1) + 1;
    const board = await this.boards.save(this.boards.create({
      mentorId, name: dto.name, type: dto.type || BoardType.CUSTOM, color: dto.color, description: dto.description, order,
    }));
    if (dto.useTemplate === 'leads') {
      for (const c of DEFAULT_LEAD_COLUMNS) {
        await this.columns.save(this.columns.create({ ...c, boardId: board.id }));
      }
    } else if (dto.useTemplate === 'tasks') {
      const tcols = [
        { name: 'A fazer', slug: 'todo', color: '#64748b', order: 0 },
        { name: 'Em andamento', slug: 'doing', color: '#f59e0b', order: 1 },
        { name: 'Concluído', slug: 'done', color: '#10b981', order: 2, outcome: 'won' as const },
      ];
      for (const c of tcols) await this.columns.save(this.columns.create({ ...c, boardId: board.id }));
    } else if (dto.useTemplate === 'demands') {
      const dcols = [
        { name: 'Nova', slug: 'new', color: '#64748b', order: 0 },
        { name: 'Em análise', slug: 'analysis', color: '#3b82f6', order: 1 },
        { name: 'Em produção', slug: 'production', color: '#f59e0b', order: 2 },
        { name: 'Aguardando Aprovação', slug: 'waiting_feedback', color: '#8b5cf6', order: 3 },
        { name: 'Aprovada', slug: 'approved', color: '#10b981', order: 4, outcome: 'won' as const },
      ];
      for (const c of dcols) await this.columns.save(this.columns.create({ ...c, boardId: board.id }));
      await this.boards.update(board.id, { type: BoardType.DEMANDS });
    } else {
      // Pelo menos uma coluna inicial
      await this.columns.save(this.columns.create({ name: 'Novo', slug: 'new', color: '#64748b', order: 0, boardId: board.id }));
    }
    return board;
  }

  @Auth('mentor', 'super_admin')
  @Patch('boards/:id')
  async updateBoard(@TenantId() mentorId: string, @Param('id') id: string, @Body() dto: any) {
    const board = await this.boards.findOne({ where: { id, mentorId } });
    if (!board) throw new NotFoundException();
    await this.boards.update(id, dto);
    return this.boards.findOne({ where: { id } });
  }

  @Auth('mentor', 'super_admin')
  @Delete('boards/:id')
  async deleteBoard(@TenantId() mentorId: string, @Param('id') id: string) {
    const board = await this.boards.findOne({ where: { id, mentorId } });
    if (!board) throw new NotFoundException();
    if (board.isDefault) throw new BadRequestException('Não é possível excluir o board padrão');
    await this.boards.remove(board);
    return { ok: true };
  }

  @Auth('mentor', 'super_admin')
  @Post('boards/reorder')
  async reorderBoards(@TenantId() mentorId: string, @Body() body: { ids: string[] }) {
    if (!Array.isArray(body?.ids)) throw new BadRequestException('ids[] é obrigatório');
    for (let i = 0; i < body.ids.length; i++) {
      await this.boards.update({ id: body.ids[i], mentorId } as any, { order: i });
    }
    return { ok: true };
  }
  @Auth('mentor', 'super_admin')
  @Post('boards/:boardId/columns')
  async createColumn(@TenantId() mentorId: string, @Param('boardId') boardId: string, @Body() dto: any) {
    const board = await this.boards.findOne({ where: { id: boardId, mentorId } });
    if (!board) throw new NotFoundException();
    const last = await this.columns.find({ where: { boardId }, order: { order: 'DESC' }, take: 1 });
    const order = dto.order ?? (last[0]?.order ?? -1) + 1;
    return this.columns.save(this.columns.create({ ...dto, boardId, order }));
  }

  @Auth('mentor', 'super_admin')
  @Patch('columns/:id')
  async updateColumn(@TenantId() mentorId: string, @Param('id') id: string, @Body() dto: any) {
    const col = await this.columns.findOne({ where: { id } });
    if (!col) throw new NotFoundException();
    const board = await this.boards.findOne({ where: { id: col.boardId, mentorId } });
    if (!board) throw new NotFoundException();
    await this.columns.update(id, dto);
    return this.columns.findOne({ where: { id } });
  }

  @Auth('mentor', 'super_admin')
  @Delete('columns/:id')
  async deleteColumn(@TenantId() mentorId: string, @Param('id') id: string) {
    const col = await this.columns.findOne({ where: { id } });
    if (!col) throw new NotFoundException();
    const board = await this.boards.findOne({ where: { id: col.boardId, mentorId } });
    if (!board) throw new NotFoundException();
    const cardCount = await this.cards.count({ where: { columnId: id } });
    if (cardCount > 0) throw new BadRequestException('Mova os cards antes de excluir a coluna');
    await this.columns.delete(id);
    return { ok: true };
  }

  @Auth('mentor', 'super_admin')
  @Post('boards/:boardId/columns/reorder')
  async reorderColumns(@TenantId() mentorId: string, @Param('boardId') boardId: string, @Body() body: { ids: string[] }) {
    const board = await this.boards.findOne({ where: { id: boardId, mentorId } });
    if (!board) throw new NotFoundException();
    for (let i = 0; i < body.ids.length; i++) {
      await this.columns.update({ id: body.ids[i], boardId } as any, { order: i });
    }
    return { ok: true };
  }

  // ============== CARDS ==============
  @Auth('mentor', 'super_admin', 'mentor_team')
  @Post('cards')
  async createCard(@TenantId() mentorId: string, @Body() dto: any) {
    if (!dto.boardId || !dto.columnId || !dto.title) throw new BadRequestException('boardId, columnId e title são obrigatórios');
    const board = await this.boards.findOne({ where: { id: dto.boardId, mentorId } });
    if (!board) throw new NotFoundException('Board não encontrado');
    const last = await this.cards.find({ where: { columnId: dto.columnId }, order: { order: 'DESC' }, take: 1 });
    const order = (last[0]?.order ?? -1) + 1;
    return this.cards.save(this.cards.create({ ...dto, mentorId, order }));
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Patch('cards/:id/move')
  async moveCard(@TenantId() mentorId: string, @Param('id') id: string, @Body() body: { columnId: string; order?: number }) {
    const card = await this.cards.findOne({ where: { id, mentorId } });
    if (!card) throw new NotFoundException();
    const newCol = await this.columns.findOne({ where: { id: body.columnId } });
    if (!newCol || newCol.boardId !== card.boardId) throw new BadRequestException('Coluna inválida');
    const order = body.order ?? 0;
    await this.cards.update(id, { columnId: body.columnId, order });

    // Sincroniza stage do lead se for board de leads
    if (card.entityType === CardEntityType.LEAD && card.entityId && newCol.slug) {
      const stages = ['new', 'tested', 'engaged', 'negotiating', 'client', 'lost'];
      if (stages.includes(newCol.slug)) {
        await this.leads.update({ id: card.entityId, mentorId } as any, { stage: newCol.slug as any });
      }
    }
    return this.cards.findOne({ where: { id } });
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Patch('cards/:id')
  async updateCard(@TenantId() mentorId: string, @Param('id') id: string, @Body() dto: any) {
    const card = await this.cards.findOne({ where: { id, mentorId } });
    if (!card) throw new NotFoundException();
    await this.cards.update(id, dto);
    return this.cards.findOne({ where: { id } });
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Delete('cards/:id')
  async deleteCard(@TenantId() mentorId: string, @Param('id') id: string) {
    await this.cards.delete({ id, mentorId } as any);
    return { ok: true };
  }
}
