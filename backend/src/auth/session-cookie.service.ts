import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';
import type { AuthResult } from './auth.service';

/** How long the refresh cookie lives in the browser. */
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The one place a session is written to, or cleared from, a browser.
 *
 * This was private to `AuthController` and had to move when a second controller
 * needed to hand out a session — the public assessment link, where an anonymous
 * candidate signs in without ever visiting `/login`. Copying the cookie
 * attributes to a second place was the alternative and would have been a
 * mistake: `clearCookie` only removes a cookie when it is given the same
 * `secure`, `sameSite` and `path` it was written with, so a divergence would
 * mean sign-out silently leaving the session in place.
 *
 * That risk is precisely what the original comment on these methods warned
 * about. Extracting them keeps one implementation rather than two that must be
 * remembered to match.
 */
@Injectable()
export class SessionCookieService {
  constructor(private readonly config: ConfigService) {}

  /**
   * The attributes the refresh cookie is written with.
   *
   * `sameSite` is configurable because a split deployment puts the SPA and the
   * API on different sites, where a `lax` cookie is silently withheld and every
   * session dies on the next page load. `none` without `secure` is refused at
   * boot in `env.validation.ts`.
   */
  options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('cookieSecure') ?? false,
      sameSite:
        this.config.get<'lax' | 'strict' | 'none'>('cookieSameSite') ?? 'lax',
      path: REFRESH_COOKIE_PATH,
    };
  }

  /**
   * Writes the session and returns the body.
   *
   * The refresh token goes out as an httpOnly cookie only — never in the JSON
   * body — so page scripts cannot read it.
   */
  respond(result: AuthResult, res: Response) {
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      ...this.options(),
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  /** Removes it, with the same attributes it was written with. */
  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, this.options());
  }
}
