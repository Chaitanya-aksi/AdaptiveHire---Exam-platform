import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SubNav } from '../../components/SubNav';
import { proctoringApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import { formatWhen } from '../../lib/schedule';
import { ASSESSMENT_TABS } from './section-tabs';
import type {
  ProctoringEventType,
  ProctoringSignalSummary,
} from '../../lib/types';

/**
 * What the platform watches for, and what this workspace has recorded.
 *
 * The catalogue rather than one candidate's timeline, because a count is worth
 * nothing without the sentence next to it. "3 face_absent" invites a recruiter
 * to conclude somebody left the room; what was actually measured is that a
 * browser-side detector found no face on two consecutive reads, which a dark
 * room and a covered lens produce just as reliably. Every entry here therefore
 * states what it measures **and** what it cannot tell you, in the same breath.
 *
 * Per-attempt detail is not duplicated here — it lives on each report, where the
 * events sit beside the answers they interleave with.
 */

interface SignalCopy {
  label: string;
  /** Exactly what produces the event. */
  measures: string;
  /**
   * What it does not establish.
   *
   * Not a disclaimer and not optional. These signals reach hiring decisions, and
   * a signal presented without its limits is read as proof of the worst thing it
   * could mean.
   */
  cannot: string;
}

const SIGNAL_COPY: Record<ProctoringEventType, SignalCopy> = {
  tab_switch: {
    label: 'Left the assessment window',
    measures:
      'The assessment lost focus or was hidden — another tab, another window, or another application. A brief flicker is ignored; focus has to actually go elsewhere and stay there.',
    cannot:
      'It cannot say where they went or why. A notification from the operating system stealing focus counts as leaving, and that false positive is accepted deliberately — the alternative was missing a candidate moving to a second monitor, which only blurs the window and leaves the page visible.',
  },
  fullscreen_exit: {
    label: 'Left full screen',
    measures:
      'Full screen ended while a section was running, almost always by pressing Escape. The candidate is asked to return before they can carry on, and the clock does not stop while they are out.',
    cannot:
      'It cannot say what was on screen instead. Leaving full screen is not the same as looking something up, and by itself it establishes nothing more than that the window changed size.',
  },
  face_absent: {
    label: 'No face in shot',
    measures:
      'The camera saw no face at all, on two consecutive reads about a second apart. Detection runs entirely in the browser: no video is recorded, buffered or sent anywhere, and the platform stores only that this happened and when.',
    cannot:
      'It cannot tell an empty chair from a dark room, a covered lens, or a detector that simply missed a face plainly there. Two agreeing reads are required precisely because one is not reliable enough to put in a hiring record.',
  },
  face_not_framed: {
    label: 'Face out of frame',
    measures:
      'A face is visible but not properly in shot — off to one side, too far from the camera, or pressed against it. The event carries which of the three it was.',
    cannot:
      'It cannot tell leaning back to think from turning away. This is a separate signal from "no face in shot" on purpose: reporting an occupied chair as an empty one would put a claim in somebody\'s report that the measurement does not support.',
  },
  multiple_faces: {
    label: 'More than one person in shot',
    measures:
      'Two or more faces were detected on consecutive reads while a section was running.',
    cannot:
      'It cannot tell who the second face belongs to, whether they spoke, or whether they were even looking at the screen. A person crossing the room behind the candidate, a photograph on the wall and somebody helping all read identically.',
  },
  multiple_displays_detected: {
    label: 'More than one display',
    measures:
      'The machine reported more than one physical display attached when the assessment began.',
    cannot:
      'It cannot see what is on the other screen — or on this one. Two windows side by side on a single monitor are one display, and no browser API can see what is drawn beside the page, so this is a soft signal about the setup rather than evidence about the attempt.',
  },
  background_noise: {
    label: 'Sustained background noise',
    measures:
      'Sound stayed above a threshold for a sustained period while a section was running. The browser reads a level from the microphone and discards the samples immediately.',
    cannot:
      'It cannot tell you what was said, or by whom, or whether it was a person at all — no audio is recorded, buffered, transcribed or transmitted, so the platform never learns anything beyond "it was loud". A television, a lawnmower and a sibling are indistinguishable. A candidate sitting a test in a shared house has done nothing wrong.',
  },
};

/**
 * The three things a signal can be about, in the order a reader cares.
 *
 * Grouped rather than listed flat because the groups answer different
 * questions — did they leave the test, who is in front of the camera, and what
 * is the room like — and the third is much weaker evidence than the first.
 */
const GROUPS: {
  title: string;
  blurb: string;
  types: ProctoringEventType[];
}[] = [
  {
    title: 'Leaving the assessment',
    blurb:
      'The strongest signals here, and still not proof of anything on their own.',
    types: ['tab_switch', 'fullscreen_exit', 'multiple_displays_detected'],
  },
  {
    title: 'In front of the camera',
    blurb:
      'Measured in the browser from the live camera. No video is recorded, stored or transmitted — only these events are.',
    types: ['face_absent', 'face_not_framed', 'multiple_faces'],
  },
  {
    title: 'The room',
    blurb: 'Circumstantial, and often says more about a home than a candidate.',
    types: ['background_noise'],
  },
];

function SignalCard({ signal }: { signal: ProctoringSignalSummary }) {
  const copy = SIGNAL_COPY[signal.eventType];
  const seen = signal.attempts > 0;

  return (
    <article className={`signal-card${seen ? '' : ' signal-card--quiet'}`}>
      <header className="signal-head">
        <div>
          <h3>{copy.label}</h3>
          <code className="muted small">{signal.eventType}</code>
        </div>

        {/*
          Attempts lead, occurrences follow in the smaller line. A candidate
          whose face left frame twelve times in one sitting is one person to
          think about, not twelve, and leading with the larger number would
          make a single restless attempt look like a pattern.
        */}
        <div className="signal-figures">
          {seen ? (
            <>
              <strong>{signal.attempts}</strong>
              <span className="muted small">
                {signal.attempts === 1 ? 'attempt' : 'attempts'} ·{' '}
                {signal.occurrences} recorded
              </span>
            </>
          ) : (
            <span className="badge">Never recorded</span>
          )}
        </div>
      </header>

      <p className="signal-measures">
        <strong>What it measures.</strong> {copy.measures}
      </p>
      <p className="signal-cannot">
        <strong>What it cannot tell you.</strong> {copy.cannot}
      </p>

      {signal.recent.length > 0 && (
        <div className="signal-recent">
          <span className="muted small">
            Most recent
            {signal.lastSeenAt &&
              ` — last seen ${formatWhen(signal.lastSeenAt)}`}
          </span>
          <ul>
            {signal.recent.map((attempt) => (
              <li key={attempt.sessionId}>
                <Link to={`/admin/reports/${attempt.sessionId}`}>
                  {attempt.candidateName}
                </Link>
                <span className="muted small">
                  {' '}
                  · {attempt.assessmentTitle} · {formatWhen(attempt.occurredAt)}
                  {attempt.occurrences > 1 && ` · ×${attempt.occurrences}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function ProctoringSignals() {
  const [signals, setSignals] = useState<ProctoringSignalSummary[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    proctoringApi
      .signals()
      .then((rows) => {
        if (!cancelled) setSignals(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err, 'Could not load proctoring signals.'));
        setSignals([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const byType = new Map((signals ?? []).map((row) => [row.eventType, row]));
  const totalAttempts = (signals ?? []).reduce(
    (most, row) => Math.max(most, row.attempts),
    0,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Assessments</h1>
          <p>
            Everything the platform watches for while a candidate is sitting an
            assessment, what each signal can and cannot tell you, and what your
            own attempts have recorded.
          </p>
          <SubNav items={ASSESSMENT_TABS} />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="stack-lg">
        {/*
          Stated first, because it changes how every number below should be
          read. This is the philosophy the whole feature is built on and it is
          easy to assume the opposite of — most people expect a proctoring page
          to be a list of people who cheated.
        */}
        <div className="card card-pad signal-intro">
          <h2>Nothing here ends an assessment</h2>
          <p>
            Every signal on this page is recorded and shown to you. None of them
            blocks a question, stops a clock, changes a score or fails an
            attempt. They are evidence for you to weigh, and the hiring decision
            stays with a person — yours.
          </p>
          <p className="muted small">
            The only hard requirements sit <em>before</em> an attempt starts: a
            candidate cannot begin until the readiness check passes — browser,
            screen, camera, microphone and connection — and cannot begin a
            section without a working camera. Once they are underway, nothing
            they do can end it early.
          </p>
        </div>

        {signals === null ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            {totalAttempts === 0 && !error && (
              <div className="card empty">
                No signals have been recorded in your workspace yet. Every check
                below is still running on every attempt — this says nothing was
                found, not that nothing was watched for.
              </div>
            )}

            {GROUPS.map((group) => (
              <section key={group.title}>
                <div className="section-head">
                  <h2>{group.title}</h2>
                  <p>{group.blurb}</p>
                </div>

                <div className="signal-list">
                  {group.types.map((type) => {
                    const signal = byType.get(type);
                    // Defensive: the API returns every enum member, so a
                    // missing one means the two have drifted. Rendering
                    // nothing beats crashing a page a recruiter is reading
                    // mid-decision.
                    return signal ? (
                      <SignalCard key={type} signal={signal} />
                    ) : null;
                  })}
                </div>
              </section>
            ))}

            <p className="muted small" style={{ margin: 0 }}>
              Out of scope, deliberately: no video or audio is recorded or
              reviewed, nothing is transcribed, no voice is identified, and no
              attempt is scored by a model. Operating-system level lockdown —
              the kind that would stop the window switcher — needs a native
              application and is not something a web page can do.
            </p>
          </>
        )}
      </div>
    </>
  );
}
