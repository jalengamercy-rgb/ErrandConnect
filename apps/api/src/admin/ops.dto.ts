import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { StaffRole } from '../generated/prisma/client.js';
import { IsKenyanPhone, Trim } from '../common/dto.js';
import { PageQueryDto } from './admin.dto.js';

export class DaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30;
}

export class CsvQueryDto {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;
}

export class CategoryCreateDto {
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'slug must be 2-40 lowercase letters, numbers or dashes' })
  slug: string;

  @Trim()
  @IsString()
  @Length(2, 60)
  name: string;

  @IsInt()
  @Min(0)
  @Max(100_000)
  baseFee: number;
}

export class CategoryUpdateDto {
  @Trim()
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  baseFee?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ReviewListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  hidden?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxStars?: number;
}

export class HideReviewDto {
  @IsBoolean()
  hidden: boolean;
}

export class AddStaffDto {
  @IsKenyanPhone()
  phone: string;

  @IsEnum(StaffRole)
  role: StaffRole;
}

export class UpdateStaffDto {
  @IsEnum(StaffRole)
  role: StaffRole;
}

export const AUDIENCES = ['ALL', 'CUSTOMERS', 'RUNNERS', 'ONLINE_RUNNERS', 'USERS'] as const;

export class BroadcastDto {
  @IsIn(AUDIENCES)
  audience: (typeof AUDIENCES)[number];

  /** Required when audience is USERS. */
  @ValidateIf((o: BroadcastDto) => o.audience === 'USERS')
  @IsUUID('all', { each: true })
  @ArrayMaxSize(1000)
  userIds?: string[];

  @Trim()
  @IsString()
  @Length(2, 80)
  title: string;

  @Trim()
  @IsString()
  @Length(2, 500)
  body: string;

  /** Also send by SMS (costs money once an SMS provider is connected). */
  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}
