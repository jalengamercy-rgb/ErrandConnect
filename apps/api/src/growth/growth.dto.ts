import { MAX_FEATURED_WEEKS, PROMO_CODE_PATTERN } from '@errandconnect/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../admin/admin.dto.js';
import { IsKenyanPhone, Trim } from '../common/dto.js';
import { BannerAudience, PromoType } from '../generated/prisma/client.js';

const upper = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value));

export class CreatePromoDto {
  @upper()
  @Matches(PROMO_CODE_PATTERN, { message: 'code must be 3-20 capital letters and digits' })
  code: string;

  @Trim()
  @IsString()
  @Length(3, 200)
  description: string;

  @IsEnum(PromoType)
  type: PromoType;

  @IsInt()
  @Min(1)
  @ValidateIf((o: CreatePromoDto) => o.type === 'PERCENT')
  @Max(100)
  value: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiscount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderValue?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  perUserLimit?: number;

  @IsOptional()
  @IsBoolean()
  firstOrderOnly?: boolean;
}

export class UpdatePromoDto {
  @Trim()
  @IsOptional()
  @IsString()
  @Length(3, 200)
  description?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PromoListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['active', 'inactive'])
  state?: 'active' | 'inactive';
}

export class SubscribeDto {
  @IsIn(['WALLET', 'MPESA'])
  method: 'WALLET' | 'MPESA';

  @IsOptional()
  @IsKenyanPhone()
  phone?: string;
}

export class AutoRenewDto {
  @IsBoolean()
  autoRenew: boolean;
}

export class RedeemPointsDto {
  @IsInt()
  @Min(100)
  points: number;
}

export class BannerDto {
  @Trim()
  @IsString()
  @Length(2, 80)
  title: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  body?: string | null;

  @IsOptional()
  @IsUUID()
  merchantId?: string | null;

  @Trim()
  @IsOptional()
  @IsString()
  categorySlug?: string | null;

  @Trim()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url?: string | null;

  @IsOptional()
  @IsEnum(BannerAudience)
  audience?: BannerAudience;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  advertiser?: string | null;
}

export class BannerPaymentDto {
  @IsInt()
  @Min(1)
  amount: number;

  @Trim()
  @IsString()
  @Length(3, 60)
  reference: string;
}

export class BannerEventDto {
  @IsIn(['impression', 'click'])
  event: 'impression' | 'click';
}

export class FeatureShopDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FEATURED_WEEKS)
  weeks: number;

  /** Sends an M-Pesa prompt for the invoice straight away. */
  @IsOptional()
  @IsKenyanPhone()
  phone?: string;
}

export class RevenueQueryDto {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;
}
