import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, Roles, type AuthUser } from '../common/auth-user.js';
import { AddressesService, UpdateAddressDto } from './addresses.service.js';
import { AddressDto, ConfirmCodeDto, EmergencyContactDto, UpdateCustomerPreferencesDto, UpdateMeDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@Controller('me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly addresses: AddressesService,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @Patch('customer-preferences')
  @Roles('CUSTOMER')
  updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: UpdateCustomerPreferencesDto) {
    return this.users.updateCustomerPreferences(user.id, dto);
  }

  /** Become a runner as well as a customer (or the other way round). */
  @Post('roles/:role')
  addRole(@CurrentUser() user: AuthUser, @Param('role', new ParseEnumPipe(['customer', 'runner'])) role: 'customer' | 'runner') {
    return this.users.addRole(user.id, role);
  }

  @Post('email/verify/request')
  @HttpCode(200)
  requestEmailVerification(@CurrentUser() user: AuthUser) {
    return this.users.requestEmailVerification(user.id);
  }

  @Post('email/verify/confirm')
  @HttpCode(200)
  confirmEmailVerification(@CurrentUser() user: AuthUser, @Body() dto: ConfirmCodeDto) {
    return this.users.confirmEmailVerification(user.id, dto.code);
  }

  @Get('addresses')
  listAddresses(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.id);
  }

  @Post('addresses')
  createAddress(@CurrentUser() user: AuthUser, @Body() dto: AddressDto) {
    return this.addresses.create(user.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAddressDto) {
    return this.addresses.update(user.id, id, dto);
  }

  @Delete('addresses/:id')
  removeAddress(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.addresses.remove(user.id, id);
  }

  @Get('emergency-contact')
  getEmergencyContact(@CurrentUser() user: AuthUser) {
    return this.addresses.getEmergencyContact(user.id);
  }

  @Put('emergency-contact')
  setEmergencyContact(@CurrentUser() user: AuthUser, @Body() dto: EmergencyContactDto) {
    return this.addresses.setEmergencyContact(user.id, dto);
  }
}
