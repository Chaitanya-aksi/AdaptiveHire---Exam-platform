import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthService, type AuthResult } from '../auth/auth.service';
import { LoginPortal } from '../auth/dto/login.dto';
import { RegistrationType, type RegisterDto } from '../auth/dto/register.dto';
import { PublicLinkService } from '../assessments/public-link.service';
import type { Assessment } from '../assessments/entities/assessment.entity';
import type { Invitation } from '../invitations/entities/invitation.entity';
import { InvitationsService } from '../invitations/invitations.service';
import { UsersService } from '../users/users.service';
import { PublicEntryService, type EntryContext } from './public-entry.service';

/**
 * This is the only unauthenticated way into an assessment, so what is pinned
 * here is mostly what must NOT happen: no session without a password, no
 * invitation left behind by a failed attempt, no writes from a step that only
 * asks a question, and no trusting the client about which branch it is on.
 *
 * The happy paths are covered too, but they are not the reason the file exists.
 */
describe('PublicEntryService', () => {
  const resolveByToken = jest.fn<Promise<Assessment | null>, [string]>();
  const stateOf = jest.fn();
  const createSelfRegistered = jest.fn();
  const discardSelfRegistered = jest.fn();
  const findByEmail = jest.fn();
  // Typed rather than bare, so the assertion on what was passed to register
  // stays checked instead of silently `any`.
  const register = jest.fn<Promise<AuthResult>, [RegisterDto]>();
  const login = jest.fn();

  const CONTEXT: EntryContext = {
    ip: '49.37.10.7',
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
  };

  /** An open link on a two-section assessment, branded by its company. */
  const assessment = (overrides: Partial<Assessment> = {}) =>
    ({
      id: 'assessment-1',
      title: 'Graduate Aptitude',
      description: 'Two sections, 50 minutes.',
      publicLinkEmailDomain: null,
      organisation: {
        name: 'AKSI Aerospace Group',
        logoUrl: null,
        accentColor: '#123456',
        supportEmail: 'careers@aksi.example',
      },
      company: null,
      modules: [
        { module: { name: 'Aptitude' }, timeLimitSeconds: 1800 },
        { module: { name: 'Logical' }, timeLimitSeconds: 1200 },
      ],
      ...overrides,
    }) as unknown as Assessment;

  const session = (id: string): AuthResult => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    user: {
      id,
      email: 'new@college.edu',
      fullName: 'A Candidate',
      role: 'candidate' as never,
      organisationId: null,
      orgRole: null,
      mustChangePassword: false,
    },
  });

  const invitation = (id: string) => ({ id }) as Invitation;

  const build = async (): Promise<PublicEntryService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicEntryService,
        {
          provide: PublicLinkService,
          useValue: { resolveByToken, stateOf },
        },
        {
          provide: InvitationsService,
          useValue: { createSelfRegistered, discardSelfRegistered },
        },
        { provide: UsersService, useValue: { findByEmail } },
        { provide: AuthService, useValue: { register, login } },
        {
          provide: ConfigService,
          useValue: { get: () => 'support@adaptivehire.example' },
        },
      ],
    }).compile();

    return moduleRef.get(PublicEntryService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveByToken.mockResolvedValue(assessment());
    stateOf.mockResolvedValue('open');
    findByEmail.mockResolvedValue(null);
    createSelfRegistered.mockResolvedValue({
      created: true,
      invitation: invitation('invitation-1'),
    });
    discardSelfRegistered.mockResolvedValue(undefined);
    register.mockResolvedValue(session('user-new'));
    login.mockResolvedValue(session('user-existing'));
  });

  describe('the link itself', () => {
    it('shows the assessment, who it is for, and how long it runs', async () => {
      const intro = await (await build()).intro('a-token');

      expect(intro.assessment.title).toBe('Graduate Aptitude');
      expect(intro.assessment.sections.map((s) => s.name)).toEqual([
        'Aptitude',
        'Logical',
      ]);
      expect(intro.assessment.totalTimeSeconds).toBe(3000);
      expect(intro.organisation.name).toBe('AKSI Aerospace Group');
      expect(intro.state).toBe('open');
      expect(intro.message).toBeNull();
    });

    /*
     * A closed round is not an error page. Somebody holding the URL already
     * knows what the assessment is, and naming it alongside "this has closed"
     * is the difference between an answer and a dead end.
     */
    it('still describes a closed round, with the reason', async () => {
      stateOf.mockResolvedValue('expired');

      const intro = await (await build()).intro('a-token');

      expect(intro.assessment.title).toBe('Graduate Aptitude');
      expect(intro.state).toBe('expired');
      expect(intro.message).toBe('This assessment has closed.');
    });

    it('brands by the company the round is for, over the group that owns it', async () => {
      resolveByToken.mockResolvedValue(
        assessment({
          company: {
            name: 'KhetPilot',
            logoUrl: 'https://example.test/kp.png',
            // Unset, so the group's shared inbox is inherited rather than lost.
            accentColor: null,
            supportEmail: null,
          } as never,
        }),
      );

      const intro = await (await build()).intro('a-token');

      expect(intro.organisation.name).toBe('KhetPilot');
      expect(intro.organisation.accentColor).toBe('#123456');
      expect(intro.organisation.supportEmail).toBe('careers@aksi.example');
    });

    /*
     * A token that matches nothing and one that was revoked are the same
     * answer, deliberately. Telling them apart would confirm that a token was
     * once real, which is the first thing anybody probing would want to know.
     */
    it('gives a revoked link and a made-up one the same 404', async () => {
      resolveByToken.mockResolvedValue(null);
      const service = await build();

      await expect(service.intro('nope')).rejects.toThrow(NotFoundException);
      await expect(service.checkEmail('nope', 'a@b.com')).rejects.toThrow(
        'This link is not valid.',
      );
    });
  });

  describe('step one — the email alone', () => {
    it('sends an unknown address to choose a password', async () => {
      const result = await (
        await build()
      ).checkEmail('a-token', 'New@College.edu');

      expect(result.step).toBe('create');
      // Normalised, so step two is given the value this decision was made about.
      expect(result.email).toBe('new@college.edu');
    });

    it('sends a known address to enter the one it has', async () => {
      findByEmail.mockResolvedValue({ id: 'user-existing' });

      const result = await (await build()).checkEmail('a-token', 'known@x.com');

      expect(result.step).toBe('password');
    });

    /* It is a question, not a step. Nothing may exist afterwards that did not
     * before, or the form becomes a way to create rows by typing addresses. */
    it('creates nothing', async () => {
      await (await build()).checkEmail('a-token', 'new@college.edu');

      expect(createSelfRegistered).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
    });

    it('refuses a closed link before asking for anything else', async () => {
      stateOf.mockResolvedValue('full');

      await expect(
        (await build()).checkEmail('a-token', 'new@college.edu'),
      ).rejects.toThrow(
        'This assessment is no longer accepting new candidates.',
      );
      expect(findByEmail).not.toHaveBeenCalled();
    });

    /* The whole reason the email step comes first: a domain refusal is worth
     * far more before somebody has chosen a password than after. */
    it('refuses the wrong domain, and names the right one', async () => {
      resolveByToken.mockResolvedValue(
        assessment({ publicLinkEmailDomain: 'college.edu' }),
      );

      await expect(
        (await build()).checkEmail('a-token', 'someone@gmail.com'),
      ).rejects.toThrow('only accepts @college.edu email addresses');
    });

    it('accepts the restricted domain, whatever the casing', async () => {
      resolveByToken.mockResolvedValue(
        assessment({ publicLinkEmailDomain: 'college.edu' }),
      );

      const result = await (
        await build()
      ).checkEmail('a-token', 'A.Student@College.EDU');

      expect(result.step).toBe('create');
    });
  });

  describe('step two — a new account', () => {
    it('invites first, then registers, then hands back the invitation', async () => {
      const result = await (
        await build()
      ).enter(
        'a-token',
        'New@College.edu',
        'a-good-password',
        'A Candidate',
        CONTEXT,
      );

      expect(createSelfRegistered).toHaveBeenCalledWith(
        'assessment-1',
        'new@college.edu',
        // No account yet, so nothing to point at — registration backfills it.
        null,
        '49.37.10.7',
        'Mozilla/5.0 (Linux; Android 14)',
      );
      expect(register).toHaveBeenCalledWith({
        email: 'new@college.edu',
        password: 'a-good-password',
        fullName: 'A Candidate',
        accountType: RegistrationType.CANDIDATE,
      });
      expect(result.invitationId).toBe('invitation-1');
      expect(result.accessToken).toBe('access');
    });

    /*
     * The order is forced: `AuthService.register` refuses a candidate with no
     * invitation, and that gate is worth keeping rather than working around. It
     * does mean a failure afterwards has to be cleaned up.
     */
    it('writes the invitation before registering, not after', async () => {
      const order: string[] = [];
      createSelfRegistered.mockImplementation(() => {
        order.push('invite');
        return Promise.resolve({
          created: true,
          invitation: invitation('invitation-1'),
        });
      });
      register.mockImplementation(() => {
        order.push('register');
        return Promise.resolve(session('user-new'));
      });

      await (
        await build()
      ).enter('a-token', 'new@college.edu', 'pw', 'A Candidate', CONTEXT);

      expect(order).toEqual(['invite', 'register']);
    });

    /* Otherwise a failed signup leaves an address holding access with no
     * account behind it, and spends a slot against the link's cap. */
    it('takes the invitation back when registration fails', async () => {
      register.mockRejectedValue(new Error('taken'));

      await expect(
        (await build()).enter(
          'a-token',
          'new@college.edu',
          'pw',
          'A Candidate',
          CONTEXT,
        ),
      ).rejects.toThrow('taken');

      expect(discardSelfRegistered).toHaveBeenCalledWith('invitation-1');
    });

    it('asks for a name rather than registering without one', async () => {
      await expect(
        (await build()).enter(
          'a-token',
          'new@college.edu',
          'pw',
          '   ',
          CONTEXT,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(createSelfRegistered).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    });

    /* A public endpoint that could mint a recruiter account would hand out a
     * workspace with it, so the safe value is stated rather than defaulted to. */
    it('never registers anything but a candidate', async () => {
      await (
        await build()
      ).enter('a-token', 'new@college.edu', 'pw', 'A Candidate', CONTEXT);

      expect(register.mock.calls[0][0].accountType).toBe(
        RegistrationType.CANDIDATE,
      );
    });
  });

  describe('step two — an account that already exists', () => {
    beforeEach(() => {
      findByEmail.mockResolvedValue({ id: 'user-existing' });
      createSelfRegistered.mockResolvedValue({
        created: true,
        invitation: invitation('invitation-2'),
      });
    });

    it('signs them in through the candidate door', async () => {
      const result = await (
        await build()
      ).enter('a-token', 'Known@X.com', 'their-password', undefined, CONTEXT);

      expect(login).toHaveBeenCalledWith({
        email: 'known@x.com',
        password: 'their-password',
        // Reuses the existing check that keeps each sign-in page to its own
        // audience, so a recruiter's address is refused here exactly as at /login.
        portal: LoginPortal.CANDIDATE,
      });
      expect(register).not.toHaveBeenCalled();
      expect(result.invitationId).toBe('invitation-2');
    });

    it('links the invitation to the account it just authenticated', async () => {
      await (
        await build()
      ).enter('a-token', 'known@x.com', 'their-password', undefined, CONTEXT);

      expect(createSelfRegistered).toHaveBeenCalledWith(
        'assessment-1',
        'known@x.com',
        'user-existing',
        CONTEXT.ip,
        CONTEXT.userAgent,
      );
    });

    /*
     * The one that matters most. If an invitation were written before the
     * password verified, anyone holding the link could create rows against any
     * address they can name — and drain the attempt cap doing it.
     */
    it('creates nothing when the password is wrong', async () => {
      login.mockRejectedValue(
        new UnauthorizedException('Invalid email or password'),
      );

      await expect(
        (await build()).enter(
          'a-token',
          'known@x.com',
          'wrong',
          undefined,
          CONTEXT,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(createSelfRegistered).not.toHaveBeenCalled();
    });

    /*
     * The branch is decided from the database, not from what step one returned.
     * A client is free to send anything, and a race between the two steps is
     * enough to make an honest one wrong.
     */
    it('ignores a fullName sent for an address that already exists', async () => {
      await (
        await build()
      ).enter(
        'a-token',
        'known@x.com',
        'their-password',
        'Somebody Else',
        CONTEXT,
      );

      expect(login).toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    });

    /* Already invited by a recruiter, then arrived through the link instead.
     * They keep the invitation they had — `created: false` — rather than
     * getting a second one, which the unique constraint would refuse anyway. */
    it('reuses an invitation this address already holds', async () => {
      createSelfRegistered.mockResolvedValue({
        created: false,
        invitation: invitation('invitation-from-recruiter'),
      });

      const result = await (
        await build()
      ).enter('a-token', 'known@x.com', 'their-password', undefined, CONTEXT);

      expect(result.invitationId).toBe('invitation-from-recruiter');
    });
  });

  describe('the link is re-checked on the way in', () => {
    /* A round can close, or its last slot be taken, between the page loading
     * and the form being submitted. */
    it.each([
      ['disabled', 'This assessment is no longer accepting new candidates.'],
      ['expired', 'This assessment has closed.'],
      ['not_yet', 'This assessment has not opened yet.'],
      ['full', 'This assessment is no longer accepting new candidates.'],
    ])('refuses entry on a %s link', async (state, message) => {
      stateOf.mockResolvedValue(state);

      await expect(
        (await build()).enter(
          'a-token',
          'new@college.edu',
          'pw',
          'A Candidate',
          CONTEXT,
        ),
      ).rejects.toThrow(new ForbiddenException(message));

      expect(createSelfRegistered).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
    });

    it('refuses the wrong domain before creating anything', async () => {
      resolveByToken.mockResolvedValue(
        assessment({ publicLinkEmailDomain: 'college.edu' }),
      );

      await expect(
        (await build()).enter(
          'a-token',
          'someone@gmail.com',
          'pw',
          'A Candidate',
          CONTEXT,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(createSelfRegistered).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    });
  });
});
