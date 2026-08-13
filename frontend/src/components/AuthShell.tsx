import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="auth-page">
      <div className="auth-container">

        {/* ══ LEFT — premium dark login panel ══════════════════════════════ */}
        <section className="auth-left">

          <div className="al-glow al-glow--top" aria-hidden="true" />
          <div className="al-glow al-glow--bottom" aria-hidden="true" />

          <header className="al-logo">
            <div className="al-logo-row">
              <div className="al-mark" aria-hidden="true">A</div>
              <span className="al-name">AdaptiveHire</span>
            </div>
            <p className="al-tagline-sub">Assess · Adapt · Achieve</p>
          </header>

          <div className="al-body">
            <div className="al-head">
              <h1>{title}.</h1>
              <p>{subtitle}</p>
            </div>
            {children}
            {footer && <div className="al-links">{footer}</div>}
          </div>

        </section>

        {/* ══ RIGHT — premium hero + assessment world ════════════════════════ */}
        <section className="auth-right" aria-hidden="true">

          {/* Layer 1-4: Background atmosphere + brand watermark */}
          <div className="ar-bg">
            <div className="ar-orb ar-orb--1" />
            <div className="ar-orb ar-orb--2" />
            <div className="ar-orb ar-orb--3" />
            <div className="ar-arc ar-arc--1" />
            <div className="ar-arc ar-arc--2" />
            <div className="ar-grid-overlay" />
            <div className="ar-watermark">
              <span className="ar-wm-line">ADAPTIVEHIRE</span>
              <span className="ar-wm-line">ADAPTIVEHIRE</span>
            </div>
          </div>

          <div className="ar-inner">

            {/* Hero copy */}
            <div className="ar-hero">
              <h2>
                <span className="ar-w">Your assessment.</span>
                <br />
                <span className="ar-l">Your opportunity.</span>
              </h2>
              <p>
                AdaptiveHire delivers a secure, fair and adaptive
                assessment experience for every candidate.
              </p>
            </div>

            {/* Layer 5: Product illustration */}
            <div className="ar-illus">

              {/* Aptitude calculation fragments */}
              <span className="ar-calc ar-calc--1" aria-hidden="true">3, 6, 12, 24 → 48</span>
              <span className="ar-calc ar-calc--2" aria-hidden="true">√144 = 12</span>
              <span className="ar-calc ar-calc--3" aria-hidden="true">A → C → F → J → ?</span>
              <span className="ar-calc ar-calc--4" aria-hidden="true">72 ÷ 8 = 9</span>

              {/* Device glow */}
              <div className="ar-device-glow" aria-hidden="true" />

              {/* Assessment device */}
              <div className="ar-device">
                <div className="ar-device-frame">

                  <div className="ar-chrome">
                    <div className="ar-dots"><span /><span /><span /></div>
                    <div className="ar-url">adaptivehire.app/assessment</div>
                    <div className="ar-live" />
                  </div>

                  <div className="ar-screen-body">
                    <div className="ar-sm-top">
                      <div className="ar-sm-module">
                        <span className="ar-sm-mod-label">Logical Reasoning</span>
                        <span className="ar-sm-qn">Question 08 / 15</span>
                      </div>
                      <div className="ar-sm-track">
                        <div className="ar-sm-fill" style={{ width: '53%' }} />
                      </div>
                    </div>

                    <p className="ar-sm-q">
                      Which approach best describes adaptive testing in a
                      recruitment context?
                    </p>

                    <div className="ar-sm-opts">
                      <div className="ar-sm-opt">
                        <span className="ar-sm-key">A</span>
                        <span>Fixed question order for all candidates</span>
                      </div>
                      <div className="ar-sm-opt ar-sm-opt--sel">
                        <span className="ar-sm-key ar-sm-key--on">B</span>
                        <span>Dynamic difficulty based on responses</span>
                        <span className="ar-sm-check" aria-hidden="true">
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor"
                            strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                            width={10} height={10}>
                            <polyline points="2,6 5,9 10,3" />
                          </svg>
                        </span>
                      </div>
                      <div className="ar-sm-opt">
                        <span className="ar-sm-key">C</span>
                        <span>Random question pool selection</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Performance score chip */}
              <div className="ar-chip ar-chip--score">
                <div className="ar-ring">
                  <svg viewBox="0 0 40 40" width="44" height="44">
                    <circle cx="20" cy="20" r="17" fill="none"
                      stroke="rgba(255,255,255,0.10)" strokeWidth="3.5" />
                    <circle cx="20" cy="20" r="17" fill="none"
                      stroke="rgba(196,181,253,0.9)" strokeWidth="3.5"
                      strokeDasharray="90.7 16.3" strokeDashoffset="24"
                      strokeLinecap="round"
                      transform="rotate(-90 20 20)" />
                  </svg>
                  <span>85%</span>
                </div>
                <div className="ar-chip-info">
                  <strong>Performance</strong>
                  <span>Overall score</span>
                </div>
              </div>

              {/* Timer chip */}
              <div className="ar-chip ar-chip--timer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  width={15} height={15}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <div>
                  <div className="ar-chip-tl">Time remaining</div>
                  <div className="ar-chip-tv">12:42</div>
                </div>
              </div>

              {/* Micro assessment cards */}
              <div className="ar-micro ar-micro--apt" aria-hidden="true">
                <span className="ar-micro-ico">🧠</span>
                <div className="ar-micro-data">
                  <span className="ar-micro-lbl">Aptitude</span>
                  <span className="ar-micro-val">87%</span>
                </div>
              </div>

              <div className="ar-micro ar-micro--rsn" aria-hidden="true">
                <span className="ar-micro-ico">🧩</span>
                <div className="ar-micro-data">
                  <span className="ar-micro-lbl">Reasoning</span>
                  <span className="ar-micro-val">92%</span>
                </div>
              </div>

              <div className="ar-micro ar-micro--adp" aria-hidden="true">
                <span className="ar-micro-ico">🔄</span>
                <div className="ar-micro-data">
                  <span className="ar-micro-lbl">Adaptability</span>
                  <span className="ar-micro-val">+18%</span>
                </div>
              </div>

              {/* Adaptive engine active indicator */}
              <div className="ar-engine" aria-hidden="true">
                <span className="ar-engine-dot" />
                <span className="ar-engine-label">Adaptive engine active</span>
              </div>

            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
