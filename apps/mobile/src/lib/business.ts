import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import type { Address, OrderStatus } from './types';

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type OrgStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export interface MyBusiness {
  id: string;
  name: string;
  status: OrgStatus;
  monthlyInvoicing: boolean;
  creditLimit: number;
  role: OrgRole;
  approvalLimit: number | null;
}

export interface Business {
  id: string;
  name: string;
  status: OrgStatus;
  industry: string | null;
  billingEmail: string | null;
  creditLimit: number;
  monthlyInvoicing: boolean;
  creditUsed: number;
  creditAvailable: number;
  pendingApprovals: number;
  myRole: OrgRole;
  myApprovalLimit: number | null;
  members: {
    userId: string;
    role: OrgRole;
    position: string | null;
    approvalLimit: number | null;
    user: { id: string; firstName: string; lastName: string; phone?: string };
  }[];
  branches: Address[];
}

export interface CompanyOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  description: string;
  total: number;
  dropoffAddress: string;
  createdAt: string;
  customer: { id: string; firstName: string; lastName: string };
}

export interface Shop {
  id: string;
  name: string;
  categorySlug: string;
  phone: string | null;
  addressLine: string | null;
  lat: number;
  lng: number;
  description: string | null;
  isFeatured: boolean;
  ratingAvg: number;
  ratingCount: number;
  distanceKm: number | null;
}

export interface MyShop {
  id: string;
  name: string;
  status: OrgStatus;
  addressLine: string | null;
  role: OrgRole;
}

export interface ShopDashboard {
  id: string;
  name: string;
  status: OrgStatus;
  addressLine: string | null;
  commissionRate: number;
  commissionOwed: number;
  openOrders: number;
  thisMonth: { orders: number; sales: number; commission: number };
}

export interface ShopOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  description: string;
  itemsCost: number;
  merchantCommission: number;
  merchantReadyAt: string | null;
  createdAt: string;
  customer: { firstName: string };
  runner: { firstName: string; lastName: string; phone?: string } | null;
}

export interface Invoice {
  id: string;
  number: string;
  amount: number;
  status: 'ISSUED' | 'PAID' | 'VOID';
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  paidAt: string | null;
  business: { id: string; name: string } | null;
  merchant: { id: string; name: string } | null;
}

interface Page<T> {
  total: number;
  items: T[];
}

export const orgKeys = {
  businesses: ['businesses', 'mine'] as const,
  business: (id: string) => ['businesses', id] as const,
  businessOrders: (id: string, view: string) => ['businesses', id, 'orders', view] as const,
  shops: (params: object) => ['merchants', 'directory', params] as const,
  myShops: ['merchants', 'mine'] as const,
  shop: (id: string) => ['merchants', id] as const,
  shopOrders: (id: string, view: string) => ['merchants', id, 'orders', view] as const,
  invoices: ['invoices'] as const,
};

export const useMyBusinesses = () => useQuery({ queryKey: orgKeys.businesses, queryFn: () => api.get<MyBusiness[]>('/businesses/mine') });

export const useBusiness = (id: string | null | undefined) =>
  useQuery({ queryKey: orgKeys.business(id ?? ''), queryFn: () => api.get<Business>(`/businesses/${id}`), enabled: !!id });

export const useBusinessOrders = (id: string, view: 'PENDING_APPROVAL' | 'ACTIVE' | 'PAST') =>
  useQuery({
    queryKey: orgKeys.businessOrders(id, view),
    queryFn: () => api.get<Page<CompanyOrder>>(`/businesses/${id}/orders?view=${view}&pageSize=50`),
  });

export const useShopDirectory = (params: { category?: string; search?: string; lat?: number; lng?: number }) =>
  useQuery({
    queryKey: orgKeys.shops(params),
    queryFn: () => {
      const query = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString();
      return api.get<Shop[]>(`/merchants${query ? `?${query}` : ''}`);
    },
  });

export const useShop = (id: string | undefined) =>
  useQuery({ queryKey: ['merchants', 'public', id], queryFn: () => api.get<Shop>(`/merchants/${id}`), enabled: !!id });

export const useMyShops = () => useQuery({ queryKey: orgKeys.myShops, queryFn: () => api.get<MyShop[]>('/merchants/mine') });

export const useShopDashboard = (id: string) =>
  useQuery({ queryKey: orgKeys.shop(id), queryFn: () => api.get<ShopDashboard>(`/merchants/${id}/dashboard`) });

export const useShopOrders = (id: string, view: 'ACTIVE' | 'PAST') =>
  useQuery({
    queryKey: orgKeys.shopOrders(id, view),
    queryFn: () => api.get<Page<ShopOrder>>(`/merchants/${id}/orders?view=${view}&pageSize=50`),
    refetchInterval: view === 'ACTIVE' ? 30_000 : false,
  });

export const useInvoices = () => useQuery({ queryKey: orgKeys.invoices, queryFn: () => api.get<Invoice[]>('/invoices') });

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  PENDING: '⏳ Waiting for ErrandCONNECT approval',
  ACTIVE: '🟢 Active',
  SUSPENDED: '⛔ Suspended',
  REJECTED: '✖ Not approved',
};
