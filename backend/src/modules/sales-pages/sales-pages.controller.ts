import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../auth/auth.decorators';
import { TenantId } from '../auth/current-user.decorator';
import { SalesPagesService } from './sales-pages.service';
import { SalesPageProductType } from '../../entities/sales-page.entity';

class SalesPageSignupDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(120) revenue?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(72) password?: string;
  /** Chave de idempotência — evita lead duplicado em duplo clique. */
  @IsOptional() @IsString() @MaxLength(64) requestId?: string;
}

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
    @Body() dto: { briefing: string; audience?: string; priceHint?: string; productType?: SalesPageProductType; tone?: string; template?: 'classic' | 'long_form'; outputFormat?: 'blocks' | 'html' },
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

  /** Status da cobrança — a tela de obrigado consulta até a aprovação cair. */
  @Get(':mentorSlug/:pageSlug/charge/:chargeId/status')
  chargeStatus(
    @Param('mentorSlug') mentorSlug: string,
    @Param('pageSlug') pageSlug: string,
    @Param('chargeId') chargeId: string,
  ) {
    return this.svc.chargeStatus(mentorSlug, pageSlug, chargeId);
  }

  /** Oferta de upgrade apresentada logo após a compra (mesmo provedor Asaas). */
  @Post(':mentorSlug/:pageSlug/charge/:chargeId/upsell')
  upsell(
    @Param('mentorSlug') mentorSlug: string,
    @Param('pageSlug') pageSlug: string,
    @Param('chargeId') chargeId: string,
    @Body() dto: any,
  ) {
    return this.svc.upsellCheckout(mentorSlug, pageSlug, chargeId, dto);
  }

  /**
   * Troca o link de acesso (JWT `?tk=` emitido no checkout) por uma sessão real
   * de PROSPECT, para o comprador cair direto na área de membro.
   */
  @Post('access/redeem')
  redeemAccessLink(@Body() dto: { token: string }) {
    return this.svc.redeemAccessLink(dto?.token);
  }

  /**
   * Cadastro público vindo da página (inclusive a página HTML enviada em ZIP).
   * Cria o lead/usuário e devolve o destino configurado pelo mentor:
   * link de acesso à área interna, link externo ou página de "obrigado".
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':mentorSlug/:pageSlug/signup')
  signup(
    @Param('mentorSlug') mentorSlug: string,
    @Param('pageSlug') pageSlug: string,
    @Body() dto: SalesPageSignupDto,
  ) {
    return this.svc.signup(mentorSlug, pageSlug, dto);
  }
}