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
