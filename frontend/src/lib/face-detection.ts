/**
 * Face-presence detection, entirely in the browser.
 *
 * No frame ever leaves this file: the webcam stream is attached to an
 * off-screen <video>, face-api.js counts faces in it locally, and only the
 * resulting count is reported. Nothing is recorded, uploaded or stored — the
 * backend receives "0 faces at 14:32", never an image.
 *
 * face-api.js and its TensorFlow core are ~1MB, so the import is dynamic:
 * candidates who never reach a test never download it.
 */

/** Served from `public/models` — the tiny detector, ~190KB. */
const MODEL_URL = '/models';

/** Small input size keeps this cheap enough to run alongside the test. */
const INPUT_SIZE = 224;
const SCORE_THRESHOLD = 0.5;

type FaceApi = typeof import('face-api.js');

let faceapi: FaceApi | null = null;
let modelReady: Promise<void> | null = null;

async function loadModel(): Promise<FaceApi> {
  faceapi ??= await import('face-api.js');
  modelReady ??= faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await modelReady;
  return faceapi;
}

/**
 * One detected face, normalised 0..1 against the video's own dimensions.
 *
 * Position and size, not just a count. Counting alone let a candidate pass with
 * their face jammed against the left edge of frame and the alignment oval
 * completely empty — the detector was perfectly happy, because something in the
 * picture was a face. Where it is and how big it is are the questions that
 * actually matter for proctoring.
 */
export interface FaceBox {
  /** Left edge, as a fraction of video width. */
  x: number;
  /** Top edge, as a fraction of video height. */
  y: number;
  width: number;
  height: number;
}

/** Like `FaceMonitor`, but reports where the faces are rather than how many. */
export interface FaceWatcher {
  /** Null when no frame could be read — unknown, which is not "nobody". */
  faces: () => Promise<FaceBox[] | null>;
  stop: () => void;
}

export interface FaceMonitor {
  /**
   * Where the faces are, or null if a frame couldn't be read.
   *
   * Boxes rather than a count, the same as `FaceWatcher`. The runtime needs to
   * know whether the candidate is still *framed*, not merely whether the
   * detector can find a face somewhere in the picture — a face at the very
   * edge of a camera pointed at the ceiling satisfies a count and tells a
   * recruiter nothing.
   */
  faces: () => Promise<FaceBox[] | null>;
  stop: () => void;
}

/**
 * Counts faces in a `<video>` the caller already owns.
 *
 * The difference from `startFaceMonitor` is who owns the camera.
 * `startFaceMonitor` opens its own stream for the assessment runtime, where
 * nothing is on screen. The readiness check already has a stream attached to a
 * preview the candidate is looking at, and opening a second one to detect on
 * would light two camera indicators and double the work for the same answer.
 *
 * `stop` only halts detection. The stream belongs to the caller and is left
 * exactly as it was found.
 */
export async function watchFaces(
  video: HTMLVideoElement,
): Promise<FaceWatcher> {
  const api = await loadModel();

  const options = new api.TinyFaceDetectorOptions({
    inputSize: INPUT_SIZE,
    scoreThreshold: SCORE_THRESHOLD,
  });

  let stopped = false;

  return {
    faces: async () => {
      // `readyState < 2` is a video that has no frame yet — starting up, or
      // between streams. Unknown, not empty: reporting "no face" for a video
      // that has not decoded one would fail a candidate for their webcam's
      // warm-up time.
      if (stopped || video.readyState < 2) return null;

      const { videoWidth: w, videoHeight: h } = video;
      if (w === 0 || h === 0) return null;

      try {
        const found = await api.detectAllFaces(video, options);
        // Normalised against the video's own dimensions, so the caller can
        // reason about position and size without knowing the resolution — and
        // without every caller re-deriving the same division.
        return found.map(({ box }) => ({
          x: box.x / w,
          y: box.y / h,
          width: box.width / w,
          height: box.height / h,
        }));
      } catch {
        return null;
      }
    },
    stop: () => {
      stopped = true;
    },
  };
}

/**
 * Starts the camera and returns a monitor. Throws if the candidate denies
 * permission or there is no camera — the caller decides what that means, and
 * for v1 it means "log nothing and carry on", never "block the test".
 */
export async function startFaceMonitor(): Promise<FaceMonitor> {
  const api = await loadModel();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240, facingMode: 'user' },
    audio: false,
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const options = new api.TinyFaceDetectorOptions({
    inputSize: INPUT_SIZE,
    scoreThreshold: SCORE_THRESHOLD,
  });

  let stopped = false;

  return {
    faces: async () => {
      if (stopped || video.readyState < 2) return null;

      const { videoWidth: w, videoHeight: h } = video;
      if (w === 0 || h === 0) return null;

      try {
        const found = await api.detectAllFaces(video, options);
        return found.map(({ box }) => ({
          x: box.x / w,
          y: box.y / h,
          width: box.width / w,
          height: box.height / h,
        }));
      } catch {
        // A dropped frame is not a violation; report "unknown" instead.
        return null;
      }
    },
    stop: () => {
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
