import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVE_ORDER_STATUSES } from '@errandconnect/shared';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import type { OrgMemberRole, Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddressDto } from '../users/users.dto.js';
import type {
  AddMemberDto,
  AdminUpdateBusinessDto,
  ApproveBusinessDto,
  BulkOrderDto,
  BusinessListQueryDto,
  BusinessOrdersQueryDto,
  RegisterBusinessDto,
  UpdateBusinessDto,
  UpdateMemberDto,
} from './businesses.dto.js';

const MEMBER_USER = { select: { id: true, firstName: true, lastName: true, phone: true, email: true } } as const;
const MAX_BRANCHES = 50;

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  // ─── Access ───

  /** The caller's membership, optionally requiring owner/admin. */
  private async membership(businessId: string, userId: string, manage = false) {
    const member = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId } },
      include: { business: true },
    });
    if (!member) throw new NotFoundException('Company not found');
    if (manage && member.role === 'MEMBER') throw new ForbiddenException('Only company owners and admins can do this');
    return member;
  }

  /** Credit used = how far the company wallet is below zero. */
  private async creditUsed(businessId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { type_businessId: { type: 'BUSINESS', businessId } } });
    return Math.max(0, -(wallet?.balance ?? 0));
  }

  // ─── Registration and profile ───

  async register(userId: string, dto: RegisterBusinessDto) {
    const existing = await this.prisma.businessMember.count({
      where: { userId, role: 'OWNER', business: { status: { in: ['PENDING', 'ACTIVE'] } } },
    });
    if (existing >= 3) throw new ConflictException('You already own the maximum number of company accounts');
    const { position, ...data } = dto;
    const business = await this.prisma.business.create({
      data: { ...data, members: { create: { userId, role: 'OWNER', position } } },
    });
    await this.audit.log({ actorId: userId, action: 'business.register', entityType: 'business', entityId: business.id });
    return business;
  }

  async mine(userId: string) {
    const memberships = await this.prisma.businessMember.findMany({
      where: { userId },
      include: { business: { select: { id: true, name: true, status: true, monthlyInvoicing: true, creditLimit: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ ...m.business, role: m.role, approvalLimit: m.approvalLimit }));
  }

  async get(businessId: string, userId: string) {
    const me = await this.membership(businessId, userId);
    const manage = me.role !== 'MEMBER';
    const [members, branches, creditUsed, pendingApprovals] = await Promise.all([
      this.prisma.businessMember.findMany({ where: { businessId }, include: { user: MEMBER_USER }, orderBy: { createdAt: 'asc' } }),
      this.prisma.address.findMany({ where: { businessId }, orderBy: { label: 'asc' } }),
      this.creditUsed(businessId),
      manage ? this.prisma.order.count({ where: { businessId, status: 'PENDING_APPROVAL' } }) : 0,
    ]);
    return {
      ...me.business,
      myRole: me.role,
      myApprovalLimit: me.approvalLimit,
      creditUsed,
      creditAvailable: Math.max(0, me.business.creditLimit - creditUsed),
      pendingApprovals,
      // Members see who is on the team but only managers see contact details.
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        position: m.position,
        approvalLimit: m.approvalLimit,
        user: manage ? m.user : { ...m.user, phone: undefined, email: undefined },
      })),
      branches,
    };
  }

  async update(businessId: string, userId: string, dto: UpdateBusinessDto) {
    await this.membership(businessId, userId, true);
    return this.prisma.business.update({ where: { id: businessId }, data: dto });
  }

  // ─── Team ───

  async addMember(businessId: string, actor: string, dto: AddMemberDto) {
    const me = await this.membership(businessId, actor, true);
    if (dto.role === 'ADMIN' && me.role !== 'OWNER') throw new ForbiddenException('Only the owner can add admins');
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user) throw new NotFoundException('No ErrandCONNECT account with that phone number. Ask them to sign up first');
    const exists = await this.prisma.businessMember.findUnique({ where: { businessId_userId: { businessId, userId: user.id } } });
    if (exists) throw new ConflictException('This person is already on the team');
    await this.prisma.businessMember.create({
      data: { businessId, userId: user.id, role: dto.role, position: dto.position, approvalLimit: dto.approvalLimit ?? null },
    });
    await this.inbox.notify([user.id], {
      title: `You joined ${me.business.name}`,
      body: 'You can now place errands on the company account.',
      link: `/business/${businessId}`,
    });
    await this.audit.log({
      actorId: actor,
      action: 'business.member.add',
      entityType: 'business',
      entityId: businessId,
      metadata: { userId: user.id, role: dto.role },
    });
    return this.get(businessId, actor);
  }

  async updateMember(businessId: string, actor: string, userId: string, dto: UpdateMemberDto) {
    const me = await this.membership(businessId, actor, true);
    const target = await this.membership(businessId, userId);
    this.assertCanManage(me.role, target.role, dto.role);
    await this.prisma.businessMember.update({
      where: { businessId_userId: { businessId, userId } },
      data: { role: dto.role, position: dto.position, approvalLimit: dto.approvalLimit },
    });
    await this.audit.log({
      actorId: actor,
      action: 'business.member.update',
      entityType: 'business',
      entityId: businessId,
      metadata: { userId, ...dto },
    });
    return this.get(businessId, actor);
  }

  async removeMember(businessId: string, actor: string, userId: string) {
    const me = await this.membership(businessId, actor, actor !== userId);
    const target = actor === userId ? me : await this.membership(businessId, userId);
    if (target.role === 'OWNER') throw new BadRequestException('The owner cannot be removed from the company');
    if (actor !== userId) this.assertCanManage(me.role, target.role);
    await this.prisma.businessMember.delete({ where: { businessId_userId: { businessId, userId } } });
    await this.audit.log({
      actorId: actor,
      action: 'business.member.remove',
      entityType: 'business',
      entityId: businessId,
      metadata: { userId },
    });
    return { removed: true };
  }

  /** Owners manage everyone; admins manage members only and cannot promote to admin. */
  private assertCanManage(actorRole: OrgMemberRole, targetRole: OrgMemberRole, newRole?: OrgMemberRole) {
    if (targetRole === 'OWNER') throw new ForbiddenException('The owner cannot be changed here');
    if (actorRole === 'ADMIN' && (targetRole === 'ADMIN' || newRole === 'ADMIN')) {
      throw new ForbiddenException('Only the owner can manage admins');
    }
  }

  // ─── Branches (company delivery addresses) ───

  async addBranch(businessId: string, actor: string, dto: AddressDto) {
    await this.membership(businessId, actor, true);
    const count = await this.prisma.address.count({ where: { businessId } });
    if (count >= MAX_BRANCHES) throw new BadRequestException(`A company can have up to ${MAX_BRANCHES} branches`);
    const { isDefault: _isDefault, ...data } = dto;
    return this.prisma.address.create({ data: { ...data, businessId } });
  }

  async removeBranch(businessId: string, actor: string, addressId: string) {
    await this.membership(businessId, actor, true);
    const { count } = await this.prisma.address.deleteMany({ where: { id: addressId, businessId } });
    if (count === 0) throw new NotFoundException('Branch not found');
    return { deleted: true };
  }

  // ─── Orders ───

  /** Owners/admins see every company errand; members see their own. */
  async listOrders(businessId: string, userId: string, query: BusinessOrdersQueryDto) {
    const me = await this.membership(businessId, userId);
    const where: Prisma.OrderWhereInput = {
      businessId,
      ...(me.role === 'MEMBER' ? { customerId: userId } : {}),
      ...(query.view === 'PENDING_APPROVAL'
        ? { status: 'PENDING_APPROVAL' }
        : query.view === 'ACTIVE'
          ? { status: { in: [...ACTIVE_ORDER_STATUSES] } }
          : query.view === 'PAST'
            ? { status: { notIn: [...ACTIVE_ORDER_STATUSES] } }
            : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          description: true,
          total: true,
          paymentMethod: true,
          dropoffAddress: true,
          scheduledFor: true,
          createdAt: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  /**
   * Many deliveries from one pickup, billed to the company. Checks the whole
   * batch fits in the available credit before creating anything.
   */
  async bulkOrder(businessId: string, userId: string, dto: BulkOrderDto) {
    const me = await this.membership(businessId, userId);
    if (me.business.status !== 'ACTIVE') throw new ForbiddenException('This company account is not active yet');
    if (!me.business.monthlyInvoicing)
      throw new BadRequestException('Bulk orders are billed by invoice. Ask ErrandCONNECT to enable monthly invoicing');
    if (me.role === 'MEMBER') throw new ForbiddenException('Only company owners and admins can place bulk orders');

    const base = { categorySlug: dto.categorySlug, pickup: dto.pickup, deliveryType: dto.deliveryType, urgency: dto.urgency, businessId };
    const quotes = [];
    for (const [index, item] of dto.items.entries()) {
      if (!item.dropoffAddressId && !item.dropoff) throw new BadRequestException(`Delivery ${index + 1} needs a drop-off location`);
      const { quote } = await this.orders.quote(userId, {
        ...base,
        dropoffAddressId: item.dropoffAddressId,
        dropoff: item.dropoff,
        itemsCost: item.itemsCost,
      });
      quotes.push(quote.customer.total);
    }
    const batchTotal = quotes.reduce((sum, t) => sum + t, 0);
    const available = me.business.creditLimit - (await this.creditUsed(businessId));
    if (batchTotal > available) {
      throw new BadRequestException(
        `This batch costs KES ${batchTotal.toLocaleString('en-KE')} but only KES ${Math.max(0, available).toLocaleString('en-KE')} of company credit is available`,
      );
    }

    const created = [];
    for (const item of dto.items) {
      created.push(
        await this.orders.create(userId, {
          ...base,
          ...item,
          scheduledFor: dto.scheduledFor,
          paymentMethod: 'BUSINESS_INVOICE',
        }),
      );
    }
    return {
      count: created.length,
      total: batchTotal,
      orders: created.map((o) => ({ id: o.id, orderNumber: o.orderNumber, total: o.total, status: o.status })),
    };
  }

  // ─── Admin ───

  async adminList(query: BusinessListQueryDto) {
    const where: Prisma.BusinessWhereInput = {
      status: query.status,
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { registrationNumber: { contains: query.search } }] }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.business.count({ where }),
      this.prisma.business.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { members: true, orders: true } } },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async adminGet(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        members: { include: { user: MEMBER_USER }, orderBy: { createdAt: 'asc' } },
        addresses: true,
        invoices: { orderBy: { createdAt: 'desc' }, take: 12 },
        _count: { select: { orders: true } },
      },
    });
    if (!business) throw new NotFoundException('Company not found');
    const owner = business.members.find((m) => m.role === 'OWNER');
    const [creditUsed, documents, spend] = await Promise.all([
      this.creditUsed(businessId),
      owner
        ? this.prisma.document.findMany({
            where: { ownerId: owner.userId, type: 'BUSINESS_REGISTRATION' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, type: true, status: true, mimeType: true, createdAt: true },
          })
        : [],
      this.prisma.order.aggregate({ where: { businessId, status: 'COMPLETED' }, _sum: { total: true } }),
    ]);
    return { ...business, creditUsed, documents, completedSpend: spend._sum.total ?? 0 };
  }

  async approve(businessId: string, dto: ApproveBusinessDto, admin: AuthUser) {
    const isFinance = admin.staffRole === 'FINANCE_MANAGER' || admin.staffRole === 'SUPER_ADMIN';
    const business = await this.setStatus(businessId, 'ACTIVE', admin, isFinance ? dto : {}, ['PENDING', 'SUSPENDED', 'REJECTED']);
    await this.notifyOwners(
      businessId,
      'Company account approved',
      `${business.name} can now place errands${business.monthlyInvoicing ? ' and pay by monthly invoice' : ''}.`,
    );
    return business;
  }

  async reject(businessId: string, reason: string, admin: AuthUser) {
    const business = await this.setStatus(businessId, 'REJECTED', admin, { reason }, ['PENDING']);
    await this.notifyOwners(businessId, 'Company account not approved', reason);
    return business;
  }

  async suspend(businessId: string, reason: string, admin: AuthUser) {
    const business = await this.setStatus(businessId, 'SUSPENDED', admin, { reason }, ['ACTIVE']);
    await this.notifyOwners(businessId, 'Company account suspended', reason);
    return business;
  }

  async adminUpdate(businessId: string, dto: AdminUpdateBusinessDto, admin: AuthUser) {
    const business = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({ where: { id: businessId }, data: dto });
      await this.audit.log(
        { actorId: admin.id, action: 'business.update', entityType: 'business', entityId: businessId, metadata: { ...dto } },
        tx,
      );
      return updated;
    });
    return business;
  }

  private async setStatus(
    businessId: string,
    status: 'ACTIVE' | 'REJECTED' | 'SUSPENDED',
    admin: AuthUser,
    data: Partial<ApproveBusinessDto> & { reason?: string },
    from: ('PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED')[],
  ) {
    const { reason, ...fields } = data;
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.business.updateMany({ where: { id: businessId, status: { in: from } }, data: { status, ...fields } });
      if (count === 0) throw new ConflictException(`This company cannot be moved to ${status.toLowerCase()} from its current status`);
      await this.audit.log(
        {
          actorId: admin.id,
          action: `business.${status.toLowerCase()}`,
          entityType: 'business',
          entityId: businessId,
          metadata: { reason, ...fields },
        },
        tx,
      );
      return tx.business.findUniqueOrThrow({ where: { id: businessId } });
    });
  }

  private async notifyOwners(businessId: string, title: string, body: string) {
    const managers = await this.prisma.businessMember.findMany({
      where: { businessId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    });
    await this.inbox.notify(
      managers.map((m) => m.userId),
      { title, body, link: `/business/${businessId}` },
    );
  }
}
