import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SessionCookieService } from '../auth/session-cookie.service';
import { Public } from '../common/decorators/public.decorator';
import { CheckEmailDto, PublicEnterDto } from './dto/public-entry.dto';
import { PublicEntryService, type EntryContext } from './public-entry.service';

/**
 * The one unauthenticated door into an assessment.
 *
 * Split from `AssessmentsController` rather than added to it because every
 * route there is recruiter-only and scoped to `@CurrentOrg()`. Mixing three
 * `@Public()` routes into that file would put the only endpoints on the
 * platform that need no organisation next to forty that must never lose one,
 * and the day somebody copies the wrong decorator is the day a customer's
 * assessments become world-readable. A separate file makes the exception
 * visible.
 *
 * ── On the rate limits below ──
 * They are looser than they first look, and deliberately. The headline use case
 * is a campus drive: a hundred candidates in one lab arrive from a single
 * public address, and Indian mobile carriers put far more than that behind
 * carrier-grade NAT. The throttler keys on the client address, so a limit tuned
 * for one person per IP would have the cohort 429ing each other — the same
 * false-positive shape that got IP blocking rejected in the proposal. They are
 * still low enough to make bulk probing slow, and `enter` sits behind argon2,
 * which costs the attacker far more than it costs us.
 */
@Controller('public/assessments')
export class PublicEntryController {
  constructor(
    private readonly entry: PublicEntryService,
    private readonly sessionCookie: SessionCookieService,
  ) {}

  /** The intro screen: what this is, who it is for, and whether it is open. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  intro(@Param('token') token: string) {
    return this.entry.intro(token);
  }

  /**
   * Step one: the email alone, so the next screen knows whether to ask the
   * candidate to choose a password or to enter the one they have.
   *
   * Creates nothing. A POST rather than a GET all the same — the address is a
   * personal detail and belongs in a body, not in a URL that lands in every
   * access log and proxy cache along the way.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':token/check')
  @HttpCode(HttpStatus.OK)
  check(@Param('token') token: string, @Body() dto: CheckEmailDto) {
    return this.entry.checkEmail(token, dto.email);
  }

  /**
   * Step two: admit them, and hand back the invitation to go to.
   *
   * The session leaves exactly as it does from `/login` — through
   * `SessionCookieService`, so the refresh token is an httpOnly cookie with the
   * same attributes sign-out will later clear it by.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':token/enter')
  @HttpCode(HttpStatus.OK)
  async enter(
    @Param('token') token: string,
    @Body() dto: PublicEnterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { invitationId, ...auth } = await this.entry.enter(
      token,
      dto.email,
      dto.password,
      dto.fullName,
      this.contextOf(req),
    );

    return { ...this.sessionCookie.respond(auth, res), invitationId };
  }

  /**
   * Where the candidate was, for the recruiter to look at later.
   *
   * `req.ip` is the real client address because `main.ts` trusts exactly one
   * proxy hop; trusting more would let a client prepend its own
   * `X-Forwarded-For` and write whatever address it liked into this column.
   */
  private contextOf(req: Request): EntryContext {
    const userAgent = req.headers['user-agent'];
    return {
      ip: req.ip ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    };
  }
}
