'use client';

import InnerPageShell from './InnerPageShell';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';

const cardStyle = {
  ...internalPageGlassCardStyle,
  borderRadius: '1rem',
  padding: 'clamp(1.25rem,2.5vw,2rem)',
};

const eyebrowStyle = {
  fontFamily: '"Space Mono", monospace',
  fontSize: '11px',
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(90,83,70,0.7)',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '0.75rem',
};

const studies = [
  {
    id: 'casestudies-card-platform',
    eyebrow: 'Coming Soon · Platform',
    title: 'Client Intelligence Platform',
    body: 'End-to-end documentation of the Bballi AI-assisted intake pipeline — from scraper architecture through dashboard delivery. Covering the design decisions, the data model, and the production constraints that shaped each phase.',
  },
  {
    id: 'casestudies-card-threejs',
    eyebrow: 'Coming Soon · Web',
    title: 'Three.js Interactive Experience',
    body: 'Build log for a high-performance particle system — performance budget, WebGL constraints, GSAP integration, and mobile optimization decisions.',
  },
  {
    id: 'casestudies-card-seo',
    eyebrow: 'Coming Soon · SEO',
    title: 'GEO Audit & Implementation',
    body: 'Full case study of a generative engine optimization engagement — baseline, structured data implementation, AI Overviews appearance, and measurable citation gains.',
  },
];

export default function CaseStudiesPage() {
  return (
    <InnerPageShell>
      {/* Hero */}
      <section
        id="casestudies-hero-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) max(10vw,calc((100% - 810px) / 2)) clamp(2.5rem,5vh,4rem)',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="casestudies-hero-sec-num"
          style={{
            position: 'absolute',
            top: '16px',
            right: 'clamp(1.25rem,4vw,3rem)',
            fontFamily: '"Doto", monospace',
            fontWeight: 900,
            fontSize: 'clamp(80px,14vw,220px)',
            color: 'transparent',
            WebkitTextStroke: '1.5px rgba(0,0,0,0.1)',
            lineHeight: 0.8,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          CS
        </span>

        <div className="inner-page-eyebrow" style={eyebrowStyle}>
          <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
          Bryan Balli · Work
        </div>

        <h1
          id="casestudies-hero-headline"
          style={{
            fontFamily: '"Doto", monospace',
            fontWeight: 900,
            letterSpacing: '-0.01em',
            lineHeight: 0.92,
            fontSize: 'clamp(52px,11vw,160px)',
            margin: '0 0 28px',
            textTransform: 'uppercase',
            color: '#0a0a0a',
          }}
        >
          Case<br />Studies.
        </h1>

        <p
          id="casestudies-hero-sub"
          style={{
            fontFamily: '"Space Grotesk", sans-serif',
            fontWeight: 300,
            fontSize: 'clamp(1.1rem,2.2vw,1.65rem)',
            lineHeight: 1.3,
            color: '#1a1a1a',
            maxWidth: '52ch',
            margin: 0,
          }}
        >
          Process documentation, results, and the decisions behind them — from intake through delivery.
        </p>
      </section>

      {/* Case study cards */}
      <section
        id="casestudies-cards-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) max(10vw,calc((100% - 810px) / 2)) clamp(2.5rem,5vh,4rem)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {studies.map(({ id, eyebrow, title, body }) => (
          <div key={id} id={id} style={cardStyle}>
            <div style={eyebrowStyle}>
              <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
              {eyebrow}
            </div>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1.1rem,1.8vw,1.35rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>{title}</h2>
            <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>{body}</p>
          </div>
        ))}

        {/* Notify card */}
        <div id="casestudies-card-notify" style={cardStyle}>
          <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.5rem' }}>Get Notified</h2>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: '0 0 1rem' }}>
            Case studies are published as projects reach handoff. Drop your email or book a call to discuss a specific use case now.
          </p>
          <a
            href="https://calendly.com/bballi/30min"
            target="_blank"
            rel="noopener noreferrer"
            className="cta-pill-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1.25rem',
              lineHeight: 1,
              fontSize: 'clamp(0.8rem,1.1vw,0.875rem)',
              fontWeight: 700,
              letterSpacing: '0.01em',
              textDecoration: 'none',
              color: '#ffffff',
              background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
              borderRadius: '999px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
              whiteSpace: 'nowrap',
            }}
          >
            Book a call ↗
          </a>
        </div>
      </section>
    </InnerPageShell>
  );
}
