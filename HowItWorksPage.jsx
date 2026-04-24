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

const phases = [
  {
    id: 'howitworks-card-phase01',
    eyebrow: 'Phase 01',
    headline: 'Intake & Brief',
    body: 'A scraper runs against your site — or we start from a discovery call if you\'re pre-launch. Tone, offer clarity, audience signals, SEO baseline, and performance data are extracted and normalized into a structured brief. You receive it within 24–48 hours. No calls required to get started.',
  },
  {
    id: 'howitworks-card-phase02',
    eyebrow: 'Phase 02',
    headline: 'Scope & Prototype',
    body: 'Based on the brief, a scope is proposed: the smallest safe move that solves the highest-priority problem. This is usually a working prototype, a design system snapshot, or a dashboard build. You approve the scope before any code ships.',
  },
  {
    id: 'howitworks-card-phase03',
    eyebrow: 'Phase 03',
    headline: 'Build & Handoff',
    body: 'Implementation runs in explicit phases, each gated by your approval. Deliverables are reviewable at every step. When the build is complete, you receive the code, documentation, and a handoff brief covering what was built, what was intentionally left out, and what to watch.',
  },
];

export default function HowItWorksPage() {
  return (
    <InnerPageShell>
      <style>{`
        .inner-page-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        @media (max-width: 800px) { .inner-page-card-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Hero */}
      <section
        id="howitworks-hero-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="howitworks-hero-sec-num"
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
          HW
        </span>

        <div className="inner-page-eyebrow" style={eyebrowStyle}>
          <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
          Bryan Balli · Process
        </div>

        <h1
          id="howitworks-hero-headline"
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
          How It<br />Works.
        </h1>

        <p
          id="howitworks-hero-sub"
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
          From first contact to shipped product — a phased process designed to stay lean, move fast, and keep every decision reviewable.
        </p>
      </section>

      {/* Phase cards */}
      <section
        id="howitworks-phases-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {phases.map(({ id, eyebrow, headline, body }) => (
          <div key={id} id={id} style={cardStyle}>
            <div style={eyebrowStyle}>
              <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
              {eyebrow}
            </div>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1.1rem,1.8vw,1.35rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>{headline}</h2>
            <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>{body}</p>
          </div>
        ))}

        {/* 2-col bottom cards */}
        <div className="inner-page-card-grid" style={{ marginTop: '0.5rem' }}>
          <div id="howitworks-card-dont-get" style={cardStyle}>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>What You Don't Get</h2>
            <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>Sprawling roadmaps. Surprise pivots. Scope that quietly expands. Endless iterations without a decision. Each phase is defined, approved, and bounded before work begins.</p>
          </div>
          <div id="howitworks-card-do-get" style={cardStyle}>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>What You Do Get</h2>
            <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>A working artifact at the end of every phase. Clear reasoning behind every decision. A partner who flags problems before they become your problems.</p>
          </div>
        </div>
      </section>
    </InnerPageShell>
  );
}
