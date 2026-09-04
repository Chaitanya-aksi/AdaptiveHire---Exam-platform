import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProctoringEventType, SessionStatus } from '../common/enums';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { ProctoringEventDto } from './dto/proctoring-event.dto';
import { ProctoringLog } from './entities/proctoring-log.entity';

/** How many attempts are listed under each signal on the catalogue page. */
const RECENT_ATTEMPTS_PER_SIGNAL = 5;

/** One attempt that carries a signal, as the catalogue lists it. */
export interface ProctoringSignalAttempt {
  sessionId: string;
  candidateName: string;
  assessmentTitle: string;
  /** The most recent time this signal fired during that attempt. */
  occurredAt: string;
  /** How many times it fired in that one attempt. */
  occurrences: number;
}

/**
 * What one signal type has actually recorded across an organisation.
 *
 * `attempts` is the figure that matters for judgement and `occurrences` the one
 * that flatters: a candidate whose face left frame twelve times in one sitting
 * is one person to think about, not twelve. Both are sent so the page can lead
 * with the honest one.
 */
export interface ProctoringSignalSummary {
  eventType: ProctoringEventType;
  occurrences: number;
  attempts: number;
  lastSeenAt: string | null;
  recent: ProctoringSignalAttempt[];
}

interface CountRow {
  eventType: ProctoringEventType;
  occurrences: string;
  attempts: string;
  lastSeenAt: Date | null;
}

interface RecentRow {
  eventType: ProctoringEventType;
  sessionId: string;
  candidateName: string;
  assessmentTitle: string;
  occurredAt: Date;
  occurrences: string;
}

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

  /**
   * Every signal the platform can record, with what this organisation's own
   * attempts have produced against each one.
   *
   * Every member of the enum is returned whether or not it has ever fired, and
   * that is the point: this is a catalogue of what is watched for, not a list of
   * what went wrong. A recruiter needs to know that ambient noise is measured
   * and that nothing was heard — an absent row would read as a check that does
   * not exist rather than one that found nothing.
   *
   * Scoped through the assessment that owns the session, because a session
   * belongs to a candidate and a candidate belongs to no organisation.
   */
  async signalsForOrganisation(
    organisationId: string,
  ): Promise<ProctoringSignalSummary[]> {
    const [counts, recent] = await Promise.all([
      this.logs.manager.query<CountRow[]>(
        `
        SELECT l."eventType",
               count(*)                       AS occurrences,
               count(DISTINCT l."sessionId")  AS attempts,
               max(l."occurredAt")            AS "lastSeenAt"
          FROM proctoring_logs l
          JOIN assessment_sessions s ON s.id = l."sessionId"
          JOIN assessments a ON a.id = s."assessmentId"
         WHERE a."organisationId" = $1
         GROUP BY l."eventType"
        `,
        [organisationId],
      ),
      /*
       * Collapsed to one row per attempt before the window function runs, so
       * "the five most recent" means five candidates rather than five events —
       * which on a signal that fires repeatedly would otherwise be the same
       * person five times over.
       */
      this.logs.manager.query<RecentRow[]>(
        `
        WITH per_attempt AS (
          SELECT l."eventType",
                 l."sessionId",
                 u."fullName" AS "candidateName",
                 a.title      AS "assessmentTitle",
                 count(*)            AS occurrences,
                 max(l."occurredAt") AS "occurredAt"
            FROM proctoring_logs l
            JOIN assessment_sessions s ON s.id = l."sessionId"
            JOIN assessments a ON a.id = s."assessmentId"
            JOIN users u ON u.id = s."candidateId"
           WHERE a."organisationId" = $1
           GROUP BY l."eventType", l."sessionId", u."fullName", a.title
        ), ranked AS (
          SELECT per_attempt.*,
                 row_number() OVER (
                   PARTITION BY "eventType" ORDER BY "occurredAt" DESC
                 ) AS rn
            FROM per_attempt
        )
        SELECT "eventType", "sessionId", "candidateName", "assessmentTitle",
               "occurredAt", occurrences
          FROM ranked
         WHERE rn <= $2
         ORDER BY "eventType", "occurredAt" DESC
        `,
        [organisationId, RECENT_ATTEMPTS_PER_SIGNAL],
      ),
    ]);

    const byType = new Map(counts.map((row) => [row.eventType, row]));

    return Object.values(ProctoringEventType).map((eventType) => {
      const count = byType.get(eventType);
      return {
        eventType,
        occurrences: Number(count?.occurrences ?? 0),
        attempts: Number(count?.attempts ?? 0),
        lastSeenAt: count?.lastSeenAt?.toISOString() ?? null,
        recent: recent
          .filter((row) => row.eventType === eventType)
          .map((row) => ({
            sessionId: row.sessionId,
            candidateName: row.candidateName,
            assessmentTitle: row.assessmentTitle,
            occurredAt: row.occurredAt.toISOString(),
            occurrences: Number(row.occurrences),
          })),
      };
    });
  }
}
