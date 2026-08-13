import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Which side of the platform is signing up.
 *
 * Not the same thing as `UserRole`: this is what the person asked for, and the
 * service decides what that earns them. Keeping it separate means the request
 * body can never simply assert `role: 'recruiter_admin'`.
 */
export enum RegistrationType {
  CANDIDATE = 'candidate',
  RECRUITER = 'recruiter',
}

/**
 * Self-service registration for both sides of the platform.
 *
 * Candidates stay invite-only — an account is created only for an email a
 * recruiter has already invited, which is what stops the candidate side filling
 * with accounts that have nothing to sit.
 *
 * Recruiters are open: anyone hiring can sign up, and doing so creates their
 * company workspace. That workspace is the boundary that keeps one customer's
 * assessments, candidates and reports away from every other customer.
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @IsString()
  @Length(2, 150)
  fullName!: string;

  /**
   * Defaults to `candidate` so a client written against the old single-purpose
   * endpoint keeps working, and so the privileged option is never the one you
   * get by leaving a field out.
   */
  @IsOptional()
  @IsEnum(RegistrationType)
  accountType?: RegistrationType;

  /**
   * The company being registered. Required for a recruiter and meaningless for a
   * candidate, who belongs to no company.
   */
  @ValidateIf(
    (dto: RegisterDto) => dto.accountType === RegistrationType.RECRUITER,
  )
  @IsString()
  @Length(2, 200, {
    message: 'Enter your company or organisation name (2-200 characters)',
  })
  organisationName?: string;
}
