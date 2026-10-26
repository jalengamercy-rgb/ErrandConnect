import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../common/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, RUNNERS_ROOM, orderRoom, userRoom } from './realtime.service.js';

/**
 * Socket.IO endpoint for live updates. Apps connect with
 * `io(API_URL, { auth: { token: accessToken } })` and then receive events
 * such as order.updated, order.message, runner.location and job.new.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      if (payload.typ !== 'access') throw new Error('wrong token type');
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: { revokedAt: true, user: { select: { id: true, status: true, runnerProfile: { select: { userId: true } } } } },
      });
      if (!session || session.revokedAt || session.user.status !== 'ACTIVE') throw new Error('session not active');

      socket.data.userId = session.user.id;
      await socket.join(userRoom(session.user.id));
      if (session.user.runnerProfile) await socket.join(RUNNERS_ROOM);
    } catch {
      socket.emit('error', { message: 'Unauthorized' });
      socket.disconnect(true);
    }
  }

  /** Start receiving live updates (location, chat) for one order the user is part of. */
  @SubscribeMessage('order.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { orderId?: string }) {
    const userId = socket.data.userId as string | undefined;
    if (!userId || typeof body?.orderId !== 'string') return { ok: false };
    const order = await this.prisma.order
      .findFirst({ where: { id: body.orderId, OR: [{ customerId: userId }, { runnerId: userId }] }, select: { id: true } })
      .catch(() => null);
    if (!order) return { ok: false };
    await socket.join(orderRoom(order.id));
    return { ok: true };
  }

  @SubscribeMessage('order.unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { orderId?: string }) {
    if (typeof body?.orderId === 'string') await socket.leave(orderRoom(body.orderId));
    return { ok: true };
  }
}
