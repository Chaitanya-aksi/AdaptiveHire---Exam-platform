import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * The knobs on an assessment's public link.
 *
 * Every field is optional and every one of them accepts `null` explicitly,
 * because null and absent mean different things here: absent leaves a setting
 * alone, null clears it. A single body has to be able to say "remove the expiry"
 * without also being read as "remove the cap".
 *
 * `@ValidateIf(value !== null)` is what allows that — the validators below would
 * otherwise reject the null that clears the field.
 */
export class PublicLinkSettingsDto {
  /** Closes or reopens the link without destroying the token behind it. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** When the link stops working. Null returns it to the assessment's window. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;

  /**
   * How many attempts the link may create in total. Null is no cap.
   *
   * The upper bound is a sanity check rather than a product limit — a number
   * past it is a typo, and a cap of a million is indistinguishable from none.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxAttempts?: number | null;

  /**
   * Restricts entry to one email domain. Null accepts any address.
   *
   * A leading `@` is stripped before validation because that is how people
   * naturally type a domain restriction, and rejecting `@college.edu` for a
   * character the service removes anyway would be an unhelpful piece of
   * pedantry.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/^@/, '') : value,
  )
  @IsString()
  @Matches(
    /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
    {
      message: 'Enter a domain like college.edu',
    },
  )
  emailDomain?: string | null;
}
