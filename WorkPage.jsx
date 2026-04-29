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

const projects = [
  {
    id: 'work-card-intelligence',
    eyebrow: 'Platform · AI',
    name: 'Bballi Intelligence',
    desc: 'Modular AI-assisted client intelligence platform — intake pipelines, brand snapshot extraction, multi-device layout capture, SEO + performance audits, and real-time dashboards.',
  },
  {
    id: 'work-card-particles',
    eyebrow: 'Web · Three.js',
    name: 'Particle Systems',
    desc: 'High-performance interactive particle and 3D environments built with Three.js and WebGL — torus swarms, terrain generation, and holographic rendering.',
  },
  {
    id: 'work-card-design-system',
    eyebrow: 'Design System',
    name: 'System Build',
    desc: 'Token-based design system extracted from an existing brand — typography scale, color palette, spacing system, and a React component library built on top.',
  },
  {
    id: 'work-card-seo',
    eyebrow: 'SEO · GEO',
    name: 'Search Intelligence',
    desc: 'AI-assisted SEO and generative engine optimization audit — Lighthouse baseline, structured data implementation, GEO citation readiness, and content gap analysis.',
  },
];

export default function WorkPage() {
  return (
    <InnerPageShell>
      <style>{`
        .inner-page-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        @media (max-width: 800px) { .inner-page-card-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Hero */}
      <section
        id="work-hero-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="work-hero-sec-num"
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
          WK
        </span>

        <div className="inner-page-eyebrow" style={eyebrowStyle}>
          <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
          Bryan Balli · Work
        </div>

        <h1
          id="work-hero-headline"
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
          Featured<br />Work.
        </h1>

        <p
          id="work-hero-sub"
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
          Selected projects spanning AI-assisted platforms, interactive web experiences, design systems, and client intelligence dashboards.
        </p>
      </section>

      {/* Project cards */}
      <section
        id="work-projects-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
        }}
      >
        <div className="inner-page-card-grid">
          {projects.map(({ id, eyebrow, name, desc }) => (
            <div key={id} id={id} style={cardStyle}>
              <div style={eyebrowStyle}>
                <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
                {eyebrow}
              </div>
              <h2 style={{ fontFamily: '"Doto", monospace', fontWeight: 900, fontSize: 'clamp(1.8rem,3vw,2.8rem)', color: '#0a0a0a', margin: '0 0 0.75rem', lineHeight: 1.05 }}>{name}</h2>
              <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>

        {/* Full-width CTA card */}
        <div id="work-card-coming-soon" style={{ ...cardStyle, marginTop: '1.5rem' }}>
          <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>More Coming Soon</h2>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>
            Case studies with full process documentation and results are being prepared. Book a call to discuss a specific project type or see relevant work samples.
          </p>
        </div>
      </section>
    </InnerPageShell>
  );
}
