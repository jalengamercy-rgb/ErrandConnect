import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../admin/admin.dto.js';
import { IsKenyanPhone, Trim } from '../common/dto.js';
import { OrgStatus } from '../generated/prisma/client.js';

export class RegisterMerchantDto {
  @Trim()
  @IsString()
  @Length(2, 120)
  name: string;

  /** The kind of errand the shop serves, e.g. "grocery-shopping". */
  @Trim()
  @IsString()
  categorySlug: string;

  @IsOptional()
  @IsKenyanPhone()
  phone?: string;

  @Trim()
  @IsOptional()
  @IsEmail()
  email?: string;

  @Trim()
  @IsString()
  @Length(3, 200)
  addressLine: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  registrationNumber?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxNumber?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateMerchantDto {
  @IsOptional()
  @IsKenyanPhone()
  phone?: string;

  @Trim()
  @IsOptional()
  @IsEmail()
  email?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class MerchantDirectoryQueryDto {
  @Trim()
  @IsOptional()
  @IsString()
  category?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class MerchantOrdersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'PAST'])
  view?: 'ACTIVE' | 'PAST';
}

// ─── Admin ───

export class MerchantListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(OrgStatus)
  status?: OrgStatus;
}

export class AdminUpdateMerchantDto {
  /** Share of items cost charged to the shop (0-0.5). Null = platform default. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(0.5)
  commissionRate?: number | null;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
