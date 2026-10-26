import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { OrderStatus, RunnerApplicationStatus } from '../generated/prisma/client.js';
import { Trim } from '../common/dto.js';

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  /** Matches name, phone or email. */
  @Trim()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}

export class RunnerListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(RunnerApplicationStatus)
  status?: RunnerApplicationStatus;
}

export const RUNNER_CHECKS = ['IDENTITY', 'VEHICLE', 'BACKGROUND', 'PAYOUT'] as const;
export type RunnerCheck = (typeof RUNNER_CHECKS)[number];

export class RunnerCheckDto {
  @IsIn(RUNNER_CHECKS)
  check: RunnerCheck;

  @IsBoolean()
  passed: boolean;
}

export class ReasonDto {
  @Trim()
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class ReviewDocumentDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @ValidateIf((o: ReviewDocumentDto) => o.decision === 'REJECTED')
  @Trim()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

export class AuditLogQueryDto extends PageQueryDto {
  @Trim()
  @IsOptional()
  @IsString()
  entityType?: string;

  @Trim()
  @IsOptional()
  @IsString()
  entityId?: string;
}

export class AdminOrderListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class AssignRunnerDto {
  @IsUUID()
  runnerId: string;
}
