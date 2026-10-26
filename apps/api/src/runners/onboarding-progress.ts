import {
  MOTORIZED_DELIVERY_TYPES,
  OPTIONAL_ONBOARDING_STEPS,
  RUNNER_ONBOARDING_STEPS,
  RUNNER_REQUIRED_AGREEMENTS,
  type RunnerOnboardingStepKey,
} from '@errandconnect/shared';
import type { ConsentType, Document, DocumentType, RunnerProfile, User, Vehicle } from '../generated/prisma/client.js';

/** Everything needed to work out how far a runner has got. */
export interface OnboardingState {
  user: Pick<User, 'email' | 'dateOfBirth' | 'gender' | 'nationality' | 'passwordHash' | 'pinHash'>;
  profile: RunnerProfile;
  vehicles: Vehicle[];
  /** Latest upload of each document type. */
  documents: Map<DocumentType, Pick<Document, 'id' | 'status' | 'rejectionReason' | 'createdAt'>>;
  hasEmergencyContact: boolean;
  hasPayoutMethod: boolean;
  /** Latest answer for each consent type. */
  consents: Map<ConsentType, boolean>;
}

const IDENTITY_DOCUMENTS: DocumentType[] = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'SELFIE', 'SELFIE_WITH_ID'];

export function needsVehicle(profile: Pick<RunnerProfile, 'deliveryTypes'>): boolean {
  return profile.deliveryTypes.some((t) => MOTORIZED_DELIVERY_TYPES.includes(t));
}

function hasDocument(state: OnboardingState, type: DocumentType): boolean {
  const document = state.documents.get(type);
  return !!document && document.status !== 'REJECTED';
}

function vehicleComplete(vehicle: Vehicle, now: Date): boolean {
  return (
    !!vehicle.registrationNumber &&
    !!vehicle.licenceNumber &&
    !!vehicle.insuranceNumber &&
    !!vehicle.licenceExpiry &&
    vehicle.licenceExpiry > now &&
    !!vehicle.insuranceExpiry &&
    vehicle.insuranceExpiry > now &&
    vehicle.status !== 'REJECTED'
  );
}

const STEP_CHECKS: Record<RunnerOnboardingStepKey, (s: OnboardingState, now: Date) => boolean> = {
  personal: ({ user, profile }) => !!user.email && !!user.dateOfBirth && !!user.gender && !!user.nationality && !!profile.nationalIdNumber,
  'service-area': ({ profile }) => !!profile.county && !!profile.city && !!profile.area && profile.preferredAreas.length > 0,
  'delivery-types': ({ profile }) => profile.deliveryTypes.length > 0,
  // Every motorized delivery type needs a complete vehicle of that type, plus a vehicle photo.
  vehicles: (s, now) => {
    const motorized = s.profile.deliveryTypes.filter((t) => MOTORIZED_DELIVERY_TYPES.includes(t));
    if (motorized.length === 0) return s.profile.deliveryTypes.length > 0;
    return motorized.every((type) => s.vehicles.some((v) => v.type === type && vehicleComplete(v, now))) && hasDocument(s, 'VEHICLE_PHOTO');
  },
  identity: (s) => IDENTITY_DOCUMENTS.every((type) => hasDocument(s, type)),
  'emergency-contact': (s) => s.hasEmergencyContact,
  payout: (s) => s.hasPayoutMethod,
  'work-preferences': ({ profile }) =>
    !!profile.availability && profile.workingDays.length > 0 && !!profile.workStartTime && !!profile.workEndTime,
  services: ({ profile }) => profile.servicesOffered.length > 0,
  experience: ({ profile }) => profile.hasDeliveryExperience !== null,
  equipment: ({ profile }) => profile.equipment.length > 0,
  skills: ({ profile }) => profile.languages.length > 0,
  background: (s) =>
    s.profile.hasCriminalRecord !== null &&
    s.profile.canLiftHeavy !== null &&
    s.profile.willingToHandleCash !== null &&
    s.consents.get('BACKGROUND_CHECK') === true,
  security: ({ user }) => !!user.passwordHash && !!user.pinHash,
  agreements: (s) => RUNNER_REQUIRED_AGREEMENTS.every((type) => s.consents.get(type) === true),
};

export function computeOnboardingProgress(state: OnboardingState, now = new Date()) {
  const steps = RUNNER_ONBOARDING_STEPS.map((step, index) => ({
    number: index + 1,
    key: step.key,
    title: step.title,
    optional: OPTIONAL_ONBOARDING_STEPS.includes(step.key),
    complete: STEP_CHECKS[step.key](state, now),
  }));
  const completeCount = steps.filter((s) => s.complete).length;
  const missingRequired = steps.filter((s) => !s.complete && !s.optional).map((s) => s.key);

  const { profile } = state;
  const reviewStarted = profile.applicationStatus !== 'DRAFT' && profile.applicationStatus !== 'SUBMITTED';
  // The verification tracker shown on the runner's dashboard after submitting.
  const tracker = [
    { key: 'submitted', label: 'Application Submitted', done: !!profile.submittedAt },
    { key: 'under-review', label: 'Documents Under Review', done: reviewStarted },
    { key: 'identity', label: 'Identity Verified', done: !!profile.identityVerifiedAt },
    ...(needsVehicle(profile) ? [{ key: 'vehicle', label: 'Vehicle Verified', done: !!profile.vehicleVerifiedAt }] : []),
    { key: 'background', label: 'Background Check Completed', done: !!profile.backgroundCheckedAt },
    { key: 'payout', label: 'Payment Account Approved', done: !!profile.payoutApprovedAt },
    { key: 'ready', label: 'Ready to Receive Jobs', done: profile.applicationStatus === 'APPROVED' },
  ];

  return {
    applicationStatus: profile.applicationStatus,
    rejectionReason: profile.rejectionReason,
    percentComplete: Math.round((completeCount / steps.length) * 100),
    canSubmit: missingRequired.length === 0,
    missingRequired,
    steps,
    tracker,
  };
}
