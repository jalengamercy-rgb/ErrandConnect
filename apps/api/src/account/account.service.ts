import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ACTIVE_ORDER_STATUSES } from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import { verifySecret } from '../common/crypto.js';
import { StorageService } from '../documents/storage.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The person's rights under Kenya's Data Protection Act (and app store rules):
 * get a copy of their data, and delete their account.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger('Account');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Everything we hold about the person, as JSON. */
  async export(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      omit: { passwordHash: true, pinHash: true, failedLoginCount: true, lockedUntil: true },
      include: {
        customerProfile: true,
        runnerProfile: { include: { vehicles: true } },
        addresses: true,
        emergencyContacts: true,
        payoutMethods: true,
        consents: true,
        businessMembers: { include: { business: { select: { name: true } } } },
        merchantMembers: { include: { merchant: { select: { name: true } } } },
        documents: { select: { id: true, type: true, status: true, createdAt: true } },
        sessions: { select: { deviceName: true, ipAddress: true, createdAt: true, revokedAt: true } },
        subscription: true,
        loyaltyEvents: true,
      },
    });
    const orderFields = {
      orderNumber: true,
      status: true,
      description: true,
      categorySlug: true,
      pickupAddress: true,
      dropoffAddress: true,
      recipientName: true,
      recipientPhone: true,
      total: true,
      runnerEarnings: true,
      paymentMethod: true,
      createdAt: true,
      completedAt: true,
      cancelledAt: true,
    } as const;
    const wallets = await this.prisma.wallet.findMany({ where: { userId }, select: { id: true, type: true, balance: true } });
    const [ordersAsCustomer, ordersAsRunner, reviewsGiven, reviewsReceived, ledger, withdrawals, tickets, messages, notifications] =
      await Promise.all([
        this.prisma.order.findMany({ where: { customerId: userId }, select: orderFields, orderBy: { createdAt: 'desc' } }),
        this.prisma.order.findMany({ where: { runnerId: userId }, select: orderFields, orderBy: { createdAt: 'desc' } }),
        this.prisma.review.findMany({ where: { authorId: userId }, select: { stars: true, comment: true, createdAt: true } }),
        this.prisma.review.findMany({ where: { subjectId: userId }, select: { stars: true, comment: true, createdAt: true } }),
        this.prisma.ledgerEntry.findMany({
          where: { walletId: { in: wallets.map((w) => w.id) } },
          select: { amount: true, createdAt: true, transaction: { select: { type: true, description: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.withdrawal.findMany({ where: { wallet: { userId } }, omit: { walletId: true, reviewedById: true } }),
        this.prisma.supportTicket.findMany({
          where: { userId },
          include: { messages: { select: { body: true, fromStaff: true, createdAt: true } } },
        }),
        this.prisma.orderMessage.findMany({
          where: { senderId: userId },
          select: { body: true, createdAt: true, order: { select: { orderNumber: true } } },
        }),
        this.prisma.notification.findMany({ where: { userId }, select: { title: true, body: true, createdAt: true, readAt: true } }),
      ]);
    return {
      exportedAt: new Date(),
      note: 'Your ErrandCONNECT data. Documents you uploaded can be downloaded in the app; their details are listed here.',
      account: user,
      wallets: wallets.map(({ id: _id, ...w }) => w),
      walletTransactions: ledger.map((e) => ({
        amount: e.amount,
        type: e.transaction.type,
        description: e.transaction.description,
        at: e.createdAt,
      })),
      withdrawals,
      ordersAsCustomer,
      ordersAsRunner,
      reviewsGiven,
      reviewsReceived,
      chatMessages: messages,
      supportTickets: tickets,
      notifications,
    };
  }

  /**
   * Deletes the account: personal details are erased and the person is signed
   * out everywhere. Records of past errands and payments are kept (without the
   * person's details) because the law requires financial records.
   */
  async delete(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { staffProfile: true, businessMembers: true, merchantMembers: true, documents: true },
    });
    if (!(await verifySecret(password, user.passwordHash))) throw new UnauthorizedException('Incorrect password');
    if (user.staffProfile) throw new ForbiddenException('Staff accounts are removed by a super admin');
    if (user.businessMembers.some((m) => m.role === 'OWNER') || user.merchantMembers.some((m) => m.role === 'OWNER')) {
      throw new ConflictException('You own a company or shop account. Contact support to close or hand it over first');
    }
    const [activeOrders, openDisputes, wallets, pendingWithdrawals] = await Promise.all([
      this.prisma.order.count({
        where: { OR: [{ customerId: userId }, { runnerId: userId }], status: { in: [...ACTIVE_ORDER_STATUSES, 'DISPUTED'] } },
      }),
      this.prisma.dispute.count({ where: { raisedById: userId, status: 'OPEN' } }),
      this.prisma.wallet.findMany({ where: { userId }, select: { type: true, balance: true } }),
      this.prisma.withdrawal.count({ where: { wallet: { userId }, status: { in: ['REQUESTED', 'APPROVED', 'ON_HOLD'] } } }),
    ]);
    if (activeOrders > 0) throw new ConflictException('Finish or cancel your errands in progress first');
    if (openDisputes > 0) throw new ConflictException('Wait until support has resolved the problems you reported');
    if (pendingWithdrawals > 0) throw new ConflictException('Wait for your withdrawals to be paid first');
    const owed = wallets.find((w) => w.balance < 0);
    if (owed)
      throw new ConflictException(
        `Your ${owed.type.toLowerCase()} wallet owes KES ${(-owed.balance).toLocaleString('en-KE')}. Clear it first`,
      );
    const left = wallets.find((w) => w.balance > 0);
    if (left) {
      throw new BadRequestException(
        `Withdraw the KES ${left.balance.toLocaleString('en-KE')} in your ${left.type.toLowerCase()} wallet first`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          // Frees the phone number so the person could sign up again later.
          phone: `deleted:${userId}`,
          email: null,
          whatsapp: null,
          altPhone: null,
          firstName: 'Deleted',
          middleName: null,
          lastName: 'user',
          dateOfBirth: null,
          gender: null,
          nationality: null,
          photoUrl: null,
          passwordHash: null,
          pinHash: null,
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });
      await tx.runnerProfile.updateMany({
        where: { userId },
        data: {
          nationalIdNumber: null,
          kraPin: null,
          previousCompany: null,
          isOnline: false,
          lastLat: null,
          lastLng: null,
          applicationStatus: 'REJECTED',
          rejectionReason: 'Account deleted',
        },
      });
      await tx.vehicle.deleteMany({ where: { runner: { userId } } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.emergencyContact.deleteMany({ where: { userId } });
      await tx.payoutMethod.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.businessMember.deleteMany({ where: { userId } });
      await tx.merchantMember.deleteMany({ where: { userId } });
      await tx.orderMessage.updateMany({ where: { senderId: userId }, data: { body: '[deleted]' } });
      await tx.subscription.updateMany({ where: { userId }, data: { status: 'EXPIRED', autoRenew: false } });
      await tx.document.deleteMany({ where: { ownerId: userId } });
      await tx.session.deleteMany({ where: { userId } });
      await this.audit.log({ actorId: userId, action: 'account.delete', entityType: 'user', entityId: userId }, tx);
    });
    // Files go last: if this fails, only orphaned files are left (logged for cleanup).
    for (const document of user.documents) {
      await this.storage
        .remove(document.storageKey)
        .catch((error: Error) => this.logger.error(`Could not delete file ${document.storageKey}: ${error.message}`));
    }
    return { deleted: true };
  }
}
