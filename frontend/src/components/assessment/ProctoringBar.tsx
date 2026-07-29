import type { CameraState } from '../../hooks/useProctoring';

interface ProctoringBarProps {
  isFullscreen: boolean;
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
          <span>
            You are not in full screen. This has been recorded. Return to full
            screen to continue the assessment.
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
