import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';

/** Matches a v4 UUID, so a malformed path segment never becomes a log field. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stamps the session and the acting user onto every log line for a request.
 *
 * Without this, finding out what happened to one candidate's attempt means
 * knowing which requests belonged to it and searching for each in turn. With it,
 * `sessionId=…` returns the whole attempt — including lines written deep in the
 * adaptive engine, which has no idea it is inside an HTTP request.
 *
 * The id is read from wherever that route happens to carry it. That is a little
 * inelegant, but the alternative is threading a logging concern through every
 * service signature, which is worse.
 */
@Injectable()
export class SessionContextInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<
      Request & {
        user?: { id?: string; organisationId?: string | null };
        params?: Record<string, string>;
        body?: Record<string, unknown>;
      }
    >();

    const fields: Record<string, string> = {};

    const sessionId = this.sessionIdFrom(req);
    if (sessionId) fields.sessionId = sessionId;

    // Never the email or the name — an application log is not the place to
    // accumulate a second copy of the candidate directory.
    if (req.user?.id) fields.userId = req.user.id;
    if (req.user?.organisationId) fields.orgId = req.user.organisationId;

    if (Object.keys(fields).length > 0) this.logger.assign(fields);

    return next.handle();
  }

  private sessionIdFrom(req: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    path?: string;
  }): string | null {
    const fromBody = req.body?.sessionId;
    if (typeof fromBody === 'string' && UUID.test(fromBody)) return fromBody;

    const named = req.params?.sessionId;
    if (typeof named === 'string' && UUID.test(named)) return named;

    // `/sessions/:id/...` calls its parameter `id`, so it only counts as a
    // session id on those routes — elsewhere `:id` is an assessment, a question
    // or a user, and mislabelling those would make the field untrustworthy.
    const generic = req.params?.id;
    if (
      typeof generic === 'string' &&
      UUID.test(generic) &&
      req.path?.includes('/sessions/')
    ) {
      return generic;
    }

    return null;
  }
}
