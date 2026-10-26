import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsKenyanPhone, Trim } from '../common/dto.js';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
const PASSWORD_MESSAGE = 'password must be 8-128 characters with at least one letter and one number';

export class RequestOtpDto {
  @IsKenyanPhone()
  phone: string;

  @IsIn(['REGISTER', 'RESET_PASSWORD'])
  purpose: 'REGISTER' | 'RESET_PASSWORD';
}

export class VerifyOtpDto extends RequestOtpDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class RegisterDto {
  /** From POST /auth/otp/verify with purpose REGISTER. */
  @IsString()
  verificationToken: string;

  @IsIn(['CUSTOMER', 'RUNNER'])
  accountType: 'CUSTOMER' | 'RUNNER';

  @Trim()
  @IsString()
  @Length(1, 50)
  firstName: string;

  @Trim()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  middleName?: string;

  @Trim()
  @IsString()
  @Length(1, 50)
  lastName: string;

  @Trim()
  @IsOptional()
  @IsEmail()
  email?: string;

  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @Matches(/^\d{4}$/, { message: 'pin must be 4 digits' })
  pin: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;

  @Equals(true, { message: 'You must accept the Terms & Conditions' })
  acceptTerms: boolean;

  @Equals(true, { message: 'You must accept the Privacy Policy' })
  acceptPrivacy: boolean;

  @IsOptional()
  @IsBoolean()
  allowGps?: boolean;

  @IsOptional()
  @IsBoolean()
  allowMarketing?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}

export class LoginDto {
  @IsKenyanPhone()
  phone: string;

  @IsString()
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;

  /**
   * For browsers (the admin panel): keep the refresh token in an httpOnly
   * cookie that page scripts can't read, instead of returning it.
   */
  @IsOptional()
  @IsBoolean()
  useCookie?: boolean;
}

export class RefreshDto {
  /** Leave out to use the refresh cookie set at login. */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class MfaCodeDto {
  /** 6-digit code from the authenticator app, or a recovery code. */
  @IsString()
  @Length(6, 12)
  code: string;
}

export class ResetPasswordDto {
  /** From POST /auth/otp/verify with purpose RESET_PASSWORD. */
  @IsString()
  verificationToken: string;

  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}
