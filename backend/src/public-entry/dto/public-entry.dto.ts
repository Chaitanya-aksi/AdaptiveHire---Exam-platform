import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

/** Step one: who are you? No password yet, and nothing is created. */
export class CheckEmailDto {
  @IsEmail()
  @Length(3, 255)
  email!: string;
}

/**
 * Step two: prove it.
 *
 * `password` means different things in the two cases and the client is told
 * which by step one — a new address is *choosing* one, an existing address is
 * *entering* the one they already have. The server does not take the client's
 * word for which case it is; it looks the address up again.
 *
 * `fullName` is only read when an account is being created. Ignored otherwise,
 * so somebody signing in cannot rename their own account through this door.
 */
export class PublicEnterDto {
  @IsEmail()
  @Length(3, 255)
  email!: string;

  // The floor the change-password endpoint already enforces, so a password
  // chosen here is not weaker than one chosen anywhere else.
  @IsString()
  @Length(8, 200)
  password!: string;

  /**
   * Required when an account is being created, ignored when one already
   * exists. The bounds match `RegisterDto` rather than being chosen afresh:
   * the value is handed straight to it, so a wider rule here would only move
   * the rejection one layer down and report it worse.
   */
  @IsOptional()
  @IsString()
  @Length(2, 150)
  fullName?: string;
}
