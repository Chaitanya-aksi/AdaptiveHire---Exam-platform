import { IsEmail } from 'class-validator';

/**
 * Asks for a reset link. Deliberately carries nothing but the address — no
 * hint about which account, no role, nothing that would let the response vary.
 */
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}
