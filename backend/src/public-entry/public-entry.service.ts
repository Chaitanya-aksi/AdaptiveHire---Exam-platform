import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService, type AuthResult } from '../auth/auth.service';
import { LoginPortal } from '../auth/dto/login.dto';
import { RegistrationType } from '../auth/dto/register.dto';
import {
  emailAllowedByDomain,
  PUBLIC_LINK_MESSAGE,
  type PublicLinkState,
} from '../assessments/public-link';
import { PublicLinkService } from '../assessments/public-link.service';
import type { Assessment } from '../assessments/entities/assessment.entity';
import { resolveBranding } from '../invitations/candidate-branding';
import { InvitationsService } from '../invitations/invitations.service';
import type { Branding } from '../organisations/organisations.service';
import { UsersService } from '../users/users.service';

/**
 * The candidate's way in through a public link.
 *
 * Everything that grants access here is borrowed rather than rebuilt.
 * `AuthService.register` and `AuthService.login` are the only two things that
 * mint a session on this platform and they stay that way — a second
 * password-checking path would be a second place to get argon2 verification,
 * the portal check, the deactivated-account check and refresh-token rotation
 * wrong, and the one that is used least is the one that would rot.
 *
 * What this file actually owns is narrow: deciding whether the link is open,
 * whether the address may use it, and which of the two existing auth calls to
 * make.
 */

/** What the entry page shows before anybody types anything. */
export interface PublicAssessmentIntro {
  assessment: {
    title: string;
    description: string | null;
    /** Subject names in the order they will be sat. Never their scoring type. */
    sections: { name: string; timeLimitSeconds: number }[];
    totalTimeSeconds: number;
  };
  /** The business asking, resolved by the same rule the portal uses. */
  organisation: Branding;
  state: PublicLinkState;
  /** What to tell the candidate, or null when the link is open. */
  message: string | null;
  /**
   * The domain restriction, if there is one, so the form can say so before
   * somebody types the wrong address rather than after.
   */
  emailDomain: string | null;
}

/**
 * What step one asks step two for.
 *
 * `create` — no account on this address, so the next screen is choose a name
 * and a password. `password` — an account exists, so the next screen asks for
 * the one they already have.
 */
export type EntryStep = 'create' | 'password';

export interface EmailCheckResult {
  step: EntryStep;
  /**
   * The address, normalised. Echoed back so step two is given the same value
   * this decision was made about rather than whatever casing was typed twice.
   */
  email: string;
}

export interface EnterResult extends AuthResult {
  /**
   * The invitation to send them to. Saved a round trip to the assessment list
   * on a page whose entire job is to get somebody into one specific test.
   */
  invitationId: string;
}

/** Where the candidate was when they claimed the link. Recorded, never enforced. */
export interface EntryContext {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class PublicEntryService {
  private readonly logger = new Logger(PublicEntryService.name);

  constructor(
    private readonly links: PublicLinkService,
    private readonly invitations: InvitationsService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The intro screen.
   *
   * A closed link still returns the assessment and who it is for, rather than
   * an error. Somebody holding the URL already knows both, and "AKSI Aerospace
   * — Graduate Aptitude — this assessment has closed" tells them what happened;
   * a bare 403 sends them hunting for a typo that is not there.
   */
  async intro(token: string): Promise<PublicAssessmentIntro> {
    const assessment = await this.resolve(token);
    const state = await this.links.stateOf(assessment);
    const modules = assessment.modules ?? [];

    return {
      assessment: {
        title: assessment.title,
        description: assessment.description,
        sections: modules.map((m) => ({
          name: m.module.name,
          timeLimitSeconds: m.timeLimitSeconds,
        })),
        // The sum of the per-module limits: an upper bound, since a module that
        // finishes early gives its remaining time back.
        totalTimeSeconds: modules.reduce(
          (total, m) => total + m.timeLimitSeconds,
          0,
        ),
      },
      organisation: resolveBranding(
        assessment.organisation,
        assessment.company,
        this.config.get<string | null>('supportEmail') ?? null,
      ),
      state,
      message: state === 'open' ? null : PUBLIC_LINK_MESSAGE[state],
      emailDomain: assessment.publicLinkEmailDomain,
    };
  }

  /**
   * Step one: which of the two screens comes next.
   *
   * This does tell an anonymous caller whether an address has an account, and
   * that is a real cost accepted deliberately. The single-form alternative
   * leaks the same fact — a new address succeeds where an existing one with the
   * wrong password fails — while also asking for a password before it can say
   * that the round is closed, or that this domain is not accepted. Naming the
   * cost: the rate limit on this route is what bounds it, not the shape of the
   * response.
   *
   * Nothing is created here. No account, no invitation, no session.
   */
  async checkEmail(token: string, rawEmail: string): Promise<EmailCheckResult> {
    const assessment = await this.resolve(token);
    await this.assertOpen(assessment);

    const email = rawEmail.trim().toLowerCase();
    this.assertDomainAllowed(assessment, email);

    const existing = await this.users.findByEmail(email);
    return { step: existing ? 'password' : 'create', email };
  }

  /**
   * Step two: admit them.
   *
   * The branch is decided here, from the database, not from what step one
   * returned — a client is free to send anything, and a race between the two
   * steps is enough to make an honest client wrong.
   */
  async enter(
    token: string,
    rawEmail: string,
    password: string,
    fullName: string | undefined,
    context: EntryContext,
  ): Promise<EnterResult> {
    const assessment = await this.resolve(token);
    await this.assertOpen(assessment);

    const email = rawEmail.trim().toLowerCase();
    this.assertDomainAllowed(assessment, email);

    const existing = await this.users.findByEmail(email);
    return existing
      ? this.enterWithExistingAccount(assessment, email, password, context)
      : this.enterWithNewAccount(
          assessment,
          email,
          password,
          fullName,
          context,
        );
  }

  /**
   * An address nobody has claimed: create the account and let them in.
   *
   * The invitation is written *before* registering, because
   * `AuthService.register` refuses a candidate who has not been invited. That
   * gate is the reason the candidate side is not full of accounts with nothing
   * to sit, and it is worth keeping — so this satisfies it rather than
   * bypassing it. Registration then backfills `candidateId` through
   * `linkUserToInvitations`, which is what `POST /sessions/start` matches on.
   *
   * If registration fails the invitation is removed again. Leaving it would
   * grant an address access without an account behind it and spend a slot
   * against the link's cap for an attempt that never happened.
   */
  private async enterWithNewAccount(
    assessment: Assessment,
    email: string,
    password: string,
    fullName: string | undefined,
    context: EntryContext,
  ): Promise<EnterResult> {
    const name = fullName?.trim();
    if (!name) {
      throw new BadRequestException('Enter your full name.');
    }

    const { invitation } = await this.invitations.createSelfRegistered(
      assessment.id,
      email,
      // No account yet, so nothing to point at. Registration fills it in.
      null,
      context.ip,
      context.userAgent,
    );

    let result: AuthResult;
    try {
      result = await this.auth.register({
        email,
        password,
        fullName: name,
        // Explicit rather than relying on the default. This endpoint must never
        // be a way to obtain a recruiter account and the workspace that comes
        // with it, and the safe value should be stated where it is read.
        accountType: RegistrationType.CANDIDATE,
      });
    } catch (error) {
      await this.invitations.discardSelfRegistered(invitation.id);
      throw error;
    }

    this.logger.log(
      `New candidate entered assessment ${assessment.id} through its public link`,
    );
    return { ...result, invitationId: invitation.id };
  }

  /**
   * An address that already has an account: prove it, then let them in.
   *
   * The password is not optional and cannot be made so. Candidate accounts are
   * org-less and shared across the companies that invite them, so admitting
   * somebody who merely typed a colleague's address would be account takeover —
   * and would expose that person's attempts for every other employer as well.
   *
   * `portal: candidate` reuses the existing check that keeps each sign-in door
   * to its own audience, so a recruiter's address is refused here with the same
   * 403 and the same message it gets on `/login`.
   *
   * Login runs first, deliberately. A wrong password must not leave an
   * invitation behind — that would let anyone holding the link create rows
   * against any address they can name, and drain the attempt cap while doing it.
   */
  private async enterWithExistingAccount(
    assessment: Assessment,
    email: string,
    password: string,
    context: EntryContext,
  ): Promise<EnterResult> {
    const result = await this.auth.login({
      email,
      password,
      portal: LoginPortal.CANDIDATE,
    });

    const { invitation } = await this.invitations.createSelfRegistered(
      assessment.id,
      email,
      result.user.id,
      context.ip,
      context.userAgent,
    );

    return { ...result, invitationId: invitation.id };
  }

  /**
   * The assessment this token belongs to.
   *
   * A token that matches nothing and a link that was revoked are the same 404
   * with the same wording. They are genuinely the same situation — there is no
   * link here — and distinguishing them would confirm that a token was once
   * real, which is the first thing anyone probing would want to know.
   */
  private async resolve(token: string): Promise<Assessment> {
    const assessment = await this.links.resolveByToken(token);
    if (!assessment) {
      throw new NotFoundException(PUBLIC_LINK_MESSAGE.not_configured);
    }
    return assessment;
  }

  /**
   * Refuses a link that is closed, expired, not open yet or full.
   *
   * Checked again on every write and not merely when the intro loaded: a round
   * can close, or its last slot be taken, between opening the page and
   * submitting the form.
   *
   * The cap is not raced-safe, and does not need to be. Two requests arriving
   * together can both read the same count and both be admitted, so a cap of 50
   * can yield 51. It exists to bound what a leaked link can harvest, not to be
   * an exact quota, and serialising every entry behind a lock would be a real
   * cost for an off-by-one nobody can act on.
   */
  private async assertOpen(assessment: Assessment): Promise<void> {
    const state = await this.links.stateOf(assessment);
    if (state !== 'open') {
      throw new ForbiddenException(PUBLIC_LINK_MESSAGE[state]);
    }
  }

  /**
   * Enforces the link's domain restriction, if it has one.
   *
   * The message names the domain, which is safe: a restriction is a property of
   * a link the recruiter handed to this cohort on purpose, and somebody who
   * mistyped their address deserves to be told which one is wanted rather than
   * guessing.
   */
  private assertDomainAllowed(assessment: Assessment, email: string): void {
    const domain = assessment.publicLinkEmailDomain;
    if (emailAllowedByDomain(email, domain)) return;

    throw new ForbiddenException(
      `This assessment only accepts @${domain} email addresses.`,
    );
  }
}
