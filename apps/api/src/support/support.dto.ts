import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, ValidateIf } from 'class-validator';
import { DisputeOutcome, DisputeStatus, DisputeType, TicketPriority, TicketStatus } from '../generated/prisma/client.js';
import { Trim } from '../common/dto.js';
import { PageQueryDto } from '../admin/admin.dto.js';

export class RaiseDisputeDto {
  @IsEnum(DisputeType)
  type: DisputeType;

  @Trim()
  @IsString()
  @Length(10, 2000)
  description: string;
}

export class ResolveDisputeDto {
  @IsEnum(DisputeOutcome)
  outcome: DisputeOutcome;

  /** For REFUND_CUSTOMER on errands already paid out: how much to credit. */
  @ValidateIf((o: ResolveDisputeDto) => o.outcome === 'REFUND_CUSTOMER')
  @IsOptional()
  @IsInt()
  @Min(1)
  refundAmount?: number;

  @Trim()
  @IsString()
  @Length(3, 1000)
  resolution: string;
}

export class DisputeListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}

export class CreateTicketDto {
  @Trim()
  @IsString()
  @Length(3, 120)
  subject: string;

  @Trim()
  @IsString()
  @Length(5, 4000)
  message: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class TicketReplyDto {
  @Trim()
  @IsString()
  @Length(1, 4000)
  message: string;
}

export class TicketListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsIn(['me', 'unassigned'])
  assigned?: 'me' | 'unassigned';
}

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  /** Staff user to assign, or null to unassign. */
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;
}
