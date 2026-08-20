import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { Repository } from 'typeorm';
import { AuditLogEntry } from './audit-log.entity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads as sensitive even though it changes nothing: opening a candidate's
 * report is the single most privacy-relevant thing a recruiter does, so it is
 * audited alongside the writes.
 */
const AUDITED_READ_PREFIXES = ['/api/reports'];

/**
 * Writes that are mechanism rather than action, and would bury everything else.
 *
 * This log exists to answer "who did that to this record". Both exclusions here
 * are high-volume paths that answer nothing:
 *
 *  - `/auth/refresh` rotates a token every fifteen minutes for every signed-in
 *    session. It records only that somebody stayed logged in.
 *  - The session runtime writes on every single answer — a dozen rows per
 *    module, per candidate — duplicating what `responses` and
 *    `assessment_sessions` already store properly, with far more detail.
 *
 * Sign-in *is* audited, deliberately: a run of failed logins is exactly the
 * sort of thing this log should show.
 */
const UNAUDITED_PREFIXES = ['/api/auth/refresh', '/api/sessions'];

/**
 * An intersection, not `extends`: Express types `route` as required and lets a
 * route parameter be `string[]` (`/x/:id/:id`), so declaring a narrower shape
 * by extension is a type error. Intersecting adds what we need without
 * contradicting any of that.
 */
type AuditedRequest = Request & {
  user?: { id?: string; organisationId?: string | null };
};

/** What Express actually hands back for route parameters. */
type RouteParams = Record<string, string | string[] | undefined>;

/**
 * Records every state-changing request, and report reads.
 *
 * Global and convention-based rather than a decorator per handler, on purpose:
 * an opt-in audit is only as complete as the last person who remembered to opt
 * in, and the endpoints most worth recording are exactly the ones somebody adds
 * in a hurry. Anything that is not a GET is audited automatically, so a new
 * mutating route is covered the moment it exists.
 *
 * Writing the row never blocks the response and never fails the request. An
 * audit store that can take the product down with it gets switched off, and
 * then there is no audit store — a failure here is loud in the log instead.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @InjectRepository(AuditLogEntry)
    private readonly entries: Repository<AuditLogEntry>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<AuditedRequest>();
    if (!this.shouldAudit(req)) return next.handle();

    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res.statusCode),
        // Failures are recorded too, and they are the interesting ones: a run
        // of 404s against another organisation's ids is somebody probing, and
        // an audit trail that only kept successes would not show it.
        error: (err: unknown) => {
          const status =
            typeof (err as { status?: number })?.status === 'number'
              ? (err as { status: number }).status
              : 500;
          this.record(req, status);
        },
      }),
    );
  }

  private shouldAudit(req: AuditedRequest): boolean {
    const path = req.path ?? '';
    if (UNAUDITED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return false;
    }
    if (req.method !== 'GET') return true;
    return AUDITED_READ_PREFIXES.some((prefix) => path.startsWith(prefix));
  }

  private record(req: AuditedRequest, statusCode: number): void {
    // The route pattern, not the concrete URL — `/invitations/:id/revoke`
    // rather than a distinct action string per id, so the column can be
    // grouped and counted.
    //
    // Express types `route` as `any`, so it is narrowed here rather than
    // trusted: an unexpected shape falls back to the concrete path instead of
    // putting `[object Object]` in the action column.
    const route = (req as { route?: { path?: unknown } }).route;
    const pattern =
      typeof route?.path === 'string' ? route.path : (req.path ?? 'unknown');

    const entry = this.entries.create({
      actorId: req.user?.id ?? null,
      organisationId: req.user?.organisationId ?? null,
      action: `${req.method} ${pattern}`.slice(0, 160),
      resourceType: this.resourceTypeFrom(req.path ?? ''),
      resourceId: this.resourceIdFrom(req.params),
      metadata: {
        statusCode,
        // Only the route's own id parameters, and only ones that look like
        // ids. Never the query string or the body.
        params: this.idParams(req.params),
      },
    });

    // Fire and forget. Awaiting it would put a database write on the critical
    // path of every mutation for a record nobody is waiting to read.
    void this.entries.save(entry).catch((error: unknown) => {
      this.logger.error(
        `Failed to write audit entry for ${entry.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /** `/api/assessments/:id/invitations` -> `assessments`. */
  private resourceTypeFrom(path: string): string {
    const segments = path.split('/').filter(Boolean);
    // Drop the global `api` prefix; what follows names the collection.
    const start = segments[0] === 'api' ? 1 : 0;
    return (segments[start] ?? 'unknown').slice(0, 60);
  }

  private resourceIdFrom(params: RouteParams | undefined): string | null {
    if (!params) return null;
    // Most specific first: on a nested route the last segment's id is the thing
    // being acted on, and `:id` is the conventional name for it.
    for (const key of ['id', 'sessionId', 'assessmentId', 'invitationId']) {
      const value = params[key];
      if (typeof value === 'string' && UUID.test(value)) return value;
    }
    return null;
  }

  private idParams(params: RouteParams | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(params ?? {})) {
      // The `typeof` check is doing real work: a repeated parameter arrives as
      // an array, and only a single UUID string is worth recording.
      if (typeof value === 'string' && UUID.test(value)) out[key] = value;
    }
    return out;
  }
}
