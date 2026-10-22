import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { TestTemplate } from '../../entities/test-template.entity';
import { Lead } from '../../entities/lead.entity';
import { PublicController } from './public.controller';
import { HealthController } from './health.controller';
import { TenantOriginsService } from './tenant-origins.service';
import { LeadsModule } from '../leads/leads.module';
import { TestsModule } from '../tests/tests.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, TestTemplate, Lead]), LeadsModule, TestsModule],
  controllers: [PublicController, HealthController],
  providers: [TenantOriginsService],
  exports: [TenantOriginsService],
})
export class PublicModule {}
