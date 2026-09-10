import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvitationSource } from '../common/enums';
import { Invitation } from '../invitations/entities/invitation.entity';
import { Assessment } from './entities/assessment.entity';
import {
  generatePublicLinkToken,
  hashPublicLinkToken,
  publicLinkState,
  type PublicLinkState,
} from './public-link';

/**
 * Owns the lifecycle of an assessment's public link: minting the token,
 * changing its settings, and resolving one back to an assessment.
 *
 * Separate from `AssessmentsService` because the two answer different
 * questions. That one is about what an assessment *is* and is scoped to an
 * organisation on every path. This one has a deliberately unscoped lookup —
 * `resolveByToken` is reached by an anonymous candidate who has no
 * organisation — and keeping that in its own file makes the exception visible
 * rather than buried among tenant-scoped methods.
 */

/** The link's settings, as a recruiter sees and edits them. */
export interface PublicLinkView {
  configured: boolean;
  enabled: boolean;
  expiresAt: Date | null;
  maxAttempts: number | null;
  emailDomain: string | null;
  /** How many self-registered attempts the link has produced so far. */
  attemptsUsed: number;
  state: PublicLinkState;
}

export interface PublicLinkSettings {
  enabled?: boolean;
  /**
   * A `Date` or an ISO string, normalised in one place below. The wire always
   * carries a string and the tests are clearer with a Date; converting at the
   * single point that assigns it beats a mapper at each of the two callers.
   */
  expiresAt?: Date | string | null;
  maxAttempts?: number | null;
  emailDomain?: string | null;
}

/** A freshly minted link: the URL to share, and the settings it was made with. */
export interface MintedPublicLink {
  /** The full URL a candidate opens. Shown once and never recoverable. */
  url: string;
  link: PublicLinkView;
}

@Injectable()
export class PublicLinkService {
  constructor(
    @InjectRepository(Assessment)
    private readonly assessments: Repository<Assessment>,
    // The repository rather than InvitationsService, deliberately: that service
    // already depends on AssessmentsService, and reaching back the other way
    // would close a circle for the sake of one count.
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Mints a token, replacing any existing one.
   *
   * **The raw token is returned exactly once and never stored.** Only its hash
   * is persisted, so a recruiter who loses the link has to rotate rather than
   * look it up — the same bargain password resets make, and for the same
   * reason: a credential in the database is a credential in every backup.
   *
   * Rotating invalidates the previous link immediately, which is the intended
   * way to revoke one that has spread further than meant.
   */
  async rotate(
    assessmentId: string,
    organisationId: string,
    settings: PublicLinkSettings = {},
  ): Promise<MintedPublicLink> {
    const assessment = await this.owned(assessmentId, organisationId);
    const { token, hash } = generatePublicLinkToken();

    assessment.publicLinkTokenHash = hash;
    // Rotating turns the link on unless the caller says otherwise: minting a
    // link nobody can use is not a thing anyone means to do.
    assessment.publicLinkEnabled = settings.enabled ?? true;
    this.applySettings(assessment, settings);

    await this.assessments.save(assessment);
    return { url: this.urlFor(token), link: await this.describe(assessment) };
  }

  /**
   * The URL a candidate opens, built here rather than in the client.
   *
   * The frontend origin is configuration the server already holds — the same
   * `appUrl` the invite emails and reset links are built from — so a recruiter
   * copying a link cannot end up with one pointing at localhost because they
   * happened to be on a preview build.
   *
   * `/a/` is short on purpose. This gets pasted into WhatsApp messages and job
   * posts, and a long path is one more thing to be mangled in transit.
   */
  private urlFor(token: string): string {
    const appUrl = this.config.getOrThrow<string>('appUrl').replace(/\/+$/, '');
    return `${appUrl}/a/${token}`;
  }

  /**
   * Changes the settings without touching the token, so a round can be closed
   * and reopened without reissuing a link a cohort already holds.
   */
  async update(
    assessmentId: string,
    organisationId: string,
    settings: PublicLinkSettings,
  ): Promise<PublicLinkView> {
    const assessment = await this.owned(assessmentId, organisationId);
    if (settings.enabled !== undefined) {
      assessment.publicLinkEnabled = settings.enabled;
    }
    this.applySettings(assessment, settings);

    await this.assessments.save(assessment);
    return this.describe(assessment);
  }

  /** Removes the link entirely. Existing attempts are untouched. */
  async revoke(
    assessmentId: string,
    organisationId: string,
  ): Promise<PublicLinkView> {
    const assessment = await this.owned(assessmentId, organisationId);
    assessment.publicLinkTokenHash = null;
    assessment.publicLinkEnabled = false;
    await this.assessments.save(assessment);
    return this.describe(assessment);
  }

  /** The current settings and state, for the recruiter's screen. */
  async view(
    assessmentId: string,
    organisationId: string,
  ): Promise<PublicLinkView> {
    return this.describe(await this.owned(assessmentId, organisationId));
  }

  /**
   * The assessment a token belongs to, or null.
   *
   * **Deliberately unscoped**, and one of only a handful of paths that are. An
   * anonymous candidate has no organisation to filter by, and demanding one
   * would make the entry page unreachable — the same reasoning as
   * `AssessmentsService.findOneForSession`. What stands in for tenancy here is
   * the token itself: 256 bits of randomness, so possession is the proof.
   *
   * Looked up by hash, so the raw token never appears in a query, a log or a
   * slow-query trace.
   */
  async resolveByToken(token: string): Promise<Assessment | null> {
    const trimmed = token?.trim();
    if (!trimmed) return null;

    return this.assessments.findOne({
      where: { publicLinkTokenHash: hashPublicLinkToken(trimmed) },
      relations: {
        modules: { module: true },
        organisation: true,
        company: true,
      },
      order: { modules: { displayOrder: 'ASC' } },
    });
  }

  /**
   * How many attempts this link has produced.
   *
   * Counts self-registered invitations only. A recruiter inviting people by
   * name should not eat into a cap that exists to bound what a *leaked* link
   * can harvest.
   */
  attemptsUsed(assessmentId: string): Promise<number> {
    return this.invitations.count({
      where: { assessmentId, source: InvitationSource.SELF },
    });
  }

  /** Whether the link admits anyone right now, and if not, why. */
  async stateOf(assessment: Assessment): Promise<PublicLinkState> {
    return publicLinkState(assessment, await this.attemptsUsed(assessment.id));
  }

  private applySettings(
    assessment: Assessment,
    settings: PublicLinkSettings,
  ): void {
    if (settings.expiresAt !== undefined) {
      assessment.publicLinkExpiresAt = settings.expiresAt
        ? new Date(settings.expiresAt)
        : null;
    }
    if (settings.maxAttempts !== undefined) {
      assessment.publicLinkMaxAttempts = settings.maxAttempts;
    }
    if (settings.emailDomain !== undefined) {
      // Stored without a leading @ and lowercased, so the comparison in
      // `emailAllowedByDomain` has one shape to deal with rather than four.
      assessment.publicLinkEmailDomain =
        settings.emailDomain?.trim().toLowerCase().replace(/^@/, '') || null;
    }
  }

  private async describe(assessment: Assessment): Promise<PublicLinkView> {
    const attemptsUsed = await this.attemptsUsed(assessment.id);
    return {
      configured: assessment.publicLinkTokenHash !== null,
      enabled: assessment.publicLinkEnabled,
      expiresAt: assessment.publicLinkExpiresAt,
      maxAttempts: assessment.publicLinkMaxAttempts,
      emailDomain: assessment.publicLinkEmailDomain,
      attemptsUsed,
      state: publicLinkState(assessment, attemptsUsed),
    };
  }

  /**
   * The assessment, and only if the asking organisation owns it.
   *
   * 404 rather than 403 for somebody else's, as everywhere else here: a 403
   * confirms the id exists, which turns this into a way to enumerate other
   * customers' assessments.
   */
  private async owned(id: string, organisationId: string): Promise<Assessment> {
    const assessment = await this.assessments.findOne({
      where: { id, organisationId },
    });
    if (!assessment) throw new NotFoundException(`Assessment ${id} not found`);
    return assessment;
  }
}
