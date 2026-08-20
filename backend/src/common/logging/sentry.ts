import * as Sentry from '@sentry/nestjs';

/**
 * Error tracking, started before anything else so its instrumentation is in
 * place when the app boots.
 *
 * Entirely optional: with no `SENTRY_DSN` this does nothing and the process runs
 * exactly as before. That is deliberate — a local checkout and CI should not
 * need an account with a third party to start, and nothing here should be able
 * to fail a boot because an external service is unreachable.
 *
 * Called from `main.ts` before `NestFactory.create`, which is the only point
 * early enough for the SDK to patch what it needs to.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,

    // Off by default: performance tracing on an assessment platform samples URLs
    // containing candidate and session ids, and that should be an explicit
    // decision rather than something switched on by supplying a DSN.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),

    /*
     * A last filter before anything leaves the building.
     *
     * The SDK already scrubs common credential shapes, but two things here are
     * specific to this product: the reset token arrives as a query parameter on
     * its own route, and request bodies on the auth routes carry passwords. An
     * error report is not worth leaking either.
     */
    beforeSend(event) {
      if (event.request?.query_string) delete event.request.query_string;
      if (event.request?.data) delete event.request.data;
      if (event.request?.cookies) delete event.request.cookies;
      return event;
    },
  });

  return true;
}
