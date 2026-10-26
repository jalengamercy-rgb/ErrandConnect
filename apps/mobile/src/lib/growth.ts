import { useQuery } from '@tanstack/react-query';

import { api } from './api';

export interface Rewards {
  loyalty: {
    enabled: boolean;
    points: number;
    lifetimePoints: number;
    tier: string;
    nextTier: string | null;
    pointsToNext: number;
    pointsPer100: number;
    valuePer100Points: number;
    minRedeemPoints: number;
    redeemableValue: number;
    history: { id: string; points: number; reason: string; createdAt: string }[];
  };
  referral: {
    enabled: boolean;
    code: string;
    referrerReward: number;
    refereeReward: number;
    invited: number;
    rewarded: number;
    earned: number;
  };
}

export interface Plus {
  available: boolean;
  price: number;
  periodDays: number;
  benefits: string[];
  active: boolean;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | null;
  currentPeriodEnd: string | null;
  autoRenew: boolean;
  pendingPayment: { status: string; failureReason: string | null } | null;
}

export interface Banner {
  id: string;
  title: string;
  body: string | null;
  merchantId: string | null;
  categorySlug: string | null;
  url: string | null;
}

export const growthKeys = {
  rewards: ['me', 'rewards'] as const,
  plus: ['me', 'plus'] as const,
  banners: ['banners'] as const,
};

export const useRewards = () => useQuery({ queryKey: growthKeys.rewards, queryFn: () => api.get<Rewards>('/me/rewards') });

/** With `poll`, checks every few seconds until the membership is active (after an M-Pesa prompt). */
export const usePlus = (poll = false) =>
  useQuery({
    queryKey: growthKeys.plus,
    queryFn: () => api.get<Plus>('/me/plus'),
    refetchInterval: (query) => (poll && !query.state.data?.active ? 4_000 : false),
  });

export const useBanners = () =>
  useQuery({ queryKey: growthKeys.banners, queryFn: () => api.get<Banner[]>('/banners'), staleTime: 5 * 60_000 });
