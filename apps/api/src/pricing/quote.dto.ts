import { DELIVERY_TYPES, URGENCY_LEVELS, type DeliveryType, type Urgency } from '@errandconnect/shared';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Body of POST /pricing/quote. Validated automatically before reaching the controller. */
export class QuoteRequestDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  itemsCost?: number;

  @IsInt()
  @Min(0)
  errandFee: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  distanceKm: number;

  @IsIn(DELIVERY_TYPES)
  deliveryType: DeliveryType;

  @IsOptional()
  @IsIn(URGENCY_LEVELS)
  urgency?: Urgency;
}
