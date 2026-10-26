import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import { ME_QUERY_KEY } from './auth-context';
import type { Address, Category, EmergencyContact, Onboarding } from './types';

export const queryKeys = {
  categories: ['categories'] as const,
  onboarding: ['runner', 'onboarding'] as const,
  addresses: ['me', 'addresses'] as const,
  emergencyContact: ['me', 'emergency-contact'] as const,
};

export const useCategories = () =>
  useQuery({ queryKey: queryKeys.categories, queryFn: () => api.get<Category[]>('/categories'), staleTime: 60 * 60_000 });

export const useOnboarding = (enabled = true) =>
  useQuery({ queryKey: queryKeys.onboarding, queryFn: () => api.get<Onboarding>('/runners/me/onboarding'), enabled });

export const useAddresses = () => useQuery({ queryKey: queryKeys.addresses, queryFn: () => api.get<Address[]>('/me/addresses') });

export const useEmergencyContact = () =>
  useQuery({ queryKey: queryKeys.emergencyContact, queryFn: () => api.get<EmergencyContact | null>('/me/emergency-contact') });

/** After a runner step saves, store the returned progress and refresh the profile summary. */
export function useOnboardingSaved() {
  const queryClient = useQueryClient();
  return (onboarding: Onboarding) => {
    queryClient.setQueryData(queryKeys.onboarding, onboarding);
    queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  };
}
