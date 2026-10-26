import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '../generated/prisma/client.js';
import { hmacSha256, randomDigits, safeEqualHex } from '../common/crypto.js';
import { MessagingService } from '../notifications/messaging.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

/** One-time codes sent by SMS or email. Only an HMAC of each code is stored. */
@Injectable()
export class OtpService {
  private readonly secret: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {
    this.secret = config.getOrThrow<string>('OTP_SECRET');
  }

  private hash(destination: string, purpose: OtpPurpose, code: string) {
    return hmacSha256(this.secret, `${destination}:${purpose}:${code}`);
  }

  async send(destination: string, purpose: OtpPurpose, channel: 'SMS' | 'EMAIL'): Promise<void> {
    const now = Date.now();
    const recent = await this.prisma.otpCode.findMany({
      where: { destination, purpose, createdAt: { gte: new Date(now - 60 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException('Please wait a minute before requesting another code', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (recent.length >= MAX_CODES_PER_HOUR) {
      throw new HttpException('Too many codes requested. Try again later', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomDigits(CODE_LENGTH);
    await this.prisma.otpCode.create({
      data: { destination, purpose, codeHash: this.hash(destination, purpose, code), expiresAt: new Date(now + CODE_TTL_MS) },
    });

    const text = `Your ErrandCONNECT code is ${code}. It expires in 5 minutes. Never share this code.`;
    if (channel === 'SMS') await this.messaging.sendSms(destination, text);
    else await this.messaging.sendEmail(destination, 'Your ErrandCONNECT verification code', text);
  }

  /** Checks a code and marks it used. Throws if wrong, expired or used up. */
  async verify(destination: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { destination, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Code expired. Please request a new one');
    }
    if (!safeEqualHex(otp.codeHash, this.hash(destination, purpose, code))) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Incorrect code');
    }
    // Conditional update so two simultaneous requests can't both use the same code.
    const { count } = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException('Code already used');
  }
}
