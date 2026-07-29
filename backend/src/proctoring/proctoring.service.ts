import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionStatus } from '../common/enums';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { ProctoringEventDto } from './dto/proctoring-event.dto';
import { ProctoringLog } from './entities/proctoring-log.entity';

/**
 * Records proctoring signals. Detect and log for recruiter judgment — nothing
 * here ends a session, flags a candidate or changes a score. Violations are
 * data in the report; the hiring decision stays with a person.
 */
@Injectable()
export class ProctoringService {
  private readonly logger = new Logger(ProctoringService.name);

  constructor(
    @InjectRepository(ProctoringLog)
    private readonly logs: Repository<ProctoringLog>,
    @InjectRepository(AssessmentSession)
    private readonly sessions: Repository<AssessmentSession>,
  ) {}

  /**
   * Stores one event, but only for a live session the candidate owns. Returns
   * false when the event is rejected — a closed session must not keep
   * accruing violations from a tab someone left open.
   */
  async record(
    candidateId: string,
    event: ProctoringEventDto,
  ): Promise<boolean> {
    const session = await this.sessions.findOne({
      where: { id: event.sessionId },
      select: { id: true, candidateId: true, status: true },
    });

    if (
      !session ||
      session.candidateId !== candidateId ||
      session.status !== SessionStatus.IN_PROGRESS
    ) {
      return false;
    }

    // save/create rather than insert: TypeORM's insert typing rejects a plain
    // Record for a jsonb column.
    await this.logs.save(
      this.logs.create({
        sessionId: event.sessionId,
        eventType: event.eventType,
        occurredAt: new Date(event.occurredAt),
        metadata: event.metadata ?? null,
      }),
    );

    this.logger.log(
      `Session ${event.sessionId}: ${event.eventType}` +
        (event.metadata ? ` ${JSON.stringify(event.metadata)}` : ''),
    );
    return true;
  }
}
