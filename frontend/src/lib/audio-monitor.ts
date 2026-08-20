/*
 * Ambient-noise detection, entirely in the browser.
 *
 * The contract, and the reason this file is deliberately small: it reads a
 * *level* and throws the samples away. There is no `MediaRecorder`, no buffer
 * kept between reads, no upload, and nothing that could be reassembled into
 * audio. The platform never learns what was said — only that it was loud.
 *
 * That is not a limitation to be lifted later. It is what makes an always-on
 * microphone defensible at all, and it mirrors the same decision already made
 * for the camera: face-api.js runs on-device and no video leaves the machine.
 *
 * It also means this cannot tell a voice from a television, a housemate from a
 * lawnmower. Everything downstream is named for what is measured — "background
 * noise" — and must stay that way; calling it "talking" would put a claim in a
 * candidate's report that the measurement does not support.
 */

/** Above this RMS, a sample counts as loud. 0..1, empirical. */
const LOUD_AT = 0.08;

/**
 * Consecutive loud samples before it counts as noise.
 *
 * A door closing is one sample; a conversation is many. Requiring a run of them
 * is what stops the report filling with a candidate's own cough.
 */
const SUSTAINED_SAMPLES = 3;

export interface AudioMonitor {
  /**
   * True when the last `SUSTAINED_SAMPLES` reads were all above the threshold.
   *
   * Called on a poll rather than pushing events, so the caller owns the cadence
   * and the transition logic — the same shape as the face monitor.
   */
  isSustainedNoise: () => boolean;
  /** Current level, 0..1. Exposed for the readiness check's level meter. */
  level: () => number;
  stop: () => void;
}

/**
 * Asks for the microphone and starts measuring.
 *
 * Rejects if permission is denied or there is no input device — the caller
 * treats that as "unavailable" and carries on, because unlike the camera a
 * microphone is never a precondition for starting a test. A candidate in a
 * shared house who cannot grant it has done nothing wrong.
 */
export async function startAudioMonitor(): Promise<AudioMonitor> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // No video here even though the camera is also on: this stream is separate
    // so stopping one never disturbs the other.
    audio: {
      // Off deliberately. These clean up speech for a listener, which is the
      // opposite of what a level meter wants — noise suppression would erase
      // exactly the background sound being measured.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  // Small window: this is a loudness reading, not a spectrogram, and a smaller
  // buffer is a cheaper read on a machine already running face detection.
  analyser.fftSize = 512;
  source.connect(analyser);
  // Deliberately not connected to `context.destination` — routing the mic to
  // the speakers would feed the candidate their own audio back.

  const samples = new Uint8Array(analyser.fftSize);
  let loudRun = 0;

  const read = (): number => {
    analyser.getByteTimeDomainData(samples);

    // RMS around the 128 midpoint. The array is overwritten on every read and
    // never copied, so no audio outlives this function call.
    let sumSquares = 0;
    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sumSquares += centred * centred;
    }
    return Math.sqrt(sumSquares / samples.length);
  };

  return {
    level: read,

    isSustainedNoise: () => {
      loudRun = read() >= LOUD_AT ? loudRun + 1 : 0;
      return loudRun >= SUSTAINED_SAMPLES;
    },

    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      // Releases the OS audio device; without it the browser keeps showing a
      // recording indicator after the test has ended.
      void context.close();
    },
  };
}
