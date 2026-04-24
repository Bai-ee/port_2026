'use client';

import { internalPageGlassCardStyle } from './pageSurfaceSystem';

const sectionPadding = 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)';

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
    id: 'what-a-design-system-is',
    heading: 'What a Design System Is',
    body: 'A shared vocabulary between design and engineering — tokens for color, type, and spacing, a component library built on them, and documentation that keeps teams aligned as the product scales.',
  },
  {
    id: 'extraction-process',
    heading: 'The Extraction Process',
    body: 'Starting from an existing site or Figma file, design tokens are reverse-engineered, normalized, and rebuilt as a maintainable system. No starting from scratch unless the project calls for it.',
  },
  {
    id: 'implementation',
    heading: 'Implementation',
    body: 'Components are built in React with TypeScript, styled with the extracted tokens, and documented with usage guidelines. Delivered as a package your team can extend.',
  },
  {
    id: 'maintenance',
    heading: 'Maintenance',
    body: 'Ongoing retainer options available for system evolution — adding components, updating tokens, reviewing pull requests for system consistency.',
  },
];

export default function DesignSystemsPage() {
  return (
    <>
      {/* Hero */}
      <section
        id="design-systems-hero-section"
        style={{
          padding: sectionPadding,
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="design-systems-hero-sec-num"
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
          04
        </span>

        <div
          id="design-systems-hero-eyebrow"
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
          id="design-systems-hero-headline"
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
          Design<br />Systems.
        </h1>

        <p
          id="design-systems-hero-sub"
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
          Component libraries, token architecture, and design-to-code pipelines that give teams a single source of truth and a faster path to ship.
        </p>
      </section>

      {/* Content */}
      <section
        id="design-systems-content-section"
        style={{ padding: sectionPadding }}
      >
        <div
          id="design-systems-cards-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <style>{`@media (max-width: 800px) { #design-systems-cards-grid { grid-template-columns: 1fr !important; } }`}</style>
          {CARDS.map((card) => (
            <div key={card.id} id={`design-systems-card-${card.id}`} style={cardStyle}>
              <h2 style={cardHeadingStyle}>{card.heading}</h2>
              <p style={cardBodyStyle}>{card.body}</p>
            </div>
          ))}
        </div>

        {/* Full-width system stack card */}
        <div id="design-systems-stack-card" style={cardStyle}>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(90,83,70,0.7)',
            margin: '0 0 0.75rem',
          }}>
            System Stack
          </p>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '13px',
            lineHeight: 1.8,
            color: 'rgba(26,26,26,0.78)',
            margin: 0,
          }}>
            React · TypeScript · CSS Custom Properties · Figma tokens · Storybook · Radix UI primitives · Tailwind CSS (optional)
          </p>
        </div>
      </section>
    </>
  );
}
