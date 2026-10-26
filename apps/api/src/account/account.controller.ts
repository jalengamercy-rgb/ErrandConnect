import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/auth-user.js';
import { AccountService } from './account.service.js';

class DeleteAccountDto {
  @IsString()
  @MaxLength(128)
  password: string;
}

@Controller('me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /** A copy of everything we hold about you (Data Protection Act, right of access). */
  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Header('Content-Disposition', 'attachment; filename="errandconnect-my-data.json"')
  export(@CurrentUser() user: AuthUser) {
    return this.account.export(user.id);
  }

  /** Deletes your account (password required). */
  @Post('delete')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  delete(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    return this.account.delete(user.id, dto.password);
  }
}
