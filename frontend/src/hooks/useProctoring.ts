import { useCallback, useEffect, useRef, useState } from 'react';
import { startFaceMonitor, type FaceMonitor } from '../lib/face-detection';
import {
  PROCTORING_EVENT,
  connectProctoring,
  type ProctoringEvent,
  type ProctoringEventType,
} from '../lib/socket';
import type { Socket } from 'socket.io-client';

/** How often the webcam is sampled. Often enough to notice, cheap enough to run. */
const FACE_POLL_MS = 5000;

export type CameraState =
  | 'idle'
  | 'starting'
  | 'active'
  | 'denied'
  | 'unsupported';

interface Proctoring {
  connected: boolean;
  isFullscreen: boolean;
  enterFullscreen: () => Promise<void>;
  camera: CameraState;
  startCamera: () => Promise<void>;
  /** Short user-facing notice for the most recent signal, if any. */
  notice: string | null;
  dismissNotice: () => void;
}

/** `window.screen.isExtended` and `getScreenDetails` aren't in lib.dom yet. */
interface ScreenDetails {
  screens: unknown[];
}
type WindowManagement = Window & {
  getScreenDetails?: () => Promise<ScreenDetails>;
};

/**
 * The four proctoring signals, wired to the session's socket.
 *
 * Everything here detects and reports; nothing a candidate does mid-test
 * blocks, ends or fails it — a tab switch, a full-screen exit, a face going
 * briefly out of frame are all just recorded for the recruiter to judge.
 *
 * The one exception is the camera itself: it must be on before a module can
 * begin (enforced in TakeAssessment via `camera === 'active'`), because face
 * presence can't be evaluated at all without it. That's a start-of-test
 * prerequisite, not a mid-test penalty, so it doesn't change the "detect and
 * log, never auto-disqualify" handling of what happens once the camera is on.
 *
 * None of that belongs in the strings below. Telling a candidate mid-test that
 * a violation carries no consequence is an invitation to commit one, so the
 * notices state what was recorded and stop there. Keep it that way.
 */
export function useProctoring(
  sessionId: string | null,
  active: boolean,
): Proctoring {
  const [connected, setConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    () => document.fullscreenElement !== null,
  );
  const [camera, setCamera] = useState<CameraState>(() =>
    // `mediaDevices` is typed as always present but is genuinely undefined on
    // an insecure origin, so this is a runtime check, not a type guard.
    typeof navigator.mediaDevices?.getUserMedia === 'function'
      ? 'idle'
      : 'unsupported',
  );
  const [notice, setNotice] = useState<string | null>(null);
  // Which signal produced the notice currently on screen, so a later, unrelated
  // signal doesn't wipe it, and so the face monitor can safely clear its own
  // notice without touching a tab-switch or full-screen one.
  const noticeSourceRef = useRef<'fullscreen' | 'tab' | 'face' | null>(null);

  const showNotice = useCallback(
    (text: string, source: 'fullscreen' | 'tab' | 'face') => {
      noticeSourceRef.current = source;
      setNotice(text);
    },
    [],
  );

  const socketRef = useRef<Socket | null>(null);
  const monitorRef = useRef<FaceMonitor | null>(null);

  // ── Socket ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId || !active) return;

    const socket = connectProctoring();
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      socket.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [sessionId, active]);

  const emit = useCallback(
    (eventType: ProctoringEventType, metadata?: Record<string, unknown>) => {
      if (!sessionId) return;
      const event: ProctoringEvent = {
        sessionId,
        eventType,
        occurredAt: new Date().toISOString(),
        metadata,
      };
      // Fire and forget: a dropped signal must never interrupt the test.
      socketRef.current?.emit(PROCTORING_EVENT, event);
    },
    [sessionId],
  );

  // ── Fullscreen ─────────────────────────────────────────────────────────

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Denied or unsupported (some browsers block it outside a gesture).
      // Nothing to do — the exit signal simply never fires.
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    const onChange = () => {
      const nowFullscreen = document.fullscreenElement !== null;
      setIsFullscreen(nowFullscreen);
      if (!nowFullscreen) {
        emit('fullscreen_exit');
        showNotice('Full-screen exit recorded.', 'fullscreen');
      }
    };

    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [active, emit, showNotice]);

  // ── Tab switching ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      // Only the leaving edge is a signal; coming back is not a second one.
      if (document.visibilityState !== 'hidden') return;
      emit('tab_switch');
      showNotice('You switched away from the test. This has been recorded.', 'tab');
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, emit, showNotice]);

  // ── Multiple displays ──────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const check = async () => {
      let screenCount: number | null = null;

      const managed = window as WindowManagement;
      if (managed.getScreenDetails) {
        try {
          const details = await managed.getScreenDetails();
          screenCount = details.screens.length;
        } catch {
          // Permission refused. Fall through to the property below, which
          // needs no permission and is enough for a soft signal.
        }
      }
      if (screenCount === null && 'isExtended' in window.screen) {
        screenCount = (window.screen as Screen & { isExtended: boolean })
          .isExtended
          ? 2
          : 1;
      }

      // Logged as context for the recruiter, never as a violation: a second
      // monitor is normal on plenty of desks.
      if (!cancelled && screenCount !== null && screenCount > 1) {
        emit('multiple_displays_detected', { screenCount });
      }
    };

    void check();
    window.addEventListener('resize', check);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', check);
    };
  }, [active, emit]);

  // ── Face presence ──────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    if (camera === 'active' || camera === 'starting') return;
    setCamera('starting');
    try {
      monitorRef.current = await startFaceMonitor();
      setCamera('active');
    } catch {
      // Denied, no camera, or the model failed to load. The test continues.
      setCamera('denied');
    }
  }, [camera]);

  useEffect(() => {
    if (!active || camera !== 'active') return;

    // Only transitions are reported — a candidate who steps away for a minute
    // should produce one `face_absent`, not twelve.
    let lastState: 'ok' | 'absent' | 'multiple' | null = null;

    const id = window.setInterval(async () => {
      const count = await monitorRef.current?.count();
      if (count === null || count === undefined) return;

      const state = count === 0 ? 'absent' : count > 1 ? 'multiple' : 'ok';
      if (state === lastState) return;
      lastState = state;

      if (state === 'absent') {
        emit('face_absent', { faceCount: 0 });
        showNotice('No face visible to the camera. This has been recorded.', 'face');
      } else if (state === 'multiple') {
        emit('multiple_faces', { faceCount: count });
        showNotice(
          'More than one person is visible to the camera. This has been recorded.',
          'face',
        );
      } else if (noticeSourceRef.current === 'face') {
        // The candidate is back in frame — clear our own notice so it doesn't
        // read as a stuck/glitched warning. Only clear one we set ourselves;
        // an unrelated tab-switch or full-screen notice stays put.
        noticeSourceRef.current = null;
        setNotice(null);
      }
    }, FACE_POLL_MS);

    return () => window.clearInterval(id);
  }, [active, camera, emit, showNotice]);

  // Releases the camera when the test ends or the screen unmounts.
  useEffect(
    () => () => {
      monitorRef.current?.stop();
      monitorRef.current = null;
    },
    [],
  );

  const dismissNotice = useCallback(() => {
    noticeSourceRef.current = null;
    setNotice(null);
  }, []);

  return {
    connected,
    isFullscreen,
    enterFullscreen,
    camera,
    startCamera,
    notice,
    dismissNotice,
  };
}
