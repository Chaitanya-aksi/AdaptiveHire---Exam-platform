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

export interface FaceMonitor {
  /** Number of faces currently visible, or null if a frame couldn't be read. */
  count: () => Promise<number | null>;
  stop: () => void;
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
    count: async () => {
      if (stopped || video.readyState < 2) return null;
      try {
        const faces = await api.detectAllFaces(video, options);
        return faces.length;
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
