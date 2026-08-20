/**
 * Where an unhandled UI error goes.
 *
 * A single seam on purpose: every caller reports through here, so the tracking
 * service is one file's concern rather than something spread through the
 * components.
 *
 * Sentry is loaded *dynamically*, and only when a DSN is configured. The SDK is
 * a few tens of kilobytes, and a candidate on a phone about to sit a timed test
 * should not download it so that it can do nothing — the same reasoning that
 * already keeps face-api.js out of the main bundle.
 */

type SentryModule = typeof import('@sentry/react');

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let sentry: SentryModule | null = null;
let loading: Promise<SentryModule | null> | null = null;

function loadSentry(): Promise<SentryModule | null> {
  if (!dsn) return Promise.resolve(null);

  loading ??= import('@sentry/react')
    .then((mod) => {
      mod.init({
        dsn,
        environment: import.meta.env.MODE,
        // Off unless asked for: traces carry the URLs of assessment routes,
        // which contain invitation ids.
        tracesSampleRate: 0,
      });
      sentry = mod;
      return mod;
    })
    .catch(() => {
      // Tracking failing to load must never be visible to a candidate, and must
      // never take the page down with it.
      return null;
    });

  return loading;
}

export interface ErrorContext {
  /** Where it happened, e.g. 'assessment-runtime'. */
  boundary?: string;
  /** React's component stack, when the report came from an error boundary. */
  componentStack?: string;
  /**
   * The attempt this happened during, when there is one.
   *
   * This is the field that makes a report actionable: a failure inside a timed,
   * unrepeatable assessment has to be traceable back to the specific attempt,
   * because the candidate cannot simply sit it again to reproduce it.
   */
  invitationId?: string | null;
  sessionId?: string | null;
  [key: string]: unknown;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  // Always, so a developer sees it in the console whether or not tracking is on.
  // eslint-disable-next-line no-console
  console.error('[AdaptiveHire]', context.boundary ?? 'error', error, context);

  if (!dsn) return;

  void loadSentry().then((mod) => {
    if (!mod) return;
    mod.captureException(error, {
      tags: { boundary: context.boundary ?? 'unknown' },
      // Identifiers only. Never the candidate's name or email — an error
      // tracker is not a place to accumulate a second copy of the directory.
      contexts: {
        attempt: {
          invitationId: context.invitationId ?? null,
          sessionId: context.sessionId ?? null,
        },
      },
      extra: { componentStack: context.componentStack },
    });
  });
}

/** True when reports actually leave the browser. Used for the boot log line. */
export const errorTrackingEnabled = Boolean(dsn);

/** Referenced so the lazily-initialised handle is not flagged as write-only. */
export const isSentryLoaded = (): boolean => sentry !== null;
