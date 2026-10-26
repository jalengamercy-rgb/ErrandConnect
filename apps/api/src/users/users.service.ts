import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { newCustomerCode, newRunnerCode, uniqueCode } from '../common/codes.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OtpService } from '../auth/otp.service.js';
import type { UpdateCustomerPreferencesDto, UpdateMeDto } from './users.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
  ) {}

  /** Everything the app needs about the logged-in user. Never includes password/PIN hashes. */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        whatsapp: true,
        altPhone: true,
        firstName: true,
        middleName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        nationality: true,
        photoUrl: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        idVerifiedAt: true,
        status: true,
        referralCode: true,
        createdAt: true,
        customerProfile: { omit: { userId: true } },
        runnerProfile: { select: { runnerCode: true, applicationStatus: true, isOnline: true, ratingAvg: true, jobsCompleted: true } },
        staffProfile: { select: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...dto,
          email: dto.email?.toLowerCase(),
          // Changing email means it must be verified again.
          ...(dto.email ? { emailVerifiedAt: null } : {}),
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('This email is already registered');
      throw error;
    }
    if (dto.email) await this.recalculateCustomerLevel(userId);
    return this.getMe(userId);
  }

  async updateCustomerPreferences(userId: string, dto: UpdateCustomerPreferencesDto) {
    await this.prisma.customerProfile.update({ where: { userId }, data: dto });
    return this.getMe(userId);
  }

  async addCustomerProfile(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const customerCode = await uniqueCode(newCustomerCode, async (code) =>
      !!(await tx.customerProfile.findUnique({ where: { customerCode: code } })),
    );
    await tx.customerProfile.create({ data: { userId, customerCode } });
    await tx.wallet.create({ data: { type: 'CUSTOMER', userId } });
  }

  async addRunnerProfile(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const runnerCode = await uniqueCode(newRunnerCode, async (code) =>
      !!(await tx.runnerProfile.findUnique({ where: { runnerCode: code } })),
    );
    await tx.runnerProfile.create({ data: { userId, runnerCode } });
  }

  /** Lets an existing customer become a runner, or a runner also order errands. */
  async addRole(userId: string, role: 'customer' | 'runner') {
    const user = await this.getMe(userId);
    if (role === 'customer') {
      if (user.customerProfile) throw new ConflictException('You already have a customer account');
      await this.prisma.$transaction((tx) => this.addCustomerProfile(userId, tx));
    } else {
      if (user.runnerProfile) throw new ConflictException('You already have a runner account');
      await this.addRunnerProfile(userId);
    }
    return this.getMe(userId);
  }

  async requestEmailVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user.email) throw new BadRequestException('Add an email address first');
    if (user.emailVerifiedAt) throw new ConflictException('Email already verified');
    await this.otp.send(user.email, 'VERIFY_EMAIL', 'EMAIL');
    return { sent: true };
  }

  async confirmEmailVerification(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    if (!user.email) throw new BadRequestException('Add an email address first');
    await this.otp.verify(user.email, 'VERIFY_EMAIL', code);
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await this.recalculateCustomerLevel(userId);
    return this.getMe(userId);
  }

  /**
   * Customer verification level: 1 = phone verified, 2 = phone + email,
   * 3 = ID verified by an admin.
   */
  async recalculateCustomerLevel(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailVerifiedAt: true, idVerifiedAt: true, customerProfile: { select: { userId: true } } },
    });
    if (!user.customerProfile) return;
    const level = user.idVerifiedAt ? 3 : user.emailVerifiedAt ? 2 : 1;
    await tx.customerProfile.update({ where: { userId }, data: { verificationLevel: level } });
  }
}
