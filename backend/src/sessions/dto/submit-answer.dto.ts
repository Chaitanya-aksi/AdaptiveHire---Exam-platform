import { IsString, IsUUID, Length } from 'class-validator';

export class SubmitAnswerDto {
  /**
   * Echoed back so a stale tab can't answer the question it *thinks* is on
   * screen — the server rejects anything that isn't the one it served.
   */
  @IsUUID()
  questionId!: string;

  @IsString()
  @Length(1, 16)
  selectedOption!: string;

  // No timeTaken field on purpose: it is derived from the server's serve
  // timestamp, so it can't be under-reported.
}
