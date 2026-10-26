import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { EscrowStatus, PaymentStatus, WithdrawalStatus } from '../generated/prisma/client.js';
import { IsKenyanPhone, Trim } from '../common/dto.js';
import { PageQueryDto } from '../admin/admin.dto.js';

export class PayDto {
  /** Defaults to the customer's own number. */
  @IsOptional() @IsKenyanPhone()
  phone?: string;
}

export class WithdrawDto {
  @IsInt() @Min(1)
  amount: number;

  @Matches(/^\d{4}$/, { message: 'pin must be 4 digits' })
  pin: string;
}

export class WalletTypeParam {
  @IsIn(['customer', 'runner'])
  type: 'customer' | 'runner';
}

export class TransactionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 30;
}

export class EscrowListQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(EscrowStatus)
  status?: EscrowStatus;
}

export class PaymentListQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(PaymentStatus)
  status?: PaymentStatus;
}

export class WithdrawalListQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;
}

export class ReferenceDto {
  @Trim() @IsString() @Length(3, 60)
  reference: string;
}
