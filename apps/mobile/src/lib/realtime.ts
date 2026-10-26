import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';

import { API_URL, session } from './api';
import { ME_QUERY_KEY } from './auth-context';
import { orderKeys } from './orders';
import type { ChatMessage, Order } from './types';

/**
 * Keeps a live connection to the API while logged in and refreshes the
 * affected screens when something changes (new job, status change, chat,
 * runner location). Screens also refresh on their own every so often, so
 * nothing is missed if the connection drops.
 */
export function useRealtime(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const socket: Socket = io(API_URL, {
      // Read the token on every (re)connect, so a refreshed token is used.
      auth: (cb) => cb({ token: session.accessToken() }),
      transports: ['websocket'],
    });
    attachHandlers(socket, queryClient);
    return () => {
      socket.disconnect();
    };
  }, [enabled, queryClient]);
}

function attachHandlers(socket: Socket, queryClient: QueryClient) {
  socket.on('job.new', () => queryClient.invalidateQueries({ queryKey: orderKeys.jobs }));
  socket.on('job.taken', () => queryClient.invalidateQueries({ queryKey: orderKeys.jobs }));

  socket.on('order.updated', ({ orderId }: { orderId: string }) => {
    queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    queryClient.invalidateQueries({ queryKey: orderKeys.lists });
    queryClient.invalidateQueries({ queryKey: orderKeys.jobs });
    queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  });

  socket.on('order.message', ({ orderId, message }: { orderId: string; message: ChatMessage }) => {
    queryClient.setQueryData<ChatMessage[]>(orderKeys.messages(orderId), (old) =>
      old && !old.some((m) => m.id === message.id) ? [...old, message] : old,
    );
  });

  socket.on('runner.location', ({ orderId, lat, lng, at }: { orderId: string; lat: number; lng: number; at: string }) => {
    queryClient.setQueryData<Order>(orderKeys.detail(orderId), (order) =>
      order?.runner ? { ...order, runner: { ...order.runner, location: { lat, lng, at } } } : order,
    );
  });
}
