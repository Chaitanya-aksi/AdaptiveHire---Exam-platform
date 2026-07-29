import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Invite one candidate from the form, rather than uploading a sheet for them. */
export class CreateInvitationDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(255)
  email!: string;

  /**
   * Optional, and only used to greet them in the invite email — the candidate
   * sets their real name when they register, so a typo here is harmless.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;
}
