import { MAX_DISTANCE_CHOICES_KM, RUNNER_EQUIPMENT, RUNNER_LANGUAGES, RUNNER_SKILLS } from '@errandconnect/shared';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Availability, DeliveryType, Gender, PayoutMethodType, Weekday } from '../generated/prisma/client.js';
import { IsKenyanPhone, Trim } from '../common/dto.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Step 1 (name and phone were given at sign-up). */
export class PersonalStepDto {
  @IsISO8601({ strict: true })
  dateOfBirth: string;

  @IsEnum(Gender)
  gender: Gender;

  @Trim() @IsString() @Length(2, 60)
  nationality: string;

  @Trim() @IsString() @Matches(/^[A-Z0-9]{6,12}$/i, { message: 'nationalIdNumber must be 6-12 letters or digits' })
  nationalIdNumber: string;

  @Trim() @IsEmail()
  email: string;

  @IsOptional() @IsKenyanPhone()
  whatsapp?: string;
}

/** Step 2 */
export class ServiceAreaStepDto {
  @Trim() @IsString() @Length(2, 60)
  county: string;

  @Trim() @IsString() @Length(2, 60)
  city: string;

  @Trim() @IsString() @Length(2, 80)
  area: string;

  @IsString({ each: true }) @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique()
  preferredAreas: string[];

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;
}

/** Step 3 */
export class DeliveryTypesStepDto {
  @IsEnum(DeliveryType, { each: true }) @ArrayMinSize(1) @ArrayUnique()
  deliveryTypes: DeliveryType[];
}

/** Step 4: one per vehicle. */
export class VehicleDto {
  @IsEnum(DeliveryType)
  type: DeliveryType;

  @Trim() @IsString() @Length(1, 40)
  make: string;

  @Trim() @IsString() @Length(1, 40)
  model: string;

  @Trim() @IsString() @Length(2, 30)
  color: string;

  /** e.g. KMEA 123B or KDA 456X; spaces are removed. */
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value))
  @Matches(/^[A-Z0-9]{5,10}$/, { message: 'registrationNumber looks invalid' })
  registrationNumber: string;

  @IsInt() @Min(1980) @Max(new Date().getFullYear() + 1)
  year: number;

  @Trim() @IsString() @Length(4, 30)
  licenceNumber: string;

  @IsISO8601({ strict: true })
  licenceExpiry: string;

  @Trim() @IsString() @Length(4, 40)
  insuranceNumber: string;

  @IsISO8601({ strict: true })
  insuranceExpiry: string;
}

/** Step 5: documents are uploaded via POST /documents; only KRA PIN is entered here. */
export class IdentityStepDto {
  @Trim() @IsOptional() @Matches(/^[A-Z]\d{9}[A-Z]$/i, { message: 'kraPin should look like A123456789B' })
  kraPin?: string;
}

/** Step 7 */
export class PayoutStepDto {
  @IsEnum(PayoutMethodType)
  type: PayoutMethodType;

  /** Registered name on the M-Pesa line or bank account. */
  @Trim() @IsString() @Length(2, 100)
  accountName: string;

  @ValidateIf((o: PayoutStepDto) => o.type !== 'BANK')
  @IsKenyanPhone()
  phone?: string;

  @ValidateIf((o: PayoutStepDto) => o.type === 'BANK')
  @Trim() @IsString() @Length(2, 60)
  bankName?: string;

  @ValidateIf((o: PayoutStepDto) => o.type === 'BANK')
  @Matches(/^\d{6,20}$/, { message: 'accountNumber must be 6-20 digits' })
  accountNumber?: string;

  @ValidateIf((o: PayoutStepDto) => o.type === 'BANK')
  @Trim() @IsString() @Length(2, 60)
  branch?: string;
}

/** Step 8 */
export class WorkPreferencesStepDto {
  @IsEnum(Availability)
  availability: Availability;

  @IsEnum(Weekday, { each: true }) @ArrayMinSize(1) @ArrayUnique()
  workingDays: Weekday[];

  @Matches(TIME, { message: 'workStartTime must be HH:MM' })
  workStartTime: string;

  @Matches(TIME, { message: 'workEndTime must be HH:MM' })
  workEndTime: string;

  /** 2, 5, 10, 20 or null for no limit. */
  @IsOptional() @IsIn(MAX_DISTANCE_CHOICES_KM)
  maxDistanceKm?: number | null;
}

/** Step 9: service category slugs. */
export class ServicesStepDto {
  @IsString({ each: true }) @ArrayMinSize(1) @ArrayUnique()
  servicesOffered: string[];
}

/** Step 10 */
export class ExperienceStepDto {
  @IsBoolean()
  hasDeliveryExperience: boolean;

  @Trim() @IsOptional() @IsString() @MaxLength(80)
  previousCompany?: string;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  yearsExperience?: number;

  @IsOptional() @IsInt() @Min(0) @Max(200)
  avgDeliveriesPerDay?: number;
}

/** Step 11 */
export class EquipmentStepDto {
  @IsIn(RUNNER_EQUIPMENT, { each: true }) @ArrayUnique()
  equipment: string[];
}

/** Step 12 */
export class SkillsStepDto {
  @IsIn(RUNNER_LANGUAGES, { each: true }) @ArrayMinSize(1) @ArrayUnique()
  languages: string[];

  @IsIn(RUNNER_SKILLS, { each: true }) @ArrayUnique()
  skills: string[];
}

/** Step 13 */
export class BackgroundStepDto {
  @IsBoolean()
  hasCriminalRecord: boolean;

  @IsBoolean()
  canLiftHeavy: boolean;

  @IsBoolean()
  willingToHandleCash: boolean;

  @Equals(true, { message: 'You must agree to ID verification' })
  agreeToIdVerification: boolean;

  @Equals(true, { message: 'You must agree to background checks' })
  agreeToBackgroundCheck: boolean;
}

/** Step 15 */
export class AgreementsStepDto {
  @Equals(true, { message: 'You must accept the Terms & Conditions' })
  terms: boolean;

  @Equals(true, { message: 'You must accept the Privacy Policy' })
  privacyPolicy: boolean;

  @Equals(true, { message: 'You must consent to GPS tracking while online' })
  gpsTracking: boolean;

  @Equals(true, { message: 'You must confirm you understand the commission rates' })
  commissionRates: boolean;

  @Equals(true, { message: 'You must certify that your information is true' })
  infoIsTrue: boolean;
}

export class GoOnlineDto {
  @IsBoolean()
  online: boolean;

  @ValidateIf((o: GoOnlineDto) => o.online)
  @IsLatitude()
  lat?: number;

  @ValidateIf((o: GoOnlineDto) => o.online)
  @IsLongitude()
  lng?: number;
}
