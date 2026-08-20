import { useCallback, useEffect, useRef, useState } from 'react';
import { startAudioMonitor, type AudioMonitor } from '../lib/audio-monitor';
import { startFaceMonitor, type FaceMonitor } from '../lib/face-detection';
import { RUNTIME_RULE, framing, type FramingCode } from '../lib/face-framing';
import { permissionState } from '../lib/system-check';
import {
  PROCTORING_EVENT,
  connectProctoring,
  type ProctoringEvent,
  type ProctoringEventType,
} from '../lib/socket';
import type { Socket } from 'socket.io-client';

/** How often the webcam is sampled. Often enough to notice, cheap enough to run. */
const FACE_POLL_MS = 5000;

/**
 * Consecutive bad reads before a framing problem is logged.
 *
 * The readiness check can be strict because it is a setup step with a preview
 * to look at. This is a person sitting an assessment for forty minutes, and
 * "leaned out of frame at 14:32" is noise that buries the events a recruiter
 * should actually read. Two reads at `FACE_POLL_MS` is ten seconds of being
 * genuinely out of position, which is a signal; a glance at the desk is not.
 */
const SUSTAINED_FRAMES = 2;

/**
 * How often the microphone level is read.
 *
 * Faster than the camera because noise is transient — a five-second gap would
 * miss most of a conversation — and far cheaper: it is an array scan, not a
 * neural net. `SUSTAINED_SAMPLES` in the monitor is expressed in these ticks,
 * so the two constants have to be read together.
 */
const AUDIO_POLL_MS = 1500;

export type CameraState =
  'idle' | 'starting' | 'active' | 'denied' | 'unsupported';

/**
 * Same shape as the camera, one meaning apart: `denied` is a normal resting
 * state here, not a problem to solve. A microphone is never required to start.
 */
export type MicrophoneState = CameraState;

interface Proctoring {
  connected: boolean;
  isFullscreen: boolean;
  enterFullscreen: () => Promise<void>;
  /**
   * The candidate has left the window at least once during this module.
   *
   * Sticky and undismissable: it goes true the first time focus leaves and is
   * cleared only when the module ends. There is no acknowledgement, so the
   * warning stands for the rest of the section rather than being clicked away
   * and forgotten.
   */
  away: boolean;
  /** How many times they have left during this module. */
  awayCount: number;
  camera: CameraState;
  startCamera: () => Promise<void>;
  microphone: MicrophoneState;
  startMicrophone: () => Promise<void>;
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

/** Which monitor owns the notice on screen, so each only clears its own. */
type NoticeSource = 'fullscreen' | 'tab' | 'face' | 'noise';

/**
 * The Keyboard Lock API, where the browser has it.
 *
 * Not in `lib.dom` yet, and absent entirely in Firefox and Safari — so every
 * caller has to cope with `undefined` rather than assume it away.
 */
function keyboardLock():
  { lock: (keys?: string[]) => Promise<void>; unlock: () => void } | undefined {
  return (
    navigator as Navigator & {
      keyboard?: {
        lock: (keys?: string[]) => Promise<void>;
        unlock: () => void;
      };
    }
  ).keyboard;
}

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
  /**
   * A module is actually running — a question is on screen and the clock is
   * going.
   *
   * Separate from `active`, which stays true across the between-module screens
   * so the socket and the monitors keep running. Blanking the screen and
   * demanding an acknowledgement on a section intro would punish somebody for
   * checking their email between sections, which is not what any of this is
   * for.
   */
  armed = false,
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
  const [microphone, setMicrophone] = useState<MicrophoneState>(() =>
    typeof navigator.mediaDevices?.getUserMedia === 'function'
      ? 'idle'
      : 'unsupported',
  );
  const [away, setAway] = useState(false);
  const [awayCount, setAwayCount] = useState(0);
  /** Mirrors `away` for the event handlers — see `leave` below for why. */
  const awayRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Which signal produced the notice currently on screen, so a later, unrelated
  // signal doesn't wipe it, and so the face and noise monitors can safely clear
  // their own notices without touching a tab-switch or full-screen one.
  const noticeSourceRef = useRef<NoticeSource | null>(null);

  const showNotice = useCallback((text: string, source: NoticeSource) => {
    noticeSourceRef.current = source;
    setNotice(text);
  }, []);

  const socketRef = useRef<Socket | null>(null);
  const monitorRef = useRef<FaceMonitor | null>(null);
  const audioRef = useRef<AudioMonitor | null>(null);

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

  /**
   * Set just before we drop full-screen ourselves, so the change handler can
   * tell our own exit from the candidate pressing Escape. Without it, ending
   * the test would log a `fullscreen_exit` violation against them for the act
   * of finishing.
   */
  const selfExitRef = useRef(false);

  /**
   * Gives full-screen back, and checks that it actually went.
   *
   * The keyboard is unlocked **first**, explicitly, rather than left to the
   * lock effect's own cleanup. Chrome puts a keyboard-locked full-screen into
   * a "press and hold Escape to exit" mode, and unwinding the lock before
   * asking to leave is the only ordering that does not depend on which React
   * cleanup happens to run first. It is idempotent, so calling it when nothing
   * is locked costs nothing.
   *
   * The result is then verified rather than assumed. `exitFullscreen` can
   * resolve while the browser is still unwinding, and this is the one place
   * where being wrong is visible to the candidate: they finish their
   * assessment and the screen stays locked over their whole desktop.
   */
  const exitFullscreen = useCallback(async () => {
    keyboardLock()?.unlock();

    // Null when the candidate is in the browser's own F11 full-screen, which is
    // not ours to take away — and a no-op besides.
    if (document.fullscreenElement === null) return;

    selfExitRef.current = true;
    try {
      await document.exitFullscreen();
    } catch {
      selfExitRef.current = false;
    }

    // One retry, a moment later. If the first attempt raced the browser's own
    // transition the second one lands; if full-screen is genuinely gone the
    // guard below returns immediately.
    if (document.fullscreenElement === null) return;

    // `setTimeout`, not `requestAnimationFrame`: frames stop being served to a
    // hidden document, and auto-submit can land the attempt on its completed
    // state while the candidate is on another tab — exactly when this must
    // still run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    selfExitRef.current = true;
    try {
      await document.exitFullscreen();
    } catch {
      selfExitRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    const onChange = () => {
      const nowFullscreen = document.fullscreenElement !== null;
      setIsFullscreen(nowFullscreen);
      if (!nowFullscreen) {
        if (selfExitRef.current) {
          selfExitRef.current = false;
          return;
        }
        emit('fullscreen_exit');
        showNotice('Full-screen exit recorded.', 'fullscreen');
      }
    };

    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [active, emit, showNotice]);

  /*
   * Full-screen belongs to the test and has to be handed back when it ends.
   *
   * The full-screen element is `document.documentElement`, which no amount of
   * client-side routing replaces — so without these two effects the browser
   * stayed full-screen through the results screen, through sign-out, and into
   * whoever signed in next. It has to be given back on both edges:
   *
   *  - when monitoring stops (the attempt was submitted, and the candidate is
   *    still sitting on the "Assessment submitted" screen), and
   *  - when this screen goes away while it is still running — the back button,
   *    a link out, sign-out.
   */
  useEffect(() => {
    if (!active) void exitFullscreen();
  }, [active, exitFullscreen]);

  useEffect(() => () => void exitFullscreen(), [exitFullscreen]);

  // ── Leaving the test ───────────────────────────────────────────────────

  /*
   * A browser page cannot stop a candidate switching away, and it is worth
   * being exact about why rather than leaving somebody to discover it.
   * Alt+Tab, Cmd+Tab, the Windows key and Mission Control are handled by the
   * operating system and never reach the page; Ctrl+T, Ctrl+W, Ctrl+N and
   * Ctrl+Tab are reserved by the browser, where `preventDefault` on them does
   * nothing. `navigator.keyboard.lock()` is the closest thing that exists and
   * is explicitly limited to "keys granted access by the underlying operating
   * system" — which does not include the window switcher. Genuine prevention
   * needs a native lockdown client, which CLAUDE.md puts out of scope for v1.
   *
   * So leaving is detected and warned about, hard, and recorded for the
   * recruiter. It is deliberately **not** blanked: hiding the question
   * mid-attempt was tried and removed, because it punishes a candidate for
   * every transient focus change — a notification, an OS dialog, a keyboard
   * user tabbing one step too far — by taking the question away from them
   * while their clock runs.
   *
   * Both `blur` and `visibilitychange` are watched because they catch
   * different things: switching tabs hides the document, while moving to
   * another window on a second monitor only blurs it and leaves it visible.
   */

  /**
   * How long the window has to stay unfocused before it counts as leaving.
   *
   * `blur` alone is far too eager. It fires when focus crosses into the
   * browser's own UI, which a keyboard user does simply by pressing Tab past
   * the last control on the page — and that was reported as the screen going
   * blank while somebody navigated with the keyboard. Anything that returns
   * focus within this window is treated as what it almost always is: focus
   * moving around, not a candidate leaving.
   *
   * `visibilitychange` is not debounced, because a hidden document is
   * unambiguous.
   */
  const AWAY_GRACE_MS = 700;

  useEffect(() => {
    if (!active || !armed) return;

    let pending: ReturnType<typeof setTimeout> | null = null;

    const cancelPending = () => {
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
    };

    const leave = () => {
      // `awayRef` means "currently away", and it exists to make one departure
      // one event: `blur` and `visibilitychange` both fire on an ordinary tab
      // switch. It is a ref rather than the `away` state because doing this
      // inside a state updater would emit twice under StrictMode, where
      // updaters are deliberately re-run.
      if (awayRef.current) return;
      awayRef.current = true;
      emit('tab_switch');
      // Sticky, unlike the ref: the warning stays up for the rest of the
      // module rather than being cleared by coming back.
      setAway(true);
      setAwayCount((n) => n + 1);
      showNotice('You left the assessment. This has been recorded.', 'tab');
    };

    /**
     * Coming back re-arms the detector without clearing the warning.
     *
     * This is what makes a second departure count as a second departure. The
     * warning has no dismiss button, so nothing else would ever reset the
     * latch, and every switch after the first would go unlogged.
     */
    const returned = () => {
      cancelPending();
      awayRef.current = false;
    };

    const onBlur = () => {
      cancelPending();
      pending = setTimeout(() => {
        pending = null;
        // Re-checked rather than assumed: focus may have come straight back,
        // and `hasFocus` is the question actually being asked.
        if (!document.hasFocus()) leave();
      }, AWAY_GRACE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        cancelPending();
        leave();
      } else {
        returned();
      }
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelPending();
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, armed, emit, showNotice]);

  /* A module ending clears any warning still on screen with it. */
  useEffect(() => {
    if (!armed) {
      awayRef.current = false;
      setAway(false);
    }
  }, [armed]);

  /*
   * Marks the document while a module is running, which is what the
   * `user-select: none` rule hangs off. A class rather than inline style so
   * the rule lives with the rest of the runtime's CSS, and on the body so it
   * covers the whole subtree without the question card knowing about it.
   */
  useEffect(() => {
    document.body.classList.toggle('assess-running', armed);
    return () => document.body.classList.remove('assess-running');
  }, [armed]);

  // ── Focus trap ─────────────────────────────────────────────────────────

  /*
   * Keeps Tab inside the assessment.
   *
   * This is the actual fix for the keyboard-navigation bug, rather than the
   * grace period above, which only softens it: tabbing past the last control
   * moves focus into the browser's address bar, which blurs the window and
   * looked exactly like leaving. Wrapping focus back to the first control
   * means ordinary keyboard navigation never leaves the document at all.
   *
   * It is not a security measure and is not pretending to be one — Alt+Tab is
   * still Alt+Tab. It stops an accident being recorded as a violation.
   */
  useEffect(() => {
    if (!armed) return;

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const shell = document.querySelector('.assess-shell');
      if (!shell) return;

      const focusable = [
        ...shell.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
        // `getClientRects` rather than `offsetParent`, which is null for a
        // `position: fixed` element and would quietly drop one from the cycle.
      ].filter((el) => el.getClientRects().length > 0);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Only the two edges are redirected. Everything in between is ordinary
      // Tab behaviour and should stay that way.
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (active === null || !shell.contains(active)) {
        // Focus is somewhere outside the assessment — the body, usually, right
        // after a re-render. Bring it back rather than letting the next Tab
        // walk out into the browser.
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onTab);
    return () => document.removeEventListener('keydown', onTab);
  }, [armed]);

  // ── Keyboard lock ──────────────────────────────────────────────────────

  /*
   * Best-effort, and genuinely partial. In full screen this captures the keys
   * the OS is willing to hand over — Escape, F11 and the browser's own
   * shortcuts on the platforms that allow it — which stops the accidental
   * Escape that used to drop somebody out of full screen mid-question. It does
   * not, and cannot, capture the window switcher. Wrapped in a catch because
   * the API is unimplemented in Firefox and Safari and rejects without a
   * transient activation.
   */
  useEffect(() => {
    if (!active || !armed || !isFullscreen) return;

    const keyboard = keyboardLock();
    if (!keyboard) return;

    void keyboard.lock().catch(() => {
      // Unsupported, or no activation to spend. Nothing else to try.
    });

    return () => keyboard.unlock();
  }, [active, armed, isFullscreen]);

  // ── Shortcuts the page can actually refuse ─────────────────────────────

  /*
   * A short list on purpose. Everything here is something the page genuinely
   * owns; the browser-reserved combinations are left alone rather than
   * `preventDefault`ed for show, because a handler that appears to block
   * Ctrl+T and does not is worse than no handler — it invites the reader to
   * believe the rest of this is airtight.
   */
  useEffect(() => {
    if (!active || !armed) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;

      // Printing or saving the page is a copy of the question bank leaving.
      if (mod && (key === 'p' || key === 's')) event.preventDefault();
      // Copying the stem out is the same thing by hand.
      if (mod && (key === 'c' || key === 'x' || key === 'a')) {
        event.preventDefault();
      }
    };

    const swallow = (event: Event) => event.preventDefault();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('contextmenu', swallow);
    document.addEventListener('copy', swallow);
    document.addEventListener('cut', swallow);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('contextmenu', swallow);
      document.removeEventListener('copy', swallow);
      document.removeEventListener('cut', swallow);
    };
  }, [active, armed]);

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

  /*
   * Turns the camera on by itself where permission has already been granted.
   *
   * A candidate reaches a module having just proved, in the readiness check,
   * that their camera works and their face is properly framed. Asking them to
   * press "Turn on camera" again thirty seconds later — with Begin greyed out
   * until they do — reads as the product having forgotten, and it is asking
   * for something the browser has already been told.
   *
   * Gated on `granted` rather than attempted blindly. `getUserMedia` with a
   * standing grant resolves silently and needs no gesture; without one it puts
   * a permission prompt on screen that nobody asked for, at the worst possible
   * moment. Where the answer is anything other than `granted` — or the browser
   * will not say — the manual control on the intro screen is still there.
   */
  useEffect(() => {
    if (!active || camera !== 'idle') return;

    let cancelled = false;
    void permissionState('camera').then((state) => {
      if (!cancelled && state === 'granted') void startCamera();
    });

    return () => {
      cancelled = true;
    };
  }, [active, camera, startCamera]);

  useEffect(() => {
    if (!active || camera !== 'active') return;

    /*
     * The same framing rule the readiness check runs, on the looser
     * `RUNTIME_RULE` — see `face-framing.ts` for why the two differ.
     *
     * It used to ask only how many faces were visible, which meant a camera
     * angled at the ceiling with the candidate's head in one corner logged
     * nothing at all: a face was present, so the count was one, so everything
     * looked fine. Position and size are what a recruiter is actually being
     * asked to judge.
     *
     * Still detect-and-log. Nothing here blocks, ends or fails an attempt —
     * see the note at the top of this file. What changed is that the events
     * are now true.
     */
    let lastState: FramingCode | null = null;
    let pending: FramingCode | null = null;
    let runs = 0;

    const id = window.setInterval(async () => {
      const found = await monitorRef.current?.faces();
      if (found === null || found === undefined) return;

      const verdict = framing(found, RUNTIME_RULE);
      const state = verdict.code;

      // A momentary lean is not a finding. The state has to hold for
      // `SUSTAINED_FRAMES` reads before it is allowed to become the truth.
      if (state === pending) {
        runs += 1;
      } else {
        pending = state;
        runs = 1;
      }
      if (runs < SUSTAINED_FRAMES) return;

      // Only transitions are reported — a candidate who steps away for a
      // minute should produce one `face_absent`, not twelve.
      if (state === lastState) return;
      lastState = state;

      if (state === 'absent') {
        emit('face_absent', { faceCount: 0 });
        showNotice(
          'No face visible to the camera. This has been recorded.',
          'face',
        );
      } else if (state === 'multiple') {
        emit('multiple_faces', { faceCount: verdict.faceCount });
        showNotice(
          'More than one person is visible to the camera. This has been recorded.',
          'face',
        );
      } else if (state !== 'ok') {
        // Named for what was measured. This is a face that *is* visible but is
        // not properly in shot, which is a different thing from an empty
        // chair — logging it as `face_absent` would put a claim in somebody's
        // report that the measurement does not support.
        emit('face_not_framed', { reason: state });
        showNotice(
          'Your face is not properly in view of the camera. This has been recorded.',
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

  // ── Ambient noise ──────────────────────────────────────────────────────
  //
  // A widening of the proctoring scope, made deliberately and recorded in
  // CLAUDE.md. The level is measured in the browser and the samples are
  // discarded — nothing is recorded, buffered or transmitted, so what reaches
  // the server is the same shape of fact as `face_absent`: that it happened.
  //
  // Unlike the camera this is never a gate. A candidate who cannot grant a
  // microphone, or who lives somewhere noisy, has done nothing wrong.

  const startMicrophone = useCallback(async () => {
    if (microphone === 'active' || microphone === 'starting') return;
    setMicrophone('starting');
    try {
      audioRef.current = await startAudioMonitor();
      setMicrophone('active');
    } catch {
      // Denied, no input device, or an AudioContext the browser would not
      // start. The test continues either way.
      setMicrophone('denied');
    }
  }, [microphone]);

  useEffect(() => {
    if (!active || microphone !== 'active') return;

    // Transitions only, exactly like the face monitor: a noisy room should
    // produce one event when it gets loud and another when it settles, not one
    // every tick for the length of the module.
    let noisy = false;

    const id = window.setInterval(() => {
      const sustained = audioRef.current?.isSustainedNoise() ?? false;
      if (sustained === noisy) return;
      noisy = sustained;

      if (sustained) {
        emit('background_noise');
        showNotice(
          'Background noise detected. This has been recorded.',
          'noise',
        );
      } else if (noticeSourceRef.current === 'noise') {
        // Quiet again — clear our own notice so it doesn't read as stuck. Only
        // ever one we set ourselves.
        noticeSourceRef.current = null;
        setNotice(null);
      }
    }, AUDIO_POLL_MS);

    return () => window.clearInterval(id);
  }, [active, microphone, emit, showNotice]);

  // Releases the camera and the microphone when the test ends or the screen
  // unmounts. Both, or the browser keeps showing its in-use indicator over a
  // page that has finished with them.
  useEffect(
    () => () => {
      monitorRef.current?.stop();
      monitorRef.current = null;
      audioRef.current?.stop();
      audioRef.current = null;
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
    away,
    awayCount,
    camera,
    startCamera,
    microphone,
    startMicrophone,
    notice,
    dismissNotice,
  };
}
