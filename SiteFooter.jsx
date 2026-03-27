import React, { useState } from 'react';

const SiteFooter = () => {
  const [email, setEmail] = useState('');

  return (
    <footer id="site-footer" style={footerStyle}>
      <div style={footerInnerStyle}>

        {/* Top grid */}
        <div style={footerTopStyle}>

          {/* Left — brand */}
          <div style={footerBrandColStyle}>
            <a href="/" style={footerWordmarkStyle}>Bryan Balli</a>
            <p style={footerDescStyle}>
              Creative technologist & digital media consultant. Human-in-the-loop AI systems, interactive builds, and digital strategy.
            </p>
            <div style={footerSocialsStyle}>
              <a href="#" style={footerSocialBtnStyle} aria-label="LinkedIn">in</a>
              <a href="#" style={footerSocialBtnStyle} aria-label="Twitter">𝕏</a>
              <a href="#" style={footerSocialBtnStyle} aria-label="GitHub">gh</a>
            </div>
          </div>

          {/* Right — nav columns */}
          <div style={footerNavGridStyle}>
            <div style={footerNavColStyle}>
              <span style={footerNavHeadingStyle}>Work</span>
              <a href="#" style={footerNavLinkStyle}>Featured Projects</a>
              <a href="#" style={footerNavLinkStyle}>Case Studies</a>
              <a href="#" style={footerNavLinkStyle}>Gallery</a>
              <a href="#" style={footerNavLinkStyle}>Process</a>
            </div>
            <div style={footerNavColStyle}>
              <span style={footerNavHeadingStyle}>Company</span>
              <a href="#" style={footerNavLinkStyle}>About</a>
              <a href="#" style={footerNavLinkStyle}>How It Works</a>
              <a href="#" style={footerNavLinkStyle}>Contact</a>
              <a
                href="#"
                style={footerNavLinkStyle}
                data-cal-link="bryan-balli-5w12w7/30min"
                data-cal-namespace="30min"
                data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
              >Book a Call</a>
            </div>
          </div>

        </div>

        {/* Divider */}
        <div style={footerDividerStyle} />

        {/* Newsletter */}
        <div style={footerNewsletterStyle}>
          <h3 style={footerNewsletterHeadingStyle}>Stay In Touch</h3>
          <p style={footerNewsletterSubStyle}>Updates on projects, tools, and thinking on human-AI collaboration.</p>
          <div style={footerFormStyle}>
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={footerInputStyle}
            />
            <button className="cta-pill-btn" style={footerSubmitStyle}>
              <img src="/img/profile2_400x400.png?v=1774582808" style={footerSubmitAvatarStyle} alt="" />
              Subscribe
            </button>
          </div>
        </div>

        {/* Divider */}
        <div style={footerDividerStyle} />

        {/* Bottom bar */}
        <div style={footerBottomStyle}>
          <span style={footerCopyrightStyle}>© 2026 Bryan Balli · All rights reserved</span>
          <div style={footerLegalLinksStyle}>
            <a href="#" style={footerLegalLinkStyle}>Privacy</a>
            <a href="#" style={footerLegalLinkStyle}>Terms</a>
          </div>
        </div>

      </div>
    </footer>
  );
};

const footerStyle = {
  width: '100%',
  background: '#1e1a17',
  paddingTop: 'clamp(4rem, 8vw, 7rem)',
  paddingBottom: 'clamp(2rem, 4vw, 3rem)',
  boxSizing: 'border-box',
};

const footerInnerStyle = {
  maxWidth: '1100px',
  margin: '0 auto',
  padding: '0 clamp(1.5rem, 5vw, 3rem)',
};

const footerTopStyle = {
  display: 'flex',
  gap: 'clamp(3rem, 8vw, 8rem)',
  flexWrap: 'wrap',
  marginBottom: 'clamp(3rem, 6vw, 5rem)',
};

const footerBrandColStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  flex: '1 1 260px',
  maxWidth: '340px',
};

const footerWordmarkStyle = {
  fontSize: 'clamp(1.3rem, 2.5vw, 1.8rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  color: '#f5f1df',
  textDecoration: 'none',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const footerDescStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  lineHeight: 1.65,
  color: 'rgba(245, 241, 223, 0.45)',
};

const footerSocialsStyle = {
  display: 'flex',
  gap: '0.6rem',
  marginTop: '0.5rem',
};

const footerSocialBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.2rem',
  height: '2.2rem',
  borderRadius: '50%',
  border: '1px solid rgba(245, 241, 223, 0.2)',
  color: 'rgba(245, 241, 223, 0.6)',
  fontSize: '0.72rem',
  fontWeight: 700,
  textDecoration: 'none',
  cursor: 'pointer',
};

const footerNavGridStyle = {
  display: 'flex',
  gap: 'clamp(2rem, 6vw, 6rem)',
  flex: '1 1 auto',
  flexWrap: 'wrap',
};

const footerNavColStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.85rem',
};

const footerNavHeadingStyle = {
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(245, 241, 223, 0.35)',
  marginBottom: '0.25rem',
};

const footerNavLinkStyle = {
  fontSize: 'clamp(0.85rem, 1.2vw, 0.95rem)',
  color: 'rgba(245, 241, 223, 0.65)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const footerDividerStyle = {
  width: '100%',
  height: '1px',
  background: 'rgba(245, 241, 223, 0.1)',
  margin: 'clamp(2rem, 4vw, 3rem) 0',
};

const footerNewsletterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
  textAlign: 'center',
};

const footerNewsletterHeadingStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 1.8vw, 1.3rem)',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  color: '#f5f1df',
};

const footerNewsletterSubStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.88rem)',
  color: 'rgba(245, 241, 223, 0.45)',
  maxWidth: '36ch',
};

const footerFormStyle = {
  display: 'flex',
  gap: '0.5rem',
  marginTop: '0.5rem',
  width: '100%',
  maxWidth: '420px',
};

const footerInputStyle = {
  flex: 1,
  padding: '0.75rem 1rem',
  background: 'rgba(245, 241, 223, 0.06)',
  border: '1px solid rgba(245, 241, 223, 0.15)',
  borderRadius: '0.5rem',
  color: '#f5f1df',
  fontSize: '0.88rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const footerSubmitStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.25rem 0.75rem 0.25rem 0.25rem',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: '#ffffff',
  fontSize: '0.875rem',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const footerSubmitAvatarStyle = {
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid rgba(255,255,255,0.35)',
  flexShrink: 0,
  display: 'block',
};

const footerBottomStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.75rem',
};

const footerCopyrightStyle = {
  fontSize: '0.78rem',
  color: 'rgba(245, 241, 223, 0.3)',
};

const footerLegalLinksStyle = {
  display: 'flex',
  gap: '1.5rem',
};

const footerLegalLinkStyle = {
  fontSize: '0.78rem',
  color: 'rgba(245, 241, 223, 0.35)',
  textDecoration: 'none',
  cursor: 'pointer',
};

export default SiteFooter;
