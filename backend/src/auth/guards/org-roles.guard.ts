import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ORG_ROLES_KEY } from '../../common/decorators/org-roles.decorator';
import { ORG_ROLE_RANK, OrgRole } from '../../common/enums';

/**
 * Enforces the workspace role floor set by `@MinOrgRole()`.
 *
 * Modelled on `RolesGuard` rather than folded into it, because the two answer
 * different questions and fail differently. `RolesGuard` decides whether this
 * audience may touch the route at all; this decides what they may do with it.
 *
 * A route with no `@MinOrgRole()` is unrestricted here — the vast majority of
 * recruiter endpoints are reads that any member should have, and requiring an
 * explicit floor on all of them would mean a forgotten decorator locked people
 * out rather than letting them in.
 */
@Injectable()
export class OrgRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OrgRole | undefined>(
      ORG_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;

    /*
     * No workspace role at all is a refusal, not a pass.
     *
     * A candidate reaching here has already failed `RolesGuard`, so in practice
     * this catches a recruiter account with a null `orgRole` — which should not
     * exist, and is exactly the case where defaulting to "allow" would hand out
     * the whole workspace. The same reasoning as `@CurrentOrg()` throwing
     * rather than letting an undefined scope through.
     */
    if (!user?.orgRole) {
      throw new ForbiddenException(
        'This account has no role in an organisation.',
      );
    }

    if (ORG_ROLE_RANK[user.orgRole] < ORG_ROLE_RANK[required]) {
      throw new ForbiddenException(
        `This action needs the ${required} role or above.`,
      );
    }

    return true;
  }
}
