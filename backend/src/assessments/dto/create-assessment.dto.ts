import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { AssessmentModuleConfigDto } from './assessment-module-config.dto';

export class CreateAssessmentDto {
  @IsString()
  @Length(2, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  /** At least one module — an assessment with no modules has nothing to ask. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssessmentModuleConfigDto)
  modules!: AssessmentModuleConfigDto[];

  /**
   * The scheduled window, as ISO-8601 with an offset.
   *
   * Both optional, and absence is meaningful: no window at all means the
   * assessment can be sat from the moment somebody is invited, which is how
   * every assessment behaved before scheduling existed.
   *
   * An offset is required rather than a bare local time — a round scheduled by
   * a recruiter in one time zone and sat by a candidate in another has to mean
   * one instant.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  opensAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  closesAt?: string;

  /**
   * Which questions the engine may draw from. Omit or send an empty list for no
   * restriction, which is the default — the engine then uses everything visible
   * to the organisation. A curated pool narrows the choices without replacing
   * them: the test still adapts question by question within it.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  questionIds?: string[];

  /**
   * Which business in the group the candidate is appearing for.
   *
   * Optional, and omitting it means the workspace's own branding — which is
   * what every assessment did before group companies existed, and what a
   * customer who is a single company always wants.
   *
   * Validated against the caller's own organisation before anything is written.
   * The id comes from a browser, so an unchecked one would let a recruiter put
   * another customer's logo, name and support address in front of their
   * candidates.
   */
  @IsOptional()
  @IsUUID('4')
  companyId?: string;
}
