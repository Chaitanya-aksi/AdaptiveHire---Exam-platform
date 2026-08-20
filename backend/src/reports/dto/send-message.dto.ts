import { IsString, Length } from 'class-validator';

export class SendCandidateMessageDto {
  /**
   * What to say, in the recruiter's own words.
   *
   * The template adds only a greeting, the company's name and a sign-off, so
   * this is the whole message. Bounded at 4000 characters — long enough for
   * anything anyone reasonably writes to a candidate, short enough that a
   * paste of an entire document is rejected here rather than by the SMTP
   * server after the row is already written.
   */
  @IsString()
  @Length(1, 4000)
  message!: string;
}
