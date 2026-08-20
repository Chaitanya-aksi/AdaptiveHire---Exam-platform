import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconArrow } from '../../components/Icons';
import { SectionSplash } from '../../components/assessment/SectionSplash';
import { invitationsApi } from '../../lib/endpoints';
import { watchFaces, type FaceWatcher } from '../../lib/face-detection';
import { OVAL, SETUP_RULE, framing } from '../../lib/face-framing';
import {
  checkBrowser,
  checkConnection,
  checkDisplays,
  checkWindowFills,
  openCamera,
  openMicrophone,
  type CheckResult,
} from '../../lib/system-check';
import type { PracticeQuestion } from '../../lib/types';

/*
 * The gate before the assessment: does this machine work, and do you know what
 * you are about to be asked?
 *
 * Runs once, before the first module, and is reachable any time beforehand from
 * the assessment card — which is the point. An invitation allows exactly one
 * attempt, so "my camera doesn't work" is a thing to discover a week early, not
 * at nine on the morning of.
 *
 * **Every step is live, and re-decides continuously (changed 2026-08-20).**
 * The first version of this wizard asked each question once and remembered the
 * answer, which produced the bug it existed to prevent: the camera step opened
 * a stream, said "Working", and let a candidate through on a completely black
 * frame with no face in it. A device answering is not the same as a device
 * doing its job. So:
 *
 *   - the camera step runs **face detection on the preview**, and passes only
 *     while exactly one face is visible;
 *   - the microphone step passes only once the meter has **actually moved**;
 *   - the screen step re-decides on every `resize`, so un-maximising takes the
 *     pass away again;
 *   - the connection step re-measures on a timer.
 *
 * Continue is bound to the verdict *right now*, not to a verdict from a moment
 * ago — cover the lens after passing and the button disables again.
 */

type StepKey = 'browser' | 'screen' | 'camera' | 'microphone' | 'connection';

interface StepSpec {
  key: StepKey;
  /** Short, for the rail. */
  label: string;
  title: string;
  /** What "good" looks like, in the candidate's terms. */
  guidance: string[];
}

const STEPS: StepSpec[] = [
  {
    key: 'browser',
    label: 'Browser',
    title: 'Your browser',
    guidance: [
      'The assessment needs full screen, camera access and a live connection.',
      'A recent Chrome, Edge, Firefox or Safari has all three.',
    ],
  },
  {
    key: 'screen',
    label: 'Screen',
    title: 'Your screen',
    guidance: [
      'One display only — disconnect a second monitor before you start.',
      'This window has to fill the screen, so nothing else sits beside it.',
    ],
  },
  {
    key: 'camera',
    label: 'Camera',
    title: 'Your camera',
    guidance: [
      'Line your face up inside the oval and look straight at the camera.',
      'Light on your face rather than behind you — a bright window behind you leaves you in shadow.',
      'The camera stays on for the whole assessment. No video is recorded or sent anywhere.',
    ],
  },
  {
    key: 'microphone',
    label: 'Microphone',
    title: 'Your microphone',
    guidance: [
      'Say something — the bar below has to move before you can continue.',
      'If it stays flat, the microphone is muted in your computer settings rather than in the browser.',
      'Noise levels are recorded during the assessment. Audio itself is never recorded or sent anywhere.',
    ],
  },
  {
    key: 'connection',
    label: 'Connection',
    title: 'Your connection',
    guidance: [
      'Answers are saved one at a time, so this needs a steady connection rather than a fast one.',
      'A wired connection, or sitting closer to the router, beats a busy wifi network.',
    ],
  },
];

/**
 * Peak level that counts as the microphone having proved itself.
 *
 * Half of `LOUD_AT` in `audio-monitor.ts`, and the two have to be read
 * together: that one asks "is this room noisy enough to report?", this one only
 * asks "is this device actually picking anything up?", which needs less. For
 * scale, ambient room noise on a quiet desk measures around 0.006 — this sits
 * roughly seven times above that and well under normal speech, so it separates
 * a working microphone from one muted in the OS mixer without demanding that
 * the candidate shout.
 */
const HEARD_AT = 0.04;
/** How often the preview is checked for a face. */
const FACE_POLL_MS = 700;

/**
 * Agreeing samples needed before the verdict flips.
 *
 * Detection is per-frame and a face near a threshold crosses it constantly —
 * measured on a real desk, one sat 0.005 from the vertical limit, which
 * without this would strobe the whole step between pass and fail twice a
 * second. Two samples at `FACE_POLL_MS` is under a second and a half to grant
 * or revoke, which is responsive, and it takes two consecutive bad reads to
 * take a pass away rather than one dropped frame.
 */
const STABLE_SAMPLES = 2;
/** How often the connection is re-measured while its step is on screen. */
const PING_EVERY_MS = 8000;

function StatusDot({ status }: { status: CheckResult['status'] }) {
  const label =
    status === 'ok'
      ? '✓'
      : status === 'warn'
        ? '!'
        : status === 'fail'
          ? '✕'
          : '…';

  return (
    <span className={`sc-dot sc-dot--${status}`} aria-hidden="true">
      {label}
    </span>
  );
}

export function ReadinessCheck() {
  const { invitationId = '' } = useParams();
  const navigate = useNavigate();

  /*
   * The stages of getting into an assessment, in order.
   *
   * The two `splash` phases are branded pauses rather than loading screens.
   * The sample questions and the real assessment deliberately use the same
   * controls, so without a marker between them the moment answers begin to
   * count would pass unannounced — which is the one transition a candidate is
   * entitled to notice.
   */
  const [phase, setPhase] = useState<
    'checks' | 'splash-practice' | 'practice' | 'splash-assessment'
  >('checks');
  const [index, setIndex] = useState(0);
  /** Which steps have been cleared, for the rail. */
  const [cleared, setCleared] = useState<Partial<Record<StepKey, boolean>>>({});
  /** The live verdict for the step on screen. Null while it is being set up. */
  const [result, setResult] = useState<CheckResult | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const meterRef = useRef<HTMLSpanElement | null>(null);
  const [heard, setHeard] = useState(false);
  /** Whether the one face is properly framed. Drives the oval's colour. */
  const [aligned, setAligned] = useState(false);
  /** The caption over the preview. Null until the first frame is read. */
  const [tag, setTag] = useState<string | null>(null);

  /** The assessment's own name, for the splash before it starts. */
  const [assessmentTitle, setAssessmentTitle] = useState<string | null>(null);
  const [practice, setPractice] = useState<PracticeQuestion[] | null>(null);
  const [pIndex, setPIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const step = STEPS[index];
  const passed = result?.status === 'ok';
  const last = index === STEPS.length - 1;

  /** Bumped by "Check again" to force the step's effect to start over. */
  const [attempt, setAttempt] = useState(0);

  /*
   * One effect per visit to a step: it sets the step up, keeps it under
   * observation, and tears everything down on the way out.
   *
   * Deliberately one big effect rather than five small ones. Every branch owns
   * a camera, a microphone, a timer or a listener, and the thing that must
   * never happen is a resource outliving its step — a webcam still running
   * behind the connection screen lights the candidate's camera indicator with
   * nothing on screen to explain it. Colocating setup and cleanup is what makes
   * that checkable by reading.
   */
  useEffect(() => {
    if (phase !== 'checks') return;

    let live = true;
    const cleanups: (() => void)[] = [];

    const publish = (next: CheckResult) => {
      if (live) setResult(next);
    };

    const setup = async () => {
      setResult(null);
      setAligned(false);
      setTag(null);
      setHeard(false);

      switch (step.key) {
        case 'browser':
          publish(checkBrowser());
          return;

        case 'screen': {
          // Two questions the candidate experiences as one: how many screens,
          // and whether this window has the one it is on to itself. Re-run on
          // resize, so un-maximising takes the pass away immediately.
          const evaluate = () => {
            const displays = checkDisplays();
            const fills = checkWindowFills();
            publish(
              displays.status !== 'ok'
                ? displays
                : fills.status !== 'ok'
                  ? fills
                  : {
                      key: 'screen',
                      label: 'Screen',
                      status: 'ok',
                      detail: 'Screen check done. Proceed',
                      fix: null,
                    },
            );
          };

          evaluate();
          window.addEventListener('resize', evaluate);
          cleanups.push(() => window.removeEventListener('resize', evaluate));
          return;
        }

        case 'camera': {
          const { result: opened, stream } = await openCamera();
          if (!live) {
            stream?.getTracks().forEach((track) => track.stop());
            return;
          }

          cleanups.push(() =>
            stream?.getTracks().forEach((track) => track.stop()),
          );

          if (!stream) {
            publish(opened);
            return;
          }

          if (videoRef.current) videoRef.current.srcObject = stream;

          publish({
            key: 'camera',
            label: 'Camera',
            status: 'warn',
            detail: 'Camera on. Looking for your face…',
            fix: null,
          });

          // The camera opening is not the check. This is: a stream that decodes
          // a black frame, or one pointed at the ceiling, passes `getUserMedia`
          // and fails here — which is the bug this step used to have.
          let monitor: FaceWatcher | null = null;
          try {
            monitor = await watchFaces(videoRef.current as HTMLVideoElement);
          } catch {
            publish({
              key: 'camera',
              label: 'Camera',
              status: 'fail',
              detail: 'The face check could not start in this browser.',
              fix: 'Try a recent Chrome or Edge.',
            });
            return;
          }

          if (!live) {
            monitor.stop();
            return;
          }
          cleanups.push(() => monitor?.stop());

          // The last few verdicts, so a single frame cannot grant or revoke a
          // pass on its own. See `STABLE_SAMPLES`.
          const recent: boolean[] = [];

          const poll = window.setInterval(() => {
            void monitor?.faces().then((found) => {
              if (!live || found === null) return;

              const verdict = framing(found, SETUP_RULE);
              recent.push(verdict.ok);
              if (recent.length > STABLE_SAMPLES) recent.shift();

              // Unanimous, in whichever direction. Anything less is a face on
              // the threshold, and the honest answer there is "not yet".
              const settled =
                recent.length === STABLE_SAMPLES &&
                recent.every((ok) => ok === verdict.ok)
                  ? verdict.ok
                  : false;

              // A frame that looks right but has not settled yet is neither a
              // pass nor a complaint — saying "properly framed" beside a
              // disabled button would read as a bug, and repeating the last
              // failure would read as the check ignoring them.
              const settling = verdict.ok && !settled;

              setAligned(settled);
              setTag(settling ? 'Hold still…' : verdict.tag);

              publish({
                key: 'camera',
                label: 'Camera',
                status: settled ? 'ok' : 'warn',
                detail: settling
                  ? 'Almost — hold that position.'
                  : verdict.detail,
                fix: settling ? null : verdict.fix,
              });
            });
          }, FACE_POLL_MS);
          cleanups.push(() => window.clearInterval(poll));
          return;
        }

        case 'microphone': {
          const { result: opened, monitor } = await openMicrophone();
          if (!live) {
            monitor?.stop();
            return;
          }
          cleanups.push(() => monitor?.stop());

          if (!monitor) {
            publish(opened);
            return;
          }

          publish({
            key: 'microphone',
            label: 'Microphone',
            status: 'warn',
            detail: 'Microphone on. Waiting to hear something…',
            fix: null,
          });

          // A device that opens but is muted in the operating system's mixer
          // passes a permission check and moves no meter. Requiring the meter
          // to move is the only way to tell the two apart from in here.
          let frame = 0;
          const tick = () => {
            const level = monitor.level();
            if (meterRef.current) {
              // ×400 because speech sits low on an RMS scale of 0..1. A
              // legibility factor for a bar, not a measurement.
              meterRef.current.style.width = `${Math.min(100, level * 400)}%`;
            }
            if (level >= HEARD_AT) {
              setHeard(true);
              publish({
                key: 'microphone',
                label: 'Microphone',
                status: 'ok',
                // Says what is measured and what is not. The candidate is
                // entitled to know an always-on microphone is not an always-on
                // recording.
                detail:
                  'Microphone functioning perfectly. All the noises are recorded during the assessment.',
                fix: null,
              });
            }
            frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
          cleanups.push(() => cancelAnimationFrame(frame));
          return;
        }

        case 'connection': {
          const measure = async () => {
            const next = await checkConnection(() => invitationsApi.ping());
            publish(next);
          };

          await measure();
          const timer = window.setInterval(() => void measure(), PING_EVERY_MS);
          cleanups.push(() => window.clearInterval(timer));
          return;
        }
      }
    };

    void setup();

    return () => {
      live = false;
      for (const cleanup of cleanups) cleanup();
    };
  }, [phase, step.key, attempt]);

  useEffect(() => {
    if (!invitationId) return;
    // Its real name, not "Your assessment". The splash is the product saying
    // what the candidate is about to sit, and a placeholder there would make
    // the one authentic-feeling screen the vaguest one. A failure is silent:
    // the splash simply falls back, and nothing about starting depends on it.
    invitationsApi
      .mine()
      .then((list) => {
        const mine = list.find((entry) => entry.id === invitationId);
        if (mine) setAssessmentTitle(mine.assessment.title);
      })
      .catch(() => setAssessmentTitle(null));
  }, [invitationId]);

  useEffect(() => {
    if (!invitationId) return;
    invitationsApi
      .practice(invitationId)
      .then(setPractice)
      // An empty or failed practice set must never block the assessment — it is
      // a courtesy, and nobody should lose a sitting because the bank has no
      // samples in it yet.
      .catch(() => setPractice([]));
  }, [invitationId]);

  const begin = useCallback(
    () => navigate(`/assessments/${invitationId}/take`),
    [invitationId, navigate],
  );

  const advance = () => {
    setCleared((current) => ({ ...current, [step.key]: true }));
    if (!last) {
      setIndex(index + 1);
      return;
    }
    // Straight to the assessment splash when there is nothing to practise on,
    // so the checks are never the last thing before a question that counts.
    setPhase(
      practice && practice.length > 0 ? 'splash-practice' : 'splash-assessment',
    );
  };

  if (phase === 'splash-practice') {
    return (
      <SectionSplash
        title="Sample test"
        subtitle="A few untimed questions so the controls are familiar. Nothing here is scored."
        onDone={() => setPhase('practice')}
      />
    );
  }

  if (phase === 'splash-assessment') {
    return (
      <SectionSplash
        title={assessmentTitle ?? 'Your assessment'}
        subtitle="This one counts. The clock starts on the first question and your answers are final."
        onDone={begin}
      />
    );
  }

  if (phase === 'checks') {
    const status = result?.status ?? 'pending';

    return (
      <div className="assess-shell rc-shell">
        <div className="card rc-card">
          <div className="rc-body">
            {/* The rail. Progress and place in one glance, joined by a line so
                it reads as a route rather than as five separate labels. */}
            <ol className="rc-rail" aria-label="Checks">
              {STEPS.map((entry, i) => {
                const done = cleared[entry.key] && i < index;
                return (
                  <li
                    key={entry.key}
                    className={`rc-rail-step${i === index ? ' rc-now' : ''}${
                      done ? ' rc-done' : ''
                    }`}
                    aria-current={i === index ? 'step' : undefined}
                  >
                    <span className="rc-rail-n" aria-hidden="true">
                      {done ? '✓' : i + 1}
                    </span>
                    <span className="rc-rail-label">{entry.label}</span>
                  </li>
                );
              })}
            </ol>

            <div className="rc-main">
              <p className="assess-eyebrow">
                Step {index + 1} of {STEPS.length} · Before you start
              </p>
              <h1>{step.title}</h1>

              <ul className="rc-guide">
                {step.guidance.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              {step.key === 'camera' && (
                <div
                  className={`rc-preview rc-preview--${
                    aligned ? 'ok' : tag === null ? 'wait' : 'bad'
                  }`}
                >
                  {/* Mirrored in CSS: an unmirrored preview of your own face is
                      the one thing everybody finds unsettling. */}
                  <video
                    ref={videoRef}
                    className="rc-video"
                    autoPlay
                    playsInline
                    muted
                  />
                  {/* Positioned from `OVAL` rather than from CSS, so the ring
                      drawn here is provably the ring being measured. */}
                  <span
                    className="rc-frame"
                    aria-hidden="true"
                    style={{
                      left: `${(OVAL.cx - OVAL.rx) * 100}%`,
                      top: `${(OVAL.cy - OVAL.ry) * 100}%`,
                      width: `${OVAL.rx * 200}%`,
                      height: `${OVAL.ry * 200}%`,
                    }}
                  />
                  <span className="rc-frame-tag">{tag ?? 'Looking…'}</span>
                </div>
              )}

              {step.key === 'microphone' && (
                <div className="rc-meter-wrap">
                  <div className="rc-meter" aria-hidden="true">
                    <span ref={meterRef} />
                  </div>
                  <p className="muted small rc-meter-note">
                    {heard
                      ? '✓ Heard you — the microphone is picking up sound.'
                      : 'Say something to see the bar move.'}
                  </p>
                </div>
              )}

              <div className={`rc-result rc-result--${status}`}>
                <StatusDot status={status} />
                <div>
                  <strong>{result?.detail ?? 'Checking…'}</strong>
                  {result?.fix && <div className="sc-fix">{result.fix}</div>}
                </div>
              </div>

              <div className="row rc-actions">
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  disabled={result === null}
                >
                  Check again
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!passed}
                  onClick={advance}
                >
                  {last ? 'Start assessment' : 'Continue'}
                  <IconArrow />
                </button>
                <Link to="/assessments" className="muted small">
                  Back to my assessments
                </Link>
              </div>

              {!passed && result !== null && (
                <p className="muted small rc-blocked">
                  This has to pass before the assessment can start. It is being
                  checked continuously — fix it and this updates on its own.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const question = practice?.[pIndex] ?? null;

  if (!question) {
    return (
      <div className="assess-shell">
        <div className="card card-pad assess-intro">
          <h1>You&rsquo;re all set</h1>
          <p className="muted">
            Everything checked out. The assessment starts as soon as you press
            the button.
          </p>
          <button type="button" className="primary" onClick={begin}>
            Start assessment
            <IconArrow />
          </button>
        </div>
      </div>
    );
  }

  const total = practice?.length ?? 0;
  const lastPractice = pIndex === total - 1;

  return (
    <div className="assess-shell">
      <div className="card pq-card">
        <header className="pq-head">
          <div className="pq-progress" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={`pq-tick${
                  i < pIndex
                    ? ' pq-tick--done'
                    : i === pIndex
                      ? ' pq-tick--now'
                      : ''
                }`}
              />
            ))}
          </div>
          <div className="pq-meta">
            <span>
              Question {pIndex + 1} of {total}
            </span>
            {/* Small, and only once. A candidate has to know these answers go
                nowhere — but a banner saying so turns a rehearsal into a
                disclaimer, and nobody rehearses on a disclaimer. */}
            <span className="pq-chip">Warm-up · not scored</span>
          </div>
        </header>

        <div className="pq-body">
          <p className="pq-module">{question.moduleName}</p>
          {/* Keyed on the question so each one fades in as it arrives, which is
              what stops the screen feeling like a form that swapped its text. */}
          <p className="pq-stem" key={question.id}>
            {question.text}
          </p>

          <ul className="pq-options">
            {question.options.map((option) => {
              const chosen = picked === option.key;

              return (
                <li key={option.key}>
                  <button
                    type="button"
                    className={`pq-option${chosen ? ' pq-option--chosen' : ''}`}
                    aria-pressed={chosen}
                    onClick={() => setPicked(option.key)}
                  >
                    <span className="pq-key">{option.key}</span>
                    <span className="pq-text">{option.text}</span>
                    <span className="pq-mark" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="pq-foot">
          {/* Nothing is marked and nothing is revealed. Answer, move on — the
              point is the controls, not the answers, and a right/wrong verdict
              here only teaches somebody to dread the real thing. */}
          <button
            type="button"
            className="primary pq-next"
            disabled={picked === null}
            onClick={() => {
              if (lastPractice) {
                setPhase('splash-assessment');
                return;
              }
              setPIndex(pIndex + 1);
              setPicked(null);
            }}
          >
            {lastPractice ? 'Start assessment' : 'Next question'}
            <IconArrow />
          </button>
          <Link to="/assessments" className="muted small">
            Back to my assessments
          </Link>
        </footer>
      </div>
    </div>
  );
}
