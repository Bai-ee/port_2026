'use client';

// DashboardCreationFailedModal — blocking modal shown when the client's
// PRIMARY dashboard-creation run has failed. Consumes only
// bootstrap.creationFailure (the allow-listed projection from
// api/_lib/client-provisioning.cjs buildCreationFailureProjection) — never a
// raw error. See docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md §4.
//
// There is no close button or backdrop dismiss: the parent decides whether to
// render this at all. Three explicit exits:
//   1. "Meet Instead"             — Calendly, new tab
//   2. "Continue anyway"         — optional, only when the parent supplies
//      onContinueAnyway. Lets the client into their UNPOPULATED dashboard.
//      NOTE: this departs from the plan's §122 two-exits-only contract; it was
//      an explicit owner decision. The parent's bypass is session-only and the
//      incident stays open, so admin review is unaffected.
//   3. "Delete account"          — hands off to the parent's existing
//      confirmation flow via onRequestDeleteAccount.

import { useEffect, useRef, useState } from 'react';
import {
  trackDashboardCreationFailedModalShown,
  trackDashboardCreationFailedReportCopied,
  trackDashboardCreationFailedCalendlyClicked,
  trackDashboardCreationFailedDeleteStarted,
  trackDashboardCreationFailedContinuedAnyway,
} from '../../lib/analytics';
import { buildCreationFailureReport } from '../../lib/dashboard/creation-failure-report';

const CALENDLY_URL = 'https://calendly.com/bballi/30min';
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, summary, [tabindex]:not([tabindex="-1"])';

export default function DashboardCreationFailedModal({ creationFailure, websiteUrl, onRequestDeleteAccount, onContinueAnyway }) {
  const modalRef = useRef(null);
  const [copyState, setCopyState] = useState('idle'); // 'idle' | 'copied' | 'error'

  const isOpen = creationFailure?.status === 'open';
  const incidentId = creationFailure?.incidentId || null;
  const publicCode = creationFailure?.publicCode || null;
  const publicStage = creationFailure?.publicStage || null;

  // Fire once per distinct incident, not on every bootstrap re-poll (a fresh
  // creationFailure object reference lands on every refetch even when the
  // incident itself hasn't changed).
  useEffect(() => {
    if (!isOpen) return;
    trackDashboardCreationFailedModalShown(publicCode, publicStage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  // Focus trap: no close control exists, so focus must never be allowed to
  // escape to the dashboard behind this modal. Initial focus lands on the
  // dialog container itself (not a pre-selected action) per the WAI-ARIA
  // alertdialog pattern — there is no single "obviously correct" default.
  useEffect(() => {
    if (!isOpen) return undefined;
    modalRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key !== 'Tab') return;
      const node = modalRef.current;
      const items = node ? Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)) : [];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (copyState === 'idle') return undefined;
    const timer = setTimeout(() => setCopyState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);

  if (!isOpen) return null;

  // The headline already states the failure and the copyable report carries the
  // domain, so the one remaining line of body copy folds the support reference
  // and the what-happens-next sentence together. Both no-code branches keep a
  // standalone sentence so a signup that never got a public code still reads.
  const notificationSent = creationFailure.notification?.status === 'sent';
  const statusLine = publicCode
    ? (notificationSent
      ? `Support reference: ${publicCode} — Bryan has been notified.`
      : `Support reference: ${publicCode} has been recorded and sent to Bryan for review.`)
    : (notificationSent
      ? 'Bryan has been notified and can take a closer look.'
      : 'Your report has been recorded and sent to Bryan for review.');
  const report = buildCreationFailureReport(creationFailure, { websiteUrl });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopyState('copied');
      trackDashboardCreationFailedReportCopied(publicCode);
    } catch {
      setCopyState('error');
    }
  };

  const handleCalendlyClick = () => {
    trackDashboardCreationFailedCalendlyClicked(publicCode);
  };

  const handleContinueAnyway = () => {
    trackDashboardCreationFailedContinuedAnyway(publicCode, publicStage);
    onContinueAnyway?.();
  };

  const handleDeleteClick = () => {
    trackDashboardCreationFailedDeleteStarted(publicCode);
    onRequestDeleteAccount?.();
  };

  const copyLabel = copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Could not copy — select text above' : 'Copy report';

  return (
    <div id="dashboard-creation-failed-overlay" style={overlayStyle}>
      {/* Same marquee keyframe every other execution declares locally
          (InnerPageShell.jsx:39, FAQPage.jsx:183, StackedSlidesSection.jsx:2347) —
          identical body, so redeclaring here is safe and keeps this modal
          self-contained. */}
      <style>{`
        @keyframes agentMarquee { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
        @media (prefers-reduced-motion: reduce) {
          .dashboard-creation-failed-heading-track { animation: none; }
        }
        .dashboard-creation-failed-cta-subrow > .dcf-btn { flex: 1 1 0; min-width: 0; }
        @media (max-width: 480px) {
          .dashboard-creation-failed-cta-subrow { flex-direction: column; }
          .dashboard-creation-failed-cta-subrow > .dcf-btn { flex: 0 0 auto; }
        }
        /* Press feedback: every pressable element confirms it heard the click.
           Named properties only, never the all-properties shorthand. */
        .dcf-btn {
          transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
                      border-color 160ms ease,
                      color 160ms ease,
                      background-color 160ms ease;
        }
        .dcf-btn:active { transform: scale(0.97); }
        /* Touch devices fire :hover on tap — gate it. */
        @media (hover: hover) and (pointer: fine) {
          .dcf-btn--continue:hover { border-color: rgba(42, 36, 32, 0.42); }
          .dcf-btn--delete:hover { color: #8b1e1e; border-color: rgba(139, 30, 30, 0.28); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dcf-btn { transition: border-color 160ms ease, color 160ms ease; }
          .dcf-btn:active { transform: none; }
        }
      `}</style>
      <div
        id="dashboard-creation-failed-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-creation-failed-heading"
        tabIndex={-1}
        style={modalStyle}
      >
        <div id="dashboard-creation-failed-header-row" style={headerRowStyle}>
          <img src="/img/profile2_400x400.png?v=1774582808" alt="" aria-hidden="true" style={headerLogoStyle} />
          <span id="dashboard-creation-failed-eyebrow" style={headerLabelStyle}>Dashboard</span>
        </div>

        <div id="dashboard-creation-failed-body" style={bodyStyle}>
          {/* Scrolling marquee headline. The 'b' copy is the seamless-loop
              duplicate (track translates -50%) and is aria-hidden so the
              dialog's aria-labelledby still resolves to the phrase once. */}
          <h2 id="dashboard-creation-failed-heading" style={headingStyle}>
            <span
              id="dashboard-creation-failed-heading-track"
              className="dashboard-creation-failed-heading-track"
              style={headingMarqueeTrackStyle}
            >
              {['a', 'b'].map((k) => (
                <span key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={headingMarqueeGroupStyle}>
                  <span>WE COULDN&rsquo;T FINISH YOUR DASHBOARD</span>
                  <span aria-hidden="true" style={headingMarqueeDotStyle}>&bull;</span>
                </span>
              ))}
            </span>
          </h2>
          <p id="dashboard-creation-failed-reference" style={referenceStyle}>
            <span id="dashboard-creation-failed-error-line" style={errorLineStyle}>An error occurred!</span>{' '}
            {statusLine}
          </p>

          <details id="dashboard-creation-failed-details" style={detailsStyle}>
            <summary id="dashboard-creation-failed-details-summary" style={detailsSummaryStyle}>Technical details</summary>
            <pre id="dashboard-creation-failed-report-text" style={reportTextStyle}>{report}</pre>
            <button type="button" id="dashboard-creation-failed-copy-btn" style={copyButtonStyle} onClick={handleCopy}>
              {copyLabel}
            </button>
            <span id="dashboard-creation-failed-copy-status" aria-live="polite" style={visuallyHiddenStyle}>
              {copyState === 'copied' ? 'Copied' : ''}
            </span>
          </details>

          <div id="dashboard-creation-failed-cta-row" style={ctaRowStyle}>
            <a
              id="dashboard-creation-failed-calendly-cta"
              className="cta-pill-btn dcf-btn"
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={primaryButtonStyle}
              onClick={handleCalendlyClick}
            >
              Meet Instead
            </a>
            <div
              id="dashboard-creation-failed-cta-subrow"
              className="dashboard-creation-failed-cta-subrow"
              style={ctaSubRowStyle}
            >
              {onContinueAnyway ? (
                <button
                  type="button"
                  id="dashboard-creation-failed-continue-btn"
                  className="dcf-btn dcf-btn--continue"
                  style={continueButtonStyle}
                  onClick={handleContinueAnyway}
                >
                  Continue anyway
                </button>
              ) : null}
              <button
                type="button"
                id="dashboard-creation-failed-delete-btn"
                className="dcf-btn dcf-btn--delete"
                style={secondaryButtonStyle}
                onClick={handleDeleteClick}
              >
                Delete account
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── styles — mirrors components/payments/SubscribeModal.jsx's visual grammar ─

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  // Above the intake terminal (up to 1000 inline) and every tile-detail modal
  // (900), below the account-deletion confirmation (2000) — see the wiring
  // note in DashboardPage.jsx next to where this component is rendered.
  zIndex: 1500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  background: 'rgba(42, 36, 32, 0.18)',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const modalStyle = {
  width: 'min(480px, 100%)',
  maxHeight: 'min(88dvh, 720px)',
  overflowY: 'auto',
  color: '#2a2420',
  background: '#ffffff',
  boxShadow: '0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4), 0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15)',
  border: '1px solid #E4E4E4',
  borderRadius: '1.5rem',
  outline: 'none',
};

const headerRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: 'clamp(1.25rem, 5vw, 2rem) clamp(1.25rem, 5vw, 2rem) 0',
};

const headerLogoStyle = {
  width: '2.75rem',
  height: '2.75rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid rgba(255,255,255,0.35)',
  display: 'block',
  flexShrink: 0,
};

const headerLabelStyle = {
  fontSize: '0.82rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.44)',
  fontWeight: 700,
  fontFamily: '"Space Mono", monospace',
};

const bodyStyle = {
  padding: '1rem clamp(1.25rem, 5vw, 2rem) clamp(2rem, 4vw, 2.5rem)',
};

// Doto display treatment — matches the established executions
// (#cmo-modal-marquee in StackedSlidesSection, the CONTACT marquee in
// InnerPageShell, the dashboard capability header): 700 weight, -0.02em
// tracking, 1.05 line-height. Only the size clamp is scoped down to fit
// the 480px modal.
const headingStyle = {
  margin: '0.75rem 0 0',
  fontFamily: "'Doto', 'Space Mono', monospace",
  fontSize: 'clamp(1.5rem, 5.5vw, 2rem)',
  lineHeight: 1.05,
  letterSpacing: '-0.02em',
  fontWeight: 700,
  color: '#2a2420',
  // Marquee viewport: edge fade matches the CONTACT marquee in InnerPageShell.
  overflow: 'hidden',
  maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
};

const headingMarqueeTrackStyle = {
  display: 'flex',
  alignItems: 'center',
  width: 'max-content',
  willChange: 'transform',
  animation: 'agentMarquee 22s linear infinite',
};

const headingMarqueeGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '1.5rem',
  paddingRight: '1.5rem',
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

const headingMarqueeDotStyle = {
  color: 'rgba(42, 36, 32, 0.35)',
};

// Now the modal's only line of body copy. Styling is unchanged from the old
// standalone reference line; only the top margin and line-height open up, since
// it no longer sits beneath a paragraph.
// Inline lead-in on the reference line — identical type treatment (it inherits
// everything from the paragraph), only the colour differs. Repo error ink
// #8b1e1e, same as #delete-account-modal-error and the intake [ERROR: ...] lines.
const errorLineStyle = {
  color: '#8b1e1e',
};

const referenceStyle = {
  margin: '0.9rem 0 0',
  fontSize: '0.82rem',
  lineHeight: 1.6,
  fontFamily: '"Space Mono", monospace',
  color: 'rgba(42, 36, 32, 0.5)',
  textAlign: 'center',
};

const detailsStyle = {
  margin: '1.25rem 0 0',
  padding: '0.75rem 1rem',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  borderRadius: '0.75rem',
  background: 'rgba(42, 36, 32, 0.03)',
};

const detailsSummaryStyle = {
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 700,
};

const reportTextStyle = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: '0.8rem',
  lineHeight: 1.6,
  fontFamily: '"Space Mono", monospace',
  color: '#2a2420',
  margin: '0.75rem 0',
};

const copyButtonStyle = {
  border: '1px solid rgba(42, 36, 32, 0.15)',
  background: '#ffffff',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.5rem 1rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const visuallyHiddenStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

const ctaRowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  marginTop: '1.5rem',
};

// The two secondary actions share one row at 50/50 on desktop; the class in
// the component's <style> block collapses them to full-width stacked at the
// repo's 480px mobile breakpoint.
const ctaSubRowStyle = {
  display: 'flex',
  gap: '0.75rem',
};

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  width: '100%',
  boxSizing: 'border-box',
  border: 'none',
  textDecoration: 'none',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: '#ffffff',
  borderRadius: '999px',
  padding: '0.85rem 1.25rem',
  fontSize: '0.875rem',
  fontWeight: 700,
  letterSpacing: '0.01em',
  cursor: 'pointer',
};

// Sits between the primary CTA and the muted delete action: same white pill as
// the delete button but at full-strength ink, so the destructive option stays
// the quietest thing in the row.
const continueButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(42, 36, 32, 0.22)',
  background: '#ffffff',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.72rem 1rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

// Destructive action stays the quietest thing in the row: lighter border,
// muted ink, same small type. Its only emphasis is the red-tinted hover.
const secondaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(42, 36, 32, 0.14)',
  background: '#ffffff',
  color: 'rgba(42, 36, 32, 0.55)',
  borderRadius: '999px',
  padding: '0.72rem 1rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};
