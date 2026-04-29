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
    id: 'brand-snapshot',
    heading: 'Brand Snapshot',
    body: 'An automated crawl of your digital presence extracts tone cues, offer clarity, audience signals, and visual patterns — delivered as a structured brief you can act on immediately.',
  },
  {
    id: 'design-system-extraction',
    heading: 'Design System Extraction',
    body: 'From an existing site or Figma file, core tokens are extracted: typography scale, color palette, spacing system, and component inventory. Output is a production-ready design system.',
  },
  {
    id: 'visual-identity',
    heading: 'Visual Identity',
    body: 'Logo, color, type, and motion direction — aligned to your brand voice and positioned clearly against competitors in your space.',
  },
  {
    id: 'turnaround',
    heading: 'Turnaround',
    body: 'Brand snapshot: same day. Design system extraction from an existing brand: 3–5 days. Full visual identity engagement: quoted by scope after a discovery call.',
  },
];

const DELIVERABLES = [
  'Structured intake brief',
  'Token-based design system',
  'Color palette with accessibility ratios',
  'Typography scale',
  'Component inventory',
  'Competitive positioning snapshot',
];

export default function BrandIdentityPage() {
  return (
    <>
      {/* Hero */}
      <section
        id="brand-identity-hero-section"
        style={{
          padding: sectionPadding,
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="brand-identity-hero-sec-num"
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
          03
        </span>

        <div
          id="brand-identity-hero-eyebrow"
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
          id="brand-identity-hero-headline"
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
          Brand<br />Identity.
        </h1>

        <p
          id="brand-identity-hero-sub"
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
          Design system extraction, brand snapshot analysis, and visual identity work — translating brand direction into production-ready systems.
        </p>
      </section>

      {/* Content */}
      <section
        id="brand-identity-content-section"
        style={{ padding: sectionPadding }}
      >
        <div
          id="brand-identity-cards-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <style>{`@media (max-width: 800px) { #brand-identity-cards-grid { grid-template-columns: 1fr !important; } }`}</style>
          {CARDS.map((card) => (
            <div key={card.id} id={`brand-identity-card-${card.id}`} style={cardStyle}>
              <h2 style={cardHeadingStyle}>{card.heading}</h2>
              <p style={cardBodyStyle}>{card.body}</p>
            </div>
          ))}
        </div>

        {/* Full-width deliverables card */}
        <div id="brand-identity-deliverables-card" style={cardStyle}>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(90,83,70,0.7)',
            margin: '0 0 0.75rem',
          }}>
            Deliverables
          </p>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '13px',
            lineHeight: 1.8,
            color: 'rgba(26,26,26,0.78)',
            margin: 0,
          }}>
            {DELIVERABLES.join(' · ')}
          </p>
        </div>
      </section>
    </>
  );
}
