import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ModuleProgress } from '../../components/assessment/ModuleProgress';
import { ProctoringBar } from '../../components/assessment/ProctoringBar';
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
 */
export function TakeAssessment() {
  const { invitationId } = useParams<{ invitationId: string }>();
  const { step, error, loading, busy, answer, startModule, refresh } =
    useSession(invitationId);

  const proctoring = useProctoring(
    step?.session.sessionId ?? null,
    // Monitoring runs from the moment the session opens until it is submitted,
    // including the between-module screens.
    step !== null && step.state !== 'completed',
  );

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
            Thanks — your answers for <strong>{step.session.assessmentTitle}</strong>{' '}
            are in. You answered {answered} question{answered === 1 ? '' : 's'}{' '}
            across {step.session.modules.length} section
            {step.session.modules.length === 1 ? '' : 's'}.
          </p>
          <p className="muted small">
            Results go to the recruiting team. You will hear from them directly —
            there is nothing else to do here.
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
            <div className="row">
              <button
                type="button"
                onClick={() => void proctoring.startCamera()}
                disabled={
                  proctoring.camera === 'active' ||
                  proctoring.camera === 'starting' ||
                  proctoring.camera === 'unsupported'
                }
              >
                {proctoring.camera === 'active'
                  ? 'Camera ready'
                  : proctoring.camera === 'starting'
                    ? 'Starting…'
                    : proctoring.camera === 'denied'
                      ? 'Retry camera access'
                      : 'Turn on camera'}
              </button>
              {proctoring.camera === 'denied' && (
                <span className="muted small">
                  Camera access was blocked. Allow the camera for this site in
                  your browser's settings, then retry — a camera is required
                  to begin.
                </span>
              )}
              {proctoring.camera === 'unsupported' && (
                <span className="muted small">
                  This browser or device doesn't support the required camera
                  check, so the assessment can't be started here. Try a
                  recent version of Chrome or Edge on a device with a camera.
                </span>
              )}
            </div>
          </div>

          {error && <div className="alert error">{error}</div>}

          <p className="muted small">
            The clock starts when you press begin, not before.
          </p>
          {!cameraReady && (
            <p className="muted small">
              Turn on your camera above to begin — it's required for this
              assessment.
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
        onSubmit={(option) => void answer(step.question.id, option)}
      />
    </div>
  );
}
