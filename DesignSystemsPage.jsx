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
  color: 'var(--t-text-strong)',
  margin: '0 0 0.6rem',
};

const cardBodyStyle = {
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  fontWeight: 400,
  fontSize: 'clamp(0.88rem,1.4vw,1rem)',
  lineHeight: 1.7,
  color: 'color-mix(in srgb, var(--t-text-body) 78%, transparent)',
  margin: 0,
};

const CARDS = [
  {
    id: 'what-a-design-system-is',
    heading: 'What a Design System Is',
    body: 'Tokens for color, type, and spacing feed a component library that engineers install as a package — so any design update propagates across the product without manual reconciliation.',
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
          borderBottom: '1px solid color-mix(in srgb, var(--t-text-strong) 5%, transparent)',
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
            WebkitTextStroke: '1.5px color-mix(in srgb, var(--t-text-strong) 10%, transparent)',
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
            color: 'color-mix(in srgb, var(--t-text-eyebrow) 70%, transparent)',
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
            color: 'var(--t-text-strong)',
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
            color: 'var(--t-text-body)',
            maxWidth: '52ch',
            margin: 0,
          }}
        >
          Component libraries, token architecture, and design-to-code pipelines so engineers and designers pull from the same token set, reducing design-review cycles and eliminating one-off style overrides.
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
            color: 'color-mix(in srgb, var(--t-text-eyebrow) 70%, transparent)',
            margin: '0 0 0.75rem',
          }}>
            System Stack
          </p>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '13px',
            lineHeight: 1.8,
            color: 'color-mix(in srgb, var(--t-text-body) 78%, transparent)',
            margin: 0,
          }}>
            React · TypeScript · CSS Custom Properties · Figma tokens · Storybook · Radix UI primitives · Tailwind CSS (optional)
          </p>
        </div>
      </section>
    </>
  );
}
