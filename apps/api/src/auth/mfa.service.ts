import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { randomInt } from 'node:crypto';
import { decryptSecret, encryptSecret, hashSecret, verifySecret } from '../common/crypto.js';
import { newTotpSecret, totpUri, verifyTotp } from '../common/totp.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RECOVERY_CODE_COUNT = 10;
/** No 0/O, 1/I/L: easy to read off paper. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** e.g. "K7QXD-M2PRW". */
function newRecoveryCode() {
  const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** Recovery codes are compared without dashes, spaces or case. */
const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Two-factor sign-in for staff, with an authenticator app. It protects the
 * admin routes only: a staff session must pass the check before using them.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private get key(): string {
    return this.config.get<string>('DATA_ENCRYPTION_KEY') || this.config.getOrThrow<string>('JWT_SECRET');
  }

  /** Whether every staff member must use two-factor sign-in (always on in production). */
  get required(): boolean {
    const setting = this.config.get<string>('STAFF_MFA_REQUIRED');
    return setting ? setting === 'true' : this.config.get('NODE_ENV') === 'production';
  }

  private async staff(userId: string) {
    const staff = await this.prisma.staffProfile.findUnique({ where: { userId }, include: { user: { select: { phone: true } } } });
    if (!staff) throw new ForbiddenException('Two-factor sign-in is for staff accounts');
    return staff;
  }

  async status(user: AuthUser) {
    const staff = await this.staff(user.id);
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: user.sessionId }, select: { mfaVerifiedAt: true } });
    return {
      enabled: !!staff.twoFactorEnabledAt,
      required: this.required,
      sessionVerified: !!session.mfaVerifiedAt,
      recoveryCodesLeft: staff.recoveryCodes.length,
    };
  }

  /** Step 1: a new secret to add to the authenticator app (not active until confirmed). */
  async setup(user: AuthUser) {
    const staff = await this.staff(user.id);
    if (staff.twoFactorEnabledAt) throw new ConflictException('Two-factor sign-in is already on');
    const secret = newTotpSecret();
    await this.prisma.staffProfile.update({ where: { userId: user.id }, data: { twoFactorSecret: encryptSecret(secret, this.key) } });
    return { secret, uri: totpUri(secret, staff.user.phone) };
  }

  /** Step 2: confirm with a code from the app. Returns one-time recovery codes (shown once). */
  async enable(user: AuthUser, code: string) {
    const staff = await this.staff(user.id);
    if (staff.twoFactorEnabledAt) throw new ConflictException('Two-factor sign-in is already on');
    if (!staff.twoFactorSecret) throw new BadRequestException('Start the setup first');
    const step = verifyTotp(decryptSecret(staff.twoFactorSecret, this.key), code);
    if (step === null) throw new BadRequestException('That code is not right. Check the time on your phone and try again');
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffProfile.update({
        where: { userId: user.id },
        data: {
          twoFactorEnabledAt: new Date(),
          twoFactorLastStep: step,
          recoveryCodes: await Promise.all(recoveryCodes.map((c) => hashSecret(normalizeRecoveryCode(c)))),
        },
      });
      await tx.session.update({ where: { id: user.sessionId }, data: { mfaVerifiedAt: new Date() } });
      await this.audit.log({ actorId: user.id, action: 'staff.mfa.enable', entityType: 'user', entityId: user.id }, tx);
    });
    return { enabled: true, recoveryCodes };
  }

  /** Each new staff session proves the second factor once. */
  async verify(user: AuthUser, code: string) {
    const staff = await this.staff(user.id);
    if (!staff.twoFactorEnabledAt || !staff.twoFactorSecret) throw new BadRequestException('Two-factor sign-in is not set up');
    const clean = code.trim().toUpperCase();
    let usedRecoveryCode = false;
    if (/^\d{6}$/.test(clean)) {
      const step = verifyTotp(decryptSecret(staff.twoFactorSecret, this.key), clean, staff.twoFactorLastStep);
      if (step === null) throw new BadRequestException('That code is not right. Codes change every 30 seconds');
      // Conditional update stops the same code being accepted twice at once.
      const { count } = await this.prisma.staffProfile.updateMany({
        where: { userId: user.id, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
        data: { twoFactorLastStep: step },
      });
      if (count === 0) throw new BadRequestException('That code was already used. Wait for the next one');
    } else {
      const remaining = [...staff.recoveryCodes];
      let index = -1;
      for (let i = 0; i < remaining.length; i++) {
        if (await verifySecret(normalizeRecoveryCode(clean), remaining[i])) {
          index = i;
          break;
        }
      }
      if (index === -1) throw new BadRequestException('That code is not right');
      remaining.splice(index, 1);
      await this.prisma.staffProfile.update({ where: { userId: user.id }, data: { recoveryCodes: remaining } });
      usedRecoveryCode = true;
    }
    await this.prisma.session.update({ where: { id: user.sessionId }, data: { mfaVerifiedAt: new Date() } });
    if (usedRecoveryCode)
      await this.audit.log({ actorId: user.id, action: 'staff.mfa.recovery_code_used', entityType: 'user', entityId: user.id });
    return this.status(user);
  }

  /** Super admin: for staff who lost their phone. They set it up again at next sign-in. */
  async reset(userId: string, admin: AuthUser) {
    const staff = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staff) throw new NotFoundException('Staff member not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.staffProfile.update({
        where: { userId },
        data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorLastStep: null, recoveryCodes: [] },
      });
      // Their current sessions must sign in again.
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorId: admin.id, action: 'staff.mfa.reset', entityType: 'user', entityId: userId }, tx);
    });
    return { reset: true };
  }
}
