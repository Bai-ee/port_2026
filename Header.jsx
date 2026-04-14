import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const Header = ({ logoRef, onOpenPage }) => {
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(false); // SSR-safe: real value set in useEffect below
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth < 768;
      setIsMobile(nextIsMobile);
      if (!nextIsMobile) {
        setIsMenuOpen(false);
      }
    };

    handleResize(); // set real value on mount
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  // const navItems = [
  //   { label: 'Work', href: '#content-section' },
  //   { label: 'About', pageId: 'value' },
  //   { label: 'Process', pageId: 'engage' },
  //   { label: 'Contact', pageId: 'contact' },
  // ];

  const openPage = (pageId) => {
    setIsMenuOpen(false);
    onOpenPage?.(pageId);
  };

  const headerStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '64px',
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 'max(10vw, calc((100% - 810px) / 2))',
    paddingRight: 'max(10vw, calc((100% - 810px) / 2))',
    background: 'rgba(245, 241, 223, 0.18)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 -1px 0 rgba(42,36,32,0.08)',
    boxSizing: 'border-box',
  };

  const anchorStyle = {
    width: 0,
    height: 0,
    pointerEvents: 'none',
  };

  const logoStyle = {
    fontSize: 'clamp(1rem, 2vw, 1.4rem)',
    fontWeight: 700,
    letterSpacing: 'normal',
    textTransform: 'uppercase',
    color: '#2a2420',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  };

  const socialLinkStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'clamp(0.9rem, 1.4vw, 1rem)',
    fontWeight: 500,
    letterSpacing: '-0.02em',
    color: 'rgba(42, 36, 32, 0.42)',
    textDecoration: 'none',
    lineHeight: 1,
  };

  const actionGroupStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    maxWidth: '268.336px',
  };

  const loginLinkStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.65rem 1rem',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.34)',
    border: '1px solid rgba(42, 36, 32, 0.1)',
    color: '#2a2420',
    textDecoration: 'none',
    fontSize: '0.84rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
    lineHeight: 1,
  };

  const navItemsStyle = {
    display: isMobile ? 'none' : 'flex',
    gap: 'clamp(1.2rem, 3vw, 2.4rem)',
    alignItems: 'center',
    marginLeft: 'auto',
  };

  const navItemStyle = {
    border: 'none',
    background: 'none',
    fontSize: 'clamp(0.62rem, 1.1vw, 0.72rem)',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#2a2420',
    textDecoration: 'none',
    opacity: 0.65,
    cursor: 'pointer',
  };

  const hamburgerStyle = {
    display: isMobile ? 'flex' : 'none',
    flexDirection: 'column',
    gap: '5px',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    marginLeft: 'auto',
  };

  const hamburgerLineStyle = {
    width: 'clamp(20px, 5vw, 24px)',
    height: '2px',
    backgroundColor: '#2a2420',
    transition: 'all 0.3s ease',
  };

  const mobileMenuOverlayStyle = {
    position: 'fixed',
    inset: '80px 1rem auto',
    zIndex: 260,
    background: 'rgba(245, 241, 223, 0.18)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6), 0 24px 70px rgba(42,36,32,0.15)',
    borderRadius: '1.25rem',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
  };

  const mobileNavItemStyle = {
    border: 'none',
    background: 'rgba(255,255,255,0.34)',
    color: '#2a2420',
    borderRadius: '0.95rem',
    padding: '0.95rem 1rem',
    textAlign: 'left',
    fontSize: '0.86rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    cursor: 'pointer',
  };

  return (
    <>
      <header id="site-nav" style={headerStyle}>
        <div ref={logoRef} aria-hidden="true" style={anchorStyle} />

        <div id="site-nav-brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <img src="/img/sig.png" alt="" aria-hidden="true" style={{ height: 'clamp(2rem, 4vw, 2.8rem)', width: 'auto', display: 'block' }} />
        </div>

        <div style={actionGroupStyle}>
          <a
            href="https://www.linkedin.com/in/bryanballi"
            target="_blank"
            rel="noopener noreferrer"
            style={socialLinkStyle}
            aria-label="LinkedIn"
          >
            LinkedIn
          </a>
          <a href={user ? '/dashboard' : '/login'} style={loginLinkStyle}>
            {user ? 'Go to Dashboard' : 'Client Login'}
          </a>
        </div>

        {isMobile ? (
          /*
          <button
            data-nav-hamburger
            style={hamburgerStyle}
            onClick={() => setIsMenuOpen((value) => !value)}
            aria-label="Toggle menu"
            aria-expanded={isMenuOpen}
          >
            <div style={{ ...hamburgerLineStyle, transform: isMenuOpen ? 'translateY(7px) rotate(45deg)' : 'none' }} />
            <div style={{ ...hamburgerLineStyle, opacity: isMenuOpen ? 0 : 1 }} />
            <div style={{ ...hamburgerLineStyle, transform: isMenuOpen ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
          </button>
          */
          null
        ) : (
          /*
          <nav id="site-nav-links" style={navItemsStyle}>
            {navItems.map((item) => (
              item.pageId ? (
                <button key={item.label} type="button" style={navItemStyle} onClick={() => openPage(item.pageId)}>
                  {item.label}
                </button>
              ) : (
                <a key={item.label} href={item.href} style={navItemStyle}>
                  {item.label}
                </a>
              )
            ))}
          </nav>
          */
          null
        )}
      </header>

      {/*
      {isMobile && isMenuOpen ? (
        <div style={mobileMenuOverlayStyle}>
          {navItems.map((item) => (
            item.pageId ? (
              <button key={item.label} type="button" style={mobileNavItemStyle} onClick={() => openPage(item.pageId)}>
                {item.label}
              </button>
            ) : (
              <a key={item.label} href={item.href} style={{ ...mobileNavItemStyle, display: 'block', textDecoration: 'none' }} onClick={() => setIsMenuOpen(false)}>
                {item.label}
              </a>
            )
          ))}
        </div>
      ) : null}
      */}
    </>
  );
};

export default Header;
