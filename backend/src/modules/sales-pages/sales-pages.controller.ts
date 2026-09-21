import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { Auth } from '../auth/auth.decorators';
import { TenantId } from '../auth/current-user.decorator';
import { SalesPagesService } from './sales-pages.service';
import { SalesPageProductType } from '../../entities/sales-page.entity';

@Controller('sales-pages')
export class SalesPagesController {
  constructor(private svc: SalesPagesService) {}

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Get()
  list(@TenantId() mentorId: string) {
    return this.svc.list(mentorId);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Post(':id/duplicate')
  duplicate(@TenantId() mentorId: string, @Param('id') id: string) {
    return this.svc.duplicate(mentorId, id);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Get(':id')
  get(@TenantId() mentorId: string, @Param('id') id: string) {
    return this.svc.get(mentorId, id);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Post()
  create(@TenantId() mentorId: string, @Body() dto: any) {
    return this.svc.create(mentorId, dto);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Put(':id')
  update(@TenantId() mentorId: string, @Param('id') id: string, @Body() dto: any) {
    return this.svc.update(mentorId, id, dto);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Delete(':id')
  remove(@TenantId() mentorId: string, @Param('id') id: string) {
    return this.svc.remove(mentorId, id);
  }

  @Auth('mentor', 'super_admin', 'mentor_team')
  @Post('generate')
  generate(
    @TenantId() mentorId: string,
    @Body() dto: { briefing: string; audience?: string; priceHint?: string; productType?: SalesPageProductType; tone?: string },
  ) {
    return this.svc.generate(mentorId, dto);
  }
}

/** Endpoints públicos (sem auth) */
@Controller('public/sales-pages')
export class PublicSalesPagesController {
  constructor(private svc: SalesPagesService) {}

  @Get(':mentorSlug/:pageSlug')
  publicView(@Param('mentorSlug') mentorSlug: string, @Param('pageSlug') pageSlug: string) {
    return this.svc.publicBySlug(mentorSlug, pageSlug);
  }

  @Post(':mentorSlug/:pageSlug/checkout')
  checkout(
    @Param('mentorSlug') mentorSlug: string,
    @Param('pageSlug') pageSlug: string,
    @Body() dto: any,
  ) {
    return this.svc.checkout(mentorSlug, pageSlug, dto);
  }

  @Post(':mentorSlug/:pageSlug/validate-coupon')
  validateCoupon(
    @Param('mentorSlug') mentorSlug: string,
    @Param('pageSlug') pageSlug: string,
    @Body() dto: { code: string; email?: string },
  ) {
    return this.svc.validateCoupon(mentorSlug, pageSlug, dto);
  }
}