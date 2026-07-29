import { IsEmail, IsString, Length, MinLength } from 'class-validator';

/**
 * Self-service registration always creates a `candidate`. Recruiter/admin
 * accounts are provisioned by seed or by an existing recruiter_admin.
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
}
