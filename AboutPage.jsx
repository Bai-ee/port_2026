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

export default function AboutPage() {
  return (
    <InnerPageShell>
      <style>{`
        .inner-page-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        @media (max-width: 800px) { .inner-page-card-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Hero */}
      <section
        id="about-hero-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="about-hero-sec-num"
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
          AB
        </span>

        <div className="inner-page-eyebrow" style={eyebrowStyle}>
          <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
          Bryan Balli · About
        </div>

        <h1
          id="about-hero-headline"
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
          AI Design<br />Engineer.
        </h1>

        <p
          id="about-hero-sub"
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
          Creative technologist with a decade of experience spanning design strategy and front-end engineering — building AI-assisted systems for founders, agencies, and growing teams.
        </p>
      </section>

      {/* 4-card grid */}
      <section
        id="about-cards-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) clamp(1.25rem,max(8vw,calc((100% - 1100px) / 2)),12rem) clamp(2.5rem,5vh,4rem)',
        }}
      >
        <div className="inner-page-card-grid">
          {[
            {
              id: 'about-card-work',
              title: 'The Work',
              body: 'Design systems, high-performance web builds, modular AI intake pipelines, client intelligence dashboards, SEO and GEO audits. The thread across all of it: making complex things ship with precision.',
            },
            {
              id: 'about-card-background',
              title: 'The Background',
              body: 'Agency experience across Publicis, Epsilon, Conversant, and Alliance Data — working with TikTok, HBO Max, and national brands. Now independent, focused on teams that need to move fast without sacrificing quality.',
            },
            {
              id: 'about-card-approach',
              title: 'The Approach',
              body: 'Every engagement starts with the smallest safe move. Phases are explicit, approvals gate each step, and scope doesn\'t drift. Clear reasoning instead of endless iterations.',
            },
            {
              id: 'about-card-availability',
              title: 'The Availability',
              body: 'Available beyond standard working hours to accommodate your flow state. One conversation translates across desktop, mobile, social, email, and print collateral.',
            },
          ].map(({ id, title, body }) => (
            <div key={id} id={id} style={cardStyle}>
              <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>{title}</h2>
              <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>

        {/* Full-width card */}
        <div id="about-card-experience" style={{ ...cardStyle, marginTop: '1.5rem' }}>
          <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>Experience Spanning</h2>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>
            Chicago · San Francisco · Remote international teams · Agencies · Independent practice · AI-native workflows since 2022
          </p>
        </div>
      </section>
    </InnerPageShell>
  );
}
