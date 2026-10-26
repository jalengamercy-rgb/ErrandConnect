import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { StaffRole } from '../generated/prisma/client.js';
import { MfaService } from '../auth/mfa.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCOUNT_ROLES, AccountRole, AuthUser, IS_PUBLIC, STAFF_ROLES } from './auth-user.js';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'access';
}

/**
 * Runs before every route. Checks the access token, loads the user, and
 * enforces @Public(), @Roles() and @Staff().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket connections are authenticated by RealtimeGateway when they connect.
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Login required');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    if (payload.typ !== 'access') throw new UnauthorizedException('Invalid token');

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: {
        revokedAt: true,
        mfaVerifiedAt: true,
        user: {
          select: {
            id: true,
            status: true,
            customerProfile: { select: { userId: true } },
            runnerProfile: { select: { userId: true } },
            staffProfile: { select: { role: true, twoFactorEnabledAt: true } },
          },
        },
      },
    });
    if (!session || session.revokedAt || session.user.id !== payload.sub) {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    if (session.user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active');

    const user: AuthUser = {
      id: session.user.id,
      sessionId: payload.sid,
      isCustomer: !!session.user.customerProfile,
      isRunner: !!session.user.runnerProfile,
      staffRole: session.user.staffProfile?.role ?? null,
    };
    request.user = user;

    const roles = this.reflector.getAllAndOverride<AccountRole[] | undefined>(ACCOUNT_ROLES, targets);
    if (roles?.length) {
      const allowed = roles.some((r) => (r === 'CUSTOMER' ? user.isCustomer : user.isRunner));
      if (!allowed) throw new ForbiddenException(`Requires a ${roles.join(' or ').toLowerCase()} account`);
    }

    const staffRoles = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES, targets);
    if (staffRoles) {
      const allowed =
        user.staffRole !== null && (user.staffRole === 'SUPER_ADMIN' || staffRoles.length === 0 || staffRoles.includes(user.staffRole));
      if (!allowed) throw new ForbiddenException('Not allowed for your admin role');
      // Admin routes also need the second factor: checked once per session.
      const staff = session.user.staffProfile!;
      if (staff.twoFactorEnabledAt && !session.mfaVerifiedAt) {
        throw new ForbiddenException({ statusCode: 403, code: 'MFA_REQUIRED', message: 'Enter the code from your authenticator app' });
      }
      if (!staff.twoFactorEnabledAt && this.mfa.required) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'MFA_SETUP_REQUIRED',
          message: 'Set up two-factor sign-in to use the admin panel',
        });
      }
    }

    return true;
  }
}
