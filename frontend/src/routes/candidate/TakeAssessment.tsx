import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ModuleProgress } from '../../components/assessment/ModuleProgress';
import { ProctoringBar } from '../../components/assessment/ProctoringBar';
import { SectionSplash } from '../../components/assessment/SectionSplash';
import { QuestionCard } from '../../components/assessment/QuestionCard';
import { Timer } from '../../components/assessment/Timer';
import { useProctoring } from '../../hooks/useProctoring';
import { useSession } from '../../hooks/useSession';

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * The test itself. Rendered outside the app shell on purpose — there is no
 * navigation, no menu and no way to wander off mid-module by accident.
 *
 * Exported wrapped in its own error boundary, because this is the one screen in
 * the product where a render error costs something irreplaceable: the clock is
 * server-authoritative and BullMQ auto-submits at the deadline, so a blank page
 * here is a candidate losing their attempt to a JavaScript exception while the
 * countdown carries on underneath it.
 *
 * Recovery remounts rather than re-renders, which re-runs `useSession` — and
 * `/sessions/start` rejoins an in-progress session rather than starting a new
 * one, so they come back to the question, clock and answered count the server
 * currently holds.
 */
export function TakeAssessment() {
  // Read here rather than inside the runtime: the boundary has to name the
  // attempt in its report, and it cannot reach anything the subtree that just
  // threw was holding. The invitation id identifies it just as well as the
  // session id and is available before the session exists.
  const { invitationId } = useParams<{ invitationId: string }>();

  return (
    <ErrorBoundary
      name="assessment-runtime"
      context={{ invitationId }}
      fallback={({ reset }) => <RuntimeRecovery onResume={reset} />}
    >
      <AssessmentRuntime />
    </ErrorBoundary>
  );
}

/** Shown in place of the test when the runtime throws. */
function RuntimeRecovery({ onResume }: { onResume: () => void }) {
  return (
    <div className="assess-shell">
      <div className="card card-pad assess-done">
        <h1>This page stopped responding</h1>
        <p className="muted">
          Your answers are recorded on our servers as you submit them, and the
          assessment clock is still running.
        </p>
        <p className="muted small">
          Resuming picks up from the question you were on.
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={onResume}>
            Resume assessment
          </button>
          <Link to="/assessments">
            <button type="button">Back to my assessments</button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function AssessmentRuntime() {
  const { invitationId } = useParams<{ invitationId: string }>();
  const { step, error, loading, busy, answer, startModule, refresh } =
    useSession(invitationId);

  const proctoring = useProctoring(
    step?.session.sessionId ?? null,
    // Monitoring runs from the moment the session opens until it is submitted,
    // including the between-module screens.
    step !== null && step.state !== 'completed',
    // Armed only while a question is actually on screen. The away warning and
    // the focus trap would otherwise fire on a section intro, which nags
    // somebody for checking their email between sections.
    step?.state === 'question',
  );

  /*
   * The section splash, between one module and the next.
   *
   * Announced once per section, tracked by index rather than by a flag that
   * gets reset: the intro screen re-renders on every poll, and a boolean would
   * either replay the splash or need clearing from three different places.
   *
   * The first section is deliberately never announced. Getting here at all
   * means passing through the readiness check, which ends on a splash carrying
   * the assessment's own name — a second one a heartbeat later would read as a
   * stutter rather than as a signpost.
   */
  const announced = useRef(0);
  const [announcing, setAnnouncing] = useState<number | null>(null);

  /*
   * Read here rather than at the render site because the decision has to live
   * in an effect: mutating the ref during render is re-run under StrictMode
   * and in concurrent rendering, and a signpost that sometimes marks itself
   * shown without appearing is worse than none.
   */
  const introIndex =
    step?.state === 'module_intro' ? step.session.currentModuleIndex : null;

  useEffect(() => {
    if (introIndex === null || introIndex <= announced.current) return;
    announced.current = introIndex;
    setAnnouncing(introIndex);
  }, [introIndex]);

  // When the local clock hits zero we don't decide anything — we just ask the
  // server what happens next. It owns the deadline.
  const handleExpire = useCallback(() => {
    void refresh();
  }, [refresh]);

  const { enterFullscreen, camera } = proctoring;
  const cameraReady = camera === 'active';
  const beginModule = useCallback(async () => {
    // Camera is mandatory: face presence can't be evaluated at all without
    // it, so a module must never start without it confirmed active. The
    // button below is disabled for the same reason — this guard just makes
    // sure nothing else can call beginModule and skip that check.
    if (!cameraReady) return;
    // Fullscreen has to be requested inside the click that started it, so it
    // rides along with the module start rather than happening on load.
    await enterFullscreen();
    await startModule();
  }, [cameraReady, enterFullscreen, startModule]);

  if (loading) {
    return <div className="assess-shell empty">Loading your assessment…</div>;
  }

  if (error && !step) {
    return (
      <div className="assess-shell">
        <div className="card card-pad stack">
          <div className="alert error" style={{ margin: 0 }}>
            {error}
          </div>
          <Link to="/assessments">Back to my assessments</Link>
        </div>
      </div>
    );
  }

  if (!step) return null;

  if (step.state === 'completed') {
    const answered = step.session.modules.reduce(
      (total, module) => total + module.answered,
      0,
    );

    return (
      <div className="assess-shell">
        <div className="card card-pad assess-done">
          <h1>Assessment submitted</h1>
          <p className="muted">
            Thanks — your answers for{' '}
            <strong>{step.session.assessmentTitle}</strong> are in. You answered{' '}
            {answered} question{answered === 1 ? '' : 's'} across{' '}
            {step.session.modules.length} section
            {step.session.modules.length === 1 ? '' : 's'}.
          </p>
          <p className="muted small">
            Results go to the recruiting team. You will hear from them directly
            — there is nothing else to do here.
          </p>
          {/* This screen is also where somebody lands whose attempt was ended
              for them — auto-submit fires on the deadline whether or not their
              browser was still open, so a power cut looks exactly like a normal
              finish from here. The details page carries the contact route,
              because it is the one that knows which company invited them; this
              is a signpost to it rather than a second copy. */}
          <p className="muted small">
            Interrupted by a power cut or a lost connection?{' '}
            <Link to={`/assessments/${invitationId}`}>
              Open this assessment's details
            </Link>{' '}
            to contact the recruiting team.
          </p>
          <Link to="/assessments">
            <button type="button">Back to my assessments</button>
          </Link>
        </div>
      </div>
    );
  }

  const { session, module } = step;

  if (step.state === 'module_intro') {
    const position = session.currentModuleIndex + 1;
    // Rendered before the intro card rather than instead of it: the splash
    // says *which* section, the card says how long it is and how it is scored.
    if (announcing === session.currentModuleIndex) {
      return (
        <SectionSplash
          title={module.name}
          subtitle={`Section ${position} of ${session.modules.length}. The clock for this one starts when you begin it.`}
          onDone={() => setAnnouncing(null)}
        />
      );
    }

    return (
      <div className="assess-shell">
        <div className="card card-pad assess-intro">
          <p className="assess-eyebrow">
            Section {position} of {session.modules.length} ·{' '}
            {session.assessmentTitle}
          </p>
          <h1>{module.name}</h1>
          {module.description && <p className="muted">{module.description}</p>}

          <ul className="assess-facts">
            <li>
              <strong>{formatMinutes(module.timeLimitSeconds)}</strong>
              <span>Time limit for this section</span>
            </li>
            <li>
              <strong>
                {module.minQuestions}–{module.maxQuestions} questions
              </strong>
              <span>
                {module.scoringType === 'objective'
                  ? 'The questions adapt to your answers, so the exact number varies'
                  : 'Answer honestly — there are no right or wrong answers here'}
              </span>
            </li>
            <li>
              <strong>No going back</strong>
              <span>Each answer is final once you continue</span>
            </li>
          </ul>

          {/*
           * States what is monitored and nothing about what is not — not the
           * camera's on-device processing, not the absence of recording, not
           * what a mid-test violation does or doesn't do. Naming a mid-test
           * limit reads as permission, so that part of the copy sets an
           * expectation and stops. The one named consequence is the camera
           * being required to begin at all, which is a real, enforced gate
           * (see `cameraReady` above) rather than a mid-test penalty, so it's
           * fine — and necessary — to say so plainly. See also ProctoringBar.
           */}
          <div className="assess-monitor">
            <h3>This session is monitored</h3>
            <p className="muted small">
              The assessment runs in full screen with your camera on. A camera
              is required to begin — leaving full screen, switching away from
              the test, and whether a face is present are recorded throughout
              and form part of the record sent to the recruiting team.
            </p>
            {/*
             * A statement in the normal case, a control only when one is
             * needed.
             *
             * The camera turns itself on where permission already stands — see
             * `useProctoring` — which is every candidate who has just come
             * through the readiness check. Offering them a "Turn on camera"
             * button beside a disabled Begin, for a camera the browser has
             * already granted, made a working product look broken.
             */}
            {proctoring.camera === 'active' ? (
              <p className="assess-cam assess-cam--on">
                <span className="assess-cam-dot" aria-hidden="true" />
                Camera on and working.
              </p>
            ) : proctoring.camera === 'starting' ||
              proctoring.camera === 'idle' ? (
              <p className="assess-cam">
                <span className="assess-cam-dot" aria-hidden="true" />
                Starting your camera…
              </p>
            ) : proctoring.camera === 'unsupported' ? (
              <p className="assess-cam assess-cam--bad">
                This browser or device doesn&rsquo;t support the required camera
                check, so the assessment can&rsquo;t be started here. Try a
                recent version of Chrome or Edge on a device with a camera.
              </p>
            ) : (
              <div className="assess-cam assess-cam--bad">
                <p style={{ margin: 0 }}>
                  Camera access was blocked. Allow the camera for this site in
                  your browser&rsquo;s settings, then try again — a camera is
                  required to begin.
                </p>
                <button
                  type="button"
                  style={{ marginTop: 10 }}
                  onClick={() => void proctoring.startCamera()}
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          {error && <div className="alert error">{error}</div>}

          <p className="muted small">
            The clock starts when you press begin, not before.
          </p>
          {/* Only where there is something to do about it. While the camera is
              starting, the button being briefly disabled explains itself. */}
          {(proctoring.camera === 'denied' ||
            proctoring.camera === 'unsupported') && (
            <p className="muted small">
              A working camera is required to begin this assessment.
            </p>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => void beginModule()}
            disabled={busy || !cameraReady}
          >
            {busy ? 'Starting…' : `Begin ${module.name}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="assess-shell">
      <header className="assess-head">
        <div>
          <p className="assess-eyebrow">{session.assessmentTitle}</p>
          <h1>{module.name}</h1>
        </div>
        <Timer
          remainingMs={step.moduleRemainingMs}
          // Re-syncs the countdown to the server's figure on every answer.
          syncKey={`${module.moduleId}:${step.sequenceNumber}`}
          onExpire={handleExpire}
        />
      </header>

      <ModuleProgress
        modules={session.modules}
        currentIndex={session.currentModuleIndex}
        answered={step.moduleProgress.answered}
        min={step.moduleProgress.min}
        max={step.moduleProgress.max}
      />

      <ProctoringBar
        isFullscreen={proctoring.isFullscreen}
        camera={proctoring.camera}
        notice={proctoring.notice}
        onDismissNotice={proctoring.dismissNotice}
        onReturnToFullscreen={() => void proctoring.enterFullscreen()}
      />

      {error && <div className="alert error">{error}</div>}

      <QuestionCard
        question={step.question}
        sequenceNumber={step.sequenceNumber}
        busy={busy}
        onSubmit={(payload) => void answer(step.question.id, payload)}
      />

      {proctoring.away && <AwayWarning count={proctoring.awayCount} />}
    </div>
  );
}

/**
 * The warning shown once a candidate has left the assessment window.
 *
 * One line, pinned above the question and **not dismissable**. Hiding the
 * question was tried and removed: it took the test away from somebody every
 * time focus moved for a reason that was not their doing, while their clock
 * carried on. A standing line does the same job without the test itself
 * becoming the penalty, and without an acknowledge button — which is only ever
 * pressed to make a message go away.
 *
 * Compact because it stands for the rest of the section: a three-line banner
 * that never leaves is a three-line banner pushing the question down the screen
 * for ten minutes. The count sits inline and rises on each further departure,
 * so the state of the attempt stays on screen without growing.
 *
 * It states what was recorded and stops there. It does not promise the attempt
 * is safe — telling a candidate mid-test that a violation carries no
 * consequence is an invitation to commit one — and it does not threaten a
 * penalty this product does not apply.
 */
function AwayWarning({ count }: { count: number }) {
  return (
    <p className="away-warn" role="alert">
      <strong>You left the assessment window.</strong>{' '}
      {count === 1 ? 'Recorded.' : `Recorded — ${count} times this section.`}
    </p>
  );
}
