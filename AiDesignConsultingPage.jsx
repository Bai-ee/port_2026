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
    id: 'what-it-is',
    heading: 'What It Is',
    body: 'AI design consulting combines software engineering, applied AI, and product design into a single engagement. Instead of treating AI as a tool you bolt on at the end, the work starts with AI — extracting signals, normalizing data, generating briefs, and surfacing intelligence that drives decisions.',
  },
  {
    id: 'who-its-for',
    heading: 'Who It\'s For',
    body: 'Founders and small teams who need to move fast. Agencies that want AI workflows integrated into client delivery. Businesses that have data but not the systems to act on it.',
  },
  {
    id: 'what-you-get',
    heading: 'What You Get',
    body: 'A structured intake brief, brand snapshot, SEO and performance baseline, and a working prototype — all built with AI at the center of the pipeline, not the periphery.',
  },
  {
    id: 'how-it-works',
    heading: 'How It Works',
    body: 'Phase 1 is always the smallest safe move: intake run, brief delivered, scope confirmed. Each subsequent phase is gated by your approval. No sprawling roadmaps.',
  },
];

const SERVICES = [
  'Client intelligence dashboards',
  'Modular intake pipelines',
  'Brand snapshot extraction',
  'SEO + performance audits',
  'Multi-device layout capture',
  'AI-assisted content recommendations',
];

export default function AiDesignConsultingPage() {
  return (
    <>
      {/* Hero */}
      <section
        id="ai-consulting-hero-section"
        style={{
          padding: sectionPadding,
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="ai-consulting-hero-sec-num"
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
          01
        </span>

        <div
          id="ai-consulting-hero-eyebrow"
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
          id="ai-consulting-hero-headline"
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
          AI Design<br />Consulting.
        </h1>

        <p
          id="ai-consulting-hero-sub"
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
          Building AI-assisted workflows, client intelligence pipelines, and production-quality web systems — from brand intake to deployed dashboard.
        </p>
      </section>

      {/* Content */}
      <section
        id="ai-consulting-content-section"
        style={{ padding: sectionPadding }}
      >
        {/* 2x2 card grid */}
        <div
          id="ai-consulting-cards-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <style>{`@media (max-width: 800px) { #ai-consulting-cards-grid { grid-template-columns: 1fr !important; } }`}</style>
          {CARDS.map((card) => (
            <div key={card.id} id={`ai-consulting-card-${card.id}`} style={cardStyle}>
              <h2 style={cardHeadingStyle}>{card.heading}</h2>
              <p style={cardBodyStyle}>{card.body}</p>
            </div>
          ))}
        </div>

        {/* Full-width services card */}
        <div id="ai-consulting-services-card" style={cardStyle}>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(90,83,70,0.7)',
            margin: '0 0 0.75rem',
          }}>
            Services Included
          </p>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '13px',
            lineHeight: 1.8,
            color: 'rgba(26,26,26,0.78)',
            margin: 0,
          }}>
            {SERVICES.join(' · ')}
          </p>
        </div>
      </section>
    </>
  );
}
