import { ReportsService, type AttemptListItem } from './reports.service';

type Unranked = Omit<AttemptListItem, 'rank' | 'cohortSize'>;

/**
 * Only the two fields the ranking reads. Everything else on an attempt is
 * carried through untouched, and filling it in here would say nothing about
 * what is under test.
 */
function attempt(sessionId: string, overallScore: number | null): Unranked {
  return { sessionId, overallScore } as Unranked;
}

/**
 * `rankByScore` is private and touches none of the twelve repositories the
 * constructor asks for, so the instance is built from the prototype rather
 * than wired up with a dozen nulls that the test would then have to explain.
 */
function rank(rows: Unranked[]): AttemptListItem[] {
  const service = Object.create(ReportsService.prototype) as {
    rankByScore(rows: Unranked[]): AttemptListItem[];
  };
  return service.rankByScore(rows);
}

/** Position by session id, for readable expectations. */
function positions(rows: AttemptListItem[]): Record<string, number | null> {
  return Object.fromEntries(rows.map((row) => [row.sessionId, row.rank]));
}

describe('ReportsService.rankByScore', () => {
  it('places the highest overall score first', () => {
    const ranked = rank([
      attempt('b', 37.6),
      attempt('a', 57.4),
      attempt('c', 36.7),
    ]);

    expect(positions(ranked)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('leaves the rows in the order they came in', () => {
    // The caller orders the cohort by start date; ranking must annotate that
    // list, not re-sort it under the caller's feet.
    const ranked = rank([attempt('b', 10), attempt('a', 90)]);

    expect(ranked.map((row) => row.sessionId)).toEqual(['b', 'a']);
  });

  it('gives tied scores the same position and skips the ones they used', () => {
    const ranked = rank([
      attempt('a', 80),
      attempt('b', 70),
      attempt('c', 70),
      attempt('d', 60),
    ]);

    expect(positions(ranked)).toEqual({ a: 1, b: 2, c: 2, d: 4 });
  });

  it('handles a tie at the top without inventing a winner', () => {
    const ranked = rank([attempt('a', 50), attempt('b', 50)]);

    expect(positions(ranked)).toEqual({ a: 1, b: 1 });
  });

  it('gives an unscored attempt no position rather than last place', () => {
    const ranked = rank([
      attempt('done', 40),
      attempt('running', null),
      attempt('lowest', 10),
    ]);

    // Null, not 3 — the attempt is unfinished, not the worst in the cohort.
    expect(positions(ranked)).toEqual({ done: 1, running: null, lowest: 2 });
  });

  it('counts only scored attempts in the cohort size', () => {
    const ranked = rank([
      attempt('a', 40),
      attempt('b', null),
      attempt('c', 10),
    ]);

    // Two, not three: the denominator has to match the population the
    // positions are drawn from, or "2nd of 3" would have no third place.
    expect(ranked.every((row) => row.cohortSize === 2)).toBe(true);
  });

  it('reports a cohort of nothing when no attempt is scored', () => {
    const ranked = rank([attempt('a', null), attempt('b', null)]);

    expect(positions(ranked)).toEqual({ a: null, b: null });
    expect(ranked.every((row) => row.cohortSize === 0)).toBe(true);
  });

  it('ranks a single scored attempt first of one', () => {
    const ranked = rank([attempt('only', 12.5)]);

    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].cohortSize).toBe(1);
  });

  it('has nothing to say about an empty cohort', () => {
    expect(rank([])).toEqual([]);
  });
});
