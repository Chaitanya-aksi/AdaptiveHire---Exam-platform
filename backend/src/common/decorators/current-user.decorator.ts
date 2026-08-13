import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '../enums';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  /**
   * The company whose data this request may touch. Set for every recruiter and
   * null for every candidate.
   *
   * Read from the database on each request rather than carried in the access
   * token, so moving an account between organisations takes effect at once
   * instead of whenever its token happens to expire.
   */
  organisationId: string | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
