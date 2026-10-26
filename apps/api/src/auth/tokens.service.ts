import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { OtpPurpose } from '../generated/prisma/client.js';
import type { AccessTokenPayload } from '../common/auth.guard.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Proves the holder just verified this phone number with an OTP. */
interface PhoneVerificationPayload {
  phone: string;
  purpose: OtpPurpose;
  typ: 'phone-verification';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

const PHONE_VERIFICATION_TTL_SECONDS = 15 * 60;

@Injectable()
export class TokensService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {
    this.accessTtlSeconds = Number(config.get('ACCESS_TOKEN_TTL_SECONDS') ?? 900);
    this.refreshTtlMs = Number(config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30) * 24 * 60 * 60_000;
  }

  signPhoneVerification(phone: string, purpose: OtpPurpose): Promise<string> {
    const payload: PhoneVerificationPayload = { phone, purpose, typ: 'phone-verification' };
    return this.jwt.signAsync(payload, { expiresIn: PHONE_VERIFICATION_TTL_SECONDS });
  }

  /** Returns the verified phone number, or throws. */
  async verifyPhoneVerification(token: string, purpose: OtpPurpose): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<PhoneVerificationPayload>(token);
      if (payload.typ === 'phone-verification' && payload.purpose === purpose) return payload.phone;
    } catch {
      // fall through
    }
    throw new UnauthorizedException('Phone verification expired. Please verify your number again');
  }

  /** Starts a new logged-in session for a device. */
  async createSession(userId: string, meta: { deviceName?: string; ipAddress?: string }): Promise<TokenPair> {
    const refreshToken = randomToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        deviceName: meta.deviceName,
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
    return { accessToken: await this.signAccess(userId, session.id), refreshToken, accessTokenExpiresIn: this.accessTtlSeconds };
  }

  /**
   * Swaps a refresh token for new tokens. The old refresh token stops working
   * (rotation), so a stolen token can only be used once.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    const next = randomToken();
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
      data: { refreshTokenHash: sha256(next), expiresAt: new Date(Date.now() + this.refreshTtlMs) },
    });
    if (count === 0) throw new UnauthorizedException('Session expired, please log in again');
    return { accessToken: await this.signAccess(session.userId, session.id), refreshToken: next, accessTokenExpiresIn: this.accessTtlSeconds };
  }

  revokeSession(sessionId: string) {
    return this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  revokeAllSessions(userId: string) {
    return this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private signAccess(userId: string, sessionId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, typ: 'access' };
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds });
  }
}
