import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const Header = ({ logoRef, onOpenPage, logoSrc = '/img/sig.png' }) => {
  const isSignatureLogo = logoSrc === '/img/sig.png';
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(false);

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

  return (
    <>
      <header
        id="founders-top-strip"
        style={{
          background: 'rgba(245, 241, 223, 0.55)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 -1px 0 rgba(42,36,32,0.08)',
        }}
      >
        <div id="founders-top-strip-inner">
          {/* Hidden anchor for GSAP intro animation */}
          <div ref={logoRef} aria-hidden="true" style={{ width: 0, height: 0, pointerEvents: 'none', position: 'absolute' }} />

          <a href="/" id="founders-brand" aria-label="Back to homepage">
            <img src={logoSrc} alt={isSignatureLogo ? 'Bryan Balli signature' : 'Bryan Balli logo'} width={isSignatureLogo ? 276 : 663} height={isSignatureLogo ? 208 : 552} loading="eager" decoding="async" style={{ mixBlendMode: 'darken' }} />
          </a>

          <div id="founders-top-actions">
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
            <button
              type="button"
              id="founders-chat-cta"
              className="founders-chat-cta--light"
              onClick={handleDashboardCta}
            >
              <span className="founders-chat-label-full">Dashboard</span>
              <span className="founders-chat-label-short">Dash</span>
              <span id="founders-chat-cta-icon">↗</span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;
