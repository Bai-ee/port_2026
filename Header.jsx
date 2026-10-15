import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useAuth } from './AuthContext';
import UpRightArrow from './components/UpRightArrow';
import { scrambleTextTo } from './components/home/scrambleText';

const CTA_LABEL = 'Clients';
const CTA_SCRAMBLE_MS = 420;
const CTA_START_OPACITY = 0.25;

// `actions` is an optional right-side slot: pass a node to replace the default
// "Clients" CTA for a page that needs its own nav action (e.g. /looper's info
// button). Omitted everywhere else, so the homepage/FAQ/inner-page nav is
// unchanged.
const Header = ({ logoRef, onOpenPage, logoSrc = '/img/sig.png', actions = null }) => {
  const isSignatureLogo = logoSrc === '/img/sig.png';
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const ctaLabelRefs = useRef([]);
  const ctaArrowRef = useRef(null);
  const ctaCancelRef = useRef([]);

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth < 768;
      setIsMobile(nextIsMobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleDashboardCta = () => {
    if (user) {
      window.location.href = '/dashboard';
      return;
    }
    // Logged out: open the onboarding modal on the homepage; elsewhere fall
    // back to the login/onboard route since the modal only mounts on '/'.
    if (window.location.pathname === '/') {
      window.dispatchEvent(new CustomEvent('openOnboardModal'));
    } else {
      window.location.href = '/login?flow=homepage-create';
    }
  };

  // Hover: the label scrambles in from low to full opacity, then the arrow
  // appears. Text is written to the DOM directly (never React state) so the
  // scramble's textContent writes can't desync React's text nodes.
  const resetCta = () => {
    ctaCancelRef.current.forEach((cancel) => cancel());
    ctaCancelRef.current = [];
    ctaLabelRefs.current.forEach((node) => {
      if (!node) return;
      node.textContent = CTA_LABEL;
      node.style.transition = 'none';
      node.style.opacity = '1';
    });
    if (ctaArrowRef.current) ctaArrowRef.current.style.opacity = '0';
  };

  const playCta = () => {
    resetCta();
    const nodes = ctaLabelRefs.current.filter(Boolean);
    nodes.forEach((node, i) => {
      node.style.opacity = String(CTA_START_OPACITY);
      void node.offsetWidth;
      node.style.transition = `opacity ${CTA_SCRAMBLE_MS}ms ease-out`;
      node.style.opacity = '1';
      ctaCancelRef.current.push(scrambleTextTo(node, CTA_LABEL, {
        durationMs: CTA_SCRAMBLE_MS,
        churnBeforeLock: true,
        onComplete: i === 0 ? () => {
          if (ctaArrowRef.current) ctaArrowRef.current.style.opacity = '1';
        } : undefined,
      }));
    });
  };

  useEffect(() => () => ctaCancelRef.current.forEach((cancel) => cancel()), []);

  return (
    <>
      <header
        id="founders-top-strip"
        style={{
          background: 'var(--t-chrome)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: 'inset 0 0 0 1px var(--t-glass-highlight), inset 0 -1px 0 var(--t-border-faint)',
        }}
      >
        <div id="founders-top-strip-inner">
          {/* Hidden anchor for GSAP intro animation */}
          <div ref={logoRef} aria-hidden="true" style={{ width: 0, height: 0, pointerEvents: 'none', position: 'absolute' }} />

          <a href="/" id="founders-brand" aria-label="Back to homepage">
            <Image src={logoSrc} alt={isSignatureLogo ? 'Bryan Balli signature' : 'Bryan Balli logo'} width={isSignatureLogo ? 276 : 663} height={isSignatureLogo ? 208 : 552} priority id="founders-brand-logo-image" style={{ mixBlendMode: 'var(--t-logo-blend)', filter: isSignatureLogo ? 'var(--t-logo-filter)' : undefined }} />
          </a>

          <div id="founders-top-actions">
            {actions || (
              <button
                type="button"
                id="founders-chat-cta"
                className="founders-chat-cta--light"
                onClick={handleDashboardCta}
                onMouseEnter={playCta}
                onMouseLeave={resetCta}
                onFocus={playCta}
                onBlur={resetCta}
                style={{ position: 'relative' }}
              >
                <span ref={(node) => { ctaLabelRefs.current[0] = node; }} className="founders-chat-label-full">{CTA_LABEL}</span>
                <span ref={(node) => { ctaLabelRefs.current[1] = node; }} className="founders-chat-label-short">{CTA_LABEL}</span>
                {/* Absolutely placed so revealing it never shifts the label. */}
                <span
                  ref={ctaArrowRef}
                  id="founders-chat-cta-arrow-slot"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: '0.3rem', lineHeight: 0, opacity: 0, transition: 'opacity 160ms ease-out', pointerEvents: 'none' }}
                >
                  <UpRightArrow id="founders-chat-cta-icon" />
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Floating scroll-to-top bubble, bottom-right. Same show/hide trigger as
          before (StackedSlidesSection's hero-pin logic toggles #nav-scroll-top-arrow's
          display) — only the position/shape moved out of the nav. */}
      <button
        id="nav-scroll-top"
        type="button"
        aria-label="Scroll to top"
        onClick={() => {
          const arrow = document.getElementById('nav-scroll-top-arrow');
          if (arrow && arrow.style.display !== 'none') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
      >
        <span id="nav-scroll-top-arrow" style={{ display: 'none', lineHeight: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="8" y1="13" x2="8" y2="3" />
            <polyline points="4,7 8,3 12,7" />
          </svg>
        </span>
      </button>
    </>
  );
};

export default Header;
