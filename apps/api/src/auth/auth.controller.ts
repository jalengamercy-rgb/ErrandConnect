import { Body, Controller, Get, HttpCode, Ip, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../common/auth-user.js';
import { LoginDto, MfaCodeDto, RefreshDto, RegisterDto, RequestOtpDto, ResetPasswordDto, VerifyOtpDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import type { TokenPair } from './tokens.service.js';

// Stricter limit for login/OTP routes to slow down guessing attacks.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** Refresh token cookie for browsers; only sent to /auth routes and unreadable by page scripts. */
const REFRESH_COOKIE = 'ec_refresh';

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(response: Response, tokens: TokenPair): Omit<TokenPair, 'refreshToken'> {
    const { refreshToken, ...rest } = tokens;
    response.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/auth',
      maxAge: Number(this.config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30) * 86_400_000,
    });
    return rest;
  }

  /** Step 1 of sign-up / password reset: text a 6-digit code to the phone. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto);
  }

  /** Step 2: check the code; returns a verificationToken for register / reset. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.auth.register(dto, { ipAddress: ip });
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto, { ipAddress: ip });
    return dto.useCookie ? { ...result, tokens: this.setRefreshCookie(response, result.tokens) } : result;
  }

  /** Body token (apps) or the refresh cookie (browsers). The cookie is rotated too. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    if (dto.refreshToken) return this.auth.refresh(dto.refreshToken);
    const cookie = readCookie(request, REFRESH_COOKIE);
    if (!cookie) throw new UnauthorizedException('Session expired, please log in again');
    return this.setRefreshCookie(response, await this.auth.refresh(cookie));
  }

  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    response.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return this.auth.logout(user.sessionId);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password/reset')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  // ─── Staff two-factor sign-in ───

  @Get('mfa')
  mfaStatus(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.mfa.setup(user);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.mfa.enable(user, dto.code);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/verify')
  @HttpCode(200)
  mfaVerify(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.mfa.verify(user, dto.code);
  }
}
