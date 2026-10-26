import { Global, Injectable, Module } from '@nestjs/common';
import type { Server } from 'socket.io';

export const RUNNERS_ROOM = 'runners';
export const userRoom = (userId: string) => `user:${userId}`;
export const orderRoom = (orderId: string) => `order:${orderId}`;

/**
 * Sends live events to connected apps. Services call this after saving
 * changes; if nobody is connected the events are simply dropped, and apps
 * catch up the next time they load data.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  toUsers(userIds: (string | null | undefined)[], event: string, payload: unknown) {
    const rooms = userIds.filter((id): id is string => !!id).map(userRoom);
    if (this.server && rooms.length) this.server.to(rooms).emit(event, payload);
  }

  toOrder(orderId: string, event: string, payload: unknown) {
    this.server?.to(orderRoom(orderId)).emit(event, payload);
  }

  toAllRunners(event: string, payload: unknown) {
    this.server?.to(RUNNERS_ROOM).emit(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeServiceModule {}
