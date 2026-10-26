import { useQuery } from '@tanstack/react-query';

import { api } from './api';

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface TicketSummary {
  id: string;
  number: string;
  subject: string;
  status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  updatedAt: string;
}

export interface Ticket extends TicketSummary {
  orderId: string | null;
  messages: { id: string; body: string; fromStaff: boolean; createdAt: string; author: { firstName: string; lastName: string } }[];
}

export const supportKeys = {
  notifications: ['me', 'notifications'] as const,
  tickets: ['support', 'tickets'] as const,
  ticket: (id: string) => ['support', 'tickets', id] as const,
};

export const useNotifications = () =>
  useQuery({ queryKey: supportKeys.notifications, queryFn: () => api.get<InboxItem[]>('/me/notifications'), refetchInterval: 60_000 });

export const useTickets = () => useQuery({ queryKey: supportKeys.tickets, queryFn: () => api.get<TicketSummary[]>('/support/tickets') });

export const useTicket = (id: string) =>
  useQuery({ queryKey: supportKeys.ticket(id), queryFn: () => api.get<Ticket>(`/support/tickets/${id}`), refetchInterval: 30_000 });

/** Problem types customers and runners can report on an errand. */
export const DISPUTE_TYPES = [
  { value: 'ITEM_MISSING', label: 'Item missing' },
  { value: 'WRONG_ITEM', label: 'Wrong item' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'NOT_DELIVERED', label: 'Not delivered' },
  { value: 'OVERCHARGED', label: 'Overcharged' },
  { value: 'RUNNER_BEHAVIOUR', label: "Runner's behaviour" },
  { value: 'CUSTOMER_BEHAVIOUR', label: "Customer's behaviour" },
  { value: 'OTHER', label: 'Something else' },
] as const;
