import { IsEmail, IsEnum, IsString, Length } from 'class-validator';
import { UserRole } from '../../common/enums';

/**
 * Recruiter-provisioned account. Unlike self-service registration this one does
 * accept a role — creating another recruiter_admin is allowed, but only for a
 * caller who already is one. That is the intended path for adding recruiters:
 * public sign-up stays candidate-only, because a self-assigned recruiter
 * account would read the whole question bank, answers included.
 *
 * No password field — the service generates one and returns it once.
 */
export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 150)
  fullName!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
