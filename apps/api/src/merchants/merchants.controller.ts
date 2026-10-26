import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ReasonDto } from '../admin/admin.dto.js';
import { CurrentUser, Staff, type AuthUser } from '../common/auth-user.js';
import {
  AdminUpdateMerchantDto,
  MerchantDirectoryQueryDto,
  MerchantListQueryDto,
  MerchantOrdersQueryDto,
  RegisterMerchantDto,
  UpdateMerchantDto,
} from './merchants.dto.js';
import { MerchantsService } from './merchants.service.js';

@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  /** Shop directory for customers. */
  @Get()
  directory(@Query() query: MerchantDirectoryQueryDto) {
    return this.merchants.directory(query);
  }

  @Post()
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterMerchantDto) {
    return this.merchants.register(user.id, dto);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.merchants.mine(user.id);
  }

  @Get(':id')
  publicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.publicProfile(id);
  }

  /** The shop's own dashboard (members only). */
  @Get(':id/dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.get(id, user.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMerchantDto) {
    return this.merchants.update(id, user.id, dto);
  }

  @Get(':id/orders')
  orders(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: MerchantOrdersQueryDto) {
    return this.merchants.listOrders(id, user.id, query);
  }

  @Post(':id/orders/:orderId/ready')
  @HttpCode(200)
  markReady(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.merchants.markReady(id, user.id, orderId);
  }
}

@Controller('admin/merchants')
@Staff('MERCHANT_MANAGER', 'OPERATIONS_MANAGER')
export class AdminMerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  list(@Query() query: MerchantListQueryDto) {
    return this.merchants.adminList(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.adminGet(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser) {
    return this.merchants.setStatus(id, 'ACTIVE', admin);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.merchants.setStatus(id, 'REJECTED', admin, dto.reason);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.merchants.setStatus(id, 'SUSPENDED', admin, dto.reason);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateMerchantDto, @CurrentUser() admin: AuthUser) {
    return this.merchants.adminUpdate(id, dto, admin);
  }
}
