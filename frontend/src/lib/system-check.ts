/*
 * What the browser can and cannot do, checked before the clock starts.
 *
 * Every real exam platform does this, and for one reason: an invitation allows
 * exactly one attempt, so discovering at question three that fullscreen is
 * unavailable costs somebody their whole assessment. Better to find out while
 * nothing is at stake.
 *
 * **Every check gates the start (changed 2026-08-20).** This used to divide the
 * checks into blocking ones (camera, missing APIs) and advisory ones
 * (microphone, connection, extra displays) that warned and let the candidate
 * through. It no longer does: anything short of `ok` stops the assessment
 * starting. The reasoning is that a signal worth showing on this page is a
 * signal worth acting on, and a candidate who is waved past a warning has no
 * way to know it will be held against them in the report afterwards — better to
 * fix it now, while the fixes are all one click and no clock is running.
 *
 * `warn` and `fail` therefore differ only in what they say, not in what they
 * allow: `warn` is "you can fix this yourself right now", `fail` is "this
 * machine or browser cannot do it".
 *
 * **One check per screen (changed 2026-08-20).** These used to run together and
 * paint a list of ticks; the readiness wizard now walks them one at a time, and
 * that is why `openCamera` and `openMicrophone` hand their live resources back
 * to the caller instead of closing them. A tick proves a device answered. A
 * preview of your own face, and a meter that moves when you speak, prove the
 * thing will actually work — and a camera aimed at a ceiling passes the first
 * test and fails the second.
 *
 * The caller owns what it is handed, and must release it when the step is left.
 */

import { startAudioMonitor, type AudioMonitor } from './audio-monitor';

export type CheckStatus = 'pending' | 'ok' | 'warn' | 'fail';

export interface CheckResult {
  key: string;
  label: string;
  status: CheckStatus;
  /** One line, written for a candidate rather than an engineer. */
  detail: string;
  /**
   * What to do about it, when the candidate can do something.
   *
   * Kept apart from `detail` so the page can present it as an instruction
   * rather than as more description. Null when there is nothing to try — an
   * unsupported browser is not fixed by advice.
   */
  fix: string | null;
}

/**
 * How to undo a blocked camera or microphone.
 *
 * Once "Never allow" has been chosen the browser will not ask again —
 * `getUserMedia` rejects immediately, with no prompt, and **no web page can
 * re-open that dialog**. That is a browser security rule, not something this
 * page can work around, so pointing at the switch is the only useful thing to
 * say. "Check again" picks up the new answer.
 *
 * One sentence: somebody reading this is already annoyed, and a paragraph
 * describing every icon it might be is read as an error rather than a fix.
 */
const PERMISSION_FIX =
  'Click the icon at the left of the address bar, set it to Allow, then check again.';

/**
 * What a browser permission is currently set to, where the browser will say.
 *
 * The Permissions API is what separates "blocked" from "there is no device" —
 * `getUserMedia` reports both as a rejection, and the two need completely
 * different advice. Not every browser implements it for camera and microphone,
 * so a null answer is normal and the caller falls back to the error name.
 */
export async function permissionState(
  name: 'camera' | 'microphone',
): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({
      name: name as PermissionName,
    });
    return status.state;
  } catch {
    return null;
  }
}

/** Turns a `getUserMedia` rejection into something a candidate can act on. */
function mediaFailure(error: unknown): { blocked: boolean; missing: boolean } {
  const name = error instanceof Error ? error.name : '';
  return {
    blocked: name === 'NotAllowedError' || name === 'SecurityError',
    missing: name === 'NotFoundError' || name === 'DevicesNotFoundError',
  };
}

/**
 * The APIs the runtime is built on.
 *
 * Feature detection, not user-agent sniffing: what matters is whether the
 * browser in front of us has the API, and a version table would be wrong within
 * a year and wrong about every browser nobody thought of.
 */
export function checkBrowser(): CheckResult {
  const missing: string[] = [];
  if (typeof document.documentElement.requestFullscreen !== 'function') {
    missing.push('full screen');
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    missing.push('camera access');
  }
  if (typeof WebSocket !== 'function') missing.push('live connection');

  if (missing.length > 0) {
    return {
      key: 'browser',
      label: 'Browser',
      status: 'fail',
      detail: `This browser does not support ${missing.join(', ')}.`,
      fix: 'Open this page in a recent Chrome, Edge, Firefox or Safari.',
    };
  }

  return {
    key: 'browser',
    label: 'Browser',
    status: 'ok',
    detail: 'Browser verified successfully.',
    fix: null,
  };
}

/**
 * Camera, by actually opening one — and handing the live stream back.
 *
 * A permission query would say whether access is *allowed*; only opening a
 * stream says whether a working camera exists behind it. Nothing is captured,
 * recorded or sent: the stream goes straight to a `<video>` the candidate is
 * looking at, and the caller stops it when the step is left.
 */
export async function openCamera(): Promise<{
  result: CheckResult;
  stream: MediaStream | null;
}> {
  const base = { key: 'camera', label: 'Camera' };
  const fail = (result: CheckResult) => ({ result, stream: null });

  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    return fail({
      ...base,
      status: 'fail',
      detail: 'This browser cannot use a camera, and a camera is required.',
      fix: 'Open this page in a recent Chrome, Edge, Firefox or Safari.',
    });
  }

  if ((await permissionState('camera')) === 'denied') {
    return fail({
      ...base,
      status: 'warn',
      detail: 'Camera access is blocked for this site.',
      fix: PERMISSION_FIX,
    });
  }

  try {
    // The stream comes back running rather than being stopped on the spot.
    // The point of the camera step is that the candidate sees themselves: a
    // green tick proves a device answered, a picture proves it is pointed at
    // their face, in focus, and lit well enough to be worth proctoring.
    // 4:3 requested explicitly, to match the preview's own aspect ratio. With
    // `object-fit: cover` a 16:9 stream would be cropped at the sides on
    // screen while face detection still saw the full frame — so a face the
    // candidate cannot see would count as inside the alignment oval.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
    });
    return {
      result: {
        ...base,
        status: 'ok',
        detail: 'Working. It stays on for the whole assessment.',
        fix: null,
      },
      stream,
    };
  } catch (error) {
    const { blocked, missing } = mediaFailure(error);

    if (missing) {
      return fail({
        ...base,
        status: 'fail',
        detail: 'No camera was found on this computer.',
        fix: 'Plug in a camera, or use a computer that has one, then check again.',
      });
    }

    return fail({
      ...base,
      status: 'warn',
      detail: blocked
        ? 'Camera access was refused.'
        : 'The camera could not be opened — another app may be using it.',
      fix: blocked
        ? PERMISSION_FIX
        : 'Close anything else using the camera (video calls, for example), then check again.',
    });
  }
}

/**
 * Microphone.
 *
 * Background noise is recorded as a signal for the recruiter to weigh, so the
 * assessment wants a working microphone. It used to be advisory; it now gates
 * the start like everything else, because a candidate let through with no
 * microphone has quietly lost a section of their own report and is never told.
 */
export async function openMicrophone(): Promise<{
  result: CheckResult;
  monitor: AudioMonitor | null;
}> {
  const base = { key: 'microphone', label: 'Microphone' };
  const fail = (result: CheckResult) => ({ result, monitor: null });

  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    return fail({
      ...base,
      status: 'fail',
      detail: 'This browser cannot use a microphone.',
      fix: 'Open this page in a recent Chrome, Edge, Firefox or Safari.',
    });
  }

  if ((await permissionState('microphone')) === 'denied') {
    return fail({
      ...base,
      status: 'warn',
      detail: 'Microphone access is blocked for this site.',
      fix: PERMISSION_FIX,
    });
  }

  try {
    // The same monitor the assessment itself runs, rather than a one-off
    // `getUserMedia` stopped immediately: it exposes `level()`, so the
    // candidate can watch the meter answer their own voice. A device that
    // opens but is muted in the operating system's mixer passes a permission
    // check and moves no meter — that is the failure worth catching here.
    const monitor = await startAudioMonitor();
    return {
      result: {
        ...base,
        status: 'ok',
        // Says what is measured and what is not. The candidate is entitled to
        // know an always-on microphone is not an always-on recording.
        detail:
          'Working. Noise levels are recorded during the assessment — audio ' +
          'itself is never recorded or sent anywhere.',
        fix: null,
      },
      monitor,
    };
  } catch (error) {
    const { blocked, missing } = mediaFailure(error);

    if (missing) {
      return fail({
        ...base,
        status: 'fail',
        detail: 'No microphone was found on this computer.',
        fix: 'Plug in a microphone or headset, then check again.',
      });
    }

    return fail({
      ...base,
      status: 'warn',
      detail: blocked
        ? 'Microphone access was refused.'
        : 'The microphone could not be opened — another app may be using it.',
      fix: blocked
        ? PERMISSION_FIX
        : 'Close anything else using the microphone, then check again.',
    });
  }
}

/**
 * How many displays are attached.
 *
 * `isExtended` needs no permission, unlike `getScreenDetails`, and it answers
 * the only question that can be answered without one: is the desktop spread
 * across more than one physical screen.
 *
 * Note what this cannot see, because it is the thing people expect it to: two
 * windows side by side on a single monitor are still **one display**, and no
 * browser API reports what else is on screen beside it. `checkWindowFills`
 * below is what covers that case.
 */
export function checkDisplays(): CheckResult {
  const base = { key: 'displays', label: 'Displays' };
  const extended = (screen as Screen & { isExtended?: boolean }).isExtended;

  if (extended === true) {
    return {
      ...base,
      status: 'warn',
      detail: 'More than one display is connected.',
      fix: 'Disconnect the second screen, then press Check again.',
    };
  }

  return { ...base, status: 'ok', detail: 'No split screens', fix: null };
}

/**
 * Whether the browser window has the screen to itself.
 *
 * This is the split-screen check, and it exists because the displays check
 * above cannot be: a browser has no way to enumerate other applications or see
 * what is drawn beside it. What it *can* see is its own size, so a window that
 * does not fill the screen is treated as a window with something else next to
 * it. That is a proxy rather than a measurement, and it is deliberately a
 * generous one — the candidate simply maximises and re-checks.
 *
 * `availWidth`/`availHeight` rather than `width`/`height`: they exclude the
 * taskbar or dock, which a maximised window does not cover either.
 */
export function checkWindowFills(): CheckResult {
  const base = { key: 'window', label: 'Screen space' };

  const coverage =
    Math.min(1, window.outerWidth / screen.availWidth) *
    Math.min(1, window.outerHeight / screen.availHeight);

  // 0.9 of the available area. Loose enough for window chrome, an off-by-a-few
  // -pixels maximise and browser zoom; nowhere near loose enough for two
  // windows side by side, which lands around 0.5.
  if (coverage < 0.9) {
    return {
      ...base,
      status: 'warn',
      detail:
        'This window does not fill the screen, so other windows can sit ' +
        'beside it.',
      fix: 'Maximise this window, then press Check again. The assessment itself runs full screen.',
    };
  }

  return {
    ...base,
    status: 'ok',
    detail: 'You can proceed.',
    fix: null,
  };
}

/**
 * Whether the connection is good enough to keep answering.
 *
 * Timed round trips to our own API rather than a bandwidth test against a CDN:
 * what matters is latency to the server that holds the session, and a large
 * download would waste a metered connection to measure the wrong thing.
 *
 * Three round trips and the median, so one unlucky sample neither passes a bad
 * connection nor fails a good one. The caller passes the request, which is why
 * this takes a function: the measurement should be of the authenticated path
 * the candidate will actually use, not of a public health endpoint that skips
 * the auth and database work every real request does.
 */
export async function checkConnection(
  ping: () => Promise<void>,
): Promise<CheckResult> {
  const base = { key: 'connection', label: 'Connection' };
  const samples: number[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = performance.now();
    try {
      await ping();
      samples.push(performance.now() - started);
    } catch {
      return {
        ...base,
        status: 'warn',
        detail: 'Could not reach the server.',
        fix: 'Check your internet connection, then press Check again.',
      };
    }
  }

  const median = [...samples].sort((a, b) => a - b)[1];

  if (median > 1500) {
    return {
      ...base,
      status: 'warn',
      detail: `Slow to respond (${Math.round(median)}ms). Answers would take a moment to save.`,
      fix: 'Move closer to the router or switch to a wired connection, then press Check again.',
    };
  }

  return {
    ...base,
    status: 'ok',
    detail: `Responding in ${Math.round(median)}ms.`,
    fix: null,
  };
}

/*
 * There is no `canStart` here any more.
 *
 * It existed to ask "did all six pass?" of a single list. The wizard asks a
 * smaller question at each step — did *this* one pass — and will not let the
 * candidate move on until it did, so reaching the end is the proof. A helper
 * that recomputed the same answer from a bag of results would be a second
 * source of truth for a rule the flow already enforces.
 */
