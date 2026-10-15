'use client';

import { useRef } from 'react';
import Image from 'next/image';
import InternalPageBackground from './InternalPageBackground';
import Header from './Header';
import UpRightArrow from './components/UpRightArrow';

const agencyLogos = [
  { src: '/img/agencies/publicis.png', alt: 'Publicis', scale: 2, intrinsicW: 105, intrinsicH: 100 },
  { src: '/img/agencies/epsilon.png', alt: 'Epsilon', intrinsicW: 175, intrinsicH: 48 },
  { src: '/img/agencies/conversant.png', alt: 'Conversant', intrinsicW: 228, intrinsicH: 42 },
  { src: '/img/agencies/alliance.png', alt: 'Alliance Data', intrinsicW: 201, intrinsicH: 50 },
];

const navLinkStyle = {
  fontSize: 'clamp(0.82rem, 1.1vw, 0.9rem)',
  color: 'color-mix(in srgb, var(--t-text) 60%, transparent)',
  textDecoration: 'none',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const legalLinkStyle = {
  fontSize: '0.82rem',
  color: 'color-mix(in srgb, var(--t-text) 40%, transparent)',
  textDecoration: 'none',
  cursor: 'pointer',
};

export default function InnerPageShell({ children, secNum }) {
  const logoRef = useRef(null);

  return (
    <div className="inner-page-shell" style={{ minHeight: '100dvh', position: 'relative', background: 'var(--t-raised)' }}>
      <InternalPageBackground />

      <style>{`
        @keyframes agentMarquee { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
        .inner-page-shell #founders-top-strip {
          background: color-mix(in srgb, var(--t-raised) 72%, transparent);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: inset 0 -1px 0 rgba(0,0,0,0.05);
        }
        @media (max-width: 767px) {
          .inner-page-eyebrow { display: none; }
          .inner-page-marquee-contact { animation-duration: 14s !important; }
          .inner-page-marquee-agency  { animation-duration: 9s  !important; }
        }
      `}</style>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <Header logoRef={logoRef} onOpenPage={null} />

        {/* Page content injected here */}
        <div style={{ marginTop: '50px' }}>
          {children}
        </div>

        {/* Footer — matches homepage inline footer */}
        <footer
          id="inner-page-footer"
          style={{
            width: '100%',
            padding: 'clamp(2.5rem, 5vw, 4.5rem) clamp(1.25rem, max(8vw, calc((100% - 1100px) / 2)), 12rem) clamp(3rem, 6vw, 5rem)',
            boxSizing: 'border-box',
            borderTop: '1px solid var(--t-border-faint)',
          }}
        >
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(1rem, 2vw, 1.55rem)',
            textAlign: 'center',
            width: '100%',
            maxWidth: '46rem',
            margin: '0 auto',
          }}>
            {/* CONTACT marquee */}
            <div style={{
              width: '100%',
              overflow: 'hidden',
              marginBottom: 'clamp(24px, 5vw, 75px)',
              maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
            }}>
              <div className="inner-page-marquee-contact" style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 28s linear infinite' }}>
                {['a', 'b'].map((k) => (
                  <div key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                    {['CONTACT', '•', 'CONTACT', '•'].map((w, j) => (
                      <span key={j} style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(1.6rem, 8.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: 'var(--t-text)', whiteSpace: 'nowrap' }}>{w}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <Image id="inner-page-footer-signature" src="/img/sig.png" alt="Bryan Balli signature" width={276} height={208} style={{ width: 'min(110px, 31vw)', height: 'auto', display: 'block', filter: 'var(--t-logo-filter)' }} />

            <blockquote style={{ margin: 'clamp(1rem, 2vw, 1.5rem) 0', padding: 'clamp(1rem, 2vw, 1.5rem) clamp(1.25rem, 3vw, 2rem)', borderLeft: '3px solid color-mix(in srgb, var(--t-text) 15%, transparent)', fontSize: 'clamp(1.35rem, 1.85vw, 1.65rem)', lineHeight: 1.55, color: 'var(--t-text-secondary)', fontStyle: 'italic', fontFamily: "'Space Grotesk', system-ui, sans-serif", textAlign: 'left' }}>
              "Brief, prototype, and pipeline — scoped to what you actually need to launch and keep running."
            </blockquote>

            <p style={{ margin: 0, fontSize: 'clamp(0.7rem, 1.4vw, 0.91rem)', lineHeight: 1.6, fontWeight: 400, textAlign: 'left', color: 'color-mix(in srgb, var(--t-text) 80%, transparent)', width: '100%' }}>
              <strong>Bryan Balli</strong> leads a team across design and engineering as a Creative Technologist, with experience spanning agencies in Chicago, San Francisco, and remote teams. Ready to step into your process, see what's working, fix what's not, and build what's missing across design, content, and systems.
            </p>

            <a
              href="https://calendly.com/bballi/30min"
              target="_blank"
              rel="noopener noreferrer"
              className="cta-pill-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                padding: '0.5rem 0.75rem', lineHeight: 1, fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
                fontWeight: 700, letterSpacing: '0.01em', textDecoration: 'none', color: 'var(--t-on-solid)',
                background: 'linear-gradient(175deg, color-mix(in srgb, var(--t-glass-highlight) 40%, transparent) 0%, transparent 52%), var(--t-gradient-accent)',
                borderRadius: '999px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 color-mix(in srgb, var(--t-glass-highlight) 62.22%, transparent), inset 0 -1px 0 rgba(0,0,0,0.1)',
                whiteSpace: 'nowrap', marginTop: '20px', marginBottom: '20px',
              }}
            >
              <Image src="/img/profile2_400x400.png" alt="" aria-hidden="true" width={28} height={28} style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid color-mix(in srgb, var(--t-surface) 35%, transparent)', flexShrink: 0, display: 'block' }} />
              Meet With Your Human
              <UpRightArrow style={{ fontSize: '0.95rem', opacity: 0.9, marginLeft: '0.1rem' }} />
            </a>

            {/* Agency logo marquee */}
            <div style={{
              width: '100%', maxWidth: '325px', overflow: 'hidden',
              maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
            }}>
              <div className="inner-page-marquee-agency" style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 18s linear infinite' }}>
                {['a', 'b'].map((k) => (
                  <div key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '2rem', paddingRight: 'clamp(0.5rem, 1.5vw, 2rem)', flexShrink: 0 }}>
                    {agencyLogos.map((logo) => (
                      <Image key={logo.alt} src={logo.src} alt={k === 'a' ? logo.alt : ''} width={logo.intrinsicW} height={logo.intrinsicH} style={{ height: logo.scale ? `${22 * logo.scale}px` : '22px', width: 'auto', display: 'block', filter: 'var(--t-logo-filter-muted)', flexShrink: 0 }} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* SEO nav grid */}
          <nav aria-label="Site navigation" style={{
            display: 'flex', flexWrap: 'wrap', gap: 'clamp(2rem, 5vw, 4rem)',
            padding: 'clamp(2rem, 4vw, 3rem) 0',
            borderTop: '1px solid color-mix(in srgb, var(--t-text) 10%, transparent)', marginTop: '50px',
          }}>
            {[
              { heading: 'Work', links: [{ label: 'Featured Projects', href: '/work' }, { label: 'Case Studies', href: '/case-studies' }, { label: 'Process', href: '/process' }] },
              { heading: 'Services', links: [{ label: 'AI Design Consulting', href: '/services/ai-design-consulting' }, { label: 'Web Development', href: '/services/web-development' }, { label: 'Brand Identity', href: '/services/brand-identity' }, { label: 'Design Systems', href: '/services/design-systems' }, { label: 'SEO & GEO', href: '/services/seo-geo' }] },
              { heading: 'FAQ', links: [{ label: 'What Is a Creative Technologist?', href: '/faq#what-is-a-creative-technologist' }, { label: 'What Is an AI Design Engineer?', href: '/faq#ai-design-engineer' }, { label: 'How I Work', href: '/faq#how-i-work' }, { label: 'Pricing & Engagements', href: '/faq#pricing' }, { label: 'Turnaround & Availability', href: '/faq#turnaround' }] },
              { heading: 'Company', links: [{ label: 'About', href: '/about' }, { label: 'How It Works', href: '/how-it-works' }, { label: 'Contact', href: '/contact' }, { label: 'Book a Call', href: 'https://calendly.com/bballi/30min', external: true }] },
            ].map(({ heading, links }) => (
              <div key={heading} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', flex: '1 1 120px' }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--t-text) 35%, transparent)', marginBottom: '0.2rem' }}>{heading}</span>
                {links.map(({ label, href, external }) => (
                  <a key={label} href={href} style={navLinkStyle} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{label}</a>
                ))}
              </div>
            ))}
          </nav>

          {/* Bottom bar */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexWrap: 'wrap', gap: '0.75rem',
            paddingTop: 'clamp(1rem, 2vw, 1.5rem)', borderTop: '1px solid color-mix(in srgb, var(--t-text) 10%, transparent)',
          }}>
            <span style={{ fontSize: '0.78rem', color: 'color-mix(in srgb, var(--t-text) 35%, transparent)' }}>© 2026 Bryan Balli · All rights reserved</span>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <a href="https://www.linkedin.com/in/bryanballi" style={legalLinkStyle}>LinkedIn</a>
              <a href="https://x.com/bai_ee" style={legalLinkStyle}>𝕏</a>
              <a href="#" style={legalLinkStyle}>Privacy</a>
              <a href="#" style={legalLinkStyle}>Terms</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
