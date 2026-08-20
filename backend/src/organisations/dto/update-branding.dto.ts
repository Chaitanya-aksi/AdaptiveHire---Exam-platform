import {
  IsEmail,
  IsOptional,
  IsUrl,
  Matches,
  ValidateIf,
} from 'class-validator';

export class UpdateBrandingDto {
  /**
   * Absolute https URL of the company logo, or null to clear it.
   *
   * https only: the candidate portal is served over https, and a http image
   * would be blocked as mixed content — so an http URL is not a preference to
   * respect, it is a logo that will not appear.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  logoUrl?: string | null;

  /**
   * `#rrggbb`, or null to fall back to AdaptiveHire's own accent.
   *
   * Validated as a literal hex triplet rather than accepting any CSS colour
   * string. This value is interpolated into a stylesheet on a page candidates
   * are asked to sign in to, and "any string a customer types" reaching a
   * `style` attribute is how a branding field becomes an injection point.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'accentColor must be a hex colour such as #2f5bea',
  })
  accentColor?: string | null;

  /**
   * Where candidates write when an assessment goes wrong for them, or null to
   * fall back to the platform's own address.
   *
   * Worth setting: the clock is server-authoritative and auto-submit fires
   * whether or not the browser is still open, so a power cut can end somebody's
   * attempt through no fault of theirs — and only the company that invited them
   * can decide what to do about it.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  supportEmail?: string | null;
}
