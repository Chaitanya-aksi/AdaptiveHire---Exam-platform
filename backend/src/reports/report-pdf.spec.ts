import { reportFileName } from './report-pdf';
import type { ReportSummaryView } from './reports.service';

/**
 * Only the fields the filename is built from. The rest of the view is a large
 * object that says nothing about what is under test.
 */
function view(
  fullName: string,
  title: string,
  timing: { startedAt: string; submittedAt: string | null },
): ReportSummaryView {
  return {
    candidate: { fullName },
    assessment: { title },
    timing,
  } as ReportSummaryView;
}

describe('reportFileName', () => {
  it('names the file after the candidate, the assessment and the date', () => {
    expect(
      reportFileName(
        view('Priya Raghavan', 'Graduate Analyst 2026', {
          startedAt: '2026-08-04T11:01:00.000Z',
          submittedAt: '2026-08-04T11:14:00.000Z',
        }),
      ),
    ).toBe('adaptivehire-priya-raghavan-graduate-analyst-2026-2026-08-04.pdf');
  });

  it('dates an unfinished attempt from when it started', () => {
    // There is no submission date to use, and a file with no date at all
    // sorts worse in a downloads folder than one dated from the start.
    expect(
      reportFileName(
        view('Sam', 'Ops Screen', {
          startedAt: '2026-07-30T09:00:00.000Z',
          submittedAt: null,
        }),
      ),
    ).toBe('adaptivehire-sam-ops-screen-2026-07-30.pdf');
  });

  it('strips anything that has no business in a response header', () => {
    // This string is interpolated into Content-Disposition between quotes. A
    // quote, a newline or a path separator reaching it is the whole risk.
    const name = reportFileName(
      view('A"B\nC/D\\E', 'Role; drop', {
        startedAt: '2026-01-02T00:00:00.000Z',
        submittedAt: '2026-01-02T00:00:00.000Z',
      }),
    );

    // The newline survives as a separator — it is whitespace, and whitespace
    // becomes a hyphen. What matters is that nothing outside the safe set
    // reaches the header, which the pattern below is the real assertion for.
    expect(name).toBe('adaptivehire-ab-cde-role-drop-2026-01-02.pdf');
    expect(name).toMatch(/^[\w.-]+$/);
  });

  it('keeps accented names readable rather than dropping them', () => {
    expect(
      reportFileName(
        view('José Ñuñez', 'Analyst', {
          startedAt: '2026-03-01T00:00:00.000Z',
          submittedAt: '2026-03-01T00:00:00.000Z',
        }),
      ),
      // Decomposed, then the combining marks fall away: "jose-nunez" beats
      // both "j-uez" and a percent-encoded mess.
    ).toBe('adaptivehire-jose-nunez-analyst-2026-03-01.pdf');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(
      reportFileName(
        view('★★★', '☆☆☆', {
          startedAt: '2026-05-05T00:00:00.000Z',
          submittedAt: '2026-05-05T00:00:00.000Z',
        }),
      ),
    ).toBe('adaptivehire-candidate-assessment-2026-05-05.pdf');
  });

  it('caps each part so a long title cannot run away with the name', () => {
    const name = reportFileName(
      view('Bartholomew', 'A'.repeat(200), {
        startedAt: '2026-05-05T00:00:00.000Z',
        submittedAt: '2026-05-05T00:00:00.000Z',
      }),
    );

    expect(name.length).toBeLessThan(120);
    expect(name.endsWith('-2026-05-05.pdf')).toBe(true);
  });
});
