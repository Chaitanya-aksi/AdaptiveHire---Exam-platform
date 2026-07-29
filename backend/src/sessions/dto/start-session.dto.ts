import { IsUUID } from 'class-validator';

export class StartSessionDto {
  /** Which invitation the candidate is acting on — their claim to this test. */
  @IsUUID()
  invitationId!: string;
}
