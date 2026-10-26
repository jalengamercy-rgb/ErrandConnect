import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';

import { api } from '@/lib/api';
import { useOnboardingSaved } from '@/lib/queries';
import type { Onboarding } from '@/lib/types';

/** Saves one onboarding step with PUT /runners/me/onboarding/<step>, then returns to the hub. */
export function useSaveStep(step: string) {
  const saved = useOnboardingSaved();
  return useMutation({
    mutationFn: (body: object) => api.put<Onboarding>(`/runners/me/onboarding/${step}`, body),
    onSuccess: (onboarding) => {
      saved(onboarding);
      router.back();
    },
  });
}

export interface StepProps {
  data: Onboarding;
}
