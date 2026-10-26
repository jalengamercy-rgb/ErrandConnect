import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Staff, type AuthUser } from '../common/auth-user.js';
import { AuditLogQueryDto, PageQueryDto, ReasonDto, ReviewDocumentDto, RunnerCheckDto, RunnerListQueryDto } from './admin.dto.js';
import { AdminService } from './admin.service.js';

// SUPER_ADMIN can use every route; the roles listed are the others allowed.
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('runners')
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER')
  listRunners(@Query() query: RunnerListQueryDto) {
    return this.admin.listRunners(query);
  }

  @Get('runners/:id')
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER')
  getRunner(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getRunner(id);
  }

  @Post('runners/:id/start-review')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER')
  startReview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser) {
    return this.admin.startRunnerReview(id, admin);
  }

  @Post('runners/:id/checks')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER')
  setCheck(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RunnerCheckDto, @CurrentUser() admin: AuthUser) {
    return this.admin.setRunnerCheck(id, dto.check, dto.passed, admin);
  }

  @Post('runners/:id/approve')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser) {
    return this.admin.approveRunner(id, admin);
  }

  @Post('runners/:id/reject')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.admin.rejectRunner(id, dto.reason, admin);
  }

  @Post('documents/:id/review')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'RUNNER_MANAGER', 'CUSTOMER_SUPPORT')
  reviewDocument(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDocumentDto, @CurrentUser() admin: AuthUser) {
    return this.admin.reviewDocument(id, dto, admin);
  }

  @Get('customers')
  @Staff('OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT')
  listCustomers(@Query() query: PageQueryDto) {
    return this.admin.listCustomers(query);
  }

  @Post('customers/:id/verify-id')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT')
  verifyCustomerId(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser) {
    return this.admin.verifyCustomerId(id, admin);
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthUser) {
    return this.admin.setUserStatus(id, 'SUSPENDED', dto.reason, admin);
  }

  @Post('users/:id/activate')
  @HttpCode(200)
  @Staff('OPERATIONS_MANAGER')
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser) {
    return this.admin.setUserStatus(id, 'ACTIVE', undefined, admin);
  }

  @Get('audit-logs')
  @Staff('SUPER_ADMIN')
  auditLogs(@Query() query: AuditLogQueryDto) {
    return this.admin.listAuditLogs(query);
  }
}
