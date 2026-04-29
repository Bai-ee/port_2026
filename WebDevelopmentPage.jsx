'use client';

import { internalPageGlassCardStyle } from './pageSurfaceSystem';

const sectionPadding = 'clamp(3rem,8vh,7rem) max(10vw,calc((100% - 810px) / 2)) clamp(2.5rem,5vh,4rem)';

const cardStyle = {
  ...internalPageGlassCardStyle,
  borderRadius: '1rem',
  padding: 'clamp(1.25rem,2.5vw,2rem)',
};

const cardHeadingStyle = {
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  fontWeight: 700,
  fontSize: 'clamp(1rem,1.6vw,1.15rem)',
  color: '#0a0a0a',
  margin: '0 0 0.6rem',
};

const cardBodyStyle = {
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  fontWeight: 400,
  fontSize: 'clamp(0.88rem,1.4vw,1rem)',
  lineHeight: 1.7,
  color: 'rgba(26,26,26,0.78)',
  margin: 0,
};

const CARDS = [
  {
    id: 'the-stack',
    heading: 'The Stack',
    body: 'Next.js · React · TypeScript · GSAP · Three.js · Tailwind CSS · Firebase · Vercel. Every tool chosen for what the project needs — not for résumé surface area.',
  },
  {
    id: 'what-gets-built',
    heading: 'What Gets Built',
    body: 'Marketing sites, portfolio platforms, client dashboards, design system implementations, animated landing pages, and data-driven web applications.',
  },
  {
    id: 'the-standard',
    heading: 'The Standard',
    body: 'Pixel-accurate to design. Performant by default. Lighthouse scores are a starting point, not a finish line. Accessible, responsive, and built to last.',
  },
  {
    id: 'timeline',
    heading: 'Timeline',
    body: 'Scoped builds run 2–6 weeks. A focused prototype can ship in under a week. Timelines are explicit at the start of each phase and don\'t shift without a conversation.',
  },
];

export default function WebDevelopmentPage() {
  return (
    <>
      {/* Hero */}
      <section
        id="web-dev-hero-section"
        style={{
          padding: sectionPadding,
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="web-dev-hero-sec-num"
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
          02
        </span>

        <div
          id="web-dev-hero-eyebrow"
          className="inner-page-eyebrow"
          style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '11px',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'rgba(90,83,70,0.7)',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <span aria-hidden="true">●</span>
          Bryan Balli · Services
        </div>

        <h1
          id="web-dev-hero-headline"
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
          Web<br />Development.
        </h1>

        <p
          id="web-dev-hero-sub"
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
          High-performance web builds using Next.js, React, GSAP, and Three.js — shipped with design precision and production-grade engineering.
        </p>
      </section>

      {/* Content */}
      <section
        id="web-dev-content-section"
        style={{ padding: sectionPadding }}
      >
        <div
          id="web-dev-cards-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <style>{`@media (max-width: 800px) { #web-dev-cards-grid { grid-template-columns: 1fr !important; } }`}</style>
          {CARDS.map((card) => (
            <div key={card.id} id={`web-dev-card-${card.id}`} style={cardStyle}>
              <h2 style={cardHeadingStyle}>{card.heading}</h2>
              <p style={cardBodyStyle}>{card.body}</p>
            </div>
          ))}
        </div>

        {/* Full-width tech depth card */}
        <div id="web-dev-tech-depth-card" style={cardStyle}>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(90,83,70,0.7)',
            margin: '0 0 0.75rem',
          }}>
            Tech Depth
          </p>
          <p style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            fontSize: 'clamp(0.88rem,1.4vw,1rem)',
            lineHeight: 1.7,
            color: 'rgba(26,26,26,0.78)',
            margin: 0,
          }}>
            GSAP for complex animation sequences and scroll-driven experiences. Three.js for interactive 3D and particle systems. Next.js App Router for server components and edge-optimized delivery. Firebase for real-time data and authentication.
          </p>
        </div>
      </section>
    </>
  );
}
