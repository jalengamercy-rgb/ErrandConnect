import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect } from 'react';

import { api } from './api';
import type { ChatMessage, Job, Order, OrderSummary } from './types';

export const orderKeys = {
  lists: ['orders'] as const,
  list: (role: 'customer' | 'runner', scope: 'active' | 'past') => ['orders', role, scope] as const,
  detail: (id: string) => ['order', id] as const,
  messages: (id: string) => ['order', id, 'messages'] as const,
  jobs: ['runner', 'jobs'] as const,
};

// Live updates arrive over the socket; these intervals are a safety net.
const POLL_MS = 20_000;

export const useOrder = (id: string) =>
  useQuery({ queryKey: orderKeys.detail(id), queryFn: () => api.get<Order>(`/orders/${id}`), refetchInterval: POLL_MS });

export const useCustomerOrders = (scope: 'active' | 'past', enabled = true) =>
  useQuery({ queryKey: orderKeys.list('customer', scope), queryFn: () => api.get<OrderSummary[]>(`/orders?scope=${scope}`), enabled });

export const useRunnerOrders = (scope: 'active' | 'past', enabled = true) =>
  useQuery({
    queryKey: orderKeys.list('runner', scope),
    queryFn: () => api.get<OrderSummary[]>(`/runners/me/orders?scope=${scope}`),
    enabled,
  });

export const useJobs = (enabled: boolean) =>
  useQuery({ queryKey: orderKeys.jobs, queryFn: () => api.get<Job[]>('/runners/me/jobs'), enabled, refetchInterval: POLL_MS });

export const useMessages = (orderId: string) =>
  useQuery({ queryKey: orderKeys.messages(orderId), queryFn: () => api.get<ChatMessage[]>(`/orders/${orderId}/messages`), refetchInterval: POLL_MS });

export function formatKes(amount: number) {
  return `KES ${amount.toLocaleString('en-KE')}`;
}

/** Opens Google Maps with directions to a point (works on Android, iOS and web). */
export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function mapUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** While a runner is online, sends their position to the API so customers can track them. */
export function useRunnerLocationReporting(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted || cancelled) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 25 },
        (position) => {
          api.put('/runners/me/location', { lat: position.coords.latitude, lng: position.coords.longitude }).catch(() => undefined);
        },
      );
      if (cancelled) subscription.remove();
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);
}
