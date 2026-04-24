import React, { useState, useEffect } from 'react';
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
      <header id="founders-top-strip">
        <div id="founders-top-strip-inner">
          {/* Hidden anchor for GSAP intro animation */}
          <div ref={logoRef} aria-hidden="true" style={{ width: 0, height: 0, pointerEvents: 'none', position: 'absolute' }} />

          <a href="/" id="founders-brand" aria-label="Back to homepage">
            <img src="/img/profile2_400x400.png?v=1774582808" alt="Bryan Balli" width="36" height="36" loading="eager" decoding="async" style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
          </a>

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
            <a
              id="founders-chat-cta"
              className="founders-chat-cta--light"
              href="https://calendly.com/bballi/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="founders-chat-label-full">Contact</span>
              <span className="founders-chat-label-short">Contact</span>
              <span id="founders-chat-cta-icon">↗</span>
            </a>
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;
