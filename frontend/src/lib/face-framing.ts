import type { FaceBox } from './face-detection';

/*
 * Whether a face is properly framed — the one rule, used in both places that
 * ask the question.
 *
 * It lives here rather than in the readiness check that first needed it
 * because the assessment runtime asks exactly the same thing, and a geometry
 * rule kept in two files drifts. That is not hypothetical: the alignment oval
 * was briefly drawn from CSS and measured from TypeScript, and the two
 * disagreed immediately — the ring on screen tested nothing at all.
 *
 * The two callers differ only in how forgiving they are, which is what
 * `FramingRule` is for. Setting up is a deliberate act with a preview to look
 * at; sitting an assessment for forty minutes involves shifting in a chair,
 * and holding both to the same tolerance would report a candidate for being
 * a person.
 */

/**
 * The alignment oval, in fractions of the frame.
 *
 * The single source of truth: the check measures against these numbers and the
 * readiness check's ring is *drawn* from them, so the shape a candidate is
 * asked to fill is by construction the shape being tested.
 *
 * `cx` is 0.5 deliberately. The preview is mirrored for the candidate's
 * comfort, and a horizontally centred target is the one shape that maps onto
 * itself under that mirror — so no part of this has to think about it.
 */
export const OVAL = { cx: 0.5, cy: 0.5, rx: 0.22, ry: 0.33 };

export interface FramingRule {
  /** How far off-centre a face may sit, as a fraction of the oval's radii. */
  centreToleranceX: number;
  centreToleranceY: number;
  /** How wide a face may be, as a fraction of the frame. */
  minFaceWidth: number;
  maxFaceWidth: number;
}

/**
 * The readiness check: strict, because this is the moment to get it right.
 *
 * Vertical is the more forgiving axis. Sliding a chair sideways is a fine
 * adjustment anybody can make; vertical framing is set by the tilt of a laptop
 * lid, which is coarse — a measured face on a real desk sat 0.005 from the
 * limit with the lid at a comfortable angle, and holding both axes to the same
 * tolerance failed people for their hinge.
 */
export const SETUP_RULE: FramingRule = {
  centreToleranceX: 0.5,
  centreToleranceY: 0.7,
  minFaceWidth: 0.18,
  maxFaceWidth: 0.55,
};

/**
 * Mid-assessment: the same rule, loosened.
 *
 * Two reasons, and both matter. There is no oval on screen during the test, so
 * a candidate is being measured against a target they cannot see — the
 * readiness check taught them the framing, but they are not looking at it any
 * more. And a signal here becomes a line in somebody's report, where "leaned
 * to one side at 14:32" is noise that buries the events a recruiter should
 * actually read.
 *
 * So this asks a coarser question: are you still recognisably sat in front of
 * your camera? Combined with `SUSTAINED_FRAMES` in the caller, a momentary
 * lean never reaches the log.
 */
export const RUNTIME_RULE: FramingRule = {
  centreToleranceX: 0.95,
  centreToleranceY: 1.1,
  minFaceWidth: 0.12,
  maxFaceWidth: 0.75,
};

/** Why a framing check failed, for the event metadata and for the copy. */
export type FramingCode =
  'ok' | 'absent' | 'multiple' | 'off_centre' | 'too_far' | 'too_close';

export interface FramingVerdict {
  ok: boolean;
  code: FramingCode;
  /** How many faces were seen, for the log. */
  faceCount: number;
  /** The caption over a preview, where there is one. */
  tag: string;
  detail: string;
  fix: string | null;
}

/**
 * Whether exactly one face is properly framed inside the oval.
 *
 * Counting faces was the whole check until this replaced it, and counting is
 * why a candidate passed with their face jammed against the left edge of frame
 * and the oval completely empty: something in the picture was a face, so the
 * count was one, so it passed. Position and size are what proctoring actually
 * needs to know.
 */
export function framing(faces: FaceBox[], rule: FramingRule): FramingVerdict {
  if (faces.length === 0) {
    return {
      ok: false,
      code: 'absent',
      faceCount: 0,
      tag: 'No face detected',
      detail: 'No face visible.',
      fix: 'Move into the oval, and turn on a light in front of you if the picture is dark.',
    };
  }

  if (faces.length > 1) {
    return {
      ok: false,
      code: 'multiple',
      faceCount: faces.length,
      tag: `${faces.length} faces`,
      detail: `${faces.length} faces visible.`,
      fix: 'You have to sit the assessment alone. Ask others to step out of shot.',
    };
  }

  const face = faces[0];
  const cx = face.x + face.width / 2;
  const cy = face.y + face.height / 2;

  const offCentre =
    Math.abs(cx - OVAL.cx) > OVAL.rx * rule.centreToleranceX ||
    Math.abs(cy - OVAL.cy) > OVAL.ry * rule.centreToleranceY;

  // Position before size: somebody at the edge of frame is told the useful
  // thing first, and "move closer" to a face that is already half off-screen
  // is advice that makes the picture worse.
  if (offCentre) {
    return {
      ok: false,
      code: 'off_centre',
      faceCount: 1,
      tag: 'Not in the oval',
      detail: 'Your face is not inside the oval.',
      fix: 'Move so your whole face sits inside the ring, and look straight at the camera.',
    };
  }

  if (face.width < rule.minFaceWidth) {
    return {
      ok: false,
      code: 'too_far',
      faceCount: 1,
      tag: 'Too far away',
      detail: 'You are too far from the camera.',
      fix: 'Move closer until your face fills the oval.',
    };
  }

  if (face.width > rule.maxFaceWidth) {
    return {
      ok: false,
      code: 'too_close',
      faceCount: 1,
      tag: 'Too close',
      detail: 'You are too close to the camera.',
      fix: 'Move back a little, until your whole face is inside the oval.',
    };
  }

  return {
    ok: true,
    code: 'ok',
    faceCount: 1,
    tag: 'Framed correctly',
    detail: 'Face identified. You can proceed.',
    fix: null,
  };
}
