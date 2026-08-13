import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Which sign-in page the request came from.
 *
 * The two doors are for two different audiences, and a recruiter who signs in
 * through the candidate form should be sent to the right page rather than
 * silently let through. Enforced on the server, not just in the UI: refusing
 * only on the client would still have issued an access token and set the
 * httpOnly refresh cookie, so the next page load would restore the session and
 * land them in the admin area anyway.
 */
export enum LoginPortal {
  CANDIDATE = 'candidate',
  RECRUITER = 'recruiter',
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /**
   * Optional. Omitted means "no preference", which keeps scripts and API tests
   * working — the real access control is the role guard on every endpoint, and
   * this only decides which front door an account may use.
   */
  @IsOptional()
  @IsEnum(LoginPortal)
  portal?: LoginPortal;
}
