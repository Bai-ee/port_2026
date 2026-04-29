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

const steps = [
  {
    id: 'process-card-step01',
    step: 'Step 01',
    title: 'Discovery',
    body: 'A 30-minute call or async intake run. We establish what you\'re trying to fix, what already exists, and what the smallest safe first move looks like. Output: a scoped brief and a phase proposal.',
  },
  {
    id: 'process-card-step02',
    step: 'Step 02',
    title: 'Intake & Brief',
    body: 'If you have a live site, the intake scraper runs — extracting tone, offer clarity, audience signals, SEO baseline, and performance data. Normalized into a structured brief. Delivered within 24–48 hours. No calls required.',
  },
  {
    id: 'process-card-step03',
    step: 'Step 03',
    title: 'Build',
    body: 'Implementation in explicit phases. Phase 1 is always the smallest safe move. Each phase ships a working artifact — prototype, component, or dashboard. Your approval gates the next phase.',
  },
  {
    id: 'process-card-step04',
    step: 'Step 04',
    title: 'Handoff',
    body: 'Code, documentation, and a handoff brief. What was built, what was intentionally left out, what to watch. No black-box handoffs. Everything is legible to your team or a future engineer.',
  },
];

export default function ProcessPage() {
  return (
    <InnerPageShell>
      <style>{`
        .inner-page-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        @media (max-width: 800px) { .inner-page-card-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Hero */}
      <section
        id="process-hero-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) max(10vw,calc((100% - 810px) / 2)) clamp(2.5rem,5vh,4rem)',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="process-hero-sec-num"
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
          PR
        </span>

        <div className="inner-page-eyebrow" style={eyebrowStyle}>
          <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
          Bryan Balli · Process
        </div>

        <h1
          id="process-hero-headline"
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
          The<br />Process.
        </h1>

        <p
          id="process-hero-sub"
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
          A phased, approval-gated process built for speed, clarity, and zero scope drift. Every step is visible. Every decision is explained.
        </p>
      </section>

      {/* Steps + bottom grid */}
      <section
        id="process-steps-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) max(10vw,calc((100% - 810px) / 2)) clamp(2.5rem,5vh,4rem)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {steps.map(({ id, step, title, body }) => (
          <div key={id} id={id} style={cardStyle}>
            <div style={eyebrowStyle}>
              <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
              {step}
            </div>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1.1rem,1.8vw,1.35rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>{title}</h2>
            <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>{body}</p>
          </div>
        ))}

        <div className="inner-page-card-grid" style={{ marginTop: '0.5rem' }}>
          <div id="process-card-clean" style={cardStyle}>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>What Keeps It Clean</h2>
            <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>Scope is defined before work starts. Approvals gate each phase. Changes to scope are surfaced immediately — not absorbed silently and billed later.</p>
          </div>
          <div id="process-card-fast" style={cardStyle}>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 700, fontSize: 'clamp(1rem,1.5vw,1.15rem)', color: '#0a0a0a', margin: '0 0 0.75rem' }}>What Keeps It Fast</h2>
            <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>AI-assisted workflows compress research, brief generation, and content analysis from days to hours. The human work stays human — decisions, craft, and judgment.</p>
          </div>
        </div>
      </section>
    </InnerPageShell>
  );
}
