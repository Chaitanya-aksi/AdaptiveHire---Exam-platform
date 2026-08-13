import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './current-user.decorator';

/**
 * The organisation this request is allowed to touch, guaranteed non-null.
 *
 * Every recruiter-facing endpoint takes its scope from here rather than reading
 * `organisationId` off the user and asserting it, because the two failure modes
 * are not equally bad. A `!` that turns out to be wrong yields `undefined`,
 * which a TypeORM `where` clause quietly drops — and a dropped tenant filter
 * returns every organisation's rows. This throws instead.
 *
 * So an account that reaches a recruiter endpoint without an organisation is
 * refused outright. That should be impossible (registration creates the pair in
 * one transaction), which is exactly why it must fail loudly if it ever happens
 * rather than silently widening the query.
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user?.organisationId) {
      throw new ForbiddenException(
        'This account is not attached to an organisation.',
      );
    }
    return user.organisationId;
  },
);
