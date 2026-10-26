import type { DeliveryType } from './constants';

/** Delivery types that need a registered vehicle, licence and insurance. */
export const MOTORIZED_DELIVERY_TYPES: readonly DeliveryType[] = ['MOTORCYCLE', 'CAR', 'VAN', 'PICKUP', 'TRUCK'];

export const RUNNER_EQUIPMENT = [
  'SMARTPHONE_ANDROID',
  'SMARTPHONE_IPHONE',
  'POWER_BANK',
  'DELIVERY_BAG',
  'COOLER_BOX',
  'HELMET',
  'REFLECTOR_JACKET',
  'GPS_HOLDER',
] as const;

export const RUNNER_SKILLS = ['CUSTOMER_SERVICE', 'NAVIGATION', 'FIRST_AID'] as const;

export const RUNNER_LANGUAGES = ['ENGLISH', 'SWAHILI', 'LOCAL_LANGUAGES'] as const;

/** Allowed choices for "Maximum Delivery Distance"; null means no limit. */
export const MAX_DISTANCE_CHOICES_KM = [2, 5, 10, 20] as const;

/**
 * Runner registration steps, in the order the app shows them.
 * Step 14 (account security: password + PIN) is completed at sign-up.
 */
export const RUNNER_ONBOARDING_STEPS = [
  { key: 'personal', title: 'Basic Information' },
  { key: 'service-area', title: 'Address & Service Area' },
  { key: 'delivery-types', title: 'Delivery Type' },
  { key: 'vehicles', title: 'Vehicle Details' },
  { key: 'identity', title: 'Identity Verification' },
  { key: 'emergency-contact', title: 'Emergency Contact' },
  { key: 'payout', title: 'Banking & Payments' },
  { key: 'work-preferences', title: 'Work Preferences' },
  { key: 'services', title: 'Services Offered' },
  { key: 'experience', title: 'Experience' },
  { key: 'equipment', title: 'Equipment' },
  { key: 'skills', title: 'Skills' },
  { key: 'background', title: 'Background Questions' },
  { key: 'security', title: 'Account Security' },
  { key: 'agreements', title: 'Agreements' },
] as const;
export type RunnerOnboardingStepKey = (typeof RUNNER_ONBOARDING_STEPS)[number]['key'];

/** Steps the runner can skip and still submit. */
export const OPTIONAL_ONBOARDING_STEPS: readonly RunnerOnboardingStepKey[] = ['experience', 'equipment', 'skills'];

/** Agreements every runner must accept before submitting (step 15). */
export const RUNNER_REQUIRED_AGREEMENTS = ['TERMS', 'PRIVACY_POLICY', 'GPS_TRACKING', 'COMMISSION_RATES', 'INFO_IS_TRUE'] as const;

/** Current versions of the legal documents users agree to. Bump when the text changes. */
export const LEGAL_VERSIONS = {
  TERMS: '2026-10-01',
  PRIVACY_POLICY: '2026-10-01',
} as const;
