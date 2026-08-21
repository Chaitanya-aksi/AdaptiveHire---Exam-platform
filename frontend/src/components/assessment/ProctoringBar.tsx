import type { CameraState } from '../../hooks/useProctoring';

interface ProctoringBarProps {
  isFullscreen: boolean;
  /**
   * The browser's own F11 full screen. Only ever true here alongside
   * `isFullscreen` being false, which is the case worth wording differently —
   * see the alert below.
   */
  browserFullscreen: boolean;
  camera: CameraState;
  notice: string | null;
  onDismissNotice: () => void;
  onReturnToFullscreen: () => void;
}

const CAMERA_LABEL: Record<CameraState, string> = {
  idle: 'Camera off',
  starting: 'Starting camera…',
  active: 'Camera on',
  denied: 'Camera unavailable',
  unsupported: 'Camera unsupported',
};

/**
 * The candidate's view of what is being monitored.
 *
 * Shown rather than hidden on purpose: a candidate who can see that leaving
 * full screen is recorded is far less likely to do it, and being open about
 * the monitoring is the fair way to run it.
 *
 * Every string here states what is recorded and stops there. It never names a
 * consequence the system does not enforce, and it never names a limit — "this
 * will not end your test" is an accurate sentence that reads as permission,
 * so it is not said.
 */
export function ProctoringBar({
  isFullscreen,
  browserFullscreen,
  camera,
  notice,
  onDismissNotice,
  onReturnToFullscreen,
}: ProctoringBarProps) {
  return (
    <>
      <div className="assess-proctor">
        <span className={isFullscreen ? 'ok' : 'off'}>
          {isFullscreen ? 'Full screen' : 'Not full screen'}
        </span>
        <span className={camera === 'active' ? 'ok' : 'off'}>
          {CAMERA_LABEL[camera]}
        </span>
        <span className="muted">This session is monitored and recorded.</span>
      </div>

      {!isFullscreen && (
        <div className="alert warn assess-proctor-alert">
          {/*
            Two wordings, because they are two different situations to the
            person reading. Told "you are not in full screen" while looking at a
            full-screen window, a candidate reasonably concludes the app is
            broken and keeps going. The second sentence names what they can see
            and gives them the one action that works.
          */}
          <span>
            {browserFullscreen
              ? 'Full screen was opened by the browser rather than by the assessment. This has been recorded. Use the button below to continue.'
              : 'You are not in full screen. This has been recorded. Return to full screen to continue the assessment.'}
          </span>
          <button type="button" onClick={onReturnToFullscreen}>
            Return to full screen
          </button>
        </div>
      )}

      {notice && (
        <div className="alert warn assess-proctor-alert">
          <span>{notice}</span>
          <button type="button" className="link" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
