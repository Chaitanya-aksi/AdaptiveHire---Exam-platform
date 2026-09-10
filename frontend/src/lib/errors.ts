interface ApiErrorShape {
  response?: {
    status?: number;
    data?: { message?: string | string[] };
  };
}

/**
 * Turns an axios failure into something a recruiter can act on.
 *
 * 429 in particular deserves naming: a generic "could not load" sends people
 * hunting for a bug when the API is simply asking them to slow down.
 */
export function describeError(error: unknown, fallback: string): string {
  const { response } = error as ApiErrorShape;

  if (!response) {
    return 'Could not reach the API. Is the backend running on port 3001?';
  }

  if (response.status === 429) {
    return 'The API is rate-limiting this session. Wait a few seconds and try again.';
  }

  if (response.status === 403) {
    return 'Your account does not have access to this.';
  }

  const message = response.data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string') return message;

  return fallback;
}

/**
 * The same, except that the server's own message wins on a 403.
 *
 * `describeError` replaces those with "Your account does not have access to
 * this", which is right almost everywhere: a 403 there comes from a role guard
 * whose message ("Insufficient role for this resource") is written for a
 * developer, and the reader does have an account.
 *
 * It is wrong on the public assessment link, where a 403 is the *answer* — this
 * round has closed, or it only accepts one email domain — and where the reader
 * has no account at all. So that page uses this instead of working around the
 * other one locally.
 */
export function describeServerError(error: unknown, fallback: string): string {
  const { response } = error as ApiErrorShape;

  if (!response) return describeError(error, fallback);
  if (response.status === 429) return describeError(error, fallback);

  const message = response.data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string') return message;

  return fallback;
}
