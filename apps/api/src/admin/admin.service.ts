import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType, Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth-user.js';
import { AuditService } from '../common/audit.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeOnboardingProgress, needsVehicle } from '../runners/onboarding-progress.js';
import { RunnersService } from '../runners/runners.service.js';
import { UsersService } from '../users/users.service.js';
import type { AuditLogQueryDto, PageQueryDto, ReviewDocumentDto, RunnerCheck, RunnerListQueryDto } from './admin.dto.js';

/** User fields safe to show in the admin panel (no password/PIN hashes). */
const USER_SUMMARY = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  middleName: true,
  lastName: true,
  photoUrl: true,
  status: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
  idVerifiedAt: true,
  createdAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

const IDENTITY_DOCUMENTS: DocumentType[] = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'SELFIE', 'SELFIE_WITH_ID'];
/** Any one of these, approved, verifies a customer's identity. */
const CUSTOMER_ID_DOCUMENTS: DocumentType[] = ['NATIONAL_ID_FRONT', 'PASSPORT', 'DRIVING_LICENCE'];

function searchFilter(search?: string): Prisma.UserWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: 'insensitive' as const };
  return { OR: [{ firstName: contains }, { lastName: contains }, { phone: contains }, { email: contains }] };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly runners: RunnersService,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
  ) {}

  // ─── Runners ───

  async listRunners(query: RunnerListQueryDto) {
    const where: Prisma.RunnerProfileWhereInput = { applicationStatus: query.status, user: searchFilter(query.search) };
    const [total, items] = await Promise.all([
      this.prisma.runnerProfile.count({ where }),
      this.prisma.runnerProfile.findMany({
        where,
        orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          runnerCode: true,
          applicationStatus: true,
          deliveryTypes: true,
          area: true,
          isOnline: true,
          ratingAvg: true,
          jobsCompleted: true,
          submittedAt: true,
          user: { select: USER_SUMMARY },
        },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async getRunner(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...USER_SUMMARY,
        dateOfBirth: true,
        gender: true,
        nationality: true,
        whatsapp: true,
        runnerProfile: { include: { vehicles: true } },
        documents: { orderBy: { createdAt: 'desc' }, omit: { storageKey: true } },
        payoutMethods: true,
        emergencyContacts: true,
        consents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user?.runnerProfile) throw new NotFoundException('Runner not found');
    return { ...user, progress: computeOnboardingProgress(await this.runners.loadState(userId)) };
  }

  async startRunnerReview(userId: string, admin: AuthUser) {
    const profile = await this.findRunner(userId);
    if (profile.applicationStatus !== 'SUBMITTED') throw new ConflictException('Only submitted applications can be reviewed');
    await this.prisma.$transaction(async (tx) => {
      await tx.runnerProfile.update({ where: { userId }, data: { applicationStatus: 'UNDER_REVIEW' } });
      await this.audit.log({ actorId: admin.id, action: 'runner.review.start', entityType: 'runner', entityId: userId }, tx);
    });
    return this.getRunner(userId);
  }

  /** Records the outcome of one verification check on the runner's tracker. */
  async setRunnerCheck(userId: string, check: RunnerCheck, passed: boolean, admin: AuthUser) {
    const profile = await this.findRunner(userId);
    if (profile.applicationStatus !== 'UNDER_REVIEW' && profile.applicationStatus !== 'APPROVED') {
      throw new ConflictException('Start the review before recording checks');
    }
    const now = passed ? new Date() : null;

    await this.prisma.$transaction(async (tx) => {
      if (check === 'IDENTITY') {
        if (passed) {
          const latest = await this.latestDocuments(userId, IDENTITY_DOCUMENTS, tx);
          const notApproved = IDENTITY_DOCUMENTS.filter((type) => latest.get(type) !== 'APPROVED');
          if (notApproved.length) throw new BadRequestException(`Approve these documents first: ${notApproved.join(', ')}`);
        }
        await tx.runnerProfile.update({ where: { userId }, data: { identityVerifiedAt: now } });
        await tx.user.update({ where: { id: userId }, data: { idVerifiedAt: now } });
        await this.users.recalculateCustomerLevel(userId, tx);
      } else if (check === 'VEHICLE') {
        await tx.vehicle.updateMany({ where: { runnerId: userId }, data: { status: passed ? 'APPROVED' : 'REJECTED' } });
        await tx.runnerProfile.update({ where: { userId }, data: { vehicleVerifiedAt: now } });
      } else if (check === 'PAYOUT') {
        await tx.payoutMethod.updateMany({ where: { userId }, data: { status: passed ? 'APPROVED' : 'REJECTED' } });
        await tx.runnerProfile.update({ where: { userId }, data: { payoutApprovedAt: now } });
      } else {
        await tx.runnerProfile.update({ where: { userId }, data: { backgroundCheckedAt: now } });
      }
      await this.audit.log(
        { actorId: admin.id, action: 'runner.check', entityType: 'runner', entityId: userId, metadata: { check, passed } },
        tx,
      );
    });
    return this.getRunner(userId);
  }

  async approveRunner(userId: string, admin: AuthUser) {
    const profile = await this.findRunner(userId);
    if (profile.applicationStatus !== 'UNDER_REVIEW') throw new ConflictException('Only applications under review can be approved');
    const missing = [
      !profile.identityVerifiedAt && 'IDENTITY',
      needsVehicle(profile) && !profile.vehicleVerifiedAt && 'VEHICLE',
      !profile.backgroundCheckedAt && 'BACKGROUND',
      !profile.payoutApprovedAt && 'PAYOUT',
    ].filter(Boolean);
    if (missing.length) throw new BadRequestException(`Complete these checks first: ${missing.join(', ')}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.runnerProfile.update({ where: { userId }, data: { applicationStatus: 'APPROVED', approvedAt: new Date(), rejectionReason: null } });
      await tx.wallet.upsert({ where: { type_userId: { type: 'RUNNER', userId } }, update: {}, create: { type: 'RUNNER', userId } });
      await this.audit.log({ actorId: admin.id, action: 'runner.approve', entityType: 'runner', entityId: userId }, tx);
    });
    return this.getRunner(userId);
  }

  async rejectRunner(userId: string, reason: string, admin: AuthUser) {
    const profile = await this.findRunner(userId);
    if (profile.applicationStatus !== 'SUBMITTED' && profile.applicationStatus !== 'UNDER_REVIEW') {
      throw new ConflictException('Only submitted applications can be rejected');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.runnerProfile.update({ where: { userId }, data: { applicationStatus: 'REJECTED', rejectionReason: reason } });
      await this.audit.log({ actorId: admin.id, action: 'runner.reject', entityType: 'runner', entityId: userId, metadata: { reason } }, tx);
    });
    return this.getRunner(userId);
  }

  private async findRunner(userId: string) {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Runner not found');
    return profile;
  }

  private async latestDocuments(ownerId: string, types: DocumentType[], tx: Prisma.TransactionClient) {
    const documents = await tx.document.findMany({ where: { ownerId, type: { in: types } }, orderBy: { createdAt: 'desc' } });
    const latest = new Map<DocumentType, string>();
    for (const d of documents) if (!latest.has(d.type)) latest.set(d.type, d.status);
    return latest;
  }

  // ─── Documents ───

  async reviewDocument(documentId: string, dto: ReviewDocumentDto, admin: AuthUser) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException('Document not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id: documentId },
        data: {
          status: dto.decision,
          rejectionReason: dto.decision === 'REJECTED' ? dto.reason : null,
          reviewedById: admin.id,
          reviewedAt: new Date(),
        },
        omit: { storageKey: true },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: `document.${dto.decision.toLowerCase()}`,
          entityType: 'document',
          entityId: documentId,
          metadata: { ownerId: document.ownerId, type: document.type, reason: dto.reason ?? null },
        },
        tx,
      );
      return updated;
    });
  }

  // ─── Customers ───

  async listCustomers(query: PageQueryDto) {
    const where: Prisma.UserWhereInput = { customerProfile: { isNot: null }, ...searchFilter(query.search) };
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          ...USER_SUMMARY,
          customerProfile: { select: { customerCode: true, verificationLevel: true } },
          wallets: { where: { type: 'CUSTOMER' }, select: { balance: true } },
          _count: { select: { ordersAsCustomer: true } },
        },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async verifyCustomerId(userId: string, admin: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { customerProfile: { select: { userId: true } } } });
    if (!user?.customerProfile) throw new NotFoundException('Customer not found');
    const approved = await this.prisma.document.count({ where: { ownerId: userId, type: { in: CUSTOMER_ID_DOCUMENTS }, status: 'APPROVED' } });
    if (approved === 0) throw new BadRequestException('Approve an ID, passport or driving licence document first');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { idVerifiedAt: new Date() } });
      await this.users.recalculateCustomerLevel(userId, tx);
      await this.audit.log({ actorId: admin.id, action: 'customer.verify_id', entityType: 'user', entityId: userId }, tx);
    });
    return this.users.getMe(userId);
  }

  // ─── Account status ───

  async setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string | undefined, admin: AuthUser) {
    if (userId === admin.id) throw new ForbiddenException('You cannot change your own account status');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { staffProfile: { select: { role: true } } } });
    if (!target) throw new NotFoundException('User not found');
    if (target.staffProfile && admin.staffRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a super admin can change a staff account');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status } });
      if (status === 'SUSPENDED') {
        await tx.runnerProfile.updateMany({ where: { userId }, data: { isOnline: false } });
      }
      await this.audit.log(
        { actorId: admin.id, action: status === 'SUSPENDED' ? 'user.suspend' : 'user.activate', entityType: 'user', entityId: userId, metadata: { reason: reason ?? null } },
        tx,
      );
    });
    // Sign the suspended user out of every device.
    if (status === 'SUSPENDED') await this.tokens.revokeAllSessions(userId);
    return this.users.getMe(userId);
  }

  // ─── Activity logs ───

  async listAuditLogs(query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = { entityType: query.entityType, entityId: query.entityId };
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }
}
