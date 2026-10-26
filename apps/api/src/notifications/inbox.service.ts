import { Controller, Get, Global, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export interface InboxMessage {
  title: string;
  body: string;
  /** App route to open when tapped, e.g. /orders/123 */
  link?: string;
}

/** In-app notifications: saved to the user's inbox and pushed live if they're online. */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async notify(userIds: string[], message: InboxMessage) {
    if (userIds.length === 0) return 0;
    // Insert in batches so a broadcast to many users doesn't build one huge query.
    for (let i = 0; i < userIds.length; i += 1000) {
      await this.prisma.notification.createMany({ data: userIds.slice(i, i + 1000).map((userId) => ({ userId, ...message })) });
    }
    this.realtime.toUsers(userIds, 'notification.new', message);
    return userIds.length;
  }

  list(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, omit: { userId: true } });
  }

  async markRead(userId: string, id?: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }
}

@Controller('me/notifications')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.inbox.list(user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.inbox.markRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.markRead(user.id, id);
  }
}

@Global()
@Module({ controllers: [InboxController], providers: [InboxService], exports: [InboxService] })
export class InboxModule {}
