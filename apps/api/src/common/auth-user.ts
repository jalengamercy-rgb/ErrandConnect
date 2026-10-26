import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { StaffRole } from '../generated/prisma/client.js';

/** The logged-in user, attached to each request by AuthGuard. */
export interface AuthUser {
  id: string;
  sessionId: string;
  isCustomer: boolean;
  isRunner: boolean;
  staffRole: StaffRole | null;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const IS_PUBLIC = 'isPublic';
/** Marks a route as reachable without logging in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AccountRole = 'CUSTOMER' | 'RUNNER';
export const ACCOUNT_ROLES = 'accountRoles';
/** Restricts a route to users with one of these profiles. */
export const Roles = (...roles: AccountRole[]) => SetMetadata(ACCOUNT_ROLES, roles);

export const STAFF_ROLES = 'staffRoles';
/**
 * Restricts a route to admin staff. With no roles, any staff member may use it;
 * SUPER_ADMIN can always use it.
 */
export const Staff = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES, roles);
