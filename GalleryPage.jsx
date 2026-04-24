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

const galleryTypes = [
  {
    id: 'gallery-card-web',
    eyebrow: 'Web · Interactive',
    desc: 'High-performance Three.js and WebGL interactive experiences — particle systems, terrain generation, holographic rendering.',
  },
  {
    id: 'gallery-card-dashboard',
    eyebrow: 'Dashboard · Platform',
    desc: 'AI-assisted client intelligence dashboards — real-time data surfaces, intake pipelines, and modular reporting.',
  },
  {
    id: 'gallery-card-brand',
    eyebrow: 'Brand · Identity',
    desc: 'Design system extractions, visual identity work, and token-based component libraries.',
  },
  {
    id: 'gallery-card-motion',
    eyebrow: 'Animation · Motion',
    desc: 'GSAP-powered scroll experiences, reveal animations, and motion design across web platforms.',
  },
];

export default function GalleryPage() {
  return (
    <InnerPageShell>
      <style>{`
        .inner-page-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        @media (max-width: 800px) { .inner-page-card-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Hero */}
      <section
        id="gallery-hero-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="gallery-hero-sec-num"
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
          GL
        </span>

        <div className="inner-page-eyebrow" style={eyebrowStyle}>
          <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
          Bryan Balli · Work
        </div>

        <h1
          id="gallery-hero-headline"
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
          Gallery.
        </h1>

        <p
          id="gallery-hero-sub"
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
          Visual samples across web, motion, brand, and interactive — a surface-level view of the work before the case studies are ready.
        </p>
      </section>

      {/* Gallery content */}
      <section
        id="gallery-content-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {/* 2 full-width intro cards */}
        <div id="gallery-card-whats-here" style={cardStyle}>
          <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>What's Here</h2>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>
            Screenshots, motion captures, and design frames from across the portfolio — web builds, particle systems, dashboard interfaces, brand identity work, and design system component libraries.
          </p>
        </div>

        <div id="gallery-card-whats-coming" style={cardStyle}>
          <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>What's Coming</h2>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>
            Full gallery with filterable categories, project context, and links to detailed case studies. Currently being prepared alongside case study documentation.
          </p>
        </div>

        {/* 2-col type grid */}
        <div className="inner-page-card-grid" style={{ marginTop: '0.5rem' }}>
          {galleryTypes.map(({ id, eyebrow, desc }) => (
            <div key={id} id={id} style={cardStyle}>
              <div style={eyebrowStyle}>
                <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
                {eyebrow}
              </div>
              <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </InnerPageShell>
  );
}
