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
            <img src="/img/sig.png" alt="" aria-hidden="true" />
          </a>

          <div id="founders-top-actions">
            {user ? (
              <>
                <button type="button" id="founders-login-link" onClick={handleDashClick}>
                  Dash
                </button>
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
              </>
            ) : (
              <a href="/login" id="founders-login-link">
                Client Login
              </a>
            )}
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;
