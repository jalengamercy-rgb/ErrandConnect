import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { uniqueCode } from '../common/codes.js';
import { randomDigits } from '../common/crypto.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTicketDto, TicketListQueryDto, UpdateTicketDto } from './support.dto.js';

const MESSAGE_SELECT = {
  id: true,
  body: true,
  fromStaff: true,
  createdAt: true,
  author: { select: { id: true, firstName: true, lastName: true } },
} as const;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  async create(userId: string, dto: CreateTicketDto) {
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({ where: { id: dto.orderId, OR: [{ customerId: userId }, { runnerId: userId }] } });
      if (!order) throw new NotFoundException('Order not found');
    }
    const number = await uniqueCode(
      () => `T-${randomDigits(6)}`,
      async (code) => !!(await this.prisma.supportTicket.findUnique({ where: { number: code } })),
    );
    const ticket = await this.prisma.supportTicket.create({
      data: { number, userId, orderId: dto.orderId, subject: dto.subject, messages: { create: { authorId: userId, body: dto.message } } },
    });
    return this.getForUser(ticket.id, userId);
  }

  listForUser(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, number: true, subject: true, status: true, updatedAt: true },
    });
  }

  async getForUser(id: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, userId },
      select: {
        id: true,
        number: true,
        subject: true,
        status: true,
        orderId: true,
        createdAt: true,
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  /** A reply from the user reopens the ticket for staff. */
  async replyAsUser(id: string, userId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id, userId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'CLOSED') throw new BadRequestException('This ticket is closed. Please open a new one');
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'OPEN', messages: { create: { authorId: userId, body: message } } },
    });
    return this.getForUser(id, userId);
  }

  // ─── Staff ───

  async list(query: TicketListQueryDto, staff: AuthUser) {
    const where: Prisma.SupportTicketWhereInput = {
      status: query.status,
      ...(query.assigned === 'me' ? { assignedToId: staff.id } : query.assigned === 'unassigned' ? { assignedToId: null } : {}),
      ...(query.search
        ? { OR: [{ number: { contains: query.search } }, { subject: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        // Most urgent first, then oldest.
        orderBy: [{ priority: 'desc' }, { updatedAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, phone: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          order: { select: { id: true, orderNumber: true } },
        },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items };
  }

  async getForStaff(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  /** Staff reply: waits for the user (PENDING) and notifies them. */
  async replyAsStaff(id: string, staff: AuthUser, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: 'PENDING',
        assignedToId: ticket.assignedToId ?? staff.id,
        messages: { create: { authorId: staff.id, body: message, fromStaff: true } },
      },
    });
    await this.inbox.notify([ticket.userId], {
      title: `Support replied: ${ticket.subject}`,
      body: message.slice(0, 200),
      link: `/support/${id}`,
    });
    return this.getForStaff(id);
  }

  async update(id: string, dto: UpdateTicketDto) {
    if (dto.assignedToId) {
      const staff = await this.prisma.staffProfile.findUnique({ where: { userId: dto.assignedToId } });
      if (!staff) throw new BadRequestException('Tickets can only be assigned to staff');
    }
    await this.prisma.supportTicket.update({ where: { id }, data: dto }).catch(() => {
      throw new NotFoundException('Ticket not found');
    });
    return this.getForStaff(id);
  }
}
