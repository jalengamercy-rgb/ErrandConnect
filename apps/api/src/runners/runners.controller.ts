import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentUser, Roles, type AuthUser } from '../common/auth-user.js';
import {
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
import { RunnersService } from './runners.service.js';

/**
 * Runner registration. Each step is saved separately so the app can resume
 * where the runner left off. Every step returns the updated progress.
 * Emergency contact (step 6) uses PUT /me/emergency-contact and documents
 * (steps 4-5) use POST /documents.
 */
@Roles('RUNNER')
@Controller('runners/me')
export class RunnersController {
  constructor(private readonly runners: RunnersService) {}

  @Get('onboarding')
  onboarding(@CurrentUser() user: AuthUser) {
    return this.runners.getOnboarding(user.id);
  }

  @Put('onboarding/personal')
  personal(@CurrentUser() user: AuthUser, @Body() dto: PersonalStepDto) {
    return this.runners.savePersonal(user.id, dto);
  }

  @Put('onboarding/service-area')
  serviceArea(@CurrentUser() user: AuthUser, @Body() dto: ServiceAreaStepDto) {
    return this.runners.saveServiceArea(user.id, dto);
  }

  @Put('onboarding/delivery-types')
  deliveryTypes(@CurrentUser() user: AuthUser, @Body() dto: DeliveryTypesStepDto) {
    return this.runners.saveDeliveryTypes(user.id, dto);
  }

  @Post('vehicles')
  addVehicle(@CurrentUser() user: AuthUser, @Body() dto: VehicleDto) {
    return this.runners.addVehicle(user.id, dto);
  }

  @Put('vehicles/:id')
  updateVehicle(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VehicleDto) {
    return this.runners.updateVehicle(user.id, id, dto);
  }

  @Delete('vehicles/:id')
  removeVehicle(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runners.removeVehicle(user.id, id);
  }

  @Put('onboarding/identity')
  identity(@CurrentUser() user: AuthUser, @Body() dto: IdentityStepDto) {
    return this.runners.saveIdentity(user.id, dto);
  }

  @Put('onboarding/payout')
  payout(@CurrentUser() user: AuthUser, @Body() dto: PayoutStepDto) {
    return this.runners.savePayout(user.id, dto);
  }

  @Put('onboarding/work-preferences')
  workPreferences(@CurrentUser() user: AuthUser, @Body() dto: WorkPreferencesStepDto) {
    return this.runners.saveWorkPreferences(user.id, dto);
  }

  @Put('onboarding/services')
  services(@CurrentUser() user: AuthUser, @Body() dto: ServicesStepDto) {
    return this.runners.saveServices(user.id, dto);
  }

  @Put('onboarding/experience')
  experience(@CurrentUser() user: AuthUser, @Body() dto: ExperienceStepDto) {
    return this.runners.saveExperience(user.id, dto);
  }

  @Put('onboarding/equipment')
  equipment(@CurrentUser() user: AuthUser, @Body() dto: EquipmentStepDto) {
    return this.runners.saveEquipment(user.id, dto);
  }

  @Put('onboarding/skills')
  skills(@CurrentUser() user: AuthUser, @Body() dto: SkillsStepDto) {
    return this.runners.saveSkills(user.id, dto);
  }

  @Put('onboarding/background')
  background(@CurrentUser() user: AuthUser, @Body() dto: BackgroundStepDto, @Ip() ip: string) {
    return this.runners.saveBackground(user.id, dto, ip);
  }

  @Put('onboarding/agreements')
  agreements(@CurrentUser() user: AuthUser, @Body() dto: AgreementsStepDto, @Ip() ip: string) {
    return this.runners.saveAgreements(user.id, dto, ip);
  }

  @Post('onboarding/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser) {
    return this.runners.submit(user.id);
  }

  /** Availability toggle; only approved runners can go online. */
  @Put('online')
  online(@CurrentUser() user: AuthUser, @Body() dto: GoOnlineDto) {
    return this.runners.setOnline(user.id, dto);
  }
}
