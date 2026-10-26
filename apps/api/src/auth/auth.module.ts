import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AddressesService } from '../users/addresses.service.js';
import { UsersController } from '../users/users.controller.js';
import { UsersService } from '../users/users.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { OtpService } from './otp.service.js';
import { TokensService } from './tokens.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, OtpService, TokensService, UsersService, AddressesService, MfaService],
  exports: [OtpService, TokensService, UsersService, MfaService],
})
export class AuthModule {}
