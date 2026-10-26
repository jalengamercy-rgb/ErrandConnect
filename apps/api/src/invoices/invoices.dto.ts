import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PageQueryDto } from '../admin/admin.dto.js';
import { IsKenyanPhone, Trim } from '../common/dto.js';
import { InvoiceStatus } from '../generated/prisma/client.js';

export class PayInvoiceDto {
  @IsKenyanPhone()
  phone: string;
}

export class InvoiceListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsUUID()
  merchantId?: string;
}

/** Bill a company for its completed invoice orders, or a shop for its commission, over a period. */
export class GenerateInvoiceDto {
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsISO8601()
  periodStart: string;

  @IsISO8601()
  periodEnd: string;
}

export class MarkInvoicePaidDto {
  /** Bank or M-Pesa reference. */
  @Trim()
  @IsString()
  @Length(3, 60)
  reference: string;
}
