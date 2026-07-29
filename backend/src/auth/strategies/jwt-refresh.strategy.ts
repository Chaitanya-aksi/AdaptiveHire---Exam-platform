import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { REFRESH_COOKIE_NAME } from '../auth.constants';
import type { JwtPayload } from './jwt.strategy';

export interface RefreshRequestUser extends JwtPayload {
  refreshToken: string;
}

const fromRefreshCookie = (req: Request): string | null =>
  (req?.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ?? null;

/**
 * Reads the refresh token from the httpOnly cookie only — it is never
 * accepted from a header or body, so client JS can't get at it.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: fromRefreshCookie,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: JwtPayload): RefreshRequestUser {
    const refreshToken = fromRefreshCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }
    return { ...payload, refreshToken };
  }
}
