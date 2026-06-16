import React from 'react';

const agencyLogos = [
  { src: '/img/agencies/publicis.png', alt: 'Publicis', scale: 2 },
  { src: '/img/agencies/epsilon.png', alt: 'Epsilon' },
  { src: '/img/agencies/conversant.png', alt: 'Conversant' },
  { src: '/img/agencies/alliance.png', alt: 'Alliance Data' },
];

const ctaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.5rem 0.75rem',
  lineHeight: 1,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  color: '#ffffff',
  background:
    'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: 'none',
  borderRadius: '999px',
  boxShadow:
    '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const ctaAvatarStyle = {
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid rgba(255,255,255,0.35)',
  flexShrink: 0,
  display: 'block',
};

const ctaIconStyle = { fontSize: '0.7rem', opacity: 0.75, marginLeft: '0.1rem' };

export default function SiteFooter() {
  return (
    <footer id="site-footer">
      <style>{`
        @keyframes site-footer-marquee {
          from { transform: translate3d(0,0,0); }
          to   { transform: translate3d(-50%,0,0); }
        }
        #site-footer {
          width: 100%;
          border-top: 1px solid rgba(42,36,32,0.1);
          margin-top: clamp(3rem,6vw,5rem);
          box-sizing: border-box;
        }
        #site-footer-inner {
          max-width: 1440px;
          margin: 0 auto;
          padding: clamp(2.5rem,5vw,4.5rem) 48px clamp(3rem,6vw,5rem);
          box-sizing: border-box;
        }
        #site-footer-newsletter {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(1rem,2vw,1.55rem);
          text-align: center;
          width: 100%;
          max-width: 46rem;
          margin: 0 auto;
        }
        #site-footer-contact-marquee {
          width: 100%;
          overflow: hidden;
          margin-bottom: clamp(24px,5vw,75px);
          mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);
        }
        #site-footer-contact-marquee-track {
          display: flex;
          align-items: center;
          width: max-content;
          will-change: transform;
          animation: site-footer-marquee 28s linear infinite;
        }
        .sf-contact-word {
          font-family: 'Doto','Space Mono',monospace;
          font-size: clamp(1.6rem,8.5vw,7rem);
          letter-spacing: -0.02em;
          font-weight: 700;
          line-height: 1.05;
          color: #2a2420;
          white-space: nowrap;
        }
        #site-footer-sig {
          width: min(110px,31vw);
          height: auto;
          display: block;
        }
        #site-footer-cta-row {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: clamp(0.5rem,1.5vw,1rem);
          width: 100%;
          margin-top: clamp(1.25rem,2.5vw,2rem);
        }
        #site-footer-support-text {
          margin: clamp(1rem,2vw,1.5rem) 0 clamp(0.75rem,1.5vw,1.25rem);
          font-size: clamp(0.7rem,1.4vw,0.91rem);
          line-height: 1.6;
          font-weight: 400;
          text-align: left;
          color: rgba(42,36,32,0.8);
          max-width: 46rem;
        }
        #site-footer-previously-at {
          margin: 0.5rem 0 0.35rem;
          text-align: center;
          font-size: 0.7rem;
          letter-spacing: 0.06em;
          color: rgba(42,36,32,0.32);
          font-family: 'Space Mono',monospace;
        }
        #site-footer-agency-shell {
          width: 100%;
          max-width: 325px;
          overflow: hidden;
          display: block;
          text-decoration: none;
          mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
        }
        #site-footer-agency-track {
          display: flex;
          align-items: center;
          width: max-content;
          will-change: transform;
          animation: site-footer-marquee 18s linear infinite;
        }
        .sf-agency-set {
          display: flex;
          align-items: center;
          gap: 2rem;
          padding-right: 2rem;
          flex-shrink: 0;
        }
        .sf-agency-logo {
          height: 22px;
          width: auto;
          display: block;
          opacity: 0.45;
          filter: grayscale(1);
          flex-shrink: 0;
        }
        #site-footer-nav {
          display: flex;
          flex-wrap: wrap;
          gap: clamp(2rem,5vw,4rem);
          padding: clamp(2rem,4vw,3rem) 0;
          border-top: 1px solid rgba(42,36,32,0.1);
          margin-top: 50px;
          list-style: none;
        }
        .sf-nav-col { display: flex; flex-direction: column; gap: 0.7rem; }
        .sf-nav-heading {
          font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: rgba(42,36,32,0.35); margin-bottom: 0.2rem;
        }
        .sf-nav-link {
          font-size: clamp(0.82rem,1.1vw,0.9rem);
          color: rgba(42,36,32,0.6); text-decoration: none; line-height: 1.4;
        }
        .sf-nav-link:hover { color: #2a2420; }
        /* Nav + bottom links inactive until pages ship — LinkedIn/X stay live */
        #site-footer-nav a,
        #site-footer-bottom a { pointer-events: none; cursor: default; }
        #site-footer-bottom a[href*="linkedin"],
        #site-footer-bottom a[href*="x.com"] { pointer-events: auto; cursor: pointer; }
        #site-footer-bottom {
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 0.75rem;
          padding-top: clamp(1rem,2vw,1.5rem);
          border-top: 1px solid rgba(42,36,32,0.1);
        }
        #site-footer-copyright { font-size: 0.78rem; color: rgba(42,36,32,0.35); }
        #site-footer-social-links { display: flex; gap: 1.5rem; }
        .sf-social-link { font-size: 0.82rem; color: rgba(42,36,32,0.4); text-decoration: none; }
        .sf-social-link:hover { color: #2a2420; }
        @media (max-width: 900px) {
          #site-footer-inner { padding-left: 24px; padding-right: 24px; }
        }
        @media (max-width: 620px) {
          #site-footer-inner { padding-left: 12px; padding-right: 12px; }
          #site-footer-support-text { text-align: left; }
          #site-footer-cta-row { flex-direction: column; align-items: stretch; }
          #site-footer-contact-cta { justify-content: center; }
        }
      `}</style>

      <div id="site-footer-inner">
        <div id="site-footer-newsletter">

          {/* CONTACT marquee */}
          <div id="site-footer-contact-marquee">
            <div id="site-footer-contact-marquee-track">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  aria-hidden={i > 0 ? 'true' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}
                >
                  {['CONTACT', '•', 'CONTACT', '•'].map((w, j) => (
                    <span key={j} className="sf-contact-word">{w}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <img id="site-footer-sig" src="/img/sig.png" alt="Bryan Balli signature" />

          {/* CTA */}
          <div id="site-footer-cta-row">
            <a
              id="site-footer-contact-cta"
              href="https://calendly.com/bballi/30min"
              target="_blank"
              rel="noopener noreferrer"
              className="cta-pill-btn"
              style={{ ...ctaStyle, textDecoration: 'none', border: 'none' }}
            >
              <img src="/img/profile2_400x400.png?v=1774582808" style={ctaAvatarStyle} alt="" />
              Meet with A Human
              <span style={ctaIconStyle}>↗</span>
            </a>
          </div>

          {/* Body text */}
          <p id="site-footer-support-text">
            Partner with <strong>BRYAN BALLI</strong>, an experienced Media Developer leveraging
            LLMs, capable of automating your Brands operations, Design, Development and
            Marketing.<br /><br />Humans in the Loop (HITLOOP) offers various automations
            leveraging agentic solutions that follow established processes, to elevate and automate
            Creative Services.
          </p>

          {/* Previously at + agency logos */}
          <p id="site-footer-previously-at">previously at…</p>
          <a
            id="site-footer-agency-shell"
            href="https://www.linkedin.com/in/bryanballi/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div id="site-footer-agency-track">
              {[0, 1].map((i) => (
                <div key={i} aria-hidden={i > 0 ? 'true' : undefined} className="sf-agency-set">
                  {agencyLogos.map((logo) => (
                    <img
                      key={`${i}-${logo.alt}`}
                      src={logo.src}
                      alt={i === 0 ? logo.alt : ''}
                      className="sf-agency-logo"
                      style={logo.scale ? { height: `${22 * logo.scale}px` } : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
          </a>

        </div>

        {/* SEO nav */}
        <nav id="site-footer-nav" aria-label="Site navigation">
          <div className="sf-nav-col">
            <span className="sf-nav-heading">Work</span>
            <a href="/work" className="sf-nav-link">Featured Projects</a>
            <a href="/case-studies" className="sf-nav-link">Case Studies</a>
            <a href="/process" className="sf-nav-link">Process</a>
          </div>
          <div className="sf-nav-col">
            <span className="sf-nav-heading">Services</span>
            <a href="/services/ai-design-consulting" className="sf-nav-link">AI Design Consulting</a>
            <a href="/services/web-development" className="sf-nav-link">Web Development</a>
            <a href="/services/brand-identity" className="sf-nav-link">Brand Identity</a>
            <a href="/services/design-systems" className="sf-nav-link">Design Systems</a>
            <a href="/services/seo-geo" className="sf-nav-link">SEO &amp; GEO</a>
          </div>
          <div className="sf-nav-col">
            <span className="sf-nav-heading">FAQ</span>
            <a href="/faq#what-is-a-creative-technologist" className="sf-nav-link">What Is a Creative Technologist?</a>
            <a href="/faq#ai-design-engineer" className="sf-nav-link">What Is an AI Design Engineer?</a>
            <a href="/faq#how-i-work" className="sf-nav-link">How I Work</a>
            <a href="/faq#pricing" className="sf-nav-link">Pricing &amp; Engagements</a>
            <a href="/faq#turnaround" className="sf-nav-link">Turnaround &amp; Availability</a>
          </div>
          <div className="sf-nav-col">
            <span className="sf-nav-heading">Company</span>
            <a href="/about" className="sf-nav-link">About</a>
            <a href="/how-it-works" className="sf-nav-link">How It Works</a>
            <a href="/contact" className="sf-nav-link">Contact</a>
            <a href="https://calendly.com/bballi/30min" target="_blank" rel="noopener noreferrer" className="sf-nav-link">Book a Call</a>
          </div>
        </nav>

        {/* Bottom bar */}
        <div id="site-footer-bottom">
          <span id="site-footer-copyright">© 2026 Bryan Balli · All rights reserved</span>
          <div id="site-footer-social-links">
            <a href="https://www.linkedin.com/in/bryanballi" className="sf-social-link">LinkedIn</a>
            <a href="https://x.com/bai_ee" className="sf-social-link">𝕏</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
