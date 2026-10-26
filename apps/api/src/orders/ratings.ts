import type { Prisma } from '../generated/prisma/client.js';

/**
 * Recomputes a runner's average rating from visible reviews written about
 * them *as a runner* (not reviews they got as a customer).
 */
export async function recalculateRunnerRating(tx: Prisma.TransactionClient, runnerId: string) {
  const stats = await tx.review.aggregate({
    where: { subjectId: runnerId, isHidden: false, order: { runnerId } },
    _avg: { stars: true },
    _count: true,
  });
  await tx.runnerProfile.update({
    where: { userId: runnerId },
    data: { ratingAvg: Math.round((stats._avg.stars ?? 0) * 100) / 100, ratingCount: stats._count },
  });
}
