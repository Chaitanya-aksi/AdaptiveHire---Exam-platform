import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../common/enums';
import { RolesGuard } from './roles.guard';

const contextWithUser = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const requireRoles = (roles: UserRole[] | undefined) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  it('allows routes with no @Roles() metadata', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextWithUser(undefined))).toBe(true);
  });

  it('allows a user holding a required role', () => {
    requireRoles([UserRole.RECRUITER_ADMIN]);
    const ctx = contextWithUser({ id: 'u1', role: UserRole.RECRUITER_ADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a candidate on a recruiter-only route', () => {
    requireRoles([UserRole.RECRUITER_ADMIN]);
    const ctx = contextWithUser({ id: 'u1', role: UserRole.CANDIDATE });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when the request carries no authenticated user', () => {
    requireRoles([UserRole.CANDIDATE]);
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
