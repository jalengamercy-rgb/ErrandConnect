import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LEGAL_VERSIONS } from '@errandconnect/shared';
import { ConsentType, Prisma } from '../generated/prisma/client.js';
import { DocumentsService } from '../documents/documents.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeOnboardingProgress, type OnboardingState } from './onboarding-progress.js';
import type {
  AgreementsStepDto,
  BackgroundStepDto,
  DeliveryTypesStepDto,
  EquipmentStepDto,
  ExperienceStepDto,
  GoOnlineDto,
  IdentityStepDto,
  PayoutStepDto,
  PersonalStepDto,
  ServiceAreaStepDto,
  ServicesStepDto,
  SkillsStepDto,
  VehicleDto,
  WorkPreferencesStepDto,
} from './runners.dto.js';

const MIN_RUNNER_AGE = 18;

@Injectable()
export class RunnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async loadState(userId: string): Promise<OnboardingState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        runnerProfile: { include: { vehicles: true } },
        emergencyContacts: { select: { id: true }, take: 1 },
        payoutMethods: { select: { id: true }, take: 1 },
        consents: { orderBy: { createdAt: 'asc' }, select: { type: true, granted: true } },
      },
    });
    if (!user?.runnerProfile) throw new NotFoundException('Runner profile not found');
    const { runnerProfile, emergencyContacts, payoutMethods, consents, ...rest } = user;
    const { vehicles, ...profile } = runnerProfile;
    return {
      user: rest,
      profile,
      vehicles,
      documents: await this.documents.latestByType(userId),
      hasEmergencyContact: emergencyContacts.length > 0,
      hasPayoutMethod: payoutMethods.length > 0,
      // Later answers override earlier ones (ordered oldest first).
      consents: new Map(consents.map((c) => [c.type, c.granted])),
    };
  }

  /** Progress plus the runner's saved answers, so the app can prefill each step. */
  async getOnboarding(userId: string) {
    const state = await this.loadState(userId);
    const [user, payoutMethod] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true, dateOfBirth: true, gender: true, nationality: true, whatsapp: true },
      }),
      this.prisma.payoutMethod.findFirst({ where: { userId }, omit: { userId: true } }),
    ]);
    const documents = Object.fromEntries(
      [...state.documents].map(([type, d]) => [type, { id: d.id, status: d.status, rejectionReason: d.rejectionReason, createdAt: d.createdAt }]),
    );
    return {
      runnerCode: state.profile.runnerCode,
      ...computeOnboardingProgress(state),
      answers: { user, profile: state.profile, payoutMethod, documents },
      vehicles: state.vehicles,
    };
  }

  /** Profile changes are only allowed before submitting, or after a rejection. */
  private async assertEditable(userId: string) {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId }, select: { applicationStatus: true } });
    if (!profile) throw new NotFoundException('Runner profile not found');
    if (profile.applicationStatus !== 'DRAFT' && profile.applicationStatus !== 'REJECTED') {
      throw new ForbiddenException('Your application has been submitted. Contact support to change details');
    }
  }

  private async updateProfile(userId: string, step: number, data: Prisma.RunnerProfileUpdateInput) {
    await this.assertEditable(userId);
    await this.prisma.runnerProfile.update({ where: { userId }, data: { ...data, onboardingStep: step } });
    return this.getOnboarding(userId);
  }

  async savePersonal(userId: string, dto: PersonalStepDto) {
    const dob = new Date(dto.dateOfBirth);
    const adultCutoff = new Date();
    adultCutoff.setFullYear(adultCutoff.getFullYear() - MIN_RUNNER_AGE);
    if (dob > adultCutoff) throw new BadRequestException(`Runners must be at least ${MIN_RUNNER_AGE} years old`);

    await this.assertEditable(userId);
    const email = dto.email.toLowerCase();
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          dateOfBirth: dob,
          gender: dto.gender,
          nationality: dto.nationality,
          whatsapp: dto.whatsapp,
          email,
          ...(current.email !== email ? { emailVerifiedAt: null } : {}),
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('This email is already registered');
      throw error;
    }
    return this.updateProfile(userId, 1, { nationalIdNumber: dto.nationalIdNumber.toUpperCase() });
  }

  saveServiceArea(userId: string, { lat, lng, ...dto }: ServiceAreaStepDto) {
    return this.updateProfile(userId, 2, {
      ...dto,
      ...(lat !== undefined && lng !== undefined ? { lastLat: lat, lastLng: lng, lastSeenAt: new Date() } : {}),
    });
  }

  saveDeliveryTypes(userId: string, dto: DeliveryTypesStepDto) {
    return this.updateProfile(userId, 3, dto);
  }

  async addVehicle(userId: string, dto: VehicleDto) {
    await this.assertEditable(userId);
    try {
      await this.prisma.vehicle.create({ data: { ...this.vehicleData(dto), runnerId: userId } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('This vehicle is already registered');
      throw error;
    }
    return this.updateProfile(userId, 4, {});
  }

  async updateVehicle(userId: string, vehicleId: string, dto: VehicleDto) {
    await this.assertEditable(userId);
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, runnerId: userId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    try {
      // Edited details need to be checked again.
      await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { ...this.vehicleData(dto), status: 'PENDING' } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('This vehicle is already registered');
      throw error;
    }
    return this.updateProfile(userId, 4, {});
  }

  async removeVehicle(userId: string, vehicleId: string) {
    await this.assertEditable(userId);
    const { count } = await this.prisma.vehicle.deleteMany({ where: { id: vehicleId, runnerId: userId } });
    if (count === 0) throw new NotFoundException('Vehicle not found');
    return this.getOnboarding(userId);
  }

  private vehicleData(dto: VehicleDto) {
    return { ...dto, licenceExpiry: new Date(dto.licenceExpiry), insuranceExpiry: new Date(dto.insuranceExpiry) };
  }

  saveIdentity(userId: string, dto: IdentityStepDto) {
    return this.updateProfile(userId, 5, { kraPin: dto.kraPin?.toUpperCase() });
  }

  async savePayout(userId: string, dto: PayoutStepDto) {
    await this.assertEditable(userId);
    await this.prisma.$transaction([
      this.prisma.payoutMethod.deleteMany({ where: { userId } }),
      this.prisma.payoutMethod.create({
        data: {
          userId,
          type: dto.type,
          accountName: dto.accountName,
          phone: dto.type === 'BANK' ? null : dto.phone,
          bankName: dto.type === 'BANK' ? dto.bankName : null,
          accountNumber: dto.type === 'BANK' ? dto.accountNumber : null,
          branch: dto.type === 'BANK' ? dto.branch : null,
          isDefault: true,
        },
      }),
      // Changing payout details means they must be approved again.
      this.prisma.runnerProfile.update({ where: { userId }, data: { payoutApprovedAt: null } }),
    ]);
    return this.updateProfile(userId, 7, {});
  }

  saveWorkPreferences(userId: string, dto: WorkPreferencesStepDto) {
    return this.updateProfile(userId, 8, { ...dto, maxDistanceKm: dto.maxDistanceKm ?? null });
  }

  async saveServices(userId: string, dto: ServicesStepDto) {
    const found = await this.prisma.serviceCategory.count({ where: { slug: { in: dto.servicesOffered }, isActive: true } });
    if (found !== dto.servicesOffered.length) throw new BadRequestException('Unknown service in servicesOffered');
    return this.updateProfile(userId, 9, dto);
  }

  saveExperience(userId: string, dto: ExperienceStepDto) {
    const { hasDeliveryExperience } = dto;
    return this.updateProfile(userId, 10, {
      hasDeliveryExperience,
      previousCompany: hasDeliveryExperience ? (dto.previousCompany ?? null) : null,
      yearsExperience: hasDeliveryExperience ? (dto.yearsExperience ?? null) : null,
      avgDeliveriesPerDay: hasDeliveryExperience ? (dto.avgDeliveriesPerDay ?? null) : null,
    });
  }

  saveEquipment(userId: string, dto: EquipmentStepDto) {
    return this.updateProfile(userId, 11, dto);
  }

  saveSkills(userId: string, dto: SkillsStepDto) {
    return this.updateProfile(userId, 12, dto);
  }

  async saveBackground(userId: string, { agreeToIdVerification, agreeToBackgroundCheck, ...answers }: BackgroundStepDto, ip?: string) {
    await this.assertEditable(userId);
    await this.recordConsents(userId, [['BACKGROUND_CHECK', agreeToIdVerification && agreeToBackgroundCheck]], ip);
    return this.updateProfile(userId, 13, answers);
  }

  async saveAgreements(userId: string, dto: AgreementsStepDto, ip?: string) {
    await this.assertEditable(userId);
    await this.recordConsents(
      userId,
      [
        ['TERMS', dto.terms],
        ['PRIVACY_POLICY', dto.privacyPolicy],
        ['GPS_TRACKING', dto.gpsTracking],
        ['COMMISSION_RATES', dto.commissionRates],
        ['INFO_IS_TRUE', dto.infoIsTrue],
      ],
      ip,
    );
    return this.updateProfile(userId, 15, {});
  }

  private recordConsents(userId: string, answers: [ConsentType, boolean][], ipAddress?: string) {
    const version = (type: ConsentType) => (type === 'TERMS' ? LEGAL_VERSIONS.TERMS : LEGAL_VERSIONS.PRIVACY_POLICY);
    return this.prisma.consent.createMany({
      data: answers.map(([type, granted]) => ({ userId, type, granted, version: version(type), ipAddress })),
    });
  }

  async submit(userId: string) {
    await this.assertEditable(userId);
    const progress = computeOnboardingProgress(await this.loadState(userId));
    if (!progress.canSubmit) {
      throw new BadRequestException({ message: 'Please complete all required steps', missingRequired: progress.missingRequired });
    }
    await this.prisma.runnerProfile.update({
      where: { userId },
      data: { applicationStatus: 'SUBMITTED', submittedAt: new Date(), rejectionReason: null },
    });
    return this.getOnboarding(userId);
  }

  async setOnline(userId: string, dto: GoOnlineDto) {
    const profile = await this.prisma.runnerProfile.findUniqueOrThrow({ where: { userId }, select: { applicationStatus: true } });
    if (dto.online && profile.applicationStatus !== 'APPROVED') {
      throw new ForbiddenException('Your account must be approved before you can go online');
    }
    return this.prisma.runnerProfile.update({
      where: { userId },
      data: dto.online
        ? { isOnline: true, lastLat: dto.lat, lastLng: dto.lng, lastSeenAt: new Date() }
        : { isOnline: false, lastSeenAt: new Date() },
      select: { isOnline: true, lastLat: true, lastLng: true, lastSeenAt: true },
    });
  }
}
