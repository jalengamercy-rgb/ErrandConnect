import { Injectable } from '@nestjs/common';
import { DEFAULT_JOB_RADIUS_KM, haversineKm } from '@errandconnect/shared';
import type { Order, OrderStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from './realtime.service.js';

/** Where a runner starts an errand: the pickup point, or the drop-off if there is none. */
export function jobStart(order: Pick<Order, 'pickupLat' | 'pickupLng' | 'dropoffLat' | 'dropoffLng'>) {
  return order.pickupLat != null && order.pickupLng != null
    ? { lat: order.pickupLat, lng: order.pickupLng }
    : { lat: order.dropoffLat, lng: order.dropoffLng };
}

/** Live notifications about orders, shared by the orders and payments code. */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  orderUpdated(orderId: string, customerId: string, runnerId: string | null, status: OrderStatus) {
    const payload = { orderId, status };
    this.realtime.toUsers([customerId, runnerId], 'order.updated', payload);
    this.realtime.toOrder(orderId, 'order.updated', payload);
  }

  jobTaken(orderId: string) {
    this.realtime.toAllRunners('job.taken', { orderId });
  }

  /** Tells online runners who could take this job that it exists. */
  async newJob(order: Order) {
    const runners = await this.prisma.runnerProfile.findMany({
      where: {
        applicationStatus: 'APPROVED',
        isOnline: true,
        userId: { not: order.customerId },
        deliveryTypes: { has: order.deliveryType },
        servicesOffered: { has: order.categorySlug },
        lastLat: { not: null },
      },
      select: { userId: true, lastLat: true, lastLng: true, maxDistanceKm: true },
    });
    const start = jobStart(order);
    const nearby = runners.filter((r) => haversineKm({ lat: r.lastLat!, lng: r.lastLng! }, start) <= (r.maxDistanceKm ?? DEFAULT_JOB_RADIUS_KM));
    this.realtime.toUsers(nearby.map((r) => r.userId), 'job.new', { orderId: order.id });
  }
}
