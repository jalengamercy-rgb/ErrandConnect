import { Injectable } from '@nestjs/common';
import { haversineKm, surgeMultiplierFor, type SurgeConfig } from '@errandconnect/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/** Runners count as available if they were seen in the last 10 minutes. */
const RUNNER_FRESH_MS = 10 * 60_000;
/** Open errands older than this are probably stuck, not demand. */
const DEMAND_WINDOW_MS = 60 * 60_000;

/** How busy an area is: open errands vs online runners nearby. */
@Injectable()
export class SurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async multiplierAt(point: { lat: number; lng: number }, surge: SurgeConfig) {
    if (!surge.enabled) return { multiplier: 1, openErrands: 0, onlineRunners: 0 };
    // Rough box first so the database does the filtering, then exact distance.
    const dLat = surge.radiusKm / 111;
    const dLng = surge.radiusKm / (111 * Math.cos((point.lat * Math.PI) / 180));
    const box = { gte: point.lat - dLat, lte: point.lat + dLat };
    const lngBox = { gte: point.lng - dLng, lte: point.lng + dLng };
    const [orders, runners] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: new Date(Date.now() - DEMAND_WINDOW_MS) },
          OR: [
            { pickupLat: box, pickupLng: lngBox },
            { pickupLat: null, dropoffLat: box, dropoffLng: lngBox },
          ],
        },
        select: { pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true },
      }),
      this.prisma.runnerProfile.findMany({
        where: {
          applicationStatus: 'APPROVED',
          isOnline: true,
          lastSeenAt: { gte: new Date(Date.now() - RUNNER_FRESH_MS) },
          lastLat: box,
          lastLng: lngBox,
        },
        select: { lastLat: true, lastLng: true },
      }),
    ]);
    const near = (lat: number, lng: number) => haversineKm(point, { lat, lng }) <= surge.radiusKm;
    const openErrands = orders.filter((o) => near(o.pickupLat ?? o.dropoffLat, o.pickupLng ?? o.dropoffLng)).length;
    const onlineRunners = runners.filter((r) => near(r.lastLat!, r.lastLng!)).length;
    return { multiplier: surgeMultiplierFor(openErrands, onlineRunners, surge), openErrands, onlineRunners };
  }
}
