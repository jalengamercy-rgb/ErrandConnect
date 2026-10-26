import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ReasonDto } from '../admin/admin.dto.js';
import { CurrentUser, Staff, type AuthUser } from '../common/auth-user.js';
import { AddressDto } from '../users/users.dto.js';
import {
  AddMemberDto,
  AdminUpdateBusinessDto,
  ApproveBusinessDto,
  BulkOrderDto,
  BusinessListQueryDto,
  BusinessOrdersQueryDto,
  RegisterBusinessDto,
  UpdateBusinessDto,
  UpdateMemberDto,
} from './businesses.dto.js';
import { BusinessesService } from './businesses.service.js';

@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Post()
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterBusinessDto) {
    return this.businesses.register(user.id, dto);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.businesses.mine(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.businesses.get(id, user.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBusinessDto) {
    return this.businesses.update(id, user.id, dto);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.businesses.addMember(id, user.id, dto);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.businesses.updateMember(id, user.id, userId, dto);
  }

  /** Remove a team member, or leave the company (your own id). */
  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.businesses.removeMember(id, user.id, userId);
  }

  @Post(':id/branches')
  addBranch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddressDto) {
    return this.businesses.addBranch(id, user.id, dto);
  }

  @Delete(':id/branches/:addressId')
  removeBranch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return this.businesses.removeBranch(id, user.id, addressId);
  }

  @Get(':id/orders')
  orders(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: BusinessOrdersQueryDto) {
    return this.businesses.listOrders(id, user.id, query);
  }

  @Post(':id/bulk-orders')
  bulkOrder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BulkOrderDto) {
    return this.businesses.bulkOrder(id, user.id, dto);
  }
}

@Controller('admin/businesses')
@Staff('OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'MERCHANT_MANAGER')
export class AdminBusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get()
  list(@Query() query: BusinessListQueryDto) {
    return this.businesses.adminList(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.businesses.adminGet(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveBusinessDto, @CurrentUser() admin: AuthUser) {
    return this.businesses.approve(id, dto, admin);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.businesses.reject(id, dto.reason, admin);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.businesses.suspend(id, dto.reason, admin);
  }

  /** Credit limit and invoicing are money decisions: finance only. */
  @Patch(':id')
  @Staff('FINANCE_MANAGER')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateBusinessDto, @CurrentUser() admin: AuthUser) {
    return this.businesses.adminUpdate(id, dto, admin);
  }
}
