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
    id: 'seo',
    heading: 'SEO',
    body: 'Technical audit across crawlability, indexability, Core Web Vitals, structured data, and on-page signals. Lighthouse scores, LCP fixes, and a prioritized action list delivered as a structured brief.',
  },
  {
    id: 'geo',
    heading: 'GEO — Generative Engine Optimization',
    body: 'Optimizing content to be cited by ChatGPT, Perplexity, Google AI Overviews, and Bing Copilot. Structured answers, first-party data, schema markup, and topical authority signals — optimized for AI citation.',
  },
  {
    id: 'performance',
    heading: 'Performance',
    body: 'LCP, CLS, TTFB, and INP tracked against lab and field data. Fixes prioritized by actual impact. Delivered with before/after benchmarks.',
  },
  {
    id: 'content-intelligence',
    heading: 'Content Intelligence',
    body: 'AI-assisted content analysis: E-E-A-T scoring, keyword coverage gaps, internal linking structure, and FAQ schema generation. Every recommendation is backed by data from the intake run.',
  },
];

const INCLUDED = [
  'Lighthouse audit',
  'Core Web Vitals analysis',
  'Structured data (JSON-LD)',
  'FAQ schema generation',
  'GEO citation readiness score',
  'Competitive keyword gap analysis',
  'Internal linking recommendations',
];

export default function SeoGeoPage() {
  return (
    <>
      {/* Hero */}
      <section
        id="seo-geo-hero-section"
        style={{
          padding: sectionPadding,
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="seo-geo-hero-sec-num"
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
          05
        </span>

        <div
          id="seo-geo-hero-eyebrow"
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
          id="seo-geo-hero-headline"
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
          SEO &amp;<br />GEO.
        </h1>

        <p
          id="seo-geo-hero-sub"
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
          AI-assisted SEO audits, generative engine optimization, and performance baselines — built for visibility in both traditional search and AI-powered answers.
        </p>
      </section>

      {/* Content */}
      <section
        id="seo-geo-content-section"
        style={{ padding: sectionPadding }}
      >
        <div
          id="seo-geo-cards-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <style>{`@media (max-width: 800px) { #seo-geo-cards-grid { grid-template-columns: 1fr !important; } }`}</style>
          {CARDS.map((card) => (
            <div key={card.id} id={`seo-geo-card-${card.id}`} style={cardStyle}>
              <h2 style={cardHeadingStyle}>{card.heading}</h2>
              <p style={cardBodyStyle}>{card.body}</p>
            </div>
          ))}
        </div>

        {/* Full-width included card */}
        <div id="seo-geo-included-card" style={cardStyle}>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(90,83,70,0.7)',
            margin: '0 0 0.75rem',
          }}>
            {"What's Included"}
          </p>
          <p style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '13px',
            lineHeight: 1.8,
            color: 'rgba(26,26,26,0.78)',
            margin: 0,
          }}>
            {INCLUDED.join(' · ')}
          </p>
        </div>
      </section>
    </>
  );
}
