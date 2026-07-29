import {
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ProctoringEventType } from '../../common/enums';

export class ProctoringEventDto {
  @IsUUID()
  sessionId!: string;

  @IsEnum(ProctoringEventType)
  eventType!: ProctoringEventType;

  /**
   * When the browser saw it. Kept separate from the row's `createdAt` so a
   * delayed or reconnecting client doesn't rewrite the event's real time —
   * and so a wildly wrong client clock is visible rather than hidden.
   */
  @IsISO8601()
  occurredAt!: string;

  /** Event context, e.g. `{ faceCount: 2 }` or `{ screenCount: 3 }`. */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
