import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KanbanBoard } from '../../entities/kanban-board.entity';
import { KanbanColumn } from '../../entities/kanban-column.entity';
import { KanbanCard } from '../../entities/kanban-card.entity';
import { Lead } from '../../entities/lead.entity';
import { CaptureEvent } from '../../entities/capture-event.entity';
import { KanbanController } from './kanban.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KanbanBoard, KanbanColumn, KanbanCard, Lead, CaptureEvent])],
  controllers: [KanbanController],
})
export class KanbanModule {}
