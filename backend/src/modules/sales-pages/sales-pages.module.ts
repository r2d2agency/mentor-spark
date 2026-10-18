import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { SalesPage } from '../../entities/sales-page.entity';
import { User } from '../../entities/user.entity';
import { MentorPaymentProvider } from '../../entities/mentor-payment-provider.entity';
import { Charge } from '../../entities/charge.entity';
import { Lead } from '../../entities/lead.entity';
import { Trail } from '../../entities/trail.entity';
import { TrailAccess } from '../../entities/trail-access.entity';
import { SalesPagesController, PublicSalesPagesController } from './sales-pages.controller';
import { SalesPagesService } from './sales-pages.service';
import { PurchaseLinksService } from './purchase-links.service';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { TrailAccessModule } from '../trail-access/trail-access.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesPage, User, MentorPaymentProvider, Charge, Lead, Trail, TrailAccess,
    ]),
    AiModule,
    AuthModule,
    LeadsModule,
    TrailAccessModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    }),
  ],
  controllers: [SalesPagesController, PublicSalesPagesController],
  providers: [SalesPagesService, PurchaseLinksService],
  exports: [SalesPagesService, PurchaseLinksService],
})
export class SalesPagesModule {}