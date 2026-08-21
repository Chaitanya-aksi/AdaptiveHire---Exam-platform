import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/*
 * The branded pause, and the one place that draws it.
 *
 * It exists for two reasons, and only one of them is decoration. Between the
 * stages of an assessment it is a signpost: a candidate moving from the system
 * checks into practice, and again from practice into the real thing, needs to
 * know unambiguously *which* of those they are about to be in — the sample
 * questions and the assessment deliberately use the same controls, so without a
 * marker between them the moment answers start counting passes unannounced.
 * After a sign-in it is the same brand moment spent on work that was happening
 * anyway: the destination has a session to restore and a first page to fetch,
 * and a held beat is a better way to spend that than a half-built page.
 *
 * The timing is fixed rather than tied to loading. This is a signpost, not a
 * spinner: it should last long enough to read and never longer, which a
 * progress bar chasing a fast network cannot promise.
 */

interface BrandSplashProps {
  /** The stage being entered — "Sample test", the assessment's own name. */
  title: string;
  /** One line under it, saying what that stage is. */
  subtitle: string;
  /**
   * The *minimum* time on screen.
   *
   * Defaulted rather than fixed because the callers are asking for different
   * things. Between assessment sections this is the only notice a candidate
   * gets that the rules have changed, and it has to be read; after a sign-in it
   * is punctuation on something the person already knows they did, and the same
   * beat there would read as the app being slow.
   */
  holdMs?: number;
  /**
   * Whether whatever is behind has finished. False keeps the splash up past
   * `holdMs`; the two together mean "not shorter than this, and not while there
   * is still work".
   *
   * Defaulted to true because most callers are announcing something rather than
   * waiting for it — for them the minimum *is* the duration. The page-load
   * splash is the one that waits, and a fixed hold would be wrong there in both
   * directions: too short to cover a slow session restore, and long enough on a
   * fast one to make a reload slower than the blank page it replaced.
   */
  ready?: boolean;
  onDone: () => void;
}

/** Long enough to read the title and register the change. */
const DEFAULT_HOLD_MS = 2200;
/** The fade-out, which has to finish before the next screen mounts. */
const EXIT_MS = 420;
/**
 * When the progress bar starts filling, matching the `0.85s` delay on
 * `.splash-progress span` in index.css. Subtracted from the hold to get the
 * fill's duration, so the bar arrives full exactly as the screen begins to
 * leave however long the hold is.
 */
const FILL_DELAY_MS = 850;

export function BrandSplash({
  title,
  subtitle,
  holdMs = DEFAULT_HOLD_MS,
  ready = true,
  onDone,
}: BrandSplashProps) {
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    /*
     * The splash is the only thing on screen while it lasts, and after a
     * sign-in that has to be made true rather than assumed: the destination is
     * mounted at full height behind it, so without this its scrollbar shows
     * through down the edge and a stray wheel scroll moves a page nobody can
     * see. The assessment flow has nothing behind it to lock, and is unharmed.
     */
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // A timer rather than an `animationend` listener: a candidate whose browser
  // has reduced-motion enabled gets no animation to end, and hanging the only
  // route into the assessment off an event that may never fire is not a trade
  // worth making for one saved timer.
  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(true), holdMs);
    return () => window.clearTimeout(timer);
  }, [holdMs]);

  // Leaving is the two conditions meeting, which is why it is a second effect
  // rather than a longer timeout: whichever of them lands last is what starts
  // the exit, and neither knows in advance which that will be.
  useEffect(() => {
    if (!held || !ready) return;
    setLeaving(true);
    const exit = window.setTimeout(onDone, EXIT_MS);
    return () => window.clearTimeout(exit);
  }, [held, ready, onDone]);

  return (
    <div
      className={`splash${leaving ? ' splash--leaving' : ''}`}
      role="status"
      aria-live="polite"
      // The bar's duration is the one part of the animation that has to know
      // the hold, so it is handed down as a variable rather than duplicated as
      // a second number in the stylesheet that nothing keeps in step. It tracks
      // the minimum, so a `ready` that arrives late leaves the bar sitting full
      // for the remainder — which is the honest picture: the announced wait is
      // over and something behind is still going.
      style={
        {
          '--splash-fill': `${Math.max(0, holdMs - FILL_DELAY_MS)}ms`,
        } as CSSProperties
      }
    >
      {/* Drawn behind everything and never announced: two slow arcs and a
          grain, the same language as the candidate shell's brand panel. */}
      <div className="splash-bg" aria-hidden="true">
        <span className="splash-arc splash-arc--1" />
        <span className="splash-arc splash-arc--2" />
      </div>

      <div className="splash-inner">
        <div className="splash-brand">
          <span className="splash-mark" aria-hidden="true">
            A{/* The ring that sweeps once around the mark as it lands. */}
            <span className="splash-ring" />
          </span>
          <span className="splash-name">AdaptiveHire</span>
        </div>

        <span className="splash-rule" aria-hidden="true" />

        <h1 className="splash-title">{title}</h1>
        <p className="splash-sub">{subtitle}</p>

        {/* Fills across the hold, so the pause reads as deliberate rather than
            as the page having stalled. */}
        <span className="splash-progress" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The app-level splash.
 *
 * The assessment flow renders `BrandSplash` itself — it is one screen of a
 * sequence that stays on the same route. A sign-in cannot do that: the moment
 * `login` puts the user in the auth context, `GuestOnly` navigates away and
 * takes the whole sign-in page, splash included, with it. So the splash is
 * mounted here, above the router, where a route change cannot unmount it.
 *
 * That placement is what makes it worth having rather than merely pretty. The
 * navigation happens immediately and underneath: the destination mounts, asks
 * for its data and settles behind the overlay, and the loading state it would
 * otherwise have shown is spent on the brand instead. The splash is covering
 * work, not standing in for it — which is also why nothing here waits on the
 * destination. A splash that held until the page was ready would be a spinner
 * wearing a logo, and would last a different length of time on every sign-in.
 * ------------------------------------------------------------------------- */

interface SplashRequest {
  title: string;
  subtitle: string;
  holdMs?: number;
}

interface SplashApi {
  /** Cover the screen with the brand splash until it times itself out. */
  show: (request: SplashRequest) => void;
}

const SplashContext = createContext<SplashApi | null>(null);

/**
 * Shorter than the assessment's own hold. Signing in is a routine daily act,
 * not a change of rules that has to be read, and the sign-in itself has already
 * cost a second or so of network.
 */
const SIGN_IN_HOLD_MS = 1700;

export function SplashProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<SplashRequest | null>(null);

  // Both stable: `BrandSplash` keys its timers off `onDone`, so a callback
  // rebuilt on every render would restart the hold instead of ending it.
  const hide = useCallback(() => setRequest(null), []);
  // Wrapped rather than handing out `setRequest` itself, which would read a
  // caller's request as a state updater if one were ever a function.
  const show = useCallback((next: SplashRequest) => setRequest(next), []);
  const api = useMemo<SplashApi>(() => ({ show }), [show]);

  return (
    <SplashContext.Provider value={api}>
      {children}
      {request && (
        <BrandSplash
          title={request.title}
          subtitle={request.subtitle}
          holdMs={request.holdMs ?? SIGN_IN_HOLD_MS}
          onDone={hide}
        />
      )}
    </SplashContext.Provider>
  );
}

export function useSplash(): SplashApi {
  const ctx = useContext(SplashContext);
  if (!ctx) throw new Error('useSplash must be used inside a SplashProvider');
  return ctx;
}
