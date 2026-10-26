import {
  DELIVERY_TYPES,
  PAYMENT_METHODS,
  RUNNER_PROGRESS_STATUSES,
  type PaymentMethodChoice,
  URGENCY_LEVELS,
  type DeliveryType,
  type RunnerProgressStatus,
  type Urgency,
} from '@errandconnect/shared';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsKenyanPhone, Trim } from '../common/dto.js';

export class LocationDto {
  /** Human-readable address shown to the runner. */
  @Trim()
  @IsString()
  @Length(2, 300)
  address: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @Trim()
  @IsOptional()
  @IsString()
  @Length(1, 60)
  label?: string;
}

/** Everything that affects the price. Used for quotes and when creating an order. */
export class OrderDetailsDto {
  @IsString()
  @Length(1, 60)
  categorySlug: string;

  /** Where the runner goes first (shop, pharmacy, bank). Optional for errands like "buy from any supermarket". */
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  pickup?: LocationDto;

  /** A saved address of the customer... */
  @IsOptional()
  @IsUUID()
  dropoffAddressId?: string;

  /** ...or a location given directly. */
  @ValidateIf((o: OrderDetailsDto) => !o.dropoffAddressId)
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff?: LocationDto;

  @IsIn(DELIVERY_TYPES)
  deliveryType: DeliveryType;

  @IsOptional()
  @IsIn(URGENCY_LEVELS)
  urgency?: Urgency;

  /** Order from a listed shop: the shop becomes the pickup point. */
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  /** Promo code for a discount (personal errands only). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;

  /** Order on behalf of a company the customer belongs to. */
  @IsOptional()
  @IsUUID()
  businessId?: string;

  /** Estimated cost of items the runner buys for the customer. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500_000)
  itemsCost?: number;
}

export class CreateOrderDto extends OrderDetailsDto {
  /** What the runner should do, e.g. "Buy 2kg sugar and 1L milk from Naivas". */
  @Trim()
  @IsString()
  @Length(5, 1000)
  description: string;

  @Trim()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  recipientName?: string;

  @IsOptional()
  @IsKenyanPhone()
  recipientPhone?: string;

  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod: PaymentMethodChoice;

  /** Phone that receives the M-Pesa prompt; defaults to the customer's number. */
  @IsOptional()
  @IsKenyanPhone()
  mpesaPhone?: string;
}

export class OrderListQueryDto {
  @IsOptional()
  @IsIn(['active', 'past'])
  scope?: 'active' | 'past';
}

export class ProgressDto {
  @IsIn(RUNNER_PROGRESS_STATUSES)
  status: RunnerProgressStatus;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;
}

export class DeliverDto {
  @Matches(/^\d{4}$/, { message: 'pin must be 4 digits' })
  pin: string;
}

export class CancelDto {
  @Trim()
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class MessageDto {
  @Trim()
  @IsString()
  @Length(1, 1000)
  body: string;
}

export class ReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @Trim()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  comment?: string;
}

export class LocationUpdateDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;
}
