import {
  ArrayMaxSize,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Gender } from '../generated/prisma/client.js';
import { IsKenyanPhone, Trim } from '../common/dto.js';

export class UpdateMeDto {
  @Trim()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  firstName?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  middleName?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  lastName?: string;

  @Trim()
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsKenyanPhone()
  whatsapp?: string;

  @IsOptional()
  @IsKenyanPhone()
  altPhone?: string;

  /** YYYY-MM-DD */
  @IsOptional()
  @IsISO8601({ strict: true })
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;
}

export class UpdateCustomerPreferencesDto {
  @IsOptional()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  favoriteCategories?: string[];

  @IsOptional()
  @IsBoolean()
  notifySms?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyPush?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyWhatsapp?: boolean;

  @IsOptional()
  @IsIn(['en', 'sw'])
  language?: string;
}

export class ConfirmCodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class AddressDto {
  /** "Home", "Office", "Parents"... */
  @Trim()
  @IsString()
  @Length(1, 40)
  label: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  county?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  area?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  street?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  building?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class EmergencyContactDto {
  @Trim()
  @IsString()
  @Length(2, 100)
  fullName: string;

  @Trim()
  @IsString()
  @Length(2, 40)
  relationship: string;

  @IsKenyanPhone()
  phone: string;

  @IsOptional()
  @IsKenyanPhone()
  altPhone?: string;
}
