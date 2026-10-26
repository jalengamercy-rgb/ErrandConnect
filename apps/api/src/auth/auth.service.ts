import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { LEGAL_VERSIONS } from '@errandconnect/shared';
import { ConsentType, Prisma } from '../generated/prisma/client.js';
import { hashSecret, verifySecret } from '../common/crypto.js';
import { newReferralCode, uniqueCode } from '../common/codes.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { LoginDto, RegisterDto, RequestOtpDto, ResetPasswordDto, VerifyOtpDto } from './auth.dto.js';
import { OtpService } from './otp.service.js';
import { TokensService } from './tokens.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;
// Compared against when the phone isn't registered, so the response takes
// the same time either way and doesn't reveal which numbers have accounts.
const DUMMY_HASH = await hashSecret('not-a-real-password');

export interface RequestMeta {
  ipAddress?: string;
  deviceName?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly users: UsersService,
  ) {}

  async requestOtp({ phone, purpose }: RequestOtpDto) {
    const exists = !!(await this.prisma.user.findUnique({ where: { phone }, select: { id: true } }));
    if (purpose === 'REGISTER' && exists) {
      throw new ConflictException('This number is already registered. Please log in');
    }
    // For password resets, don't reveal whether the number is registered.
    if (purpose === 'RESET_PASSWORD' && !exists) return { sent: true };
    await this.otp.send(phone, purpose, 'SMS');
    return { sent: true };
  }

  async verifyOtp({ phone, purpose, code }: VerifyOtpDto) {
    await this.otp.verify(phone, purpose, code);
    return { verificationToken: await this.tokens.signPhoneVerification(phone, purpose) };
  }

  async register(dto: RegisterDto, meta: RequestMeta) {
    const phone = await this.tokens.verifyPhoneVerification(dto.verificationToken, 'REGISTER');

    const referrer = dto.referralCode
      ? await this.prisma.user.findUnique({ where: { referralCode: dto.referralCode.toUpperCase() }, select: { id: true } })
      : null;

    const [passwordHash, pinHash] = await Promise.all([hashSecret(dto.password), hashSecret(dto.pin)]);
    const referralCode = await uniqueCode(
      newReferralCode,
      async (code) => !!(await this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } })),
    );

    const consents: { type: ConsentType; version: string; granted: boolean }[] = [
      { type: 'TERMS', version: LEGAL_VERSIONS.TERMS, granted: true },
      { type: 'PRIVACY_POLICY', version: LEGAL_VERSIONS.PRIVACY_POLICY, granted: true },
    ];
    if (dto.allowGps !== undefined) consents.push({ type: 'GPS_TRACKING', version: LEGAL_VERSIONS.PRIVACY_POLICY, granted: dto.allowGps });
    if (dto.allowMarketing !== undefined)
      consents.push({ type: 'MARKETING', version: LEGAL_VERSIONS.PRIVACY_POLICY, granted: dto.allowMarketing });

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            phone,
            email: dto.email?.toLowerCase(),
            firstName: dto.firstName,
            middleName: dto.middleName,
            lastName: dto.lastName,
            passwordHash,
            pinHash,
            phoneVerifiedAt: new Date(),
            referralCode,
            referredById: referrer?.id,
            consents: { create: consents.map((c) => ({ ...c, ipAddress: meta.ipAddress })) },
          },
        });
        if (dto.accountType === 'CUSTOMER') await this.users.addCustomerProfile(user.id, tx);
        else await this.users.addRunnerProfile(user.id, tx);
        return user.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const fields = String(error.meta?.target ?? error.message);
        throw new ConflictException(fields.includes('email') ? 'This email is already registered' : 'This number is already registered');
      }
      throw error;
    }

    const tokens = await this.tokens.createSession(userId, { deviceName: dto.deviceName, ipAddress: meta.ipAddress });
    return { user: await this.users.getMe(userId), tokens };
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true, passwordHash: true, status: true, lockedUntil: true, failedLoginCount: true },
    });
    const invalid = new UnauthorizedException('Incorrect phone number or password');

    if (!user) {
      await verifySecret(dto.password, DUMMY_HASH);
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Too many failed attempts. Try again in 15 minutes or reset your password');
    }
    if (!(await verifySecret(dto.password, user.passwordHash))) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
            : { failedLoginCount: failed },
      });
      throw invalid;
    }
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active. Please contact support');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await this.tokens.createSession(user.id, { deviceName: dto.deviceName, ipAddress: meta.ipAddress });
    return { user: await this.users.getMe(user.id), tokens };
  }

  refresh(refreshToken: string) {
    return this.tokens.refresh(refreshToken);
  }

  async logout(sessionId: string) {
    await this.tokens.revokeSession(sessionId);
    return { loggedOut: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const phone = await this.tokens.verifyPhoneVerification(dto.verificationToken, 'RESET_PASSWORD');
    const user = await this.prisma.user.update({
      where: { phone },
      data: { passwordHash: await hashSecret(dto.newPassword), failedLoginCount: 0, lockedUntil: null },
    });
    // Sign out every device, in case someone else knew the old password.
    await this.tokens.revokeAllSessions(user.id);
    return { passwordReset: true };
  }
}
