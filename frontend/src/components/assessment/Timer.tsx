import { useEffect, useRef, useState } from 'react';

interface TimerProps {
  /** Milliseconds left, as the server reported them on the last reply. */
  remainingMs: number;
  /**
   * Changes whenever the server sends a fresh figure. The countdown restarts
   * from `remainingMs` each time this changes, so client drift never
   * accumulates across a module.
   */
  syncKey: string;
  /** Fired once when the local countdown reaches zero. */
  onExpire: () => void;
}

/** Below this the timer turns red — enough warning to hurry, not to panic. */
const WARNING_MS = 60_000;

/**
 * Displays the module clock. The countdown here is presentation only: the
 * server holds the real deadline in Redis and refuses late answers regardless
 * of what this shows, so pausing or editing it in devtools buys nothing.
 */
export function Timer({ remainingMs, syncKey, onExpire }: TimerProps) {
  const [left, setLeft] = useState(remainingMs);
  const expired = useRef(false);

  useEffect(() => {
    setLeft(remainingMs);
    expired.current = false;

    // Anchor to wall-clock time rather than counting ticks: a backgrounded tab
    // throttles setInterval, and a tick-counter would silently run slow.
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const next = Math.max(0, remainingMs - (Date.now() - startedAt));
      setLeft(next);
      if (next === 0 && !expired.current) {
        expired.current = true;
        onExpire();
      }
    }, 250);

    return () => window.clearInterval(id);
  }, [remainingMs, syncKey, onExpire]);

  const totalSeconds = Math.ceil(left / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <div
      className={`assess-timer${left <= WARNING_MS ? ' warning' : ''}`}
      role="timer"
      aria-live="off"
    >
      <span className="assess-timer-label">Time left</span>
      <strong>
        {minutes}:{String(seconds).padStart(2, '0')}
      </strong>
    </div>
  );
}
