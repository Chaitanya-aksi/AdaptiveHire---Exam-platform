import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThanOrEqual, type FindManyOptions } from 'typeorm';
import { SessionStatus } from '../common/enums';
import { AssessmentSession } from './entities/assessment-session.entity';
import { ExpiredSessionSweeper } from './expired-session-sweeper.service';
import { SessionsService } from './sessions.service';

/**
 * The sweep runs unattended on boot, on the one path where nothing is watching.
 * Its failure modes are all quiet — it can sweep nothing, sweep too eagerly, or
 * die on the first bad row — so each is pinned here rather than trusted.
 */
describe('ExpiredSessionSweeper', () => {
  // Typed rather than bare `jest.fn()`, so the assertions on what the sweep
  // asked the database for stay type-checked instead of silently `any`.
  // Behaviour comes from `beforeEach`; these only carry the signature.
  const find = jest.fn<
    Promise<{ id: string }[]>,
    [FindManyOptions<AssessmentSession>]
  >();
  const autoSubmitSession = jest.fn<Promise<boolean>, [string]>();

  const build = async (): Promise<ExpiredSessionSweeper> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExpiredSessionSweeper,
        { provide: getRepositoryToken(AssessmentSession), useValue: { find } },
        { provide: SessionsService, useValue: { autoSubmitSession } },
      ],
    }).compile();
    return moduleRef.get(ExpiredSessionSweeper);
  };

  /** Runs the private sweep directly; the bootstrap hook only delays it. */
  const sweep = async (sweeper: ExpiredSessionSweeper): Promise<void> =>
    (sweeper as unknown as { sweep: () => Promise<void> }).sweep();

  /** The options the sweep passed to `find`. */
  const findOptions = (): FindManyOptions<AssessmentSession> =>
    find.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    find.mockResolvedValue([]);
    autoSubmitSession.mockResolvedValue(true);
  });

  it('closes every session found past its deadline', async () => {
    find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    await sweep(await build());

    expect(autoSubmitSession).toHaveBeenCalledTimes(2);
    expect(autoSubmitSession).toHaveBeenCalledWith('a');
    expect(autoSubmitSession).toHaveBeenCalledWith('b');
  });

  it('asks only for in-progress sessions, and only past a grace period', async () => {
    await sweep(await build());

    const where = findOptions().where as {
      status: SessionStatus;
      expiresAt: ReturnType<typeof LessThanOrEqual>;
    };

    expect(where.status).toBe(SessionStatus.IN_PROGRESS);

    // The grace period is what keeps this from racing the delayed job for a
    // session that is one second overdue and already being handled.
    const cutoff = where.expiresAt.value as Date;
    expect(cutoff.getTime()).toBeLessThan(Date.now());
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(60_000);
  });

  it('caps the batch so a backlog cannot stall a boot', async () => {
    await sweep(await build());

    expect(findOptions().take).toBeLessThanOrEqual(50);
  });

  it('does nothing when no session is overdue', async () => {
    await sweep(await build());

    expect(autoSubmitSession).not.toHaveBeenCalled();
  });

  it('keeps going when one session fails to close', async () => {
    find.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    autoSubmitSession.mockRejectedValueOnce(new Error('deadlock'));

    await expect(sweep(await build())).resolves.toBeUndefined();

    // One bad row must not abandon the rest of the batch.
    expect(autoSubmitSession).toHaveBeenCalledTimes(3);
  });

  it('swallows a database failure rather than taking the instance down', async () => {
    find.mockRejectedValue(new Error('connection refused'));

    await expect(sweep(await build())).resolves.toBeUndefined();
  });

  it('does not hold up shutdown with its pending timer', async () => {
    const sweeper = await build();
    sweeper.onApplicationBootstrap();

    const timer = (sweeper as unknown as { timer?: NodeJS.Timeout }).timer;
    expect(timer).toBeDefined();

    sweeper.onModuleDestroy();
    // Nothing should have run: the delay is longer than this test takes.
    expect(find).not.toHaveBeenCalled();
  });
});
