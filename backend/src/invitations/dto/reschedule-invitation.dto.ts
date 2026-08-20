import { IsISO8601, IsOptional, ValidateIf } from 'class-validator';

/**
 * Moves one candidate's window without touching the round.
 *
 * Both fields are optional and both accept `null`, and the two mean different
 * things: omitting a field leaves it as it is, while sending `null` clears the
 * override so that end falls back to the assessment's own window. Without that
 * distinction there would be no way to undo a reschedule.
 *
 * ISO-8601 with an offset, so what arrives is an instant. A recruiter in one
 * time zone scheduling a candidate in another has to mean a moment, not a
 * wall-clock reading, and a bare "2026-09-01T09:00" means neither on its own.
 */
export class RescheduleInvitationDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  opensAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  expiresAt?: string | null;
}
