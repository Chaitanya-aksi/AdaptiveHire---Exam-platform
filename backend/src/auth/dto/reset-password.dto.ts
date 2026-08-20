import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  /** The value from the emailed link, not its stored digest. */
  @IsString()
  @MinLength(1)
  token!: string;

  /**
   * Same floor as registration and the change-password form. Keeping the three
   * in step matters: a reset that accepted a weaker password than registration
   * would be a way around the rule rather than a way back into the account.
   */
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;
}
