import React, { useState, useEffect } from 'react';

const Header = ({ logoRef }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const navItemsStyle = {
    display: isMobile ? 'none' : 'flex',
    gap: 'clamp(1.2rem, 3vw, 2.4rem)',
    alignItems: 'center',
    marginLeft: 'auto',
  };

  const navItemStyle = {
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

  return (
    <header id="site-nav" style={headerStyle}>
      <div ref={logoRef} aria-hidden="true" style={anchorStyle} />

      <a href="/" id="site-nav-wordmark" style={logoStyle}>Bryan Balli</a>

      {isMobile ? (
        <button
          data-nav-hamburger
          style={hamburgerStyle}
          onClick={() => {}}
          aria-label="Toggle menu"
        >
          <div style={hamburgerLineStyle} />
          <div style={hamburgerLineStyle} />
          <div style={hamburgerLineStyle} />
        </button>
      ) : (
        <nav id="site-nav-links" style={navItemsStyle}>
          <a href="#" style={navItemStyle}>Work</a>
          <a href="#" style={navItemStyle}>About</a>
          <a href="#" style={navItemStyle}>Process</a>
          <a href="#" style={navItemStyle}>Contact</a>
        </nav>
      )}
    </header>
  );
};

export default Header;
