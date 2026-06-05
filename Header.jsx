import React, { useState, useEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { useAuth } from './AuthContext';

const Header = ({ logoRef, onOpenPage }) => {
  const { user, signOutUser } = useAuth();
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

  const handleDashClick = () => {
    if (user) {
      window.location.href = '/dashboard';
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
            <img src="/img/sig.png" alt="Bryan Balli signature" width="276" height="208" loading="eager" decoding="async" style={{ mixBlendMode: 'darken' }} />
          </a>

          <button
            id="nav-scroll-top"
            type="button"
            aria-label="Scroll to top"
            style={{ marginLeft: 'auto' }}
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
            <Settings2 id="nav-scroll-top-settings" size={16} strokeWidth={1.5} />
          </button>

          <div id="founders-top-actions">
            {user ? (
              <>
                <button type="button" id="founders-logout-link" onClick={signOutUser}>
                  Logout
                </button>
                <button type="button" id="founders-login-link" onClick={handleDashClick}>
                  Dash
                </button>
              </>
            ) : (
              <a href="/login" id="founders-login-link">
                Login
              </a>
            )}
            <button
              type="button"
              id="founders-chat-cta"
              className="founders-chat-cta--light"
              onClick={() => window.dispatchEvent(new CustomEvent('openOnboardModal'))}
            >
              <span className="founders-chat-label-full">Onboard</span>
              <span className="founders-chat-label-short">Onboard</span>
              <span id="founders-chat-cta-icon">↗</span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;
