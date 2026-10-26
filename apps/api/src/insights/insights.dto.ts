import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PageQueryDto } from '../admin/admin.dto.js';
import { Trim } from '../common/dto.js';
import { RiskFlagStatus, RiskSeverity } from '../generated/prisma/client.js';

export class RiskFlagQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(RiskFlagStatus)
  status?: RiskFlagStatus;

  @IsOptional()
  @IsEnum(RiskSeverity)
  severity?: RiskSeverity;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class ReviewFlagDto {
  @IsIn(['CONFIRMED', 'DISMISSED'])
  decision: 'CONFIRMED' | 'DISMISSED';

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DemandQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(72)
  hours?: number;
}

export class ChurnQueryDto {
  @IsOptional()
  @IsIn(['AT_RISK', 'LIKELY_LOST', 'LOST'])
  risk?: 'AT_RISK' | 'LIKELY_LOST' | 'LOST';
}

export class WinBackDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  userIds: string[];

  @Trim()
  @IsString()
  @Length(3, 80)
  title: string;

  @Trim()
  @IsString()
  @Length(5, 500)
  message: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;
}
