import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LeadsModule } from './modules/leads/leads.module';
import { TestsModule } from './modules/tests/tests.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ContentsModule } from './modules/contents/contents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AiModule } from './modules/ai/ai.module';
import { PublicModule } from './modules/public/public.module';
import { AdminModule } from './modules/admin/admin.module';
import { MentorModule } from './modules/mentor/mentor.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PlansModule } from './modules/plans/plans.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ProntuarioModule } from './modules/prontuario/prontuario.module';
import { PromptsModule } from './modules/prompts/prompts.module';
import { BillingModule } from './modules/billing/billing.module';
import { PushModule } from './modules/push/push.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { LandingModule } from './modules/landing/landing.module';
import { TestAssignmentsModule } from './modules/test-assignments/test-assignments.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { EventsModule } from './modules/events/events.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { KanbanModule } from './modules/kanban/kanban.module';
import { MessagesModule } from './modules/messages/messages.module';
import { TeamModule } from './modules/team/team.module';
import { AutomationsModule } from './modules/automations/automations.module';
 import { LibraryModule } from './modules/library/library.module';
 import { DemandsModule } from './modules/demands/demands.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { TrailsModule } from './modules/trails/trails.module';
import { CommunityModule } from './modules/community/community.module';
import { AccessGroupsModule } from './modules/access-groups/access-groups.module';
import { TrailAccessModule } from './modules/trail-access/trail-access.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { SalesPagesModule } from './modules/sales-pages/sales-pages.module';
import { SitesModule } from './modules/sites/sites.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { buildPgOptions } from './db.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      ...buildPgOptions(),
      autoLoadEntities: true,
      // synchronize cria/atualiza tabelas automaticamente no boot.
      // Default: TRUE (até termos migrations). Para desligar: DB_SYNCHRONIZE=false
      synchronize: process.env.DB_SYNCHRONIZE !== 'false',
      logging: process.env.DB_LOGGING === 'true',
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    LeadsModule,
    TestsModule,
    MeetingsModule,
    TasksModule,
    ContentsModule,
    NotificationsModule,
    AiModule,
    PublicModule,
    AdminModule,
    MentorModule,
    DashboardModule,
    PlansModule,
    IntegrationsModule,
    ProntuarioModule,
    PromptsModule,
    BillingModule,
    PushModule,
    GamificationModule,
    LandingModule,
    TestAssignmentsModule,
    UploadsModule,
    EventsModule,
    ContractsModule,
    OnboardingModule,
    CompaniesModule,
    KanbanModule,
    MessagesModule,
    TeamModule,
    AutomationsModule,
     LibraryModule,
     DemandsModule,
    QuizModule,
    SchedulingModule,
    TrailsModule,
    CommunityModule,
    AccessGroupsModule,
    TrailAccessModule,
    CalendarModule,
    SalesPagesModule,
    SitesModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
