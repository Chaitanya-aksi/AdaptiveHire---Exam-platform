import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';
import { AuthService, type AuthResult } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import type { RefreshRequestUser } from './strategies/jwt-refresh.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithTokens(await this.auth.register(dto), res);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithTokens(await this.auth.login(dto), res);
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { sub, refreshToken } = req.user as RefreshRequestUser;
    return this.respondWithTokens(
      await this.auth.refresh(sub, refreshToken),
      res,
    );
  }

  /**
   * Asks for a reset link.
   *
   * Always 204, whether or not that address has an account — see
   * `AuthService.requestPasswordReset`. Throttled harder than login: this is
   * the one unauthenticated route that causes mail to be sent, so an unbounded
   * version is both an enumeration tool and a way to use the platform to spam
   * a third party's inbox.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  /**
   * Redeems the token from that link and sets the new password. Signs out every
   * existing session for the account, so the response deliberately carries no
   * tokens — the new password has to be used to sign in.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(userId);
    res.clearCookie(REFRESH_COOKIE_NAME, this.refreshCookieOptions());
  }

  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.users.findById(current.id);
    return {
      id: user!.id,
      email: user!.email,
      fullName: user!.fullName,
      role: user!.role,
    };
  }

  /**
   * The attributes the refresh cookie is written with.
   *
   * `clearCookie` has to be given the same `secure`, `sameSite` and `path`, or
   * the browser treats it as a different cookie and leaves the original in
   * place — so both sites read from here rather than repeating the literals.
   *
   * `sameSite` is configurable because a split deployment puts the SPA and the
   * API on different sites, where a `lax` cookie is silently withheld and every
   * session dies on the next page load. `none` without `secure` is refused at
   * boot in `env.validation.ts`.
   */
  private refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('cookieSecure') ?? false,
      sameSite:
        this.config.get<'lax' | 'strict' | 'none'>('cookieSameSite') ?? 'lax',
      path: REFRESH_COOKIE_PATH,
    };
  }

  /**
   * The refresh token goes out as an httpOnly cookie only — never in the JSON
   * body — so page scripts can't read it.
   */
  private respondWithTokens(result: AuthResult, res: Response) {
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      ...this.refreshCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { accessToken: result.accessToken, user: result.user };
  }
}
