import type { DeliveryType, RunnerOnboardingStepKey } from '@errandconnect/shared';

// Shapes of API responses used by the app. See docs/API.md.

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type RunnerApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface Me {
  id: string;
  phone: string;
  email: string | null;
  whatsapp: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  nationality: string | null;
  photoUrl: string | null;
  emailVerifiedAt: string | null;
  idVerifiedAt: string | null;
  referralCode: string;
  customerProfile: {
    customerCode: string;
    verificationLevel: number;
    favoriteCategories: string[];
    notifySms: boolean;
    notifyEmail: boolean;
    notifyPush: boolean;
    notifyWhatsapp: boolean;
    language: string;
  } | null;
  runnerProfile: {
    runnerCode: string;
    applicationStatus: RunnerApplicationStatus;
    isOnline: boolean;
    ratingAvg: number;
    jobsCompleted: number;
  } | null;
  staffProfile: { role: string } | null;
}

export interface AuthResult {
  user: Me;
  tokens: TokenPair;
}

export interface Category {
  slug: string;
  name: string;
  icon: string | null;
}

export interface Address {
  id: string;
  label: string;
  county: string | null;
  city: string | null;
  area: string | null;
  street: string | null;
  building: string | null;
  unit: string | null;
  notes: string | null;
  lat: number;
  lng: number;
  isDefault: boolean;
}

export interface EmergencyContact {
  fullName: string;
  relationship: string;
  phone: string;
  altPhone: string | null;
}

export interface Vehicle {
  id: string;
  type: DeliveryType;
  make: string | null;
  model: string | null;
  color: string | null;
  registrationNumber: string | null;
  year: number | null;
  licenceNumber: string | null;
  licenceExpiry: string | null;
  insuranceNumber: string | null;
  insuranceExpiry: string | null;
  status: ReviewStatus;
}

export interface UploadedDocument {
  id: string;
  status: ReviewStatus;
  rejectionReason: string | null;
  createdAt: string;
}

export interface RunnerProfile {
  runnerCode: string;
  nationalIdNumber: string | null;
  kraPin: string | null;
  county: string | null;
  city: string | null;
  area: string | null;
  preferredAreas: string[];
  deliveryTypes: DeliveryType[];
  availability: string | null;
  workingDays: string[];
  workStartTime: string | null;
  workEndTime: string | null;
  maxDistanceKm: number | null;
  servicesOffered: string[];
  hasDeliveryExperience: boolean | null;
  previousCompany: string | null;
  yearsExperience: number | null;
  avgDeliveriesPerDay: number | null;
  equipment: string[];
  skills: string[];
  languages: string[];
  hasCriminalRecord: boolean | null;
  canLiftHeavy: boolean | null;
  willingToHandleCash: boolean | null;
  lastLat: number | null;
  lastLng: number | null;
}

export interface Onboarding {
  runnerCode: string;
  applicationStatus: RunnerApplicationStatus;
  rejectionReason: string | null;
  percentComplete: number;
  canSubmit: boolean;
  missingRequired: RunnerOnboardingStepKey[];
  steps: { number: number; key: RunnerOnboardingStepKey; title: string; optional: boolean; complete: boolean }[];
  tracker: { key: string; label: string; done: boolean }[];
  answers: {
    user: Pick<Me, 'firstName' | 'lastName' | 'email' | 'dateOfBirth' | 'gender' | 'nationality' | 'whatsapp'>;
    profile: RunnerProfile;
    payoutMethod: {
      type: 'MPESA' | 'BANK' | 'MOBILE_WALLET';
      accountName: string;
      phone: string | null;
      bankName: string | null;
      accountNumber: string | null;
      branch: string | null;
    } | null;
    documents: Partial<Record<string, UploadedDocument>>;
  };
  vehicles: Vehicle[];
}

export type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'RUNNER_ASSIGNED'
  | 'AT_STORE'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'DISPUTED';

export type Urgency = 'STANDARD' | 'WITHIN_1_HOUR' | 'WITHIN_30_MIN' | 'WITHIN_15_MIN';

export interface Quote {
  customer: { itemsCost: number; errandFee: number; deliveryFee: number; urgencyFee: number; serviceFee: number; total: number };
  runner: { itemsReimbursement: number; errandEarnings: number; deliveryEarnings: number; urgencyEarnings: number; total: number };
  platform: { total: number };
  extraKm: number;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  description: string;
  total?: number;
  /** Runner lists only: what the runner keeps. */
  runnerFee?: number;
  createdAt: string;
  category: { name: string };
  dropoffLabel?: string | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  description: string;
  category: { name: string };
  deliveryType: DeliveryType;
  urgency: Urgency;
  scheduledFor: string | null;
  pickupLabel: string | null;
  pickupAddress: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLabel: string | null;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  recipientName: string | null;
  recipientPhone: string | null;
  distanceKm: number;
  itemsCost: number;
  errandFee: number;
  deliveryFee: number;
  urgencyFee: number;
  serviceFee: number;
  total: number;
  runnerEarnings: number;
  /** What the runner keeps (earnings minus paying back the items). */
  runnerFee: number;
  paymentMethod: string;
  deliveryPin?: string;
  cancelReason: string | null;
  createdAt: string;
  customer: { id: string; firstName: string; lastName: string; photoUrl: string | null; phone?: string };
  runner: {
    id: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    phone?: string;
    rating: number;
    ratingCount: number;
    jobsCompleted: number;
    vehicle: { type: DeliveryType; registrationNumber: string | null; make: string | null; model: string | null; color: string | null } | null;
    location: { lat: number; lng: number; at: string } | null;
  } | null;
  events: { status: OrderStatus; note: string | null; createdAt: string }[];
  myReview: { stars: number; comment: string | null } | null;
}

export interface Job {
  id: string;
  orderNumber: string;
  category: string;
  description: string;
  urgency: Urgency;
  scheduledFor: string | null;
  pickupAddress: string | null;
  dropoffAddress: string;
  distanceKm: number;
  awayKm: number;
  itemsCost: number;
  runnerEarnings: number;
  runnerFee: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
}
