import type { Logger } from '@nestjs/common';

/**
 * Reports a broken Redis connection once per state change, not once per retry.
 *
 * ioredis reconnects forever, and every failed attempt raises another `error`.
 * A local Redis that is down for forty minutes therefore produces hundreds of
 * identical events, and printing each one buries whatever the developer was
 * actually reading — including the line that says how to fix it.
 *
 * So the code is remembered and repeats are dropped; `reset()` is called when
 * the connection comes back, so a *second* outage is reported again rather than
 * swallowed as a duplicate of the first.
 *
 * The rule lives here because two very different callers need it and must not
 * drift: the shared client in `redis.module.ts`, and every BullMQ queue and
 * worker in `queue-errors.module.ts`.
 */
export function connectionErrorReporter(
  logger: Logger,
  /** Called with the error code, only when it differs from the last one. */
  describe: (code: string) => string,
): { report: (err: unknown) => void; reset: () => void } {
  let lastCode: string | null = null;

  return {
    report(err: unknown) {
      const code = errorCode(err);
      if (code === lastCode) return;
      lastCode = code;
      logger.error(describe(code));
    },
    reset() {
      lastCode = null;
    },
  };
}

/**
 * The shortest honest name for what went wrong.
 *
 * `AggregateError` is what a dual-stack host produces when both `::1` and
 * `127.0.0.1` refuse the connection, and its own `message` is empty — so
 * reading `.message` first would report the failure as a blank string. Its
 * `code` is set, which is why that comes first.
 */
function errorCode(err: unknown): string {
  if (typeof err !== 'object' || err === null) return String(err);
  const candidate = err as NodeJS.ErrnoException;
  return candidate.code ?? candidate.message ?? candidate.name ?? 'unknown';
}
