import { BULK_ORDER_LIMIT, BUSINESS_FEATURES, BUSINESS_SERVICES, MONTHLY_ORDER_ESTIMATES } from '@errandconnect/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Trim, IsKenyanPhone } from '../common/dto.js';
import { CompanySize, DeliveryType, OrgStatus, Urgency } from '../generated/prisma/client.js';
import { PageQueryDto } from '../admin/admin.dto.js';
import { LocationDto } from '../orders/orders.dto.js';

export class RegisterBusinessDto {
  @Trim()
  @IsString()
  @Length(2, 120)
  name: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  businessType?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  industry?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  registrationNumber?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  kraPin?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  yearsInBusiness?: number;

  @IsOptional()
  @IsEnum(CompanySize)
  companySize?: CompanySize;

  @IsOptional()
  @IsIn(MONTHLY_ORDER_ESTIMATES)
  estMonthlyOrders?: string;

  @IsOptional()
  @IsArray()
  @IsIn(BUSINESS_SERVICES, { each: true })
  servicesNeeded?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(BUSINESS_FEATURES, { each: true })
  requestedFeatures?: string[];

  @Trim()
  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  /** The person registering, e.g. "Operations manager". */
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  position?: string;
}

export class UpdateBusinessDto {
  @Trim()
  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @IsOptional()
  @IsArray()
  @IsIn(BUSINESS_SERVICES, { each: true })
  servicesNeeded?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(BUSINESS_FEATURES, { each: true })
  requestedFeatures?: string[];

  @IsOptional()
  @IsEnum(CompanySize)
  companySize?: CompanySize;
}

export class AddMemberDto {
  @IsKenyanPhone()
  phone: string;

  @IsIn(['ADMIN', 'MEMBER'])
  role: 'ADMIN' | 'MEMBER';

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  position?: string;

  /** Orders above this (KES) need approval. Leave empty for no approval. */
  @IsOptional()
  @IsInt()
  @Min(0)
  approvalLimit?: number | null;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(['ADMIN', 'MEMBER'])
  role?: 'ADMIN' | 'MEMBER';

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  position?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  approvalLimit?: number | null;
}

export class BusinessOrdersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['PENDING_APPROVAL', 'ACTIVE', 'PAST'])
  view?: 'PENDING_APPROVAL' | 'ACTIVE' | 'PAST';
}

export class BulkOrderItemDto {
  @Trim()
  @IsString()
  @Length(5, 1000)
  description: string;

  @IsOptional()
  @IsUUID()
  dropoffAddressId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff?: LocationDto;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientName?: string;

  @IsOptional()
  @IsKenyanPhone()
  recipientPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  itemsCost?: number;
}

/** Many deliveries from one pickup point, e.g. a shop sending out the day's orders. */
export class BulkOrderDto {
  @Trim()
  @IsString()
  categorySlug: string;

  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  @IsEnum(DeliveryType)
  deliveryType: DeliveryType;

  @IsOptional()
  @IsEnum(Urgency)
  urgency?: Urgency;

  /** Scheduled pickup time for every delivery in the batch. */
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_ORDER_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => BulkOrderItemDto)
  items: BulkOrderItemDto[];
}

// ─── Admin ───

export class BusinessListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(OrgStatus)
  status?: OrgStatus;
}

/** Credit terms are only applied when finance approves; others approve as prepaid. */
export class ApproveBusinessDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  creditLimit?: number;

  @IsOptional()
  @IsBoolean()
  monthlyInvoicing?: boolean;
}

export class AdminUpdateBusinessDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  creditLimit?: number;

  @IsOptional()
  @IsBoolean()
  monthlyInvoicing?: boolean;
}
